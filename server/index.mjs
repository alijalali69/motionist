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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, shell: true, ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${err}`))
    );
  });
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

function emptyProject(id, name) {
  const now = new Date().toISOString();
  const w = 1080, h = 1920;
  return {
    fps: FPS, width: w, height: h, projectId: id, name,
    createdAt: now, updatedAt: now,
    template: { layers: [] },
    logo: null, bg: null, title: null, // `title` here = the global Title asset slot
    loader: defaultLoader(w, h),
    subtitle: defaultSubtitle(w, h),
    subtitleStyle: defaultSubtitleStyle(h),
    captions: [],
    pages: [],
  };
}

// One-time migration: fold the old single-project src/project.json (from
// before multi-project support existed) into the new per-project store, so
// in-progress work isn't lost.
(function migrateLegacyProject() {
  if (fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length > 0) return;
  if (!fs.existsSync(LEGACY_PROJECT_JSON)) return;
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_PROJECT_JSON, "utf-8"));
    if (!legacy || !legacy.projectId) return;
    const now = new Date().toISOString();
    legacy.name = legacy.name || "My First Project";
    legacy.createdAt = legacy.createdAt || now;
    legacy.updatedAt = now;
    fs.writeFileSync(projectPath(legacy.projectId), JSON.stringify(legacy, null, 2), "utf-8");
    console.log(`Migrated legacy project.json -> data/projects/${legacy.projectId}.json`);
  } catch (e) {
    console.warn("Legacy project migration skipped:", e.message);
  }
})();

// A small representative thumbnail for the dashboard: first content layer's
// image on the first page, else the global bg, else null (dashboard shows a
// placeholder card).
function thumbnailFor(project) {
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
      return res.status(400).json({ error: "font must be .ttf/.otf/.woff/.woff2" });
    }
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
  const project = emptyProject(id, name);
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
    ]);
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

// Save an uploaded media asset into public/projects/<projectId>/<subdir>,
// converting any video to WebM VP9 with alpha (browsers can't decode .mov
// qtrle/ProRes). Scoped per-project so deleting a project cleans up its assets.
// Returns { file, kind, width, height } — width/height are the asset's real
// exported pixel size (null if undetectable), so the client can size the
// on-canvas box to match instead of guessing.
async function saveMedia(file, projectId, subdir, prefix) {
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
    await run("ffmpeg", [
      "-y", "-i", JSON.stringify(file.path),
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
      "-b:v", "3M", "-deadline", "good", "-cpu-used", "3", "-an",
      JSON.stringify(path.join(dir, name)),
    ]);
    fs.rmSync(file.path, { force: true });
    result = { file: rel(name), kind: "video", abs: path.join(dir, name) };
  } else {
    // image (png/jpg/svg) — keep as-is
    const name = `${prefix}_${stamp}${ext}`;
    fs.renameSync(file.path, path.join(dir, name));
    result = { file: rel(name), kind: "image", abs: path.join(dir, name) };
  }

  const { width, height } = await probeDimensions(result.abs, result.kind);
  return { file: result.file, kind: result.kind, width, height };
}

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

// --- Render the reel to MP4 --------------------------------------------------
app.post("/api/render", async (req, res) => {
  try {
    const project = req.body;
    // Mirror into src/project.json — that's what Root.tsx's defaultProps and
    // the Remotion CLI's --props flag read from.
    fs.writeFileSync(LEGACY_PROJECT_JSON, JSON.stringify(project, null, 2), "utf-8");
    const safeName = (project.name || project.projectId || "reel").replace(/[^a-z0-9]/gi, "_");
    const outName = `${safeName}_${Date.now()}.mp4`;
    await run("npx", [
      "remotion", "render", "Reel", `out/${outName}`,
      "--props=src/project.json",
    ]);
    res.json({ url: `/out/${outName}` });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`Motionist server on http://localhost:${PORT}`));
