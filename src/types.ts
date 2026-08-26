// Shared reel types. The whole reel is described by a Project object, which the
// app edits in memory and passes to the Remotion Player (and to render via props).
import type { EntranceName, AmbientName, ExitName } from "./presets";

export type Box = { left: number; top: number; width: number; height: number };

export type ContentLayer = {
  index: number;
  file: string;
  role: string;
  name?: string; // real layer name from the source PSD/SVG (for display only)
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  // IN effect
  entrance: EntranceName;
  delay: number;         // in-delay (frames) before the entrance starts
  inDuration?: number;   // entrance length (frames), default 26
  // OUT effect (plays over the last outDuration frames of the page)
  exit?: ExitName;       // default "none"
  outDuration?: number;  // exit length (frames), default 24
  // Optional uploaded replacement asset (BG/Title "like the logo"). When kind is
  // video/gif/lottie the layer plays that asset in place of the static image,
  // keeping its box + motion. Absent => render `file` as a still image.
  assetKind?: "image" | "video" | "gif" | "lottie" | "text";
  fit?: "contain" | "cover";
  // Live text layer (assetKind "text") — typed directly in the app instead of
  // baked into the PSD/SVG. `file` is unused for these. Word/line-stagger
  // entrances split `text` into words or lines and reveal them in sequence;
  // every other entrance (including the mask-wipe ones) renders the text as
  // one intact block so cursive Farsi/Arabic shaping is never broken.
  text?: string;
  fontFamily?: string;   // CSS font-family to render with
  fontFile?: string;     // uploaded font file (relative to public/) — null = use fontFamily as a system/web-safe name
  fontSize?: number;     // px
  textColor?: string;
  textAlign?: "right" | "center" | "left"; // default "right" (Farsi)
  // In-frame pan/zoom ("cinematic" motion) — moves the PHOTO inside its fixed
  // box, independent of the box's own entrance/exit. Reuses the page-level
  // ambient vocabulary (kenburns, panLeft, etc.); "none"/undefined = static.
  photoMotion?: AmbientName;
  // Static crop position/zoom for an uploaded photo/video WITHIN its fixed
  // frame — the frame itself is part of the template design and must not
  // move; this lets the user choose which part of the image shows instead.
  // 0-100 matches CSS object-position semantics (50 = centered, default).
  photoPanX?: number;
  photoPanY?: number;
  photoZoom?: number; // >=1, default 1 (1 = exact cover fit, no extra zoom)
  naturalWidth?: number | null;  // uploaded asset's real pixel size (for pan math)
  naturalHeight?: number | null;
};

export type TemplateLayer = {
  file: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
};

export type Transition = { type: "none" | "fade" | "slide"; durationInFrames: number };

export type Page = {
  id: string;           // folder id (timestamp) — used in asset paths, keep stable
  name?: string;        // display name (from the uploaded file)
  durationInFrames: number;
  ambient: AmbientName;
  transition: Transition;
  layers: ContentLayer[];
  subtitle?: string; // per-page English caption; empty/absent => nothing shows
};

// Pre-animated logo. `file` is the uploaded animation; `fallback` is the static
// PSD logo PNG shown until an animation is uploaded. `kind` picks the player.
export type LogoKind = "video" | "lottie" | "gif" | "image";
export type LogoConfig = {
  box: Box;
  kind: LogoKind | null;
  file: string | null; // uploaded pre-animated file (relative to public/)
  fallback: string | null; // static PSD logo PNG
  opacity: number;
  fit?: "contain" | "cover"; // how the asset fills its box (default contain)
};

export type Caption = { fromFrame: number; toFrame: number; text: string };

export type LoaderStyle = "bar" | "segmented" | "dots";

export type SubtitleStyle = {
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  align: "center" | "right" | "left";
};

export type Project = {
  fps: number;
  width: number;
  height: number;
  projectId: string;
  name?: string; // display name shown on the dashboard (distinct from `title`, the global Title asset below)
  createdAt?: string;
  updatedAt?: string;
  template: { layers: TemplateLayer[] };
  logo: LogoConfig | null;
  bg?: LogoConfig | null;    // global background, rendered behind all pages
  title?: LogoConfig | null; // global title, rendered as a locked overlay
  loader: Box;
  loaderStyle?: LoaderStyle; // default "bar"
  subtitle: Box;
  subtitleStyle?: SubtitleStyle;
  captions?: Caption[]; // timed captions (from SRT); optional, overrides per-page text when present
  pages: Page[];
};

// Total = sum(page durations) - sum(transition overlaps).
export function reelDuration(project: Project): number {
  const totalPages = project.pages.reduce((s, p) => s + p.durationInFrames, 0);
  const totalTrans = project.pages
    .slice(0, -1)
    .reduce((s, p) => s + p.transition.durationInFrames, 0);
  return Math.max(1, totalPages - totalTrans);
}

// Nominal start frame of each page (ignores transition overlap fuzz), used to
// time per-page subtitles in the fixed overlay.
export function pageStarts(project: Project): number[] {
  const starts: number[] = [];
  let acc = 0;
  project.pages.forEach((p, i) => {
    starts.push(acc);
    const trans = i < project.pages.length - 1 ? p.transition.durationInFrames : 0;
    acc += p.durationInFrames - trans;
  });
  return starts;
}
