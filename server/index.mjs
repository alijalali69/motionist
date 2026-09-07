// Motionist local server. Bridges the browser app to the Python PSD extractor,
// the filesystem (per-project storage, uploads), and the Remotion renderer.
import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import {
  routePage,
  readManifest,
  defaultLoader,
  defaultSubtitle,
  defaultSubtitleStyle,
  FPS,
} from "../tools/compose.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data", "projects");
const LEGACY_PROJECT_JSON = path.join(ROOT, "src", "project.json");
const PORT = 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/public", express.static(PUBLIC));
app.use("/out", express.static(path.join(ROOT, "out")));

const upload = multer({ dest: path.join(ROOT, ".uploads") });

// `timeoutMs` is opt-in (undefined = no timeout, the original unbounded
// behavior — the actual render path via runStreaming() below is NOT this
// function and already has its own job-based cancel button, so it's never
// safe to impose a blanket timeout there). Passed explicitly at call sites
// where a hang has no other recovery path (PSD/SVG ingest — a stuck
// psd-tools/svgelements parse used to leave /api/ingest blocked forever
// with no cancel button, unlike the render pipeline).
function run(cmd, args, opts = {}) {
  const { timeoutMs, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, shell: true, ...spawnOpts });
    let out = "", err = "", timedOut = false;
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        // shell:true launches cmd.exe, which launches the real work as a
        // child of THAT — plain p.kill() only kills the shell and orphans
        // the actual process, same reasoning as the render-cancel route.
        if (p.pid) spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { shell: true });
      }, timeoutMs);
    }
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) return reject(new Error(`${cmd} timed out after ${timeoutMs}ms and was killed`));
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${err}`));
    });
  });
}

// Same as run(), but calls onLine(line) for every complete stdout line as it
// streams in, instead of only handing back the full output at the end —
// needed to report render progress while the process is still running.
// onSpawn(proc), if given, fires once with the actual ChildProcess — how the
// caller gets a pid to cancel a running render by.
function runStreaming(cmd, args, onLine, onSpawn, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, shell: true, ...opts });
    if (onSpawn) onSpawn(p);
    let err = "", buf = "";
    p.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (buf) onLine(buf); // trailing partial line with no final newline
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${err}`));
    });
  });
}

// Remotion's CLI prints its own progress to stdout as plain text — parse the
// three phases it goes through into one continuous 0-100 for the UI. Weights
// are a guess at relative real-world duration (rendering is the bulk of it),
// not measured — good enough for a progress bar, not meant to be exact.
function parseProgressLine(line) {
  let m;
  if ((m = line.match(/^Bundling (\d+)%/))) {
    return { phase: "bundling", percent: (+m[1] / 100) * 10 };
  }
  if ((m = line.match(/^Rendered (\d+)\/(\d+)/))) {
    const frame = +m[1], totalFrames = +m[2];
    return { phase: "rendering", percent: 10 + (frame / totalFrames) * 75, frame, totalFrames };
  }
  if ((m = line.match(/^Encoded (\d+)\/(\d+)/))) {
    const frame = +m[1], totalFrames = +m[2];
    return { phase: "encoding", percent: 85 + (frame / totalFrames) * 15, frame, totalFrames };
  }
  return null;
}

// Remotion downloads its own headless Chrome from Google's CDN on first
// render — some regions get a flat 403 from that CDN entirely ("this
// service is not available in your location", hit by a user rendering from
// Iran). If a real Chrome/Edge is already installed, point Remotion at that
// instead of downloading — skips the CDN dependency altogether.
function findLocalBrowser() {
  const candidates = [
    path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// Only kicks in when the render actually fails on a browser-download
// problem — everyone whose download already works (this machine, today)
// keeps using Remotion's own pinned Chrome build unchanged. Retries exactly
// once, with `--browser-executable` pointing at whatever local browser
// findLocalBrowser() found, if any. `onLine` gets every stdout line from
// whichever attempt is currently running, for progress reporting; `onSpawn`
// fires again on the retry so a cancel button always targets the process
// that's actually running right now.
async function runRenderWithBrowserFallback(args, onLine, onSpawn) {
  try {
    return await runStreaming("npx", args, onLine, onSpawn);
  } catch (e) {
    const msg = String(e.message || e);
    const looksLikeBrowserDownloadFailure = /chrome-for-testing|chrome-headless-shell|downloading file|AccessDenied/i.test(msg);
    const localBrowser = looksLikeBrowserDownloadFailure ? findLocalBrowser() : null;
    if (!localBrowser) throw e;
    // `run()`/`runStreaming()` spawn with `shell: true`, which (per Node's
    // own docs/deprecation warning) does NOT escape array args — it just
    // concatenates them into one command line for cmd.exe to split on
    // whitespace again. An unquoted Program Files path truncates at the
    // first space ("browserExecutable" was specified as 'C:\Program' but
    // the path doesn't exist — the exact failure this hit in the wild).
    // Quoting the whole flag=value argument keeps it one token.
    return await runStreaming("npx", [...args, `"--browser-executable=${localBrowser}"`], onLine, onSpawn);
  }
}

// --- Project storage: one JSON file per project under data/projects/<id>.json
fs.mkdirSync(DATA_DIR, { recursive: true });

function projectPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function readProject(id) {
  const p = projectPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeProject(project) {
  project.updatedAt = new Date().toISOString();
  fs.writeFileSync(projectPath(project.projectId), JSON.stringify(project, null, 2), "utf-8");
  return project;
}

function newProjectId() {
  return "proj_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function emptyProject(id, name, w = 1080, h = 1920) {
  const now = new Date().toISOString();
  return {
    fps: FPS, width: w, height: h, projectId: id, name,
    createdAt: now, updatedAt: now,
    template: { layers: [] },
    logo: null, bg: null, title: null, // `title` here = the global Title asset slot
    loader: defaultLoader(w, h),
    loaderVisible: false, // most reels don't want it; opt-in per project instead of opt-out

    subtitle: defaultSubtitle(w, h),
    subtitleStyle: defaultSubtitleStyle(h),
    captions: [],
    pages: [],
  };
}

// Note: src/project.json is NOT a real project — it's a scratch file the
// render route below overwrites on every render (Remotion Studio and the
// CLI render/still scripts read it as their default props). An old one-time
// migration used to fold it into data/projects/ whenever that folder was
// empty, which meant deleting all your projects would silently resurrect
// whatever this scratch file last happened to hold. Removed — that
// transitional need (pre-multi-project) is long past.

// Real rendered thumbnails: frame 0 of the actual "Reel" composition (see the
// /api/projects/:id/thumbnail route below), one PNG per project — genuinely
// what the reel looks like (bg, text, logo, everything), not a guess. Written
// under out/ so the existing "/out" static mount already serves it, no new
// mount needed.
const THUMBS_DIR = path.join(ROOT, "out", "thumbs");
fs.mkdirSync(THUMBS_DIR, { recursive: true });
function thumbPath(projectId) {
  return path.join(THUMBS_DIR, `${projectId}.png`);
}

// A representative thumbnail for the dashboard. Prefers the real rendered
// still if one's been generated yet; falls back to a naive heuristic (first
// content layer's image on the first page, else the global bg, else null —
// dashboard shows a placeholder card) for a project that hasn't been opened
// since this feature shipped, or whose render failed.
function thumbnailFor(project) {
  if (fs.existsSync(thumbPath(project.projectId))) {
    // Cache-bust on updatedAt so an edited project's card doesn't keep
    // showing a browser-cached copy of the old still.
    return `/out/thumbs/${project.projectId}.png?t=${encodeURIComponent(project.updatedAt || "")}`;
  }
  // Root-relative path (no /public prefix) — matches how Vite's publicDir and
  // Remotion's staticFile() both serve public/* at the site root.
  const firstLayer = project.pages?.[0]?.layers?.[0];
  if (firstLayer?.file) return `/${firstLayer.file}`;
  if (project.bg?.fallback) return `/${project.bg.fallback}`;
  if (project.bg?.file) return `/${project.bg.file}`;
  return null;
}

function summarize(project) {
  return {
    id: project.projectId,
    name: project.name || project.projectId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    pageCount: project.pages?.length ?? 0,
    width: project.width,
    height: project.height,
    thumbnail: thumbnailFor(project),
  };
}

// --- Global font library: uploaded once from the Dashboard, then reusable by
// every project — instead of the old per-project-only upload. Each entry is
// one weight/style variant (a Regular and a Bold of the same family are two
// separate entries sharing a `family` name); `cssFamily` is a unique internal
// @font-face name so the browser never confuses two different uploaded files
// that happen to share a display name.
const FONTS_JSON = path.join(ROOT, "data", "fonts.json");
const FONTS_DIR = path.join(PUBLIC, "fonts");
fs.mkdirSync(FONTS_DIR, { recursive: true });

function readFonts() {
  if (!fs.existsSync(FONTS_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(FONTS_JSON, "utf-8")); } catch { return []; }
}
function writeFonts(list) {
  fs.writeFileSync(FONTS_JSON, JSON.stringify(list, null, 2), "utf-8");
}

app.get("/api/fonts", (_req, res) => res.json(readFonts()));

app.post("/api/fonts", upload.single("font"), (req, res) => {
  try {
    const family = (req.body.family || "").trim();
    const style = (req.body.style || "Regular").trim();
    if (!family) return res.status(400).json({ error: "family name required" });
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (![".ttf", ".otf", ".woff", ".woff2"].includes(ext)) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "font must be .ttf/.otf/.woff/.woff2" });
    }
    assertRealFile(req.file);
    const id = "font_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const fileName = `${id}${ext}`;
    fs.renameSync(req.file.path, path.join(FONTS_DIR, fileName));
    const entry = {
      id,
      family,
      style,
      cssFamily: id, // unique per uploaded file — never re-derived, never shared
      file: `fonts/${fileName}`,
      originalName: req.file.originalname,
      createdAt: new Date().toISOString(),
    };
    const list = readFonts();
    list.push(entry);
    writeFonts(list);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/fonts/:id", (req, res) => {
  const list = readFonts();
  const entry = list.find((f) => f.id === req.params.id);
  if (entry) {
    const p = path.join(PUBLIC, entry.file);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  writeFonts(list.filter((f) => f.id !== req.params.id));
  res.json({ ok: true });
});

// --- Global motion preset library: a named IN/OUT effect combo (the same
// shape the app's in-memory "Copy/Paste motion" clip already uses), saved
// once and reusable across every project — mirrors the font library above,
// just with no file to store since a preset is plain JSON.
const MOTION_PRESETS_JSON = path.join(ROOT, "data", "motion-presets.json");

function readMotionPresets() {
  if (!fs.existsSync(MOTION_PRESETS_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(MOTION_PRESETS_JSON, "utf-8")); } catch { return []; }
}
function writeMotionPresets(list) {
  fs.writeFileSync(MOTION_PRESETS_JSON, JSON.stringify(list, null, 2), "utf-8");
}

app.get("/api/motion-presets", (_req, res) => res.json(readMotionPresets()));

app.post("/api/motion-presets", (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    if (!req.body?.clip || typeof req.body.clip !== "object") {
      return res.status(400).json({ error: "clip required" });
    }
    const entry = {
      id: "motion_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      clip: req.body.clip,
      createdAt: new Date().toISOString(),
    };
    const list = readMotionPresets();
    list.push(entry);
    writeMotionPresets(list);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/motion-presets/:id", (req, res) => {
  writeMotionPresets(readMotionPresets().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

// --- Global brand-color library: a saved hex, reusable across every
// project — same mirrors-the-font-library idea as motion presets above,
// plain JSON, nothing to store on disk beyond the hex itself. Fonts are
// already global (FontManager, uploaded once from the Dashboard);
// Project.swatches was the one color-related thing still stuck per-
// project — this is that gap closed the same way.
const BRAND_COLORS_JSON = path.join(ROOT, "data", "brand-colors.json");

function readBrandColors() {
  if (!fs.existsSync(BRAND_COLORS_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(BRAND_COLORS_JSON, "utf-8")); } catch { return []; }
}
function writeBrandColors(list) {
  fs.writeFileSync(BRAND_COLORS_JSON, JSON.stringify(list, null, 2), "utf-8");
}

app.get("/api/brand-colors", (_req, res) => res.json(readBrandColors()));

app.post("/api/brand-colors", (req, res) => {
  try {
    const hex = (req.body?.hex || "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return res.status(400).json({ error: "hex must be #rrggbb" });
    const name = (req.body?.name || "").trim() || undefined;
    const list = readBrandColors();
    if (list.some((c) => c.hex.toLowerCase() === hex.toLowerCase())) {
      return res.status(400).json({ error: "that color is already saved" });
    }
    const entry = {
      id: "color_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      hex, name, createdAt: new Date().toISOString(),
    };
    list.push(entry);
    writeBrandColors(list);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/brand-colors/:id", (req, res) => {
  writeBrandColors(readBrandColors().filter((c) => c.id !== req.params.id));
  res.json({ ok: true });
});

// --- Page-layout template library: a whole SAVED PAGE (its layers, box
// positions, motion, background style — everything but the source
// project's own id), reusable across any project. Unlike a motion preset
// (plain JSON, nothing to store), a page can carry real uploaded photo/
// video/text art, so saving one as a template also has to physically copy
// those asset files somewhere that outlives the source project — a shared
// public/page-templates/<templateId>/ store, not the source project's own
// projects/<id>/ folder (which the user might delete later). Same
// path-rewrite-by-walk approach as /api/projects/:id/duplicate above, just
// copying into a different destination convention.
const PAGE_TEMPLATES_JSON = path.join(ROOT, "data", "page-templates.json");
const PAGE_TEMPLATES_DIR = path.join(PUBLIC, "page-templates");
fs.mkdirSync(PAGE_TEMPLATES_DIR, { recursive: true });

function readPageTemplates() {
  if (!fs.existsSync(PAGE_TEMPLATES_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(PAGE_TEMPLATES_JSON, "utf-8")); } catch { return []; }
}
function writePageTemplates(list) {
  fs.writeFileSync(PAGE_TEMPLATES_JSON, JSON.stringify(list, null, 2), "utf-8");
}

// A page's thumbnail is just its first real content layer's own file (same
// idea as a project's own summarize()/thumbnailFor above).
function pageThumbnail(page) {
  const firstLayer = (page.layers ?? []).find((l) => l.file);
  return firstLayer ? `/${firstLayer.file}` : null;
}

app.get("/api/page-templates", (_req, res) => res.json(readPageTemplates().map((t) => ({
  id: t.id, name: t.name, createdAt: t.createdAt, thumbnail: pageThumbnail(t.page),
}))));

// Full template (page + layers) — fetched only when the user actually
// applies one, not for the picker list above.
app.get("/api/page-templates/:id", (req, res) => {
  const t = readPageTemplates().find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "template not found" });
  res.json(t);
});

app.post("/api/page-templates", (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const projectId = req.body?.projectId;
    const page = req.body?.page;
    if (!name) return res.status(400).json({ error: "name required" });
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    if (!page || typeof page !== "object") return res.status(400).json({ error: "page required" });

    const id = "tmpl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const destDir = path.join(PAGE_TEMPLATES_DIR, id);
    const srcPrefix = `projects/${projectId}/`;
    const destPrefix = `page-templates/${id}/`;

    const cloned = structuredClone(page);
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") {
        for (const k of Object.keys(v)) {
          if (typeof v[k] === "string" && v[k].startsWith(srcPrefix)) {
            const subPath = v[k].slice(srcPrefix.length); // e.g. "assets/photo_...png"
            const srcAbs = path.join(PUBLIC, "projects", projectId, subPath);
            const destAbs = path.join(destDir, subPath);
            if (fs.existsSync(srcAbs)) {
              fs.mkdirSync(path.dirname(destAbs), { recursive: true });
              fs.copyFileSync(srcAbs, destAbs);
            }
            v[k] = destPrefix + subPath;
          } else if (v[k] && typeof v[k] === "object") {
            walk(v[k]);
          }
        }
      }
    };
    walk(cloned);

    const entry = { id, name, page: cloned, createdAt: new Date().toISOString() };
    const list = readPageTemplates();
    list.push(entry);
    writePageTemplates(list);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/page-templates/:id", (req, res) => {
  const id = req.params.id;
  writePageTemplates(readPageTemplates().filter((t) => t.id !== id));
  const dir = path.join(PAGE_TEMPLATES_DIR, id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// --- Custom canvas-size presets: same pattern as motion presets above — a
// named width/height saved once from the Dashboard's "+ Custom size" card,
// reusable as its own size-preset card afterward.
const SIZE_PRESETS_JSON = path.join(ROOT, "data", "size-presets.json");

function readSizePresets() {
  if (!fs.existsSync(SIZE_PRESETS_JSON)) return [];
  try { return JSON.parse(fs.readFileSync(SIZE_PRESETS_JSON, "utf-8")); } catch { return []; }
}
function writeSizePresets(list) {
  fs.writeFileSync(SIZE_PRESETS_JSON, JSON.stringify(list, null, 2), "utf-8");
}

app.get("/api/size-presets", (_req, res) => res.json(readSizePresets()));

app.post("/api/size-presets", (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const w = Math.round(Number(req.body?.w));
    const h = Math.round(Number(req.body?.h));
    if (!name) return res.status(400).json({ error: "name required" });
    if (!(w > 0 && h > 0)) return res.status(400).json({ error: "width/height required" });
    const entry = {
      id: "size_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, w, h,
      createdAt: new Date().toISOString(),
    };
    const list = readSizePresets();
    list.push(entry);
    writeSizePresets(list);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/size-presets/:id", (req, res) => {
  writeSizePresets(readSizePresets().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

// --- Dashboard: list / create / delete projects -------------------------------
app.get("/api/projects", (_req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const list = files
    .map((f) => {
      try { return summarize(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8"))); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  res.json(list);
});

app.post("/api/projects", (req, res) => {
  const name = (req.body?.name || "").trim() || "Untitled reel";
  const id = newProjectId();
  // Sane bounds so a stray/garbage value can't hand Remotion a broken
  // composition size — clamp instead of trusting the client outright.
  const clampDim = (v, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 16 && n <= 8192 ? n : dflt;
  };
  const width = clampDim(req.body?.width, 1080);
  const height = clampDim(req.body?.height, 1920);
  const project = emptyProject(id, name, width, height);
  writeProject(project);
  res.json(project);
});

app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const p = projectPath(id);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  const assetDir = path.join(PUBLIC, "projects", id);
  if (fs.existsSync(assetDir)) fs.rmSync(assetDir, { recursive: true, force: true });
  res.json({ ok: true });
});

// Every asset path stored anywhere in a project (bg/title/logo/audio, each
// page's layers, ingested PSD/SVG page art) is always written by this same
// server as the literal string "projects/<projectId>/<subdir>/<file>" — see
// saveMedia's `rel` and /api/ingest's exportDir above, and tools/compose.mjs
// on the Python-extraction side. That means a plain string-replace of the
// id prefix, after physically copying the relevant asset folder, re-points
// every reference at the new copy correctly with no per-field asset logic
// needed — a page's layers array, its bgStyle, everything just falls out of
// one recursive walk. Shared by both project- and page-level duplication
// below (same trick, different prefix/scope).
function rewritePathPrefix(v, oldPrefix, newPrefix) {
  if (Array.isArray(v)) { v.forEach((x) => rewritePathPrefix(x, oldPrefix, newPrefix)); return; }
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (typeof v[k] === "string" && v[k].startsWith(oldPrefix)) v[k] = newPrefix + v[k].slice(oldPrefix.length);
      else if (v[k] && typeof v[k] === "object") rewritePathPrefix(v[k], oldPrefix, newPrefix);
    }
  }
}

// --- Duplicate a project: a full independent copy, own assets included ------
app.post("/api/projects/:id/duplicate", (req, res) => {
  try {
    const oldId = req.params.id;
    const src = readProject(oldId);
    if (!src) return res.status(404).json({ error: "project not found" });

    const newId = newProjectId();
    const srcDir = path.join(PUBLIC, "projects", oldId);
    const destDir = path.join(PUBLIC, "projects", newId);
    if (fs.existsSync(srcDir)) fs.cpSync(srcDir, destDir, { recursive: true });

    const project = structuredClone(src);
    project.projectId = newId;
    project.name = `${src.name || src.projectId} copy`;
    const now = new Date().toISOString();
    project.createdAt = now;
    project.updatedAt = now;

    rewritePathPrefix(project, `projects/${oldId}/`, `projects/${newId}/`);

    writeProject(project);
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Duplicate ONE page within a project: same idea, scoped to that page's
// own asset folder (projects/<projectId>/<pageId>/) instead of the whole
// project's. Has to physically copy the files and mint a new page id
// server-side (not left to the client, unlike template-insert's page id —
// see onInsertTemplate in App.tsx — since that path has no per-project
// files to copy in the first place); the client just splices the returned
// page into project.pages and saves normally. Doing this via the plain
// project-JSON prefix-rewrite instead of leaving the two pages sharing one
// folder matters for real: this app's own page delete removes its whole
// asset folder (see delPage in App.tsx) — two pages pointing at the same
// folder would mean deleting either one silently breaks the other's images.
app.post("/api/projects/:id/pages/:pageId/duplicate", (req, res) => {
  try {
    const projectId = req.params.id;
    const oldPageId = req.params.pageId;
    const project = readProject(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
    const page = project.pages?.find((p) => p.id === oldPageId);
    if (!page) return res.status(404).json({ error: "page not found" });

    const newPageId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const srcDir = path.join(PUBLIC, "projects", projectId, oldPageId);
    const destDir = path.join(PUBLIC, "projects", projectId, newPageId);
    if (fs.existsSync(srcDir)) fs.cpSync(srcDir, destDir, { recursive: true });

    const copy = structuredClone(page);
    copy.id = newPageId;
    if (copy.name) copy.name = `${copy.name} copy`;

    rewritePathPrefix(copy, `projects/${projectId}/${oldPageId}/`, `projects/${projectId}/${newPageId}/`);

    res.json(copy);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Single project load / save -----------------------------------------------
app.get("/api/projects/:id", (req, res) => {
  const project = readProject(req.params.id);
  if (!project) return res.status(404).json({ error: "project not found" });
  res.json(project);
});

app.post("/api/projects/:id", (req, res) => {
  const project = req.body;
  project.projectId = req.params.id; // trust the URL, not the body
  writeProject(project);
  res.json({ ok: true });
});

// --- Dashboard thumbnail: frame 0 of the real "Reel" composition --------------
// Called by the client on leaving the editor back to the Dashboard —
// fire-and-forget, not awaited by navigation. Reuses buildRenderArgs' own
// mirror-into-src/project.json + CLI-spawn pattern, just with `still` instead
// of `render` and a low --scale (a dashboard card is tiny; full 1080x1920 is
// wasted render time and disk space for what's shown at ~150px wide).
app.post("/api/projects/:id/thumbnail", async (req, res) => {
  try {
    const project = readProject(req.params.id);
    if (!project) return res.status(404).json({ error: "project not found" });
    if (!project.pages?.length) return res.json({ skipped: "no pages yet" });
    fs.writeFileSync(LEGACY_PROJECT_JSON, JSON.stringify(project, null, 2), "utf-8");
    const outArg = `out/thumbs/${project.projectId}.png`;
    const args = ["remotion", "still", "Reel", outArg, "--props=src/project.json", "--scale=0.3"];
    // Bounded timeout — this rides on the "leave editor" path, not a button
    // with its own cancel affordance; a stuck render here shouldn't hang
    // forever the way a user-initiated one (with Cancel) is allowed to.
    await run("npx", args, { timeoutMs: 60000 });
    res.json({ ok: true, thumbnail: thumbnailFor(project) });
  } catch (e) {
    // Non-fatal by design — thumbnailFor() just keeps returning whatever it
    // returned before (naive heuristic or the last successful still).
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Ingest one PSD/SVG as a page ---------------------------------------------
app.post("/api/ingest", upload.single("psd"), async (req, res) => {
  try {
    const projectId = req.body.projectId;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const pageId = "p" + Date.now().toString(36);
    const exportDir = path.join(PUBLIC, "projects", projectId, pageId);
    // Pick the extractor by file type: PSD (raster layers) vs SVG (vector layers).
    const ext = path.extname(req.file.originalname).toLowerCase();
    const script = ext === ".svg" ? "tools/svg_layers.py" : "tools/psd_layers.py";
    await run("python", [
      script,
      JSON.stringify(req.file.path),
      "--export", JSON.stringify(exportDir),
      "--max-side", "1920",
    ], { timeoutMs: 120_000 }); // 2min — generous for a huge multi-layer PSD, but bounded: previously unbounded, a stuck parse hung /api/ingest forever with no recovery
    fs.rmSync(req.file.path, { force: true });
    const manifest = readManifest(path.join(PUBLIC, "projects", projectId), pageId);
    const routed = routePage(projectId, pageId, manifest);
    const [cw, ch] = routed.canvas;
    res.json({
      ...routed,
      defaults: {
        loader: defaultLoader(cw, ch),
        subtitle: defaultSubtitle(cw, ch),
        subtitleStyle: defaultSubtitleStyle(ch),
        fps: FPS,
      },
      sourceName: req.file.originalname,
    });
  } catch (e) {
    // The uploaded temp file was never cleaned up on a failed/timed-out
    // ingest — only the success path removed it. force:true so a file
    // that's already gone (e.g. the timeout's own taskkill beat us to it,
    // unlikely but not impossible) doesn't turn this into a second error.
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Probe a saved media file's pixel dimensions so the client can size its box
// to match the asset's actual exported size, instead of guessing.
async function probeDimensions(absPath, kind) {
  try {
    if (kind === "image" || kind === "gif") {
      const { width, height } = imageSize(fs.readFileSync(absPath));
      if (width && height) return { width, height };
    }
    if (kind === "lottie") {
      const data = JSON.parse(fs.readFileSync(absPath, "utf-8"));
      if (data.w && data.h) return { width: data.w, height: data.h };
    }
    if (kind === "video") {
      const out = await run("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json", JSON.stringify(absPath),
      ]);
      const parsed = JSON.parse(out);
      const s = parsed.streams?.[0];
      if (s?.width && s?.height) return { width: s.width, height: s.height };
    }
  } catch (e) {
    console.warn("probeDimensions failed:", e.message);
  }
  return { width: null, height: null };
}

// Peeks at a file's actual bytes and returns a rough content family —
// "image" | "video" | "font" | "svg" | "json" | null (unrecognized) — so an
// upload can be checked against what its extension CLAIMS to be, instead of
// trusting the extension alone. A renamed .txt (or anything else) sailing
// through as a silently-broken "photo" layer is the failure mode this closes.
function sniffKind(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image"; // jpeg
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image"; // png
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "image"; // gif
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image"; // webp
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 11) === "AVI") return "video"; // avi
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") return "audio"; // wav
  if (buf.length >= 8 && buf.toString("ascii", 4, 8) === "ftyp") {
    // .m4a/.mp4/.mov all share the same ISO-base-media "ftyp" box — the
    // "major brand" 4 bytes right after it is what actually tells an audio
    // container apart from a video one.
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "M4A " || brand === "M4B ") return "audio";
    return "video"; // mp4/mov/m4v and everything else ISO-base-media
  }
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") return "audio"; // mp3 (ID3v2-tagged)
  // Raw MPEG audio frame sync with no ID3 tag — first 11 bits all 1, next 2
  // bits (MPEG version) and 2 after that (layer) both non-zero for a real
  // MP3 frame; loose enough to catch untagged mp3s without false-matching
  // arbitrary binary data.
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x18) !== 0x08 && (buf[1] & 0x06) !== 0x00) return "audio"; // mp3 (no ID3 tag)
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OggS") return "audio"; // ogg
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "fLaC") return "audio"; // flac
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video"; // webm/mkv (EBML)
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return "font"; // ttf
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "OTTO") return "font"; // otf
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "true") return "font"; // ttf (mac variant)
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "wOFF") return "font"; // woff
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "wOF2") return "font"; // woff2
  const head = buf.toString("utf-8", 0, Math.min(buf.length, 200)).trimStart();
  // Real SVGs sometimes lead with a doctype/comment before the <svg> tag
  // itself, so this checks "does it appear at all in the head", not "is it
  // the very first thing".
  if (head.startsWith("<?xml") || head.includes("<svg")) return "svg";
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  return null;
}

const EXPECTED_KIND = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".svg": "svg",
  ".mp4": "video", ".mov": "video", ".webm": "video", ".mkv": "video", ".avi": "video", ".m4v": "video",
  ".ttf": "font", ".otf": "font", ".woff": "font", ".woff2": "font",
  ".json": "json",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".ogg": "audio", ".flac": "audio",
};

// Throws (with the temp upload already cleaned up) if the file's actual bytes
// don't match what its extension claims. Returns quietly for extensions we
// don't have a rule for (nothing to check against).
function assertRealFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const expected = EXPECTED_KIND[ext];
  if (!expected) return;
  const fd = fs.openSync(file.path, "r");
  const buf = Buffer.alloc(256);
  const n = fs.readSync(fd, buf, 0, 256, 0);
  fs.closeSync(fd);
  const actual = sniffKind(buf.subarray(0, n));
  if (actual !== expected) {
    fs.rmSync(file.path, { force: true });
    throw new Error(`"${file.originalname}" doesn't look like a real ${ext} file — upload rejected.`);
  }
}

// Save an uploaded media asset into public/projects/<projectId>/<subdir>,
// converting any video to WebM VP9 with alpha (browsers can't decode .mov
// qtrle/ProRes). Scoped per-project so deleting a project cleans up its assets.
// Returns { file, kind, width, height } — width/height are the asset's real
// exported pixel size (null if undetectable), so the client can size the
// on-canvas box to match instead of guessing.
async function saveMedia(file, projectId, subdir, prefix) {
  assertRealFile(file);
  const ext = path.extname(file.originalname).toLowerCase();
  const dir = path.join(PUBLIC, "projects", projectId, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const rel = (name) => `projects/${projectId}/${subdir}/${name}`;

  let result;
  if (ext === ".json") {
    const name = `${prefix}_${stamp}.json`;
    fs.renameSync(file.path, path.join(dir, name));
    result = { file: rel(name), kind: "lottie", abs: path.join(dir, name) };
  } else if (ext === ".gif") {
    const name = `${prefix}_${stamp}.gif`;
    fs.renameSync(file.path, path.join(dir, name));
    result = { file: rel(name), kind: "gif", abs: path.join(dir, name) };
  } else if ([".ttf", ".otf", ".woff", ".woff2"].includes(ext)) {
    const name = `${prefix}_${stamp}${ext}`;
    fs.renameSync(file.path, path.join(dir, name));
    result = { file: rel(name), kind: "font", abs: path.join(dir, name) };
  } else if ([".mov", ".mp4", ".webm", ".mkv", ".avi", ".m4v"].includes(ext)) {
    const name = `${prefix}_${stamp}.webm`;
    // Keep the source's own audio track (Opus, webm's native audio codec) —
    // previously hardcoded `-an` (no audio), which silently threw the
    // soundtrack away at upload time; no `muted` prop can bring back audio
    // that was never kept in the transcoded file. A source with no audio
    // stream at all just yields a video-only webm same as before — ffmpeg
    // doesn't error over an absent optional stream when it isn't `-map`ped.
    await run("ffmpeg", [
      "-y", "-i", JSON.stringify(file.path),
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
      "-b:v", "3M", "-deadline", "good", "-cpu-used", "3",
      "-c:a", "libopus", "-b:a", "128k",
      JSON.stringify(path.join(dir, name)),
    ]);
    fs.rmSync(file.path, { force: true });
    result = { file: rel(name), kind: "video", abs: path.join(dir, name) };
  } else if ([".mp3", ".wav", ".m4a", ".ogg", ".flac"].includes(ext)) {
    // Normalized to AAC in an M4A container regardless of source format —
    // same reasoning as video's transcode to one predictable codec: mixed
    // mp3/wav/ogg/flac uploads all becoming one known-good format is what
    // makes Remotion's <Audio> (both live preview and the final render's
    // audio mixdown) reliable, instead of depending on the browser's own
    // patchwork codec support for whatever format happened to be uploaded.
    const name = `${prefix}_${stamp}.m4a`;
    await run("ffmpeg", [
      "-y", "-i", JSON.stringify(file.path),
      "-vn", "-c:a", "aac", "-b:a", "192k",
      JSON.stringify(path.join(dir, name)),
    ]);
    fs.rmSync(file.path, { force: true });
    result = { file: rel(name), kind: "audio", abs: path.join(dir, name) };
  } else {
    // image (png/jpg/svg) — keep as-is
    const name = `${prefix}_${stamp}${ext}`;
    fs.renameSync(file.path, path.join(dir, name));
    result = { file: rel(name), kind: "image", abs: path.join(dir, name) };
  }

  const { width, height } = await probeDimensions(result.abs, result.kind);
  const duration = result.kind === "audio" || result.kind === "video" ? await probeDuration(result.abs) : null;
  return { file: result.file, kind: result.kind, width, height, duration };
}

// Probes a media file's real duration in seconds — needed for the audio
// track's trim UI (can't let the user pick a start offset past the end of
// a file whose length they don't know) and generically useful for video too.
async function probeDuration(absPath) {
  try {
    const out = await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "json", JSON.stringify(absPath),
    ]);
    const parsed = JSON.parse(out);
    const d = parseFloat(parsed.format?.duration);
    return Number.isFinite(d) ? d : null;
  } catch (e) {
    console.warn("probeDuration failed:", e.message);
    return null;
  }
}

// Deletes one or more per-project asset files (or, for a PSD/SVG-ingested
// page, its whole extracted folder) when the client removes a layer/page or
// replaces an asset — otherwise the old file just sits on disk forever,
// since nothing else ever cleaned those up (only deleting the WHOLE project
// did). Every path is required to resolve inside this project's own public
// folder — no reaching into other projects or the shared font library.
app.post("/api/projects/:id/delete-files", (req, res) => {
  const projectId = req.params.id;
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  const root = path.join(PUBLIC, "projects", projectId);
  let deleted = 0;
  for (const p of paths) {
    if (!p || typeof p !== "string") continue;
    const abs = path.resolve(PUBLIC, p);
    if (abs !== root && !abs.startsWith(root + path.sep)) continue; // outside this project — refuse
    try {
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { recursive: true, force: true });
        deleted++;
      }
    } catch (e) {
      console.warn("delete-files failed for", p, e.message);
    }
  }
  res.json({ deleted });
});

// --- Upload a pre-animated logo ----------------------------------------------
app.post("/api/logo", upload.single("logo"), async (req, res) => {
  try {
    const projectId = req.body.projectId;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    res.json(await saveMedia(req.file, projectId, "logos", "logo"));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Upload a BG / Title (or any per-layer) asset ----------------------------
app.post("/api/asset", upload.single("asset"), async (req, res) => {
  try {
    const projectId = req.body.projectId;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const kindTag = (req.body.slot || "asset").replace(/[^a-z0-9]/gi, "");
    res.json(await saveMedia(req.file, projectId, "assets", kindTag || "asset"));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Shared by both the old synchronous /api/render (kept as-is — the Resolve
// plugin calls it directly and expects the finished {url, path} in one
// response, not a job to poll) and the new job-based /api/render/start
// (what the app's own UI uses for a real progress bar).
function buildRenderArgs(project) {
  // `transparent`/`exportName`/`quality`/`destDir` are transient flags
  // riding on the same body, not real Project fields — never persisted
  // anywhere but this scratch file.
  const transparent = !!project.transparent;
  // A folder the user picked via the Render menu's "Browse…" (see
  // /api/browse-folder below) — an absolute path outside this app's own
  // out/ folder, so it can't be served back over /out (that only serves
  // ROOT/out) — the client shows the real path instead of a download link.
  const destDir = typeof project.destDir === "string" && project.destDir.trim() ? project.destDir.trim() : null;
  // Mirror into src/project.json — that's what Root.tsx's defaultProps and
  // the Remotion CLI's --props flag read from.
  fs.writeFileSync(LEGACY_PROJECT_JSON, JSON.stringify(project, null, 2), "utf-8");
  const safeName = (project.exportName || project.name || project.projectId || "reel").replace(/[^a-z0-9]/gi, "_");
  // MP4/H.264 can't carry an alpha channel at all. ProRes 4444 (.mov) is
  // what NLEs — DaVinci Resolve included, which is this app's actual alpha
  // destination via the Resolve plugin — decode correctly; VP8/VP9 WebM
  // alpha is web-playback-oriented and Resolve's decoder mishandles it,
  // which showed up as a colored glow/halo around soft edges and broken
  // transparency once imported. ProRes 4444 doesn't have that problem.
  const outName = `${safeName}_${Date.now()}.${transparent ? "mov" : "mp4"}`;
  const outAbsPath = destDir ? path.join(destDir, outName) : path.join(ROOT, "out", outName);
  // Relative "out/<name>" (not the absolute path) when writing into our own
  // out/ folder, matching every existing render call — an absolute path
  // works with the Remotion CLI either way, this just avoids changing the
  // no-custom-folder behavior at all. Quoted when it's a user-picked
  // absolute path specifically — run()/runStreaming() spawn with shell:true,
  // which does NOT escape array args (see runRenderWithBrowserFallback's own
  // comment on this exact failure mode), so an unquoted "C:\Users\Name\
  // Videos" truncates at the first space. outName itself never needs this
  // (safeName is already sanitized to [a-z0-9] only, no spaces possible).
  const outArg = destDir ? `"${outAbsPath}"` : `out/${outName}`;
  const args = ["remotion", "render", "Reel", outArg, "--props=src/project.json"];
  // yuva444p10le needs each rendered frame captured as PNG (Remotion's
  // default JPEG capture format has no alpha channel to carry through).
  // Quality only applies to the plain MP4 path — an alpha export's whole
  // point is lossless-ish ProRes, not a size/quality tradeoff.
  if (transparent) {
    args.push("--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le", "--image-format=png");
  } else {
    // Lower CRF = higher quality/bigger file (standard x264 scale, 0-51).
    // "balanced" is omitted on purpose — Remotion's own unset default
    // already sits right there, so the common case gets no extra flag.
    const CRF = { high: 16, small: 30 };
    const crf = CRF[project.quality];
    if (crf !== undefined) args.push(`--crf=${crf}`);
  }
  return { args, outName, outAbsPath, servableUrl: destDir ? null : `/out/${outName}` };
}

// --- Native folder picker for the Render menu's "Browse…" (destination
// folder) — a website has no API to hand back a WRITABLE folder path, but
// this server IS the user's own machine, so it just runs a real Windows
// folder-browser dialog server-side and reports back whatever got picked.
// No timeout: the user might sit on the dialog for a while, that's fine.
app.post("/api/browse-folder", async (req, res) => {
  try {
    const scriptPath = path.join(ROOT, "tools", "browse_folder.ps1");
    const out = await run("powershell", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", JSON.stringify(scriptPath)]);
    const selected = out.trim();
    res.json({ path: selected || null }); // null = user cancelled the dialog
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Render the reel to MP4 (or, for an alpha export, a transparent WebM) ---
// Kept synchronous on purpose — the Resolve plugin's bridge calls this
// directly and expects the finished file's {url, path} in one response.
app.post("/api/render", async (req, res) => {
  try {
    const { args, outAbsPath, servableUrl } = buildRenderArgs(req.body);
    await runRenderWithBrowserFallback(args, () => {});
    // `path` is the absolute filesystem path — the Resolve plugin's bridge
    // needs a real path (not a URL) to hand the file to Resolve's Media
    // Pool. Harmless to expose: this is a single-user local server, and the
    // path is inside this project's own `out/` folder (or the user's own
    // chosen destination, via the Render menu's "Browse…") either way.
    res.json({ url: servableUrl, path: outAbsPath });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Same render, but as a background job the app's own UI can poll for a
// real progress percentage instead of staring at a static "Rendering…". ---
const renderJobs = new Map(); // jobId -> { status, percent, phase, frame, totalFrames, url, path, error }
let renderJobSeq = 0;

app.post("/api/render/start", (req, res) => {
  let outAbsPath, servableUrl;
  let args;
  try {
    ({ args, outAbsPath, servableUrl } = buildRenderArgs(req.body));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
  const jobId = "job_" + Date.now().toString(36) + "_" + (renderJobSeq++);
  const job = { status: "running", percent: 0, phase: "bundling", frame: 0, totalFrames: 0, pid: null };
  renderJobs.set(jobId, job);
  res.json({ jobId });

  runRenderWithBrowserFallback(
    args,
    (line) => {
      const progress = parseProgressLine(line);
      if (progress) Object.assign(job, progress);
    },
    (proc) => { job.pid = proc.pid; },
  )
    .then(() => {
      job.status = "done"; job.percent = 100;
      job.url = servableUrl;
      job.path = outAbsPath;
    })
    .catch((e) => {
      // The cancel route below sets "cancelling" synchronously, before the
      // kill signal actually finishes the process off (whose rejection
      // lands here, same as any other failure) — that's how a deliberate
      // stop is told apart from a genuine render error.
      if (job.status === "cancelling") {
        job.status = "cancelled";
        // A killed render leaves a broken/incomplete file sitting in out/ —
        // clean it up rather than leave a corrupt video behind.
        fs.rm(outAbsPath, { force: true }, () => {});
      } else {
        job.status = "error";
        job.error = String(e.message || e);
      }
    })
    .finally(() => {
      // Jobs are only ever read right after they finish (the client stops
      // polling once it sees "done"/"error"/"cancelled") — a few minutes of
      // headroom covers a slow client without leaking memory across a long
      // session.
      setTimeout(() => renderJobs.delete(jobId), 5 * 60 * 1000);
    });
});

// Stop button: kill whichever process this job is currently running (the
// browser-executable fallback means that could be a retry, hence tracking
// the pid on the job itself rather than closing over one process). A no-op
// if the job already finished — nothing to stop.
app.post("/api/render/:jobId/cancel", (req, res) => {
  const job = renderJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "unknown or expired render job" });
  if (job.status !== "running") return res.json({ ok: true });
  job.status = "cancelling";
  if (job.pid) {
    // spawn(..., {shell:true}) on Windows launches cmd.exe, which in turn
    // launches node/npx/remotion/chrome-headless-shell as children — plain
    // process.kill() only kills that top cmd.exe shell, leaving the actual
    // work (and any spawned Chrome) running as orphans. `taskkill /T` kills
    // the whole tree.
    spawn("taskkill", ["/PID", String(job.pid), "/T", "/F"], { shell: true });
  }
  res.json({ ok: true });
});

app.get("/api/render/status/:jobId", (req, res) => {
  const job = renderJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "unknown or expired render job" });
  res.json(job);
});

// renderJobs is in-memory only (never persisted) — restarting this process
// while a render is in flight orphans the underlying `remotion render`/
// Chromium/ffmpeg child process with no way to discover or cancel it
// afterward (its job entry, and the only pid that could `taskkill /T` it,
// dies with this process). This is NOT a full fix for that — it can't be,
// short of persisting job state to disk and reconciling on the next
// startup — just a loud warning so a deliberate shutdown mid-render is a
// visible choice, not a silent one. Real limitation, worth stating
// plainly: `stop.bat` and a manual `taskkill /F` (what actually stops this
// server day to day, including every dev-server restart this session)
// force-terminate the process without giving it a chance to run this —
// Windows' `/F` bypasses graceful signal delivery entirely. This only
// fires for a plain Ctrl+C in an interactive terminal.
function warnAboutRunningJobs() {
  const running = [...renderJobs.values()].filter((j) => j.status === "running" || j.status === "cancelling");
  if (running.length) {
    console.warn(
      `\n⚠ Shutting down with ${running.length} render(s) still in progress — ` +
      `the underlying process${running.length > 1 ? "es" : ""} will keep running as ` +
      `orphan${running.length > 1 ? "s" : ""} with no way to stop or track ${running.length > 1 ? "them" : "it"} from here.\n`
    );
  }
}
process.on("SIGINT", () => { warnAboutRunningJobs(); process.exit(0); });
process.on("SIGTERM", () => { warnAboutRunningJobs(); process.exit(0); });

app.listen(PORT, () => console.log(`Motionist server on http://localhost:${PORT}`));
