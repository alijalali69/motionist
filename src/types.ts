// Shared reel types. The whole reel is described by a Project object, which the
// app edits in memory and passes to the Remotion Player (and to render via props).
import type { EntranceName, AmbientName, ExitName, EasingName } from "./presets";

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
  // IN effect. entrance2/entrance3 are optional extra effects COMBINED with
  // `entrance` (layered via combineMotions in presets.ts) — the FX1/FX2/FX3
  // slots in the inspector, capped at 3.
  entrance: EntranceName;
  entrance2?: EntranceName;
  entrance3?: EntranceName;
  delay: number;         // FX1's in-delay (frames) before its entrance starts
  inDuration?: number;   // FX1's entrance length (frames), default 26
  // Each combined FX slot gets its OWN timing AND easing — FX1 can start
  // immediately and land hard (easeOutBack) while FX2 starts later and
  // settles slow (easeOutExpo); they're combined (see combineMotions) but
  // never share one delay/duration/curve. delay2/inDuration2/
  // entranceEasing2 are FX2's own; unset = falls back to FX1's own value
  // (delay/inDuration/entranceEasing) — so a layer that's never had FX2/3
  // dragged independently behaves exactly as if they were still shared.
  delay2?: number;
  delay3?: number;
  inDuration2?: number;
  inDuration3?: number;
  entranceEasing?: EasingName;
  entranceEasing2?: EasingName;
  entranceEasing3?: EasingName;
  // OUT effect — by default plays over the last outDuration frames of the
  // page (anchored to the page's END); set outDelay to instead anchor it to
  // an exact time from the page's START (e.g. "exit at 4.5s"), independent
  // of how long the page is. exit2/exit3 combine the same way entrance2/3 do,
  // with the same independent-timing-falls-back-to-FX1 rule as delay2/3 above.
  exit?: ExitName;       // default "none"
  exit2?: ExitName;
  exit3?: ExitName;
  outDuration?: number;  // FX1's exit length (frames), default 24
  outDelay?: number;     // FX1's exit START (frames from page start) — unset = old "anchored to page end" behavior
  outDelay2?: number;
  outDelay3?: number;
  outDuration2?: number;
  outDuration3?: number;
  exitEasing?: EasingName; // unset = use the curated default for this exit (see presets.ts)
  exitEasing2?: EasingName;
  exitEasing3?: EasingName;
  // Optional uploaded replacement asset (BG/Title "like the logo"). When kind is
  // video/gif/lottie the layer plays that asset in place of the static image,
  // keeping its box + motion. Absent => render `file` as a still image.
  assetKind?: "image" | "video" | "gif" | "lottie" | "text" | "shape";
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
  direction?: "rtl" | "ltr"; // default "rtl" (Farsi) — set "ltr" for English/Latin text
  letterSpacing?: number; // px, default 0
  lineHeight?: number; // multiple of font size, default 1.5
  uppercase?: boolean; // CSS text-transform only — the stored `text` itself is untouched
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
  photoZoom?: number; // default 1 (exact cover fit) — >1 zooms in, <1 (down to 0.3) shrinks the photo inside its frame
  naturalWidth?: number | null;  // uploaded asset's real pixel size (for pan math)
  naturalHeight?: number | null;
  // Only matters when the uploaded asset is a video (assetKind "video", or
  // shapePhotoKind "video" for a shape's photo mask) — unset/false = plays
  // with its own embedded audio, both in the live preview AND the final
  // export (OffthreadVideo's `muted` prop is respected by Remotion's render
  // pipeline, not just live playback). true = silent in both.
  videoMuted?: boolean;
  // How much of the PAGE's own ambient motion (kenburns, sway, etc. — set on
  // the page, not per-layer) this layer participates in. Unset/1 = moves
  // exactly with the page ambient (today's only behavior, still the
  // default). 0 = ignores it entirely (stays put while everything else
  // drifts — e.g. a locked foreground title over a panning background).
  // >1 = moves MORE than the page ambient (closer/foreground feel). <1 = a
  // background layer drifting slower than the rest, for real parallax depth
  // instead of every layer moving as one rigid unit.
  parallaxDepth?: number;
  // Plain vector shape (assetKind "shape") — a solid-color box for text
  // backgrounds, separators, or a colored panel behind other layers.
  // `file` is unused for these, same as text. Uses the box's own
  // left/top/width/height + the normal entrance/exit/parallax pipeline —
  // it's a layer like any other, just with no image/text content.
  // "square"/"circle" render exactly like rect/ellipse — they're a
  // convenience in the picker (snap the box to equal width/height on
  // selection) rather than a distinct render primitive. "line" also renders
  // as a plain rect; picking it just seeds a thin default box.
  shapeType?: "rect" | "ellipse" | "square" | "circle" | "line";
  shapeFill?: string;
  shapeCornerRadius?: number; // rect/square/line only; ellipse/circle ignore it (already round)
  shapeStrokeColor?: string;
  shapeStrokeWidth?: number; // 0/undefined = no stroke
  // Optional photo (or video/gif) mask — when set, this shape's own geometry
  // (its corner radius / circle roundness / stroke) clips the uploaded media
  // instead of the flat shapeFill color; shapeFill itself is untouched and
  // just stops being drawn while a mask is present, so removing the photo
  // always falls straight back to whatever fill was already set. Reuses the
  // SAME generic crop fields a real photo layer uses — photoPanX/photoPanY/
  // photoZoom/fit/photoMotion/naturalWidth/naturalHeight — a shape with a
  // photo mask is pan/zoom-croppable exactly like a photo layer (see
  // PhotoPanHandles' target filter in App.tsx).
  shapePhotoFile?: string;
  shapePhotoKind?: "image" | "video" | "gif";
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
  bgColor?: string;  // per-page solid backdrop (e.g. a text-only page with no photo) — falls back to the project's bgColor when unset
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

export type LoaderStyle = "bar" | "segmented" | "dots" | "folio";

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
  bgColor?: string;          // solid backdrop color, shows wherever bg/pages don't fully cover (default "#e8e4dd")
  swatches?: string[];       // user-saved hex colors for this project, offered next to every color picker
  title?: LogoConfig | null; // global title, rendered as a locked overlay
  loader: Box;
  loaderStyle?: LoaderStyle; // default "bar"
  loaderVisible?: boolean;   // default true (absent = shown, for old projects)
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
