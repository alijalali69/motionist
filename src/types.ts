// Shared reel types. The whole reel is described by a Project object, which the
// app edits in memory and passes to the Remotion Player (and to render via props).
import type { EntranceName, AmbientName, ExitName, EasingName, BgTextureName, BgColorName, BgGradeName, BgMotionName } from "./presets";

export type Box = { left: number; top: number; width: number; height: number };

// Backdrop treatment — the 4 layers from "The Backdrop Reel" research, each
// independently optional and stacked (texture over color over grade, with
// motion/particles on top of all three) instead of 24 separate hardcoded
// looks. A named preset just fills these fields in one shot from
// BG_PRESETS (see presets.ts) — the fields themselves are what actually
// renders and what the UI controls adjust, so picking a preset is always a
// starting point, never a locked choice. Every numeric knob is 0..1 unless
// noted; every color falls back to a per-style default when unset, so a
// bare `{ color: "mesh" }` already renders something reasonable.
export type BgStyle = {
  texture?: BgTextureName;      // "none" | grain/paper/halftone/etc — default "none"
  textureIntensity?: number;    // default 0.5
  color?: BgColorName;          // "none" = the plain bgColor/bg image shows through unchanged
  colorA?: string; colorB?: string; colorC?: string; // hex — meaning depends on `color`'s own style
  colorIntensity?: number;      // default 0.6
  colorSpeed?: number;          // animation rate multiplier, default 1 (0 = frozen on its first frame)
  grade?: BgGradeName;
  gradeIntensity?: number;      // default 0.5
  motion?: BgMotionName;
  motionDensity?: number;       // particle-count multiplier, default 0.5
  motionSpeed?: number;         // default 1
};

export type ContentLayer = {
  index: number;
  file: string;
  role: string;
  // Hidden layers are skipped everywhere they'd be drawn — the editor preview
  // AND the exported MP4, deliberately (Photoshop's rule: hidden is hidden,
  // not "hidden while I work"). Absent = visible, so every project saved
  // before this existed keeps rendering exactly as it did.
  hidden?: boolean;
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
  // Layer group — a plain shared string, not a real nested transform/scene
  // graph. Two or more layers on the SAME page sharing the same groupId
  // move together by the same position delta when any one of them is
  // dragged on the canvas (see the group-siblings block in App.tsx's
  // canvasHandles onChange) — position only, not size: resizing one
  // grouped layer resizes only itself. Unset/empty = ungrouped.
  groupId?: string;
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
  // Per-page backdrop treatment — same fallback rule as bgColor: unset means
  // "use the project's own bgStyle", not "no treatment at all". Whole-object
  // fallback, not a per-field merge (matches bgColor's own semantics), so a
  // page that sets ANY field of its own bgStyle owns the whole treatment.
  bgStyle?: BgStyle;
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
  // Optional entrance/exit FX — the same 91-effect vocabulary a page's own
  // content layers use (see entranceMotion/exitMotion/combineMotions in
  // presets.ts), but ONE slot each, not FX1/FX2/FX3 — the Logo/Title/BG
  // slots are single static overlays spanning the whole reel, not a
  // multi-effect content layer. Unset entrance/exit = static, exactly the
  // pre-FX behavior. Rendered in Logo.tsx's AssetSlot; entrance plays once
  // at reel frame 0, exit plays once at the reel's own last frames (the
  // caller passes reelDurationInFrames for that — see Reel.tsx).
  entrance?: EntranceName;
  entranceEasing?: EasingName;
  delay?: number;       // in-delay (frames) before entrance starts, default 0
  inDuration?: number;  // entrance length (frames), default 26
  exit?: ExitName;
  exitEasing?: EasingName;
  outDelay?: number;    // exit START (frames from reel start); unset = anchored to reel end
  outDuration?: number; // exit length (frames), default 24
};

export type Caption = { fromFrame: number; toFrame: number; text: string };

// One global background-music track for the whole reel — a real gap this
// app had none of (video layers can carry their OWN embedded sound via
// ContentLayer.videoMuted, but there was no way to add a separate song/
// audio bed). `file` is normalized server-side to AAC/M4A regardless of
// the source format uploaded (see saveMedia in server/index.mjs).
export type AudioTrack = {
  file: string | null;
  duration: number | null; // the SOURCE file's own real length in seconds, from ffprobe — bounds how far `startOffset` can trim
  volume: number; // 0..1, default 1
  startOffset: number; // seconds into the source file where the reel's own audio starts (trim the song's intro, etc.)
  fadeInSec: number; // 0 = no fade
  fadeOutSec: number;
  muted: boolean; // a toggle, not just deleting the track — matches ContentLayer.videoMuted's own convention
};

// User-placed ruler guide (Illustrator-style) — a persistent alignment line
// the user drags into place, distinct from CanvasHandles.tsx's own ephemeral
// smart-guide highlights (which appear only while dragging a layer, from
// canvas edges/other-element edges, and are never saved). Shared across
// every page in the project, not per-page: all pages of one project already
// share the same canvas size, so "guides for this composition" is the
// natural scope — matches how Illustrator's ruler guides are per-document,
// not per-artboard-with-identical-dimensions.
export type Guide = { id: string; axis: "x" | "y"; pos: number };

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
  bgStyle?: BgStyle;         // global backdrop treatment — see BgStyle; a page's own bgStyle overrides this entirely
  swatches?: string[];       // user-saved hex colors for this project, offered next to every color picker
  guides?: Guide[];          // user-placed ruler guides — editor-only, never rendered in export (see Guide above)
  title?: LogoConfig | null; // global title, rendered as a locked overlay
  loader: Box;
  loaderStyle?: LoaderStyle; // default "bar"
  loaderVisible?: boolean;   // default true (absent = shown, for old projects)
  subtitle: Box;
  subtitleStyle?: SubtitleStyle;
  captions?: Caption[]; // timed captions (from SRT); optional, overrides per-page text when present
  audio?: AudioTrack | null; // global background music/sound bed, spans the whole reel
  pages: Page[];
};

// How long the transition from page i into page i+1 actually plays, in
// frames. Everything that needs a transition's length goes through here —
// the Reel's own TransitionSeries, reelDuration and pageStarts — so the
// player, the timeline and the export can never disagree.
//
// The stored length isn't trusted as-is. Every page ever created got a
// 1-frame placeholder (0 crashed Remotion, and there was no control to
// change it), which is why picking "fade" looked exactly like a cut. A
// real transition still carrying that placeholder plays for
// DEFAULT_TRANSITION_SEC instead, which fixes existing projects without
// rewriting their files. A cut is 1 frame whatever is stored, so switching
// fade → cut → fade keeps the length that was chosen.
//
// Clamped to both neighbouring pages: Remotion throws if a transition is
// longer than the sequence on either side of it — which a page shortened
// after its transition was set would otherwise do.
export const DEFAULT_TRANSITION_SEC = 0.5;

export function transitionFrames(project: Project, i: number): number {
  const page = project.pages[i];
  const next = project.pages[i + 1];
  if (!page || !next) return 0; // the last page has nothing to transition into
  if (page.transition.type === "none") return 1;
  const stored = page.transition.durationInFrames;
  const wanted = stored > 1 ? stored : Math.round(DEFAULT_TRANSITION_SEC * project.fps);
  return Math.max(1, Math.min(wanted, page.durationInFrames, next.durationInFrames));
}

// Total = sum(page durations) - sum(transition overlaps).
export function reelDuration(project: Project): number {
  const totalPages = project.pages.reduce((s, p) => s + p.durationInFrames, 0);
  const totalTrans = project.pages.reduce((s, _p, i) => s + transitionFrames(project, i), 0);
  return Math.max(1, totalPages - totalTrans);
}

// Nominal start frame of each page (ignores transition overlap fuzz), used to
// time per-page subtitles in the fixed overlay.
export function pageStarts(project: Project): number[] {
  const starts: number[] = [];
  let acc = 0;
  project.pages.forEach((p, i) => {
    starts.push(acc);
    acc += p.durationInFrames - transitionFrames(project, i);
  });
  return starts;
}
