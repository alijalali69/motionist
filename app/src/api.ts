import type { Project } from "../../src/types";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  pageCount: number;
  width: number;
  height: number;
  thumbnail: string | null;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  const r = await fetch("/api/projects");
  return r.json();
}

export async function createProject(name: string, width?: number, height?: number): Promise<Project> {
  const r = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, width, height }),
  });
  if (!r.ok) throw new Error("failed to create project");
  return r.json();
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// A full independent copy — its own project id AND its own asset folder
// (every uploaded photo/video/font-reference/audio file gets physically
// duplicated server-side, not just the JSON) — see the /api/projects/:id/
// duplicate route in server/index.mjs.
export async function duplicateProject(id: string): Promise<Project> {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "duplicate failed");
  return r.json();
}

// A full independent copy of ONE page — its own asset folder too (every
// uploaded photo/video this page's layers reference gets physically
// duplicated server-side, not just the JSON), so deleting either the
// original or the copy later never breaks the other's images. Returns the
// ready-to-insert page (already carrying its own new id) — the caller
// splices it into project.pages and saves, same as inserting a page
// template (see onInsertTemplate in App.tsx).
export async function duplicatePage(projectId: string, pageId: string): Promise<Project["pages"][number]> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/duplicate`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "duplicate failed");
  return r.json();
}

// Export/import — a project as one portable file (backup, or moving to
// another machine). Export is just a URL: the route itself sets
// Content-Disposition so navigating to it (or setting window.location)
// downloads the file directly, no client-side blob assembly needed. Import
// reads whatever the user picked back off disk client-side and posts its
// JSON straight through — the server does all the real work (physically
// copying assets into a fresh project id).
export function exportProjectUrl(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}/export`;
}

export async function importProject(file: File): Promise<Project> {
  const text = await file.text();
  let bundle: unknown;
  try { bundle = JSON.parse(text); } catch { throw new Error("that file isn't valid JSON"); }
  const r = await fetch("/api/projects/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "import failed");
  return r.json();
}

export async function loadProject(id: string): Promise<Project | null> {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  return r.json();
}

export async function saveProject(project: Project): Promise<void> {
  await fetch(`/api/projects/${encodeURIComponent(project.projectId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

// Renders frame 0 of the real "Reel" composition to a PNG the Dashboard's
// project card then shows — fire-and-forget from the caller's side (the
// editor calls this on its way back to the Dashboard; a failed/slow render
// here just means the card keeps showing whatever it showed before, never
// something the user needs to wait on or be told about).
export async function generateThumbnail(id: string): Promise<void> {
  await fetch(`/api/projects/${encodeURIComponent(id)}/thumbnail`, { method: "POST" });
}

export type IngestResult = {
  page: Project["pages"][number];
  fixed: Project["template"]["layers"];
  logo: Project["logo"];
  loaderBox: Project["loader"] | null;
  subtitleBox: Project["subtitle"] | null;
  canvas: [number, number];
  defaults: {
    loader: Project["loader"];
    subtitle: Project["subtitle"];
    subtitleStyle: Project["subtitleStyle"];
    fps: number;
  };
  sourceName: string;
};

export async function ingestPsd(file: File, projectId: string): Promise<IngestResult> {
  const fd = new FormData();
  fd.append("psd", file);
  fd.append("projectId", projectId);
  const r = await fetch("/api/ingest", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json()).error || "ingest failed");
  return r.json();
}

export type UploadedMedia = {
  file: string;
  kind: "video" | "lottie" | "gif" | "image" | "audio";
  width: number | null;  // the asset's real exported pixel size, when detectable
  height: number | null;
  duration: number | null; // source file's real length in seconds (video/audio only), from ffprobe
};

export async function uploadLogo(file: File, projectId: string): Promise<UploadedMedia> {
  const fd = new FormData();
  fd.append("logo", file);
  fd.append("projectId", projectId);
  const r = await fetch("/api/logo", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "logo upload failed");
  return r.json();
}

export async function uploadAsset(file: File, slot: string, projectId: string): Promise<UploadedMedia> {
  const fd = new FormData();
  fd.append("asset", file);
  fd.append("slot", slot);
  fd.append("projectId", projectId);
  const r = await fetch("/api/asset", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "asset upload failed");
  return r.json();
}

// --- Global font library: uploaded once (from the Dashboard), reused by any
// project afterward — a "family" groups its variants (Regular/Bold/…),
// distinguished by `style`; `cssFamily` is what actually gets loaded/rendered.
export type FontEntry = {
  id: string;
  family: string;
  style: string;
  cssFamily: string;
  file: string;
  originalName: string;
  createdAt: string;
};

export async function listFonts(): Promise<FontEntry[]> {
  const r = await fetch("/api/fonts");
  return r.json();
}

export async function uploadFontToLibrary(file: File, family: string, style: string): Promise<FontEntry> {
  const fd = new FormData();
  fd.append("font", file);
  fd.append("family", family);
  fd.append("style", style);
  const r = await fetch("/api/fonts", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json()).error || "font upload failed");
  return r.json();
}

export async function deleteFont(id: string): Promise<void> {
  await fetch(`/api/fonts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Global motion preset library: a named IN/OUT effect combo (the same
// MotionClip shape the in-memory "Copy/Paste motion" feature already uses),
// saved once and reusable across every project. `MotionClip` is a type-only
// import (erased at build time) so this doesn't create a real runtime
// circular dependency with App.tsx, which imports plenty from this file.
import type { MotionClip } from "./App";

export type MotionPresetEntry = {
  id: string;
  name: string;
  clip: MotionClip;
  createdAt: string;
};

export async function listMotionPresets(): Promise<MotionPresetEntry[]> {
  const r = await fetch("/api/motion-presets");
  return r.json();
}

export async function saveMotionPreset(name: string, clip: MotionClip): Promise<MotionPresetEntry> {
  const r = await fetch("/api/motion-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, clip }),
  });
  if (!r.ok) throw new Error((await r.json()).error || "saving preset failed");
  return r.json();
}

export async function deleteMotionPreset(id: string): Promise<void> {
  await fetch(`/api/motion-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Global brand-color library: a saved hex, reusable across every
// project (fonts already work this way — Project.swatches was the one
// color-related thing still stuck per-project). Managed from the
// Dashboard (see BrandColorManager); the editor's own ColorField just
// reads the list and offers each one as an extra swatch, same as it
// already does for the current project's own saved swatches.
export type BrandColorEntry = { id: string; hex: string; name?: string; createdAt: string };

export async function listBrandColors(): Promise<BrandColorEntry[]> {
  const r = await fetch("/api/brand-colors");
  return r.json();
}

export async function addBrandColor(hex: string, name?: string): Promise<BrandColorEntry> {
  const r = await fetch("/api/brand-colors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hex, name }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "saving color failed");
  return r.json();
}

export async function deleteBrandColor(id: string): Promise<void> {
  await fetch(`/api/brand-colors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Page-layout template library: a whole saved PAGE (layers, boxes,
// motion, its own background style), reusable across any project — unlike
// a motion preset, this also carries real asset files, physically copied
// server-side into a shared store (see /api/page-templates in server/
// index.mjs) so the template outlives whichever project it was saved from.
export type PageTemplateSummary = {
  id: string;
  name: string;
  createdAt: string;
  thumbnail: string | null;
};
export type PageTemplateEntry = PageTemplateSummary & { page: Project["pages"][number] };

export async function listPageTemplates(): Promise<PageTemplateSummary[]> {
  const r = await fetch("/api/page-templates");
  return r.json();
}

export async function loadPageTemplate(id: string): Promise<PageTemplateEntry> {
  const r = await fetch(`/api/page-templates/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "template not found");
  return r.json();
}

// `page` should be the CURRENT (already-saved) state of the page being
// templated — its own layer file paths must already point at real files
// under this project's projects/<projectId>/ folder for the server to find
// and copy them.
export async function savePageTemplate(name: string, projectId: string, page: Project["pages"][number]): Promise<PageTemplateEntry> {
  const r = await fetch("/api/page-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, projectId, page }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "saving template failed");
  return r.json();
}

export async function deletePageTemplate(id: string): Promise<void> {
  await fetch(`/api/page-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Custom canvas-size presets: same pattern as the motion preset library
// above — saved once from the Dashboard, reusable as its own size card.
export type SizePresetEntry = {
  id: string;
  name: string;
  w: number;
  h: number;
  createdAt: string;
};

export async function listSizePresets(): Promise<SizePresetEntry[]> {
  const r = await fetch("/api/size-presets");
  return r.json();
}

export async function saveSizePreset(name: string, w: number, h: number): Promise<SizePresetEntry> {
  const r = await fetch("/api/size-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, w, h }),
  });
  if (!r.ok) throw new Error((await r.json()).error || "saving size preset failed");
  return r.json();
}

export async function deleteSizePreset(id: string): Promise<void> {
  await fetch(`/api/size-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Cleans up an uploaded asset (or a whole PSD/SVG-extracted page folder)
// once nothing references it any more — a deleted layer, a deleted page, or
// the old file an upload just replaced. Fire-and-forget from the caller's
// point of view: never blocks the UI action on it, and never worth failing
// the whole operation over (worst case a file just isn't cleaned up yet).
export function deleteProjectFiles(projectId: string, paths: string[]): void {
  const real = paths.filter((p) => !!p);
  if (!real.length) return;
  fetch(`/api/projects/${encodeURIComponent(projectId)}/delete-files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: real }),
  }).catch(() => {});
}

// Present only when this page is loaded inside the Motionist DaVinci
// Resolve plugin window (see resolve-plugin/), via its preload.js — plain
// `undefined` in a regular browser tab, which is exactly what lets this run
// unmodified in both places.
declare global {
  interface Window {
    motionistResolveBridge?: {
      onRendered: (absPath: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export async function renderReel(project: Project, transparent?: boolean, exportName?: string): Promise<string> {
  // `transparent`/`exportName` ride along as extra keys on the same body,
  // not real Project fields — the server reads them and never saves them.
  const extra: Record<string, unknown> = {};
  if (transparent) extra.transparent = true;
  if (exportName && exportName.trim()) extra.exportName = exportName.trim();
  const body = Object.keys(extra).length ? { ...project, ...extra } : project;
  const r = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).error || "render failed");
  const data = await r.json();

  // Hand the finished file straight to Resolve's Media Pool when running
  // inside the plugin. Fire-and-forget — a failure here (no project open in
  // Resolve, etc.) shouldn't fail the render itself, which already
  // succeeded; just log it so it's visible in devtools if something's off.
  if (window.motionistResolveBridge && data.path) {
    window.motionistResolveBridge.onRendered(data.path)
      .then((res) => { if (!res?.ok) console.warn("Motionist → Resolve: not added to Media Pool —", res?.error); })
      .catch((e) => console.warn("Motionist → Resolve bridge failed:", e));
  }

  return data.url as string;
}

// Job-based render — same server-side work as renderReel() above, but
// /api/render/start returns immediately with a job id instead of blocking
// until the whole render finishes, so the UI can poll for a real progress
// percentage instead of showing a static "Rendering…" the whole time.
export type RenderJobStatus = {
  status: "running" | "done" | "error" | "cancelling" | "cancelled";
  percent: number;
  phase?: "bundling" | "rendering" | "encoding";
  frame?: number;
  totalFrames?: number;
  // `url` is null (not just absent) once a custom destination folder was
  // used — that file lives outside public/out, so there's nothing to serve
  // it back from; the real absolute `path` is the only way to point at it.
  url?: string | null;
  path?: string;
  error?: string;
};

export type RenderQuality = "high" | "balanced" | "small";

export async function startRenderJob(project: Project, opts?: {
  transparent?: boolean;
  exportName?: string;
  quality?: RenderQuality;
  destDir?: string; // absolute folder path from browseFolder() — omitted = the app's own out/ folder
}): Promise<string> {
  const extra: Record<string, unknown> = {};
  if (opts?.transparent) extra.transparent = true;
  if (opts?.exportName && opts.exportName.trim()) extra.exportName = opts.exportName.trim();
  if (opts?.quality) extra.quality = opts.quality;
  if (opts?.destDir) extra.destDir = opts.destDir;
  const body = Object.keys(extra).length ? { ...project, ...extra } : project;
  const r = await fetch("/api/render/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json()).error || "render failed to start");
  const data = await r.json();
  return data.jobId as string;
}

// Opens a native folder-browser dialog SERVER-side (see /api/browse-folder
// in server/index.mjs) — a website has no way to hand back a writable
// folder path on its own, but the server here is the user's own machine.
// Resolves to null if the user cancelled the dialog.
export async function browseFolder(): Promise<string | null> {
  const r = await fetch("/api/browse-folder", { method: "POST" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "couldn't open the folder picker");
  const data = await r.json();
  return data.path ?? null;
}

export async function getRenderJobStatus(jobId: string): Promise<RenderJobStatus> {
  const r = await fetch(`/api/render/status/${jobId}`);
  if (!r.ok) throw new Error((await r.json()).error || "render status unavailable");
  return r.json();
}

export async function cancelRenderJob(jobId: string): Promise<void> {
  const r = await fetch(`/api/render/${jobId}/cancel`, { method: "POST" });
  if (!r.ok) throw new Error((await r.json()).error || "couldn't stop the render");
}
