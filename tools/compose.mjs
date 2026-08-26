// Shared routing/compose logic used by both the CLI (build_project.mjs, all
// pages at once) and the server (ingest, one page at a time preserving edits).
import fs from "node:fs";
import path from "node:path";

export const FPS = 30;
export const PAGE_SECONDS = 5;

export function roleOf(layer, cw, ch) {
  // Naming rule, not size-guessing: PSD text layers report kind "type"
  // directly; SVG-sourced layers all report kind "vector" (Illustrator loses
  // the text/shape distinction once type is outlined — our own recommended
  // workflow for Farsi safety), so a name keyword is the signal there.
  // Anything NOT identified as text is treated as an image/video placeholder
  // — no more area-threshold guessing that can misfire in either direction.
  const name = (layer.name || "").toLowerCase();
  const looksLikeText = layer.kind === "type" || /text|title|caption/.test(name);

  if (looksLikeText) {
    const area = layer.width * layer.height;
    return area < cw * ch * 0.02 ? "subtitle" : "title";
  }

  const coversCanvas = layer.width >= cw * 0.92 && layer.height >= ch * 0.92;
  if (coversCanvas) return "bg";

  return "photo";
}

export const ROLE_DEFAULT = {
  bg: { entrance: "fade", delay: 0 },
  photo: { entrance: "pop", delay: 18 },
  accent: { entrance: "fade", delay: 12 },
  title: { entrance: "slideRight", delay: 30 },
  subtitle: { entrance: "slideRight", delay: 46 },
};

export function assetPath(projectId, pageDir, file) {
  return `projects/${projectId}/${pageDir}/${file}`;
}

// Route one page's manifest into { page, fixed[], logo, loaderBox, subtitleBox }.
export function routePage(projectId, pageDir, manifest) {
  const [cw, ch] = manifest.canvas;
  const fixed = [];
  let logo = null;
  let loaderBox = null;
  let subtitleBox = null;
  const seenRole = {};
  const content = [];

  for (const l of manifest.layers) {
    const route = l.route ?? "content";
    if (route === "logo") {
      if (!logo) {
        logo = {
          box: { left: l.left, top: l.top, width: l.width, height: l.height },
          kind: null,
          file: null,
          fallback: assetPath(projectId, pageDir, l.file),
          opacity: l.opacity,
        };
      }
      continue;
    }
    if (route === "fixed") {
      fixed.push({
        file: assetPath(projectId, pageDir, l.file),
        name: l.name,
        left: l.left, top: l.top, width: l.width, height: l.height,
        opacity: l.opacity,
      });
      continue;
    }
    if (route === "loader") {
      loaderBox = { left: l.left, top: l.top, width: l.width, height: l.height };
      continue;
    }
    if (route === "subtitle") {
      subtitleBox = { left: l.left, top: l.top, width: l.width, height: l.height };
      continue;
    }
    const role = roleOf(l, cw, ch);
    const n = (seenRole[role] = (seenRole[role] ?? -1) + 1);
    const def = ROLE_DEFAULT[role];
    content.push({
      index: l.index,
      file: assetPath(projectId, pageDir, l.file),
      role,
      name: l.name || "", // real PSD/SVG layer name, for display in the app
      left: l.left, top: l.top, width: l.width, height: l.height,
      opacity: l.opacity,
      entrance: def.entrance,
      delay: def.delay + n * 8,
    });
  }

  const page = {
    id: pageDir,
    durationInFrames: FPS * PAGE_SECONDS,
    ambient: "kenburns",
    transition: { type: "fade", durationInFrames: 18 },
    layers: content,
    subtitle: "",
  };
  return { page, fixed, logo, loaderBox, subtitleBox, canvas: [cw, ch] };
}

export function defaultLoader(cw, ch) {
  const m = Math.round(cw * 0.05);
  return { left: m, top: ch - Math.round(ch * 0.03), width: cw - m * 2, height: Math.round(ch * 0.005) };
}

export function defaultSubtitle(cw, ch) {
  return {
    left: Math.round(cw * 0.08),
    top: ch - Math.round(ch * 0.16),
    width: cw - Math.round(cw * 0.16),
    height: Math.round(ch * 0.09),
  };
}

export function defaultSubtitleStyle(ch) {
  return {
    fontFamily: "Arial, sans-serif",
    fontSize: Math.round(ch * 0.022),
    color: "#ffffff",
    background: "rgba(0,0,0,0.55)",
    align: "center",
  };
}

export function readManifest(root, pageDir) {
  return JSON.parse(fs.readFileSync(path.join(root, pageDir, "manifest.json"), "utf-8"));
}
