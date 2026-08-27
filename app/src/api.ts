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
  kind: "video" | "lottie" | "gif" | "image";
  width: number | null;  // the asset's real exported pixel size, when detectable
  height: number | null;
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

export async function renderReel(project: Project): Promise<string> {
  const r = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  if (!r.ok) throw new Error((await r.json()).error || "render failed");
  return (await r.json()).url as string;
}
