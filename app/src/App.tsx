import React from "react";
import { Player, Thumbnail, type PlayerRef } from "@remotion/player";
import { Reel } from "../../src/Reel";
import { reelDuration, pageStarts, type Project, type LogoConfig, type Box, type LoaderStyle } from "../../src/types";
import { TEXT_ENTRANCE_NAMES, TEXT_EXIT_NAMES, LATIN_TEXT_ENTRANCE_NAMES, AMBIENT_NAMES, ENTRANCE_CATEGORIES, EXIT_CATEGORIES, EASING_NAMES, TRANSITIONS, BG_TEXTURE_NAMES, BG_COLOR_NAMES, BG_GRADE_NAMES, BG_MOTION_NAMES } from "../../src/presets";
import type { BgStyle } from "../../src/types";
import {
  loadProject, saveProject, generateThumbnail, duplicatePage, ingestPsd, uploadLogo, uploadAsset, startRenderJob, getRenderJobStatus, cancelRenderJob,
  browseFolder, type RenderQuality,
  listFonts, deleteProjectFiles, type IngestResult, type FontEntry,
  listBrandColors,
  listMotionPresets, saveMotionPreset, deleteMotionPreset, type MotionPresetEntry,
  listPageTemplates, loadPageTemplate, savePageTemplate, deletePageTemplate, type PageTemplateSummary,
} from "./api";
import { BUILT_IN_PRESETS } from "./builtinPresets";
import { Dashboard } from "./Dashboard";
import { PageThumb } from "../../src/PageThumb";
import { CanvasHandles, type Handle } from "./CanvasHandles";
import { PhotoPanHandles, type PhotoPanTarget } from "./PhotoPanHandles";
import { SafeZoneOverlay } from "./SafeZoneOverlay";
import { InstagramUIOverlay } from "./InstagramUIOverlay";
import { GuidesOverlay } from "./GuidesOverlay";
import { TextPlacementOverlay } from "./TextPlacementOverlay";
import { NumField } from "./NumField";
import { Waveform } from "./Waveform";
import { KeyframeEditor } from "./KeyframeEditor";

const AMBIENTS = AMBIENT_NAMES;
const EASINGS = EASING_NAMES;

// structuredClone is a native deep clone — no JSON string round-trip, which
// was the real cost here: update() calls this on every single edit,
// including every pointermove during a drag (a keyframe block, a canvas
// handle, a photo pan) — JSON.stringify+parse of the WHOLE project on every
// mouse-pixel of movement was the actual cause of scrubbing lag on any
// project of real size. Project is already guaranteed plain-JSON-shaped
// data (it's persisted to disk as JSON), so this clones it exactly the
// same, just without paying for two full string conversions to do it.
function clone<T>(x: T): T {
  return structuredClone(x);
}

// Measures a text layer's REAL rendered size — the same font-family/size/
// line-height/letter-spacing/uppercase/direction CSS PageScene.tsx's own
// TextLayerView actually draws with (see its `textStyle`), just off-screen
// and with white-space:pre instead of pre-wrap, so the result is the
// text's NATURAL size rather than whatever a currently-saved box width
// happens to wrap it into. Explicit newlines the user actually typed are
// still respected — only automatic wrapping is skipped, which is exactly
// what "the box is always exactly text-sized" needs: once the box always
// matches this, the real renderer's own pre-wrap never actually needs to
// wrap anything either, so there's no behavioral gap between this
// measurement and the real render.
//
// One shared hidden element, reused across calls — cheap to create once,
// and every call fully finishes (set styles, force layout via
// getBoundingClientRect, read it back) before the next one touches it, so
// reentrancy across multiple layers/effects in the same tick is safe.
let measureEl: HTMLDivElement | null = null;
function measureTextBox(opts: {
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  direction?: "rtl" | "ltr";
}): { width: number; height: number } {
  if (!measureEl) {
    measureEl = document.createElement("div");
    Object.assign(measureEl.style, {
      position: "fixed", top: "-9999px", left: "-9999px",
      visibility: "hidden", whiteSpace: "pre", display: "inline-block", pointerEvents: "none",
    });
    document.body.appendChild(measureEl);
  }
  const el = measureEl;
  el.style.fontFamily = opts.fontFamily || "Tahoma, Arial, sans-serif";
  el.style.fontSize = `${opts.fontSize ?? 48}px`;
  el.style.lineHeight = String(opts.lineHeight ?? 1.5);
  el.style.letterSpacing = opts.letterSpacing ? `${opts.letterSpacing}px` : "normal";
  el.style.textTransform = opts.uppercase ? "uppercase" : "none";
  el.style.direction = opts.direction ?? "rtl";
  // Empty text still needs to measure as ONE line's worth of height (an
  // empty box would otherwise collapse to zero and effectively disappear
  // the instant you clear a text layer's content).
  el.textContent = opts.text || " ";
  const rect = el.getBoundingClientRect();
  return { width: Math.max(1, Math.ceil(rect.width)), height: Math.max(1, Math.ceil(rect.height)) };
}

// A color swatch (native picker, for dragging around a color wheel) plus a
// hex text field (for pasting/typing an exact value) — the native <input
// type="color"> alone has no visible hex entry in most browsers. Local text
// state so a partial/invalid hex while typing doesn't get stomped on every
// keystroke; commits (and validates) on blur or Enter.
const ColorField: React.FC<{
  value: string;
  onChange: (hex: string) => void;
  swatchStyle?: React.CSSProperties;
  // Saved-palette swatches — all three optional so existing call sites keep
  // working untouched; a call site only shows the swatch row once it wires
  // these up. Lives on the PROJECT (see Project.swatches), not per-field —
  // one saved palette, offered next to every color picker in the app.
  swatches?: string[];
  onAddSwatch?: (hex: string) => void;
  onRemoveSwatch?: (hex: string) => void;
  // Brand kit — saved once from the Dashboard's "🎨 Colors" manager,
  // shared by every project (same idea as the font library). Read-only
  // here on purpose: adding/removing brand colors happens in that one
  // manager, not scattered across every color field in the app — clicking
  // a brand swatch just applies it, same as clicking a project one does.
  brandSwatches?: string[];
}> = ({ value, onChange, swatchStyle, swatches, onAddSwatch, onRemoveSwatch, brandSwatches }) => {
  const [text, setText] = React.useState(value);
  React.useEffect(() => { setText(value); }, [value]);

  const commit = () => {
    let hex = text.trim();
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex);
    else setText(value); // invalid — snap back to the last real value
  };

  const alreadySaved = !!swatches?.some((s) => s.toLowerCase() === value.toLowerCase());

  return (
    <div>
      <div className="row color-field-row">
        <input type="color" value={value} className="color-swatch-input"
          style={swatchStyle}
          onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={text} maxLength={7} placeholder="#rrggbb" className="color-hex-input"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        {onAddSwatch && (
          <button className="btn small color-save-btn" title={alreadySaved ? "Already saved" : "Save this color as a swatch"}
            disabled={alreadySaved} onClick={() => onAddSwatch(value)}>＋</button>
        )}
      </div>
      {/* Each saved swatch is one fixed-size chip — the remove ✕ is an
          absolutely-positioned corner badge (same hover-reveal language as
          a project card's delete button), not a sibling button next to a
          differently-sized swatch. That's what kept the old row visually
          uneven: a 16px swatch and a 12px ✕ button, flex-centered against
          each other, never quite lined up across a whole row of them. */}
      {swatches && swatches.length > 0 && (
        <div className="swatch-row">
          {swatches.map((hex) => (
            <div key={hex} className={"swatch-chip" + (hex.toLowerCase() === value.toLowerCase() ? " selected" : "")}
              style={{ background: hex }}>
              <button className="swatch-pick" title={hex} aria-label={`Use ${hex}`} onClick={() => onChange(hex)} />
              {onRemoveSwatch && (
                <button className="swatch-del" title={`Remove ${hex}`} aria-label={`Remove ${hex}`}
                  onClick={() => onRemoveSwatch(hex)}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Brand kit row — same chip look as the project's own swatches
          above, minus the ✕ (nothing to remove from here — see
          BrandColorManager on the Dashboard for that). A small label
          separates the two rows since they're both just rows of colored
          squares otherwise, easy to read as one longer list. */}
      {brandSwatches && brandSwatches.length > 0 && (
        <>
          <div className="hint" style={{ margin: "4px 0 2px" }}>Brand kit</div>
          <div className="swatch-row">
            {brandSwatches.map((hex) => (
              <div key={hex} className={"swatch-chip" + (hex.toLowerCase() === value.toLowerCase() ? " selected" : "")}
                style={{ background: hex }}>
                <button className="swatch-pick" title={hex} aria-label={`Use ${hex}`} onClick={() => onChange(hex)} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Shared by both the global "Background style" card and each page's own
// override — same 4-layer picker (texture over color over grade, with
// motion/particles on top of all three; see BgStyle/Backdrop.tsx) bound to
// whichever BgStyle the caller passes. `onChange` mutates the RESOLVED
// style object directly — the caller creates it on first touch (project.
// bgStyle / page.bgStyle start unset, same create-on-first-edit pattern as
// bgColor elsewhere), so this component never has to know which one it's
// editing or how the "page follows the project" fallback works.
type BgCategory = "texture" | "color" | "grade" | "motion";

const BgStyleEditor: React.FC<{
  value: BgStyle;
  onChange: (fn: (s: BgStyle) => void) => void;
  swatches: string[];
  onAddSwatch: (hex: string) => void;
  onRemoveSwatch: (hex: string) => void;
  brandSwatches?: string[];
}> = ({ value, onChange, swatches, onAddSwatch, onRemoveSwatch, brandSwatches }) => {
  // Collapsed by default — clicking a tile opens ONLY that category's own
  // controls below the tile row; clicking it again (or another tile)
  // closes/switches. Independent of whether a category is "filled" (has a
  // real non-"none" value) — a tile can be filled and collapsed, or empty
  // and expanded, at the same time.
  const [expanded, setExpanded] = React.useState<BgCategory | null>(null);
  const toggle = (cat: BgCategory) => setExpanded((cur) => (cur === cat ? null : cat));
  const pct = (n: number | undefined, def: number) => Math.round((n ?? def) * 100);
  const setPct = (key: keyof BgStyle, max: number) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange((s) => { (s as any)[key] = Math.min(max, Math.max(0, Math.round(parseFloat(e.target.value || "0")))) / 100; });

  return (
    <div className="mini" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="tilegrid-4">
        <button type="button" className={"assettile mini" + (value.texture && value.texture !== "none" ? " filled" : "") + (expanded === "texture" ? " expanded" : "")}
          title="Grain / paper / halftone / etc — analog surface texture" onClick={() => toggle("texture")}>
          <TextureTileIcon /><span className="lbl">Texture</span><span className="st">{value.texture ?? "none"}</span>
        </button>
        <button type="button" className={"assettile mini" + (value.color && value.color !== "none" ? " filled" : "") + (expanded === "color" ? " expanded" : "")}
          title="Gradient / mesh / duotone / etc — replaces the flat backdrop color" onClick={() => toggle("color")}>
          <ColorTileIcon /><span className="lbl">Color</span><span className="st">{value.color ?? "none"}</span>
        </button>
        <button type="button" className={"assettile mini" + (value.grade && value.grade !== "none" ? " filled" : "") + (expanded === "grade" ? " expanded" : "")}
          title="Vignette / letterbox / color-grade / etc — cinematic framing and tone" onClick={() => toggle("grade")}>
          <GradeTileIcon /><span className="lbl">Grade</span><span className="st">{value.grade ?? "none"}</span>
        </button>
        <button type="button" className={"assettile mini" + (value.motion && value.motion !== "none" ? " filled" : "") + (expanded === "motion" ? " expanded" : "")}
          title="Bokeh / dust / snow / etc — drifting particles, frame-deterministic (not real-time physics)" onClick={() => toggle("motion")}>
          <MotionTileIcon /><span className="lbl">Motion</span><span className="st">{value.motion ?? "none"}</span>
        </button>
      </div>

      {expanded === "texture" && (
        <div>
          <div className="row between" style={{ alignItems: "center" }}>
            <label style={{ margin: 0 }}>Texture</label>
            <select value={value.texture ?? "none"} style={{ width: "auto" }}
              onChange={(e) => onChange((s) => { s.texture = e.target.value as any; })}>
              {BG_TEXTURE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {value.texture && value.texture !== "none" && (
            <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
              <span style={{ color: "var(--muted)" }}>Intensity</span>
              <NumField min={0} max={100} value={pct(value.textureIntensity, 0.5)} onChange={setPct("textureIntensity", 100)} />
            </div>
          )}
        </div>
      )}

      {expanded === "color" && (
        <div>
          <div className="row between" style={{ alignItems: "center" }}>
            <label style={{ margin: 0 }}>Color</label>
            <select value={value.color ?? "none"} style={{ width: "auto" }}
              onChange={(e) => onChange((s) => { s.color = e.target.value as any; })}>
              {BG_COLOR_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {value.color && value.color !== "none" && (
            <>
              <div className="row" style={{ marginTop: 4, gap: 4 }} title="Colors this style uses — meaning depends on which one is picked above">
                <ColorField value={value.colorA ?? "#ffffff"} onChange={(hex) => onChange((s) => { s.colorA = hex; })}
                  swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandSwatches} />
                <ColorField value={value.colorB ?? "#000000"} onChange={(hex) => onChange((s) => { s.colorB = hex; })}
                  swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandSwatches} />
                <ColorField value={value.colorC ?? "#888888"} onChange={(hex) => onChange((s) => { s.colorC = hex; })}
                  swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandSwatches} />
              </div>
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>Intensity</span>
                <NumField min={0} max={100} value={pct(value.colorIntensity, 0.6)} onChange={setPct("colorIntensity", 100)} />
              </div>
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }} title="How fast this color style animates — 0 freezes it on its first frame">Speed</span>
                <NumField min={0} max={200} value={pct(value.colorSpeed, 1)} onChange={setPct("colorSpeed", 200)} />
              </div>
            </>
          )}
        </div>
      )}

      {expanded === "grade" && (
        <div>
          <div className="row between" style={{ alignItems: "center" }}>
            <label style={{ margin: 0 }}>Grade</label>
            <select value={value.grade ?? "none"} style={{ width: "auto" }}
              onChange={(e) => onChange((s) => { s.grade = e.target.value as any; })}>
              {BG_GRADE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {value.grade && value.grade !== "none" && (
            <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
              <span style={{ color: "var(--muted)" }}>Intensity</span>
              <NumField min={0} max={100} value={pct(value.gradeIntensity, 0.5)} onChange={setPct("gradeIntensity", 100)} />
            </div>
          )}
        </div>
      )}

      {expanded === "motion" && (
        <div>
          <div className="row between" style={{ alignItems: "center" }}>
            <label style={{ margin: 0 }}>Motion</label>
            <select value={value.motion ?? "none"} style={{ width: "auto" }}
              onChange={(e) => onChange((s) => { s.motion = e.target.value as any; })}>
              {BG_MOTION_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {value.motion && value.motion !== "none" && (
            <>
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>Density</span>
                <NumField min={0} max={100} value={pct(value.motionDensity, 0.5)} onChange={setPct("motionDensity", 100)} />
              </div>
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>Speed</span>
                <NumField min={0} max={200} value={pct(value.motionSpeed, 1)} onChange={setPct("motionSpeed", 200)} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

function niceName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, ""); // strip extension
}

// A plain photo (jpg/png/webp/gif) has no layer structure to extract, unlike
// a PSD/SVG template — so it becomes its own one-layer page instead of going
// through the server's PSD/SVG ingest pipeline: one full-bleed photo layer,
// sized to the reel canvas, ready for the user to drop a text layer on top of.
const IMAGE_PAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function pageFromImage(
  project: Project,
  name: string,
  upload: { file: string; kind: "image" | "video" | "gif" | "lottie"; width: number | null; height: number | null }
): Project["pages"][number] {
  const id = "p" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
  return {
    id,
    name: niceName(name),
    durationInFrames: 150, // 5s @ 30fps — matches the default template-page length
    // No preset motion — same "start at none" default as everywhere else;
    // the user opts into ambient/entrance/transition per element instead.
    ambient: "none",
    // durationInFrames must be >=1 — 0 crashes @remotion/transitions the
    // moment a second page exists (its interpolate() needs a strictly
    // increasing range; 0 collapses to [x,x]).
    transition: { type: "none" as any, durationInFrames: 1 },
    layers: [
      {
        index: -Date.now(),
        file: upload.file,
        role: "photo",
        left: 0, top: 0, width: project.width, height: project.height,
        opacity: 1,
        entrance: "none",
        delay: 0,
        assetKind: upload.kind === "video" || upload.kind === "gif" ? upload.kind : "image",
        fit: "cover",
        // Required for the pan/zoom drag handle to show up at all (it needs
        // the real pixel size to compute how far the crop can be dragged) —
        // this was missing before, which silently made a fresh photo page
        // un-repositionable.
        naturalWidth: upload.width,
        naturalHeight: upload.height,
      },
    ],
  };
}

// Box for a slot's asset. BG always goes full-bleed (it's a backdrop — native
// size is irrelevant). Logo/Title use the asset's REAL exported pixel size,
// scaled down only if it would be unreasonably large for its spot on the
// canvas — never force-fit into an arbitrary preset box.
function boxForSlot(
  slotKey: "logo" | "bg" | "title", cw: number, ch: number,
  nativeW: number | null, nativeH: number | null
) {
  if (slotKey === "bg") return { left: 0, top: 0, width: cw, height: ch };

  const caps = slotKey === "logo"
    ? { maxW: cw * 0.35, maxH: ch * 0.15, margin: 40 }
    : { maxW: cw * 0.85, maxH: ch * 0.25, margin: 0 };

  // Fallback size when dimensions couldn't be detected (rare: exotic format).
  let w = nativeW ?? (slotKey === "logo" ? 340 : Math.round(cw * 0.8));
  let h = nativeH ?? (slotKey === "logo" ? 190 : Math.round(ch * 0.14));

  const scale = Math.min(1, caps.maxW / w, caps.maxH / h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const left = slotKey === "logo" ? cw - w - caps.margin : Math.round((cw - w) / 2);
  const top = slotKey === "logo" ? caps.margin : Math.round(ch * 0.12);
  return { left, top, width: w, height: h };
}

function defaultSlot(
  slotKey: "logo" | "bg" | "title", w: number, h: number,
  file: string, kind: LogoConfig["kind"],
  nativeW: number | null = null, nativeH: number | null = null
): LogoConfig {
  return {
    box: boxForSlot(slotKey, w, h, nativeW, nativeH),
    kind, file, fallback: null, opacity: 1,
    fit: slotKey === "bg" ? "cover" : "contain",
  };
}

function mergeIngestedPage(prev: Project, res: IngestResult, sourceName: string): Project {
  const next = clone(prev);
  next.pages.push({ ...res.page, name: niceName(sourceName) });
  // merge chrome only if not already set
  if (!next.template.layers.length && res.fixed.length) next.template.layers = res.fixed;
  if (!next.logo && res.logo) next.logo = res.logo;
  if (res.loaderBox) next.loader = res.loaderBox;
  if (res.subtitleBox) next.subtitle = res.subtitleBox;
  return next;
}

function fmtTime(frame: number, fps: number): string {
  const totalSec = Math.max(0, frame / fps);
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Custom control bar rendered BELOW the player (never overlaid on top of it,
// so the canvas itself always stays clean — e.g. for screenshots/recording
// off the screen) — built on PlayerRef instead of the Player's own built-in
// `controls` overlay.
const PlayerControls: React.FC<{
  playerRef: React.RefObject<PlayerRef>;
  durationInFrames: number;
  fps: number;
  // Zoom%/safe-zone/Instagram-UI toggles — rendered right after Fullscreen,
  // in the same row. Passed in rather than built here since they're driven
  // by state that lives in the Editor, not this component.
  children?: React.ReactNode;
}> = ({ playerRef, durationInFrames, fps, children }) => {
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFs = (e: { detail: { isFullscreen: boolean } }) => setFullscreen(e.detail.isFullscreen);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("fullscreenchange", onFs);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("fullscreenchange", onFs);
    };
  }, [playerRef]);

  return (
    <div className="player-controls">
      <button className="btn small" onClick={() => playerRef.current?.toggle()} title={playing ? "Pause (space)" : "Play (space)"}>
        {playing ? "⏸" : "▶"}
      </button>
      <span className="pc-time">{fmtTime(frame, fps)} / {fmtTime(durationInFrames, fps)}</span>
      <input
        type="range" min={0} max={Math.max(0, durationInFrames - 1)} value={frame}
        className="pc-seek"
        onChange={(e) => playerRef.current?.seekTo(parseInt(e.target.value, 10))}
      />
      <button className="btn small icon" onClick={() => (fullscreen ? playerRef.current?.exitFullscreen() : playerRef.current?.requestFullscreen())}
        title={fullscreen ? "Exit fullscreen" : "Fullscreen"} aria-pressed={fullscreen}>
        {fullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
      </button>
      {children}
    </div>
  );
};

// One filmstrip card — a real live-content thumbnail (frame 0 of that page,
// via the same lightweight <Thumbnail> the old storyboard strip used) plus
// drag-to-reorder. Memoized so a page edit elsewhere (or another card being
// dragged over) doesn't re-mount every OTHER card's own Remotion thumbnail —
// same reasoning the storyboard strip's own PageCard had, just without that
// component's live-reflow-during-drag complexity: this filmstrip scrolls
// natively (no JS-driven offset re-rendering every card on every tick), so
// the only real re-render pressure left is a page edit or a drag tick, both
// already infrequent enough not to need the FLIP-animation machinery.
const FilmstripPageCard = React.memo<{
  project: Project;
  page: Project["pages"][number];
  index: number;
  selected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onSelect: (i: number) => void;
  onDragStartCard: (i: number) => void;
  onDragOverCard: (i: number) => void;
  onDropCard: (fromIndex: number, toIndex: number) => void;
  onDragEndCard: () => void;
  // The actions pill itself is a single shared element rendered at the
  // .filmstrip level (see below) — this just reports "I'm hovered, here's
  // my rect" up so that shared element knows whether to show and where.
  onHoverCard: (index: number, rect: DOMRect) => void;
  onUnhoverCard: () => void;
}>(({ project, page, index, selected, isDragging, isDragOver, onSelect, onDragStartCard, onDragOverCard, onDropCard, onDragEndCard, onHoverCard, onUnhoverCard }) => {
  return (
    <div
      className={"pagecard" + (selected ? " active" : "") + (isDragOver ? " drag-over" : "")}
      draggable
      onClick={() => onSelect(index)}
      onMouseEnter={(e) => onHoverCard(index, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onUnhoverCard}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(index)); onDragStartCard(index); }}
      onDragOver={(e) => { e.preventDefault(); onDragOverCard(index); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        // Read the dragged-from index straight off dataTransfer (set at
        // dragstart, guaranteed available here per the HTML5 DnD spec)
        // rather than the draggingPageIndex state the card above tracks
        // purely for the opacity/highlight visuals — state set by dragstart
        // and read by this drop handler are two different React renders,
        // and nothing forces the first to have flushed before the second
        // reads it (real mouse drags always have time between them for it
        // to happen anyway, but this way it isn't a timing assumption).
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (!Number.isNaN(from)) onDropCard(from, index);
      }}
      onDragEnd={onDragEndCard}
      title={page.name ?? page.id}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="pagethumb">
        <Thumbnail
          component={PageThumb}
          inputProps={{ project, page }}
          frameToDisplay={0}
          durationInFrames={Math.max(1, page.durationInFrames)}
          compositionWidth={project.width}
          compositionHeight={project.height}
          fps={project.fps}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
      <span className="pagecard-n">{index + 1}</span>
    </div>
  );
});

// --- Top-level app shell: switches between the project Dashboard and the Editor.
export const App: React.FC = () => {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  if (!activeId) {
    return <Dashboard onOpen={setActiveId} />;
  }
  return <Editor projectId={activeId} onBack={() => setActiveId(null)} />;
};

const Editor: React.FC<{ projectId: string; onBack: () => void }> = ({ projectId, onBack }) => {
  const [project, setProject] = React.useState<Project | null>(null);
  const [sel, setSel] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [renderUrl, setRenderUrl] = React.useState<string | null>(null);
  const [renderProgress, setRenderProgress] = React.useState<{ percent: number; phase?: string; frame?: number; totalFrames?: number; status?: string } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  // Filmstrip drag-to-reorder — which page is currently being dragged, and
  // which one it's hovering over right now (both null outside a drag). Kept
  // as plain state (not refs) since there are only ever a handful of pages,
  // nowhere near the storyboard strip's old per-frame-of-scroll concern.
  const [draggingPageIndex, setDraggingPageIndex] = React.useState<number | null>(null);
  const [dragOverPageIndex, setDragOverPageIndex] = React.useState<number | null>(null);
  // Filmstrip's save-as-template/delete pill — one shared element (position:
  // fixed, placed from the hovered card's own rect) instead of one per card,
  // so it never has to live inside .filmstrip-scroll's clipping box at all
  // (that's what caused the hover-scroll bug: the old per-card popup
  // escaped that box, which is silently overflow-y:hidden/auto no matter
  // what — see .pagecard-actions in ui.css). A short close delay (cleared
  // if either the card or the pill itself gets re-entered) covers the
  // small screen-space gap between the card and the pill sitting just
  // above it, so moving the mouse from one to the other doesn't close it.
  const [hoverPageCard, setHoverPageCard] = React.useState<{ index: number; rect: DOMRect } | null>(null);
  const hoverCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHoverPageCard = (index: number, rect: DOMRect) => {
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
    setHoverPageCard({ index, rect });
  };
  const scheduleHideHoverPageCard = () => {
    hoverCloseTimer.current = setTimeout(() => setHoverPageCard(null), 150);
  };
  const [motionClip, setMotionClip] = React.useState<MotionClip | null>(null);
  // Page-layout template library — a whole saved page (layers, boxes,
  // motion, its own bg style), reusable across any project. `null` =
  // not fetched yet; fetched lazily when the picker actually opens.
  const [pageTemplates, setPageTemplates] = React.useState<PageTemplateSummary[] | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = React.useState(false);
  const [savingTemplateFor, setSavingTemplateFor] = React.useState<number | null>(null); // page index, or null
  const [templateName, setTemplateName] = React.useState("");
  const [templateBusy, setTemplateBusy] = React.useState(false);
  const [templateErr, setTemplateErr] = React.useState<string | null>(null);
  // The bottom filmstrip's "+" dropdown — the three ways to add a page
  // (blank / import sequence / from template), same actions the old Pages
  // dock's three-button row triggered, just tucked behind ▾ now that the
  // filmstrip is a permanent bar and can't spare a whole button row.
  const [showAddPageMenu, setShowAddPageMenu] = React.useState(false);
  // Account menu — placeholder items only, see the topbar's acctwrap below.
  const [showAcctMenu, setShowAcctMenu] = React.useState(false);
  // Keyboard shortcuts cheatsheet — real shortcuts already existed (undo/
  // redo, space, delete, arrow-nudge, etc.) with zero way to discover them
  // short of already knowing to try. Toggled by the topbar's "?" button, or
  // the "?" key itself once you do know (see the global keydown effect).
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showSafeZone, setShowSafeZone] = React.useState(false);
  const [showInstagramUI, setShowInstagramUI] = React.useState(false);
  // Visibility toggle only — like showSafeZone/showInstagramUI above, this
  // is ephemeral (resets on reload), separate from the actual guide
  // POSITIONS, which are real project data (project.guides, persisted).
  // Hidden guides also stop snapping (see the userGuides prop passed to
  // CanvasHandles below) — a snap you can't see would be more confusing
  // than not snapping at all.
  const [showGuides, setShowGuides] = React.useState(false);
  // A photo layer's own frame is now freely draggable/resizable (plain drag)
  // same as text/shapes — but it ALSO has a pan-within-frame interaction
  // (drag the photo to choose its crop) that used to own the whole body-drag
  // gesture. Both can't claim a plain drag on the same box at once, so pan
  // moves behind a modifier: holding Alt hands the drag back to
  // PhotoPanHandles instead of the move/resize handle (see canvasHandles'
  // panPassthrough below, and CanvasHandles.tsx's use of it).
  const [altHeld, setAltHeld] = React.useState(false);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Alt") setAltHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Alt") setAltHeld(false); };
    const onBlur = () => setAltHeld(false); // Alt-tab away mid-hold shouldn't leave it stuck on
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const [transparentExport, setTransparentExport] = React.useState(false);
  // Export file name — seeded once per project load from the project's own
  // name (so it's never blank by default), then left alone: a later project
  // rename shouldn't silently overwrite a name the user already typed here.
  const [exportName, setExportName] = React.useState("");
  const exportNameSeededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (project && exportNameSeededFor.current !== project.projectId) {
      setExportName(project.name || project.projectId);
      exportNameSeededFor.current = project.projectId;
    }
  }, [project?.projectId, project?.name]);
  // Render menu — opened from the header's Render button. Quality only
  // matters for a plain MP4 (an alpha export is always ProRes, no size/
  // quality tradeoff); destDir is an absolute folder from browseFolder(),
  // blank = the app's own out/ folder (served at /out, download link
  // shown). renderPath mirrors renderUrl for the "done" state — the one
  // thing that's always real is the absolute path, whether or not the file
  // is also servable back over /out.
  const [showRenderMenu, setShowRenderMenu] = React.useState(false);
  const [renderQuality, setRenderQuality] = React.useState<RenderQuality>("balanced");
  const [destDir, setDestDir] = React.useState("");
  const [browsingFolder, setBrowsingFolder] = React.useState(false);
  const [renderPath, setRenderPath] = React.useState<string | null>(null);
  // Separate from the general `err` state (shown in the left column, for
  // every other action's failures) — a render/browse-folder error belongs
  // on the render-result banner under the player, not mixed in with an
  // unrelated upload failure that might be showing at the same time.
  const [renderErr, setRenderErr] = React.useState<string | null>(null);
  // Left/right panel widths — draggable via the resizer bars between them and
  // the center preview, remembered across reloads (per-browser, not part of
  // the project). Center always takes whatever's left (min 320px so the
  // player never gets crushed to nothing by two over-widened side panels).
  const [leftW, setLeftW] = React.useState(() => {
    const v = Number(localStorage.getItem("motionist:leftW"));
    return v >= 200 && v <= 640 ? v : 280;
  });
  const [rightW, setRightW] = React.useState(() => {
    const v = Number(localStorage.getItem("motionist:rightW"));
    return v >= 280 && v <= 800 ? v : 440;
  });
  React.useEffect(() => { localStorage.setItem("motionist:leftW", String(leftW)); }, [leftW]);
  React.useEffect(() => { localStorage.setItem("motionist:rightW", String(rightW)); }, [rightW]);
  // Which on-demand dock is open on each side — replaces the old always-
  // visible-with-a-collapse-toggle columns. null = that side's rail icon is
  // un-pressed and no dock shows at all (the rail itself, ~52px, is the only
  // permanent thing now). Clicking the already-active rail icon again closes
  // its dock, same "click again to turn it off" convention as the Text tool.
  const [activeLeftDock, setActiveLeftDock] = React.useState<"assets" | null>(() => {
    // Pages moved to the bottom filmstrip (always there — no rail icon or
    // dock needed for it any more), so Assets is the only left-dock option;
    // defaults closed, same "canvas gets the space until you ask for a
    // panel" default the right dock's Layers option doesn't get (that one
    // still defaults open — see below).
    return localStorage.getItem("motionist:leftDock") === "assets" ? "assets" : null;
  });
  const [activeRightDock, setActiveRightDock] = React.useState<"layers" | null>(() => {
    // Only one right-dock option exists yet (Style/Effects/Position land in
    // a later pass) — "" means explicitly closed, anything else defaults open.
    return localStorage.getItem("motionist:rightDock") === "" ? null : "layers";
  });
  React.useEffect(() => { localStorage.setItem("motionist:leftDock", activeLeftDock ?? ""); }, [activeLeftDock]);
  React.useEffect(() => { localStorage.setItem("motionist:rightDock", activeRightDock ?? ""); }, [activeRightDock]);
  const toggleLeftDock = (which: "assets") =>
    setActiveLeftDock((cur) => (cur === which ? null : which));
  const toggleRightDock = (which: "layers") =>
    setActiveRightDock((cur) => (cur === which ? null : which));
  const startPanelDrag = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftW : rightW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (side === "left") setLeftW(Math.max(200, Math.min(640, startW + dx)));
      else setRightW(Math.max(280, Math.min(800, startW - dx)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [fonts, setFonts] = React.useState<FontEntry[]>([]);
  const refreshFonts = React.useCallback(() => { listFonts().then(setFonts).catch(() => {}); }, []);
  React.useEffect(() => { refreshFonts(); }, [refreshFonts]);
  // Brand kit — colors saved once (Dashboard's "🎨 Colors" manager),
  // reusable across every project, same idea as `fonts` above. Just the
  // hex strings here: ColorField only needs to show/apply them, never
  // add/remove (that's Dashboard-only, mirrors fonts' own split).
  const [brandColors, setBrandColors] = React.useState<string[]>([]);
  React.useEffect(() => {
    listBrandColors().then((list) => setBrandColors(list.map((c) => c.hex))).catch(() => {});
  }, []);
  const [motionPresets, setMotionPresets] = React.useState<MotionPresetEntry[]>([]);
  const refreshMotionPresets = React.useCallback(() => { listMotionPresets().then(setMotionPresets).catch(() => {}); }, []);
  React.useEffect(() => { refreshMotionPresets(); }, [refreshMotionPresets]);
  const onSaveMotionPreset = async (name: string, clip: MotionClip) => {
    try { await saveMotionPreset(name, clip); refreshMotionPresets(); }
    catch (e: any) { setErr(String(e.message || e)); }
  };
  const onDeleteMotionPreset = async (id: string) => {
    await deleteMotionPreset(id);
    refreshMotionPresets();
  };
  const psdInput = React.useRef<HTMLInputElement>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);
  const bgInput = React.useRef<HTMLInputElement>(null);
  const titleInput = React.useRef<HTMLInputElement>(null);
  const audioInput = React.useRef<HTMLInputElement>(null);
  const newPhotoInput = React.useRef<HTMLInputElement>(null);
  const playerRef = React.useRef<PlayerRef>(null);
  const playerWrapRef = React.useRef<HTMLDivElement>(null);
  const centerRef = React.useRef<HTMLDivElement>(null);

  // Filmstrip wheel-scroll — a plain vertical mouse wheel over a horizontally
  // scrolling strip does nothing in most browsers without this; carried over
  // from the old storyboard strip, which had the same real addEventListener
  // (not React's onWheel, which is passive by default and can't
  // preventDefault) for the same reason: without it, the page behind the
  // filmstrip scrolls instead of the filmstrip itself.
  const filmstripScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = filmstripScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll — let the page handle it
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Same frameupdate/play/pause subscription PlayerControls keeps on this
  // same playerRef — a second independent listener, not a shared one, is
  // fine (Player supports multiple) and avoids threading frame/playing
  // through props just for the audio Waveform's playhead below.
  const [playerFrame, setPlayerFrame] = React.useState(0);
  const [playerPlaying, setPlayerPlaying] = React.useState(false);
  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setPlayerFrame(e.detail.frame);
    const onPlay = () => setPlayerPlaying(true);
    const onPause = () => setPlayerPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
    };
    // `!!project` (not just [playerRef], whose identity never changes, and
    // not the whole `project` object, which is a new reference on every
    // single edit) — <Player> itself only mounts once project finishes
    // loading, so on first render (project still null) playerRef.current is
    // null and this would otherwise attach nothing, permanently, the moment
    // project later loads. PlayerControls' own identical subscription never
    // hits this because it isn't mounted at all until
    // `{project && <PlayerControls>}` — this effect lives one level up, in
    // a component that's already mounted before project exists.
  }, [playerRef, !!project]);

  // Canvas zoom — 1 = today's fit-to-panel size, adjustable with Ctrl+wheel
  // over the preview. Session-only (not persisted): opening a project always
  // starts at a predictable fit, not wherever a past session's zoom happened
  // to land.
  //
  // Listener lives on the whole `.center` column (centerRef), not just
  // playerWrapRef — Ctrl+wheel is also the browser's OWN page-zoom shortcut,
  // and a listener scoped to only the canvas box would miss preventDefault()
  // whenever the cursor sat slightly off it (over PlayerControls, the
  // safe-zone toggle row, the whitespace around the player, etc). That gap
  // let the browser's native zoom fire instead, which scales the ENTIRE
  // page — exactly the "everything zooms, not just the video" bug reported.
  // Widening the listener's target (while still only resizing playerWrapRef
  // below) means Ctrl+wheel anywhere over the preview column always resizes
  // just the canvas, and never falls through to native page zoom.
  const [zoom, setZoom] = React.useState(1);
  const ZOOM_MIN = 0.25, ZOOM_MAX = 3;
  React.useEffect(() => {
    const el = centerRef.current;
    if (!el || !project) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // a plain scroll over the preview still just scrolls the page
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [project?.width, project?.height]);

  // Add-element toolbar: Text is a real canvas tool (armed, then a click or
  // drag on the preview places it — see TextPlacementOverlay); Photo/Shape
  // create on click same as before, just from a toolbar icon now instead of
  // a full-width button. `newestLayerIndex` lets the freshly-placed text
  // layer auto-focus its own textarea once — set right after creating it,
  // read once by that one layer's own mount effect.
  const [textTool, setTextTool] = React.useState(false);
  const [newestLayerIndex, setNewestLayerIndex] = React.useState<number | null>(null);

  // Which content layer (its stable l.index, same identity newestLayerIndex
  // above already uses — survives a reorder, unlike the array position) is
  // focused right now. Set by clicking its handle on the canvas; drives the
  // Layers dock auto-opening, its card auto-expanding/scrolling into view
  // (and every other card on the page collapsing), and this same handle's
  // outline staying lit on the canvas — the "floating toolbar" idea's actual
  // job, done by focusing the existing per-layer editor instead of a new
  // overlay that would just duplicate its Content/Effects/Keyframes rail.
  const [selectedLayerIndex, setSelectedLayerIndex] = React.useState<number | null>(null);
  React.useEffect(() => { setSelectedLayerIndex(null); }, [sel]);
  // Multi-select — canvas-only for now (not the Layers dock list). Always a
  // superset containing selectedLayerIndex once anything's selected (a
  // plain click resets it to just that one layer; shift/ctrl/cmd+click
  // toggles membership instead — see the onSelect wiring in canvasHandles
  // below). Kept as a SEPARATE set rather than replacing selectedLayerIndex
  // outright so the existing single-focus behaviors (Layers dock
  // auto-expand/collapse-siblings) stay exactly as they were for the
  // common single-click case.
  const [selectedLayerIndices, setSelectedLayerIndices] = React.useState<Set<number>>(new Set());
  React.useEffect(() => { setSelectedLayerIndices(new Set()); }, [sel]);

  // Undo/redo history. Kept as refs (not state) since they change on nearly
  // every edit and don't need to trigger a re-render themselves — forceTick
  // bumps a counter just so the Undo/Redo buttons' disabled state stays in
  // sync. Snapshots are coalesced: a burst of rapid updates (dragging a
  // handle, typing in a textarea) within 500ms of each other only pushes ONE
  // history entry (from before the burst started), so undo reverts a whole
  // drag/typing sweep at once instead of one pixel/keystroke at a time.
  const historyRef = React.useRef<Project[]>([]);
  const futureRef = React.useRef<Project[]>([]);
  const lastPushRef = React.useRef(0);
  const [, forceTick] = React.useReducer((c: number) => c + 1, 0);
  const HISTORY_LIMIT = 50;
  const COALESCE_MS = 500;

  // Click a page -> show its inspector AND jump the player to that page's start.
  const selectPage = (i: number) => {
    setSel(i);
    if (project) {
      const starts = pageStarts(project);
      playerRef.current?.pause();
      playerRef.current?.seekTo(starts[i] ?? 0);
    }
  };

  React.useEffect(() => {
    setProject(null);
    setSel(0);
    setRenderUrl(null);
    // A fresh project (or reload of the same one) starts a clean slate —
    // undoing across a project switch into a DIFFERENT project's old state
    // would be a real correctness bug, not just a UX quirk.
    historyRef.current = [];
    futureRef.current = [];
    loadProject(projectId).then(setProject).catch(() => {});
  }, [projectId]);

  // Autosave — every edit (via `update()`, below) lands in `project` state,
  // and this debounces that into a real save so work is never lost to a
  // forgotten "Save" click. Debounced (900ms of no further edits) rather
  // than firing per-keystroke, so typing a caption doesn't hammer the
  // server with a request per character. The explicit "Save" button still
  // exists for "save right now, no wait" (e.g. right before closing the
  // tab) — this doesn't replace it, just means it's no longer required.
  const [autosaveState, setAutosaveState] = React.useState<"saved" | "saving" | "unsaved">("saved");
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosaveRef = React.useRef(true); // the load above isn't an edit
  React.useEffect(() => {
    skipNextAutosaveRef.current = true;
  }, [projectId]);
  React.useEffect(() => {
    if (!project) return;
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }
    setAutosaveState("unsaved");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      setAutosaveState("saving");
      saveProject(project)
        .then(() => setAutosaveState("saved"))
        .catch(() => setAutosaveState("unsaved")); // stays "unsaved" — next edit or the manual Save button will retry
    }, 900);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [project]);

  // Ref mutations happen HERE, in plain synchronous handler code — never
  // inside a setState updater function. React.StrictMode double-invokes
  // updater functions in dev to catch impure ones; a ref push/pop living
  // inside one runs twice per call and silently corrupts the stack. (This
  // bit me during testing — undo worked once, redo then landed on garbage.)
  const undo = () => {
    if (!project || historyRef.current.length === 0) return;
    const prior = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, project];
    lastPushRef.current = 0;
    setProject(prior);
    forceTick();
  };

  const redo = () => {
    if (!project || futureRef.current.length === 0) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, project];
    lastPushRef.current = 0;
    setProject(next);
    forceTick();
  };

  // Spacebar play/pause, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo —
  // all guarded the same way: skip while a text field/select has focus, so
  // this never hijacks normal typing (a textarea's OWN native undo should
  // win while you're actively editing text in it) or steals space from a
  // focused dropdown.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        playerRef.current?.toggle();
        return;
      }
      // "?" opens the shortcuts cheatsheet (same key GitHub/Figma/Notion
      // use) — real key check, not e.code, so it works regardless of
      // keyboard layout (Shift+/ produces "?" as the actual character on
      // a US layout, but e.key already reflects whatever the layout
      // actually produced).
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      // Multi-select (canvas-only — see canvasHandles' onSelect wiring).
      // Escape clears it — or closes the cheatsheet first, if that's what's
      // open; Delete/Backspace removes every selected layer. Guarded by the
      // same `typing` check above, so Backspace still edits text normally
      // in a focused field instead of deleting layers.
      if (e.key === "Escape" && showShortcuts) {
        e.preventDefault();
        setShowShortcuts(false);
        return;
      }
      if (e.key === "Escape" && selectedLayerIndices.size > 0) {
        e.preventDefault();
        setSelectedLayerIndices(new Set());
        setSelectedLayerIndex(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLayerIndices.size > 0) {
        e.preventDefault();
        deleteSelectedLayers();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Re-attached whenever `project`/`sel`/the selection/the cheatsheet's
    // own open state changes so every branch here always acts on current
    // state, not whatever was current when the listener was first attached
    // (playerRef itself is a stable ref, so the spacebar branch doesn't
    // actually need this — but undo/redo and the other branches do).
  }, [project, sel, selectedLayerIndices, showShortcuts]);

  const update = (fn: (p: Project) => void) => {
    if (project) {
      const now = Date.now();
      if (now - lastPushRef.current > COALESCE_MS) {
        historyRef.current = [...historyRef.current, project].slice(-HISTORY_LIMIT);
        futureRef.current = [];
        forceTick();
      }
      lastPushRef.current = now;
    }
    setProject((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      fn(next);
      return next;
    });
  };

  // The saved color palette lives on the project (Project.swatches), shared
  // by every color picker in the app — one list, not one per field.
  const addSwatch = (hex: string) => update((p) => {
    if (!(p.swatches ?? []).some((s) => s.toLowerCase() === hex.toLowerCase())) {
      p.swatches = [...(p.swatches ?? []), hex];
    }
  });
  const removeSwatch = (hex: string) => update((p) => {
    p.swatches = (p.swatches ?? []).filter((s) => s.toLowerCase() !== hex.toLowerCase());
  });

  // Ruler guides (Project.guides) — same shared-across-pages, whole-project
  // list pattern as swatches above. New ones drop at canvas center, already
  // draggable into place via GuidesOverlay.tsx; moveGuide fires on every
  // pointermove of that drag (same "let update() coalesce it" trick every
  // other drag in this app already relies on for one-undo-per-drag, not
  // one-undo-per-pixel).
  const addGuide = (axis: "x" | "y") => update((p) => {
    const id = "g" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
    const pos = Math.round((axis === "x" ? p.width : p.height) / 2);
    p.guides = [...(p.guides ?? []), { id, axis, pos }];
  });
  const moveGuide = (id: string, pos: number) => update((p) => {
    const g = (p.guides ?? []).find((g) => g.id === id);
    if (g) g.pos = pos;
  });
  const deleteGuide = (id: string) => update((p) => {
    p.guides = (p.guides ?? []).filter((g) => g.id !== id);
  });
  const clearGuides = () => update((p) => { p.guides = []; });

  // Accepts one or many files (batch upload). Server ingests one PSD/SVG at a
  // time, so files are processed sequentially, in filename order, and each
  // page is appended as its own ingest completes — errors on one file don't
  // stop the rest.
  const onAddPages = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    if (!files.length) return;
    setErr(null);
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const isImage = IMAGE_PAGE_EXTS.includes(ext);
      setBusy(files.length > 1
        ? `${isImage ? "Uploading" : "Extracting"} ${i + 1}/${files.length}: ${file.name}…`
        : `${isImage ? "Uploading" : "Extracting"} ${file.name}…`);
      try {
        if (isImage) {
          const raw = await uploadAsset(file, `page_${Date.now()}`, projectId);
          // IMAGE_PAGE_EXTS (checked above) never lets an audio file reach
          // here — narrows for TS since uploadAsset()'s return type is
          // shared with the (audio-capable) Audio upload path.
          const upload = { ...raw, kind: raw.kind === "audio" ? ("image" as const) : raw.kind };
          setProject((prev) => {
            if (!prev) return prev;
            const next = clone(prev);
            next.pages.push(pageFromImage(next, file.name, upload));
            return next;
          });
        } else {
          const res = await ingestPsd(file, projectId);
          setProject((prev) => (prev ? mergeIngestedPage(prev, res, res.sourceName) : prev));
        }
      } catch (e: any) {
        failures.push(`${file.name}: ${String(e.message || e)}`);
      }
    }

    setBusy(null);
    if (failures.length) setErr(`${failures.length} file(s) failed:\n` + failures.join("\n"));
  };

  const onSlotUpload = async (slotKey: "logo" | "bg" | "title", file: File) => {
    setBusy(`Uploading ${slotKey}…`); setErr(null);
    const oldFile = project?.[slotKey]?.file ?? null;
    try {
      const { file: f, kind: rawKind, width, height } = slotKey === "logo"
        ? await uploadLogo(file, projectId)
        : await uploadAsset(file, slotKey, projectId);
      // BG/Title/Logo pickers never accept audio extensions — this slot can
      // only ever get image/video/gif/lottie back; narrows for TS since
      // uploadAsset()'s return type is shared with the (audio-capable) Audio
      // upload path.
      const kind = rawKind === "audio" ? "image" : rawKind;
      update((p) => {
        // Size to the asset's real exported dimensions every time — on first
        // upload AND on replace, since a differently-shaped replacement
        // shouldn't be force-fit into the old box.
        p[slotKey] = defaultSlot(slotKey, p.width, p.height, f, kind, width, height);
      });
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Clears a global slot (BG/Title/Logo) entirely — back to "Upload …" with
  // nothing in it, cleaning up its uploaded file the same way a replace does.
  const onRemoveSlot = (slotKey: "logo" | "bg" | "title") => {
    if (!project) return;
    const oldFile = project[slotKey]?.file ?? null;
    update((p) => { p[slotKey] = null; });
    if (oldFile) deleteProjectFiles(projectId, [oldFile]);
  };

  // Global background-music track — separate from the LogoConfig slots
  // above since AudioTrack isn't a LogoConfig (it has volume/trim/fade,
  // no box/fit). Reuses the same generic /api/asset upload + normalization
  // (server transcodes any source format to AAC/M4A — see saveMedia).
  const onUploadAudio = async (file: File) => {
    if (!project) return;
    setBusy("Uploading audio…"); setErr(null);
    const oldFile = project.audio?.file ?? null;
    try {
      const { file: f, duration } = await uploadAsset(file, "audio", projectId);
      update((p) => {
        p.audio = {
          file: f,
          duration,
          volume: p.audio?.volume ?? 1,
          startOffset: 0,
          fadeInSec: p.audio?.fadeInSec ?? 0,
          fadeOutSec: p.audio?.fadeOutSec ?? 0,
          muted: false,
        };
      });
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  const onRemoveAudio = () => {
    if (!project) return;
    const oldFile = project.audio?.file ?? null;
    update((p) => { p.audio = null; });
    if (oldFile) deleteProjectFiles(projectId, [oldFile]);
  };

  // Upload a real photo/video into a placeholder box on the CURRENT page.
  // Replaces the file + kind; the box (left/top/width/height) is left as-is
  // — cover-fit auto-crops it in, and the user can drag/resize on the canvas
  // to refine the crop if the photo's shape doesn't quite match the box.
  const onUploadPhoto = async (pageIndex: number, layerIndex: number, file: File) => {
    if (!project) return;
    const pageId = project.pages[pageIndex].id;
    const oldFile = project.pages[pageIndex].layers[layerIndex]?.file || null;
    setBusy("Uploading photo…"); setErr(null);
    try {
      const { file: f, kind: rawKind, width, height } = await uploadAsset(file, `photo_${pageId}_${layerIndex}`, projectId);
      // The photo picker's accept list excludes audio extensions — narrows
      // for TS (see the matching comment in onSlotUpload above).
      const kind = rawKind === "audio" ? "image" : rawKind;
      update((p) => {
        const layer = p.pages[pageIndex].layers[layerIndex];
        layer.file = f;
        layer.assetKind = kind;
        layer.fit = "cover";
        layer.naturalWidth = width;
        layer.naturalHeight = height;
        // Reset crop to centered default — an old pan/zoom offset was tuned
        // for the previous image's shape and won't mean the same thing here.
        layer.photoPanX = 50;
        layer.photoPanY = 50;
        layer.photoZoom = 1;
      });
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Same upload flow as onUploadPhoto, but for a SHAPE layer's optional
  // photo mask — writes shapePhotoFile/shapePhotoKind instead of file/
  // assetKind, so the layer stays a real "shape" (keeps its own Effects/
  // Keyframes vocabulary) while the shape's own geometry clips the photo.
  const onUploadShapePhoto = async (pageIndex: number, layerIndex: number, file: File) => {
    if (!project) return;
    const pageId = project.pages[pageIndex].id;
    const oldFile = project.pages[pageIndex].layers[layerIndex]?.shapePhotoFile || null;
    setBusy("Uploading photo…"); setErr(null);
    try {
      const { file: f, kind, width, height } = await uploadAsset(file, `shapephoto_${pageId}_${layerIndex}`, projectId);
      update((p) => {
        const layer = p.pages[pageIndex].layers[layerIndex];
        layer.shapePhotoFile = f;
        // "lottie" can't be object-fit cropped like an image/video/gif can —
        // the upload picker's own accept list already excludes .json, this
        // is just a defensive fallback so an unexpected kind renders as a
        // photo rather than something broken.
        layer.shapePhotoKind = kind === "video" || kind === "gif" ? kind : "image";
        layer.fit = "cover";
        layer.naturalWidth = width;
        layer.naturalHeight = height;
        layer.photoPanX = 50;
        layer.photoPanY = 50;
        layer.photoZoom = 1;
      });
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Removing the mask is a pure data edit (no server call beyond freeing the
  // file) — falls straight back to the shape's own flat shapeFill color.
  const onRemoveShapePhoto = (pageIndex: number, layerIndex: number) => {
    if (!project) return;
    const oldFile = project.pages[pageIndex].layers[layerIndex]?.shapePhotoFile || null;
    update((p) => {
      const layer = p.pages[pageIndex].layers[layerIndex];
      layer.shapePhotoFile = undefined;
      layer.shapePhotoKind = undefined;
    });
    if (oldFile) deleteProjectFiles(projectId, [oldFile]);
  };

  // Text layers are created directly in the app (not extracted from a PSD/SVG)
  // — a live Farsi (or any) text box with a sensible default box + fade-in.
  // `box` overrides the default position/size — the text tool passes one in
  // (drawn from a click or drag on the canvas); callers with no placement of
  // their own get the old canvas-centered default. Returns the new layer's
  // `index` so a caller (the text tool) can auto-focus it once it mounts.
  const onAddTextLayer = (pageIndex: number, box?: { left: number; top: number; width: number; height: number }) => {
    if (!project) return null;
    const newIndex = -Date.now();
    update((p) => {
      const page = p.pages[pageIndex];
      const w = box?.width ?? Math.round(p.width * 0.8);
      const h = box?.height ?? Math.round(p.height * 0.14);
      // push (not unshift) — layers later in the array paint on top in
      // PageScene, so a freshly added text layer defaults to sitting ON TOP
      // of whatever's already on the page (e.g. a photo), not hidden behind it.
      page.layers.push({
        index: newIndex,
        file: "", role: "text",
        left: box?.left ?? Math.round((p.width - w) / 2), top: box?.top ?? Math.round(p.height * 0.4),
        width: w, height: h, opacity: 1,
        entrance: "none", delay: 0, inDuration: 26,
        assetKind: "text", text: "", fontSize: 48, textColor: "#1a1a1a", textAlign: "right",
      } as any);
    });
    return newIndex;
  };

  // Text tool: called once the placement overlay reports a click or drag —
  // creates the layer at that exact spot, disarms the tool, and marks it as
  // the one to auto-focus once it mounts.
  const onPlaceText = (pageIndex: number, box: { left: number; top: number; width: number; height: number }) => {
    const idx = onAddTextLayer(pageIndex, box);
    setTextTool(false);
    setNewestLayerIndex(idx);
  };

  // A page with no photo/PSD at all — just a solid color (defaults to the
  // project's own backdrop color so it's visible immediately) to drop text
  // onto. Covers the "I just want text on a color" case that otherwise
  // requires a photo to create a page in the first place.
  const onAddBlankPage = () => {
    if (!project) return;
    update((p) => {
      const id = "p" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
      p.pages.push({
        id,
        name: "Text page",
        durationInFrames: 150,
        ambient: "none",
        // durationInFrames must be >=1 — 0 crashes @remotion/transitions the
        // moment a second page exists (its interpolate() needs a strictly
        // increasing range; 0 collapses to [x,x]).
        transition: { type: "none" as any, durationInFrames: 1 },
        layers: [],
        // No bgColor here on purpose — undefined means "follow the
        // project's", same promise the picker's own label makes. Setting an
        // explicit color at creation (the old behavior) permanently shadowed
        // the project-level "Backdrop color" picker for this page, since the
        // page's own fill is opaque and sits on top — so changing the
        // project color visibly did nothing, which is exactly the bug
        // report this fixes.
      });
    });
  };

  // Saves the CURRENT (already-persisted) state of one page as a reusable
  // template — the server physically copies its referenced asset files into
  // a shared store, so this only works on a page whose layers already point
  // at real uploaded files (true for any page the user is looking at; a
  // brand-new page with nothing uploaded yet just saves an assetless shell,
  // which is a fine, if sparse, template too).
  const commitSaveTemplate = async () => {
    if (!project || savingTemplateFor == null) return;
    const name = templateName.trim();
    if (!name) return;
    setTemplateBusy(true); setTemplateErr(null);
    try {
      await savePageTemplate(name, projectId, project.pages[savingTemplateFor]);
      setSavingTemplateFor(null);
      setTemplateName("");
      setPageTemplates(null); // stale — refetch next time the picker opens
    } catch (e: any) {
      setTemplateErr(String(e.message || e));
    } finally {
      setTemplateBusy(false);
    }
  };

  // Inserts a saved template as a brand-new page — fresh page id AND fresh
  // per-layer indices (indices are just React keys/z-order within a page,
  // reusing the template's own would collide if the SAME template gets
  // inserted twice into one project). Its asset files stay pointed at the
  // shared page-templates/ store — that's permanent, not tied to whichever
  // project first saved it, so no per-project asset copy is needed here.
  const onInsertTemplate = async (id: string) => {
    if (!project) return;
    setTemplateBusy(true); setTemplateErr(null);
    try {
      const entry = await loadPageTemplate(id);
      update((p) => {
        const pageId = "p" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
        const page = structuredClone(entry.page);
        page.id = pageId;
        page.layers = page.layers.map((l: any, i: number) => ({ ...l, index: i }));
        p.pages.push(page);
      });
      setShowTemplatePicker(false);
      setSel(project.pages.length); // the just-inserted page is now the last one
    } catch (e: any) {
      setTemplateErr(String(e.message || e));
    } finally {
      setTemplateBusy(false);
    }
  };

  const onDeleteTemplate = async (id: string) => {
    await deletePageTemplate(id);
    setPageTemplates((list) => (list ?? []).filter((t) => t.id !== id));
  };

  // Photo tool: browse -> upload -> the layer is created ALREADY filled in,
  // one action instead of "add an empty slot, then click again inside it to
  // upload." Placed at the BACK of the stack (unlike text, which defaults to
  // front): a photo is usually meant as the backdrop for whatever's already
  // on the page, not covering it. Nothing is added to the page at all until
  // the upload actually succeeds — backing out of the file dialog used to
  // leave an empty, easy-to-forget-about photo slot behind; now it just does
  // nothing, same as cancelling any other file picker in the app.
  const onAddPhotoLayerFromFile = async (pageIndex: number, file: File) => {
    if (!project) return;
    const pageId = project.pages[pageIndex].id;
    setBusy("Uploading photo…"); setErr(null);
    try {
      const { file: f, kind: rawKind, width, height } = await uploadAsset(file, `photo_${pageId}_${Date.now()}`, projectId);
      // Same narrowing as onUploadPhoto above — this picker never accepts audio.
      const kind = rawKind === "audio" ? "image" : rawKind;
      update((p) => {
        const page = p.pages[pageIndex];
        page.layers.unshift({
          index: -Date.now(),
          file: f, role: "photo",
          left: 0, top: 0, width: p.width, height: p.height,
          opacity: 1, entrance: "none", delay: 0, fit: "cover",
          assetKind: kind, naturalWidth: width, naturalHeight: height,
          photoPanX: 50, photoPanY: 50, photoZoom: 1,
        } as any);
      });
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // A plain color box — no upload needed, unlike photo. Defaults to a
  // translucent dark bar sized/placed like a text layer's own default box
  // (the most common use: a scrim behind text) and sent to the BACK like
  // photo, since "background panel" is the primary use — sitting in front
  // of everything is one click away (bring-forward) if it's a divider
  // that should show on top instead.
  const onAddShapeLayer = (pageIndex: number) => {
    if (!project) return;
    update((p) => {
      const page = p.pages[pageIndex];
      const w = Math.round(p.width * 0.8);
      const h = Math.round(p.height * 0.14);
      page.layers.unshift({
        index: -Date.now(),
        file: "", role: "shape",
        left: Math.round((p.width - w) / 2), top: Math.round(p.height * 0.4),
        width: w, height: h,
        // Fully opaque by default — the fill color you pick should be
        // exactly what renders. Opacity is its own visible field in the
        // Shape box now (below) for anyone who actually wants a translucent
        // scrim; it was silently 0.55 before with no field showing it,
        // which is why a chosen color looked wrong on canvas.
        opacity: 1,
        entrance: "none", delay: 0,
        assetKind: "shape", shapeType: "rect", shapeFill: "#000000", shapeCornerRadius: 0,
      } as any);
    });
  };

  const onDeleteLayer = (pageIndex: number, layerIndex: number) => {
    if (!project) return;
    const file = project.pages[pageIndex]?.layers[layerIndex]?.file;
    update((p) => { p.pages[pageIndex].layers.splice(layerIndex, 1); });
    if (file) deleteProjectFiles(projectId, [file]);
  };

  // Delete every layer in the current multi-selection (Delete/Backspace —
  // see the keydown effect below). Filters by the layer's own stable
  // `.index`, not array position, same identity selectedLayerIndices
  // already keys on everywhere else.
  const deleteSelectedLayers = () => {
    if (!project || selectedLayerIndices.size === 0) return;
    const page = project.pages[sel];
    if (!page) return;
    const files = page.layers.filter((l) => selectedLayerIndices.has(l.index)).map((l) => l.file).filter(Boolean);
    update((p) => {
      p.pages[sel].layers = p.pages[sel].layers.filter((l) => !selectedLayerIndices.has(l.index));
    });
    if (files.length) deleteProjectFiles(projectId, files);
    setSelectedLayerIndices(new Set());
    setSelectedLayerIndex(null);
  };

  // Align every selected layer against the SELECTION's own bounding box
  // (not the canvas — that's what Box align in the Content tab already
  // does, per-layer, one at a time). Same "left"/"center"/"right" and
  // "top"/"middle"/"bottom" naming as AlignBoxIcon/AlignBoxIconV below, so
  // the multi-select toolbar can reuse those same icons directly.
  const alignSelection = (kind: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    if (!project || selectedLayerIndices.size < 2) return;
    const page = project.pages[sel];
    if (!page) return;
    const members = page.layers.filter((l) => selectedLayerIndices.has(l.index));
    if (members.length < 2) return;
    const bbox = {
      left: Math.min(...members.map((l) => l.left)),
      top: Math.min(...members.map((l) => l.top)),
      right: Math.max(...members.map((l) => l.left + l.width)),
      bottom: Math.max(...members.map((l) => l.top + l.height)),
    };
    update((p) => {
      p.pages[sel].layers.forEach((l) => {
        if (!selectedLayerIndices.has(l.index)) return;
        if (kind === "left") l.left = bbox.left;
        else if (kind === "center") l.left = Math.round(bbox.left + (bbox.right - bbox.left - l.width) / 2);
        else if (kind === "right") l.left = bbox.right - l.width;
        else if (kind === "top") l.top = bbox.top;
        else if (kind === "middle") l.top = Math.round(bbox.top + (bbox.bottom - bbox.top - l.height) / 2);
        else if (kind === "bottom") l.top = bbox.bottom - l.height;
      });
    });
  };

  // Assigns an already-uploaded library font (or clears back to the system
  // default when entry is null) to one text layer.
  const onSelectFont = (pageIndex: number, layerIndex: number, entry: FontEntry | null) => {
    update((p) => {
      const layer = p.pages[pageIndex].layers[layerIndex];
      layer.fontFamily = entry?.cssFamily;
      layer.fontFile = entry?.file;
    });
  };

  const onSave = async () => {
    if (!project) return;
    setBusy("Saving…"); setErr(null);
    try { await saveProject(project); } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Holds the in-flight render's job id so the Stop button (rendered from a
  // totally separate click handler) knows what to cancel — state instead of
  // a plain local var since onStopRender needs it outside onRender's own
  // closure/lifetime.
  const renderJobIdRef = React.useRef<string | null>(null);

  const onRender = async () => {
    if (!project) return;
    setRenderErr(null); setRenderUrl(null); setRenderPath(null); setRenderProgress({ percent: 0 });
    setShowRenderMenu(false);
    try {
      await saveProject(project); // keep the saved copy in sync with what's rendered
      const jobId = await startRenderJob(project, {
        transparent: transparentExport, exportName, quality: renderQuality,
        destDir: destDir.trim() || undefined,
      });
      renderJobIdRef.current = jobId;
      // Poll until the job reports done/error/cancelled — /api/render/start
      // returns immediately instead of blocking for the whole render,
      // specifically so this loop can show a real percentage instead of a
      // static "Rendering… (this can take a while)".
      for (;;) {
        await new Promise((r) => setTimeout(r, 600));
        const status = await getRenderJobStatus(jobId);
        if (status.status === "error") throw new Error(status.error || "render failed");
        if (status.status === "cancelled") break; // stopped on purpose — not an error, nothing to show
        if (status.status === "done") {
          setRenderUrl(status.url ?? null);
          setRenderPath(status.path ?? null);
          // Same Resolve Media Pool hand-off renderReel() used to do —
          // fire-and-forget, a failure here shouldn't fail a render that
          // already succeeded.
          if (window.motionistResolveBridge && status.path) {
            window.motionistResolveBridge.onRendered(status.path)
              .then((res) => { if (!res?.ok) console.warn("Motionist → Resolve: not added to Media Pool —", res?.error); })
              .catch((e) => console.warn("Motionist → Resolve bridge failed:", e));
          }
          break;
        }
        setRenderProgress({ percent: status.percent, phase: status.phase, frame: status.frame, totalFrames: status.totalFrames, status: status.status });
      }
    } catch (e: any) { setRenderErr(String(e.message || e)); }
    finally { setRenderProgress(null); renderJobIdRef.current = null; }
  };

  const onStopRender = () => {
    if (!renderJobIdRef.current) return;
    cancelRenderJob(renderJobIdRef.current).catch((e) => setRenderErr(String(e.message || e)));
  };

  // Opens a real Windows folder dialog (server-side — see /api/browse-folder)
  // and blocks until the user picks a folder or cancels; browsingFolder just
  // disables the button meanwhile so a second click can't stack a second
  // dialog on top of the first.
  const onBrowseFolder = async () => {
    setBrowsingFolder(true); setRenderErr(null);
    try {
      const picked = await browseFolder();
      if (picked) setDestDir(picked);
    } catch (e: any) { setRenderErr(String(e.message || e)); }
    finally { setBrowsingFolder(false); }
  };

  // Move-to-any-position — the filmstrip's drag-to-reorder.
  const reorderPages = (from: number, to: number) => {
    if (from === to) return;
    update((p) => {
      const [moved] = p.pages.splice(from, 1);
      p.pages.splice(to, 0, moved);
    });
    // Keep tracking the SAME page across the move, not just the same index —
    // standard array-move index math (only shifts what sits between the two
    // positions, everything else stays put).
    setSel((s) => {
      if (s === from) return to;
      if (from < s && s <= to) return s - 1;
      if (to <= s && s < from) return s + 1;
      return s;
    });
  };

  const delPage = (i: number) => {
    const page = project?.pages[i];
    update((p) => { p.pages.splice(i, 1); });
    setSel((s) => Math.max(0, s - (i <= s ? 1 : 0)));
    if (page) {
      // Every layer's own uploaded file (photo/blank pages), PLUS the whole
      // extracted folder for a PSD/SVG-sourced page (manifest.json + its raw
      // layer exports) — passing both is harmless, whichever doesn't apply
      // to this page just no-ops server-side.
      const files = page.layers.map((l) => l.file).filter(Boolean);
      deleteProjectFiles(projectId, [...files, `projects/${projectId}/${page.id}`]);
    }
  };

  // Duplicate ONE page — same layers/motion, dropped right after the
  // original and selected. The server round-trip (duplicatePage) is the
  // part that has to happen first: it physically copies this page's own
  // asset folder to a new one and hands back a page already pointed at
  // that copy, so the two pages never end up sharing files — matters for
  // real, since delPage above deletes a page's whole folder outright.
  const dupPage = async (i: number) => {
    const page = project?.pages[i];
    if (!page || !project) return;
    setBusy("Duplicating page…");
    setErr(null);
    try {
      const copy = await duplicatePage(project.projectId, page.id);
      update((p) => { p.pages.splice(i + 1, 0, copy); });
      setSel(i + 1);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(null);
    }
  };

  // Draggable/resizable canvas handles: global bg/logo/title + every
  // text/shape/photo layer on the CURRENT page. Rebuilt whenever the
  // project, selected page, or altHeld changes. A photo layer's move/resize
  // handle sits on top of its own pan-crop zone (PhotoPanHandles) at rest;
  // holding Alt flips panPassthrough on so the drag goes to panning instead
  // — see the isPhoto branch below. BG goes first so its handle renders
  // underneath logo/title's — it's usually the biggest box on screen, and
  // shouldn't steal clicks meant for the smaller ones sitting on top of it.
  const canvasHandles: Handle[] = React.useMemo(() => {
    if (!project) return [];
    const list: Handle[] = [];
    if (project.bg) list.push({
      id: "bg", label: "BG", color: "#7ed6a5", box: project.bg.box,
      onChange: (b) => update((p) => { if (p.bg) p.bg.box = b; }),
    });
    if (project.logo) list.push({
      id: "logo", label: "LOGO", color: "#5aa9ff", box: project.logo.box,
      onChange: (b) => update((p) => { if (p.logo) p.logo.box = b; }),
    });
    if (project.title) list.push({
      id: "title", label: "TITLE", color: "#f2b84b", box: project.title.box,
      onChange: (b) => update((p) => { if (p.title) p.title.box = b; }),
    });
    if (project.loaderVisible ?? true) list.push({
      id: "loader", label: "LOADER", color: "#c9a53b", box: project.loader,
      onChange: (b) => update((p) => { p.loader = b; }),
    });
    // Text, shape, and photo layers are all freely draggable/resizable — a
    // photo's box used to be treated as fixed (only pan/zoom the content
    // within it, never move the frame itself), on the theory that a
    // PSD-extracted slot's position was part of the template design. Users
    // want to freely reposition/resize photos too, same as text/shapes, so
    // that restriction is gone — nothing stops leaving a PSD-derived one
    // exactly where it started if that's what's wanted.
    const page = project.pages[sel];
    page?.layers.forEach((l, li) => {
      const isPhoto = l.role === "photo";
      if (l.assetKind !== "text" && l.assetKind !== "shape" && !isPhoto) return;
      // A shape carrying a photo mask is pannable exactly like a real photo
      // layer (see photoPanTargets below) — its move/resize handle needs to
      // yield to PhotoPanHandles on Alt-hold too. Checking only `isPhoto`
      // here missed this case entirely: a shape's own move/resize handle
      // always sits on top of its photo-mask's pan zone with pointer-events
      // stuck on "auto" regardless of Alt, since `isPhoto` is never true for
      // an `assetKind: "shape"` layer — Alt+drag silently did nothing on any
      // shape with an uploaded photo/video.
      const isPannable = isPhoto || (l.assetKind === "shape" && !!l.shapePhotoFile);
      list.push({
        id: `${isPhoto ? "photo" : l.assetKind}-${li}`,
        label: isPhoto ? "PHOTO" : l.assetKind === "text" ? (l.text ? l.text.slice(0, 18) : "TEXT") : "SHAPE",
        color: isPhoto ? "#4fd1c5" : l.assetKind === "text" ? "#c46be0" : "#3ea6ff",
        box: { left: l.left, top: l.top, width: l.width, height: l.height },
        // A pannable layer's move/resize handle otherwise permanently
        // shadows its own pan-crop zone underneath (same box, this handle
        // wins the click) — hand the drag back to PhotoPanHandles while Alt
        // is held instead of fighting over one gesture.
        panPassthrough: isPannable && altHeld,
        pannable: isPannable,
        // A text layer's box is always kept exactly the size of its own
        // rendered text (see the measure-and-resize effect in
        // ElementMotion) — the resize grip would just offer a drag that
        // gets silently overwritten the moment anything about the text
        // changes, so it's hidden instead of dangling there unresizable.
        resizable: l.assetKind !== "text",
        selected: selectedLayerIndex === l.index || selectedLayerIndices.has(l.index),
        onSelect: (mods) => {
          const toggle = mods.shiftKey || mods.ctrlKey || mods.metaKey;
          setSelectedLayerIndices((prev) => {
            if (!toggle) return new Set([l.index]);
            const next = new Set(prev);
            // A bare toggle-click with nothing selected yet still needs to
            // START from the layer that was already the single-focus
            // selection (if any) — otherwise shift-clicking a second layer
            // right after a plain click on the first would "add" to an
            // empty set and end up selecting only the second one.
            if (next.size === 0 && selectedLayerIndex != null) next.add(selectedLayerIndex);
            if (next.has(l.index)) next.delete(l.index); else next.add(l.index);
            return next;
          });
          setSelectedLayerIndex(l.index);
          setActiveRightDock("layers");
        },
        onChange: (b) => update((p) => {
          const layer = p.pages[sel].layers[li];
          const dx = b.left - layer.left;
          const dy = b.top - layer.top;
          const isPureMove = b.width === layer.width && b.height === layer.height;
          layer.left = b.left; layer.top = b.top; layer.width = b.width; layer.height = b.height;
          // Two independent reasons a sibling should move along: a saved
          // color group (ContentLayer.groupId), or both layers being part
          // of the CURRENT multi-selection (selectedLayerIndices) — a
          // temporary, session-only selection, not saved data. Either one
          // is enough; a layer can be in a saved group AND get dragged as
          // part of an unrelated multi-select at the same time. Position
          // only, not size, same as the group-only behavior before this.
          // Covers both pointer drag and the arrow-key nudge, which both
          // call this same onChange.
          if (isPureMove && (dx !== 0 || dy !== 0)) {
            const inSelection = selectedLayerIndices.size > 1 && selectedLayerIndices.has(layer.index);
            p.pages[sel].layers.forEach((sib, si) => {
              if (si === li) return;
              const groupMatch = !!layer.groupId && sib.groupId === layer.groupId;
              const selectionMatch = inSelection && selectedLayerIndices.has(sib.index);
              if (groupMatch || selectionMatch) { sib.left += dx; sib.top += dy; }
            });
          }
        }),
      });
    });
    return list;
  }, [project, sel, altHeld, selectedLayerIndex, selectedLayerIndices]);

  // Photo pan targets: every photo-role layer on the current page that has a
  // real uploaded asset (with known natural size, needed to compute correct
  // drag-to-percent pan math). Placeholder art (not yet replaced) has nothing
  // to pan, so it's excluded.
  const photoPanTargets: PhotoPanTarget[] = React.useMemo(() => {
    if (!project) return [];
    const page = project.pages[sel];
    if (!page) return [];
    const list: PhotoPanTarget[] = [];
    page.layers.forEach((l, li) => {
      const isPlainPhoto = l.role === "photo" && !!l.assetKind;
      const isShapeWithPhoto = l.assetKind === "shape" && !!l.shapePhotoFile;
      if (!(isPlainPhoto || isShapeWithPhoto) || !l.naturalWidth || !l.naturalHeight) return;
      list.push({
        id: `photo-${li}`,
        box: { left: l.left, top: l.top, width: l.width, height: l.height },
        natural: { width: l.naturalWidth, height: l.naturalHeight },
        panX: l.photoPanX ?? 50,
        panY: l.photoPanY ?? 50,
        zoom: l.photoZoom ?? 1,
        onChange: (panX, panY) => update((p) => {
          const layer = p.pages[sel].layers[li];
          layer.photoPanX = panX; layer.photoPanY = panY;
        }),
      });
    });
    return list;
  }, [project, sel]);

  return (
    <div className="app">
      {/* Datum header — a single full-width bar instead of the old stacked
          "back button + autosave/undo row" / "big project-name input" pair.
          The brand mark doubles as the back-to-Dashboard control (click the
          logo, same convention as Figma/Notion) rather than a separate text
          button, so Render/undo/redo/project-name/autosave all fit one row. */}
      <header className="topbar">
        <button className="topbar-brand"
          onClick={() => {
            // Fire-and-forget — the Dashboard card just keeps showing
            // whatever it showed before until this lands; nothing here
            // should hold up navigating back.
            if (project) generateThumbnail(project.projectId).catch(() => {});
            onBack();
          }}
          title="Back to Dashboard">
          <img src="/brand/motionist-icon.svg" alt="" className="topbar-icon" />
          <b>Motionist</b>
        </button>
        <div className="topbar-divider" />
        <div className="topbar-proj">
          <input
            className="topbar-proj-name"
            value={project?.name ?? ""}
            placeholder="Loading…"
            disabled={!project}
            onChange={(e) => update((p) => { p.name = e.target.value; })}
          />
          {project && (
            <span className="autosave-status" title="Every change saves on its own a moment after you stop editing">
              {autosaveState === "saved" && <><span className="dot good" />Saved</>}
              {autosaveState === "saving" && <><span className="dot" />Saving…</>}
              {autosaveState === "unsaved" && <><span className="dot warn" />Unsaved</>}
            </span>
          )}
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-acts">
          <button className="btn small" onClick={onSave} disabled={!project} title="Save now (autosave already covers this a moment after you stop editing)">Save</button>
          <button className="btn small" title="Undo (Ctrl+Z)" disabled={historyRef.current.length === 0} onClick={undo}>↶</button>
          <button className="btn small" title="Redo (Ctrl+Shift+Z)" disabled={futureRef.current.length === 0} onClick={redo}>↷</button>
          {renderProgress ? (
            <button className="btn danger small" onClick={onStopRender}
              disabled={renderProgress.status === "cancelling"}
              title="Stop this render — the partial file gets deleted, nothing is saved">
              {renderProgress.status === "cancelling" ? "Stopping…" : `■ Stop · ${Math.round(renderProgress.percent)}%`}
            </button>
          ) : (
            <div className="render-menu-wrap">
              <button className="btn primary small" disabled={!project}
                onClick={() => setShowRenderMenu((v) => !v)}>
                Render ▾
              </button>
              {showRenderMenu && (
                <>
                  {/* Transparent full-screen catcher, not a dimmed .modal-backdrop —
                      this is an anchored dropdown menu, not a centered dialog; a
                      dimming overlay would fight that read. Sits behind the panel,
                      any click on it (i.e. anywhere outside the panel) closes. */}
                  <div className="dropdown-catcher" onClick={() => setShowRenderMenu(false)} />
                  <div className="render-menu card compact" onClick={(e) => e.stopPropagation()}>
                    <div className="subhead">Export settings</div>
                    <label style={{ margin: "0 0 4px" }}>File name</label>
                    <input type="text" value={exportName} placeholder={project?.name || project?.projectId || "reel"}
                      style={{ marginBottom: 8 }}
                      onChange={(e) => setExportName(e.target.value)} />

                    <label style={{ margin: "0 0 4px" }}>Quality {transparentExport && "(alpha ignores this — always full quality)"}</label>
                    <div className="segmented" style={{ width: "100%", marginBottom: 8 }}>
                      {(["high", "balanced", "small"] as const).map((q) => (
                        <button key={q} type="button" className={"tab" + (renderQuality === q ? " active" : "")}
                          disabled={transparentExport}
                          onClick={() => setRenderQuality(q)}>
                          {q === "high" ? "High" : q === "balanced" ? "Balanced" : "Small file"}
                        </button>
                      ))}
                    </div>

                    <label className="row" style={{ gap: 6, alignItems: "center", marginBottom: 8 }}>
                      <input type="checkbox" checked={transparentExport}
                        onChange={(e) => setTransparentExport(e.target.checked)} />
                      Transparent background (alpha, ProRes .mov — for Resolve/editors)
                    </label>

                    <label style={{ margin: "0 0 4px" }}>Save to</label>
                    <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                      <input type="text" readOnly value={destDir || "(default) this app's own out/ folder"}
                        title={destDir || undefined} style={{ flex: 1, color: destDir ? undefined : "var(--muted)" }} />
                      <button className="btn small" style={{ width: "auto" }} disabled={browsingFolder} onClick={onBrowseFolder}>
                        {browsingFolder ? "…" : "Browse…"}
                      </button>
                      {destDir && (
                        <button className="btn small" style={{ width: "auto" }} title="Reset to the default out/ folder"
                          onClick={() => setDestDir("")}>✕</button>
                      )}
                    </div>

                    <button className="btn primary" onClick={onRender} disabled={!project}>
                      {transparentExport ? "Render ProRes (alpha)" : "Render MP4"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button className="btn small icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
            onClick={() => setShowShortcuts(true)}>?</button>
          {/* Account slot — a visual placeholder for when login ships, not
              wired to anything real yet. Reserving the spot now (top-right,
              same place every app like this puts it) means it isn't a
              bolt-on the day auth actually lands. */}
          <div className="acctwrap">
            <button type="button" className="acct-avatar" title="Account" onClick={() => setShowAcctMenu((v) => !v)}>
              {(project?.name || "M").trim().slice(0, 1).toUpperCase()}
            </button>
            {showAcctMenu && (
              <>
                <div className="dropdown-catcher" onClick={() => setShowAcctMenu(false)} />
                <div className="acct-menu card compact" onClick={(e) => e.stopPropagation()}>
                  <a className="acct-menu-item" aria-disabled="true">Account</a>
                  <a className="acct-menu-item" aria-disabled="true">Preferences</a>
                  <a className="acct-menu-item danger" aria-disabled="true">Log out</a>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
      <div className="workspace">
      <nav className="rail">
        <button type="button" className={"rail-btn" + (activeLeftDock === "assets" ? " active" : "")}
          title="Global assets" onClick={() => toggleLeftDock("assets")}>
          <BgTileIcon /><span>Assets</span>
        </button>
        <div className="rail-div" />
        <button type="button" className={"rail-btn" + (activeRightDock === "layers" ? " active" : "")}
          title="Layers" onClick={() => toggleRightDock("layers")}>
          <RailLayersIcon /><span>Layers</span>
        </button>
      </nav>

      {/* Hidden file inputs live outside either dock's own JSX, always
          mounted regardless of which dock — or none — is open right now:
          newPhotoInput in particular is triggered from the Layers dock's
          own Photo tool, nothing to do with the Pages/Assets docks here. */}
      <input ref={psdInput} className="hidden-file" type="file" accept=".psd,.svg,.png,.jpg,.jpeg,.webp,.gif" multiple
        onChange={(e) => { if (e.target.files) onAddPages(e.target.files); e.target.value = ""; }} />
      <input ref={newPhotoInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.webm,.mov,.mp4"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddPhotoLayerFromFile(sel, f); e.target.value = ""; }} />
      <input ref={bgInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif"
        onChange={(e) => e.target.files?.[0] && onSlotUpload("bg", e.target.files[0])} />
      <input ref={titleInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif,.json"
        onChange={(e) => e.target.files?.[0] && onSlotUpload("title", e.target.files[0])} />
      <input ref={logoInput} className="hidden-file" type="file" accept=".json,.webm,.mov,.mp4,.gif,.png,.svg"
        onChange={(e) => e.target.files?.[0] && onSlotUpload("logo", e.target.files[0])} />
      <input ref={audioInput} className="hidden-file" type="file" accept=".mp3,.wav,.m4a,.ogg,.flac,.aac"
        onChange={(e) => e.target.files?.[0] && onUploadAudio(e.target.files[0])} />

      <div className="stagewrap">
      {/* LEFT dock: Pages or Global assets, whichever rail icon is active —
          never both, never neither's content lingering underneath. */}
      <aside className={"dock dock-left" + (activeLeftDock ? " open" : "")}
        style={{ width: activeLeftDock ? leftW : 0 }}>
        {activeLeftDock === "assets" && project && (
          <div className="dockbody">
            <h2 style={{ marginTop: 0 }}>Global assets (all pages)</h2>

            {/* One tile grid triggers all 4 uploads — each slot's own detail
                card (position/opacity/FX below, or Audio's waveform+volume/
                trim/fade) still renders right after it, unchanged; only the
                upload trigger itself moved out of 4 stacked full-width
                buttons into this 2x2 grid. */}
            <div className="assetgrid">
              <button className={"assettile" + (project.bg?.file ? " filled" : "")} onClick={() => bgInput.current?.click()}
                title={project.bg?.file ? "Replace Background" : "Upload Background"}>
                <BgTileIcon /><span className="lbl">Background</span><span className="st">{project.bg?.file ? "uploaded" : "empty"}</span>
              </button>
              <button className={"assettile" + (project.title?.file ? " filled" : "")} onClick={() => titleInput.current?.click()}
                title={project.title?.file ? "Replace Title" : "Upload Title"}>
                <TitleTileIcon /><span className="lbl">Title</span><span className="st">{project.title?.file ? "uploaded" : "empty"}</span>
              </button>
              <button className={"assettile" + (project.logo?.file ? " filled" : "")} onClick={() => logoInput.current?.click()}
                title={project.logo?.file ? "Replace Logo" : "Upload Logo (top-right)"}>
                <LogoTileIcon /><span className="lbl">Logo</span><span className="st">{project.logo?.file ? "uploaded" : "empty"}</span>
              </button>
              <button className={"assettile" + (project.audio?.file ? " filled" : "")} onClick={() => audioInput.current?.click()}
                title={project.audio?.file ? "Replace Audio" : "Upload Audio (music / sound bed)"}>
                <AudioTileIcon /><span className="lbl">Audio</span><span className="st">{project.audio?.file ? "uploaded" : "empty"}</span>
              </button>
            </div>

            {/* BG */}
            <div className="card compact">
              {project.bg && (
                <AssetControls slot={project.bg} label="BG" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.bg) fn(p.bg); })}
                  onRemove={() => onRemoveSlot("bg")} />
              )}
              <div style={{ marginTop: 8 }}>
                <ColorField value={project.bgColor ?? "#e8e4dd"}
                  onChange={(hex) => update((p) => { p.bgColor = hex; })}
                  swatches={project.swatches ?? []} onAddSwatch={addSwatch} onRemoveSwatch={removeSwatch} brandSwatches={brandColors} />
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                <div className="subhead">Background style</div>
                <BgStyleEditor value={project.bgStyle ?? {}}
                  onChange={(fn) => update((p) => { if (!p.bgStyle) p.bgStyle = {}; fn(p.bgStyle); })}
                  swatches={project.swatches ?? []} onAddSwatch={addSwatch} onRemoveSwatch={removeSwatch} brandSwatches={brandColors} />
              </div>
            </div>

            {/* TITLE — empty tile shows nothing below it, same as Logo/Audio;
                unlike BG (which always has real global content: bgColor +
                BgStyleEditor apply project-wide regardless of an uploaded
                image), there's nothing to show here until a file exists. */}
            {project.title && (
              <div className="card compact">
                <AssetControls slot={project.title} label="Title" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.title) fn(p.title); })}
                  onRemove={() => onRemoveSlot("title")} />
              </div>
            )}

            {/* LOGO */}
            {project.logo && (
              <div className="card compact">
                <AssetControls slot={project.logo} label="Logo" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.logo) fn(p.logo); })}
                  onRemove={() => onRemoveSlot("logo")} />
              </div>
            )}

            {/* AUDIO — global background-music/sound bed, spans the whole reel.
                Separate from a video layer's own embedded sound (that's
                per-layer, via the mute toggle in the function panel). */}
            {project.audio?.file && (
              <div className="card compact">
                <div className="mini" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Waveform src={`/${project.audio.file}`}
                    playing={playerPlaying}
                    currentSec={(project.audio.startOffset ?? 0) + playerFrame / project.fps}
                    durationSec={project.audio.duration} />
                  <div className="row between" style={{ alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>
                      {project.audio.duration != null
                        ? `${Math.floor(project.audio.duration / 60)}:${String(Math.round(project.audio.duration % 60)).padStart(2, "0")} source`
                        : "duration unknown"}
                    </span>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn small" title={project.audio.muted ? "Unmute" : "Mute"}
                        onClick={() => update((p) => { if (p.audio) p.audio.muted = !p.audio.muted; })}>
                        {project.audio.muted ? <SoundOffIcon /> : <SoundOnIcon />}
                      </button>
                      <button className="btn small" onClick={onRemoveAudio}>✕</button>
                    </div>
                  </div>
                  <div className="row between mini" style={{ alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Volume</span>
                    <NumField min={0} max={100} value={Math.round((project.audio.volume ?? 1) * 100)}
                      onChange={(e) => update((p) => { if (p.audio) p.audio.volume = Math.min(100, Math.max(0, Math.round(parseFloat(e.target.value || "0")))) / 100; })} />
                  </div>
                  <div className="row between mini" style={{ alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }} title="Trim into the source file — skips its intro">Start offset (s)</span>
                    <NumField min={0} max={Math.floor(project.audio.duration ?? 0)} value={Math.round(project.audio.startOffset ?? 0)}
                      onChange={(e) => update((p) => { if (p.audio) p.audio.startOffset = Math.max(0, Math.round(parseFloat(e.target.value || "0"))); })} />
                  </div>
                  <div className="row between mini" style={{ alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Fade in (s)</span>
                    <NumField min={0} max={30} value={Math.round(project.audio.fadeInSec ?? 0)}
                      onChange={(e) => update((p) => { if (p.audio) p.audio.fadeInSec = Math.max(0, Math.round(parseFloat(e.target.value || "0"))); })} />
                  </div>
                  <div className="row between mini" style={{ alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Fade out (s)</span>
                    <NumField min={0} max={30} value={Math.round(project.audio.fadeOutSec ?? 0)}
                      onChange={(e) => update((p) => { if (p.audio) p.audio.fadeOutSec = Math.max(0, Math.round(parseFloat(e.target.value || "0"))); })} />
                  </div>
                </div>
              </div>
            )}

            {/* LOADER */}
            <h2>Loader</h2>
            <LoaderControls loader={project.loader} style={project.loaderStyle ?? "bar"}
              visible={project.loaderVisible ?? true}
              canvas={[project.width, project.height]}
              onChangeBox={(fn) => update((p) => fn(p.loader))}
              onChangeStyle={(s) => update((p) => { p.loaderStyle = s; })}
              onChangeVisible={(v) => update((p) => { p.loaderVisible = v; })} />
          </div>
        )}
      </aside>
      {activeLeftDock && (
        <div className="panel-resizer" onMouseDown={startPanelDrag("left")} title="Drag to resize" />
      )}

      {/* CENTER: live preview */}
      <div ref={centerRef} className="center" style={{ flex: "1 1 auto", minWidth: 320 }}>
        {/* General status — errors/busy from any panel action here (uploads,
            ingest, presets…), not just rendering any more (that moved to
            the header's Render menu + the canvas overlay). Lives here (not
            inside a dock) so it stays visible no matter which dock — or
            none — is open when the error happens. */}
        {busy && <p className="spin" style={{ alignSelf: "flex-start" }}>{busy}</p>}
        {err && (
          <p className="err row between" style={{ alignItems: "center", gap: 8, alignSelf: "stretch" }}>
            <span>{err}</span>
            <button className="btn small" title="Dismiss" onClick={() => setErr(null)}>✕</button>
          </p>
        )}
        {/* Everything zoomable (storyboard + artboard) lives in its own
            scroll region, separate from PlayerControls/the safe-zone row
            below — those two must stay visually docked in place as zoom
            changes, never resized or shifted by it. flex:1 lets this take
            all the space .center isn't spending on the two fixed rows
            below it; minHeight:0 is the standard flex fix that lets its
            own overflow:auto actually clip/scroll instead of forcing
            .center itself to grow taller than the viewport. */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 12, width: "100%", flex: "1 1 auto", minHeight: 0, overflow: "auto",
        }}>
        {project ? (
          <>
          {/* Overlay-guide toolbar — ruler guides + safe-zone + Instagram UI
              mockup, split out from PlayerControls below into its OWN row
              above the artboard. Was children of the bottom transport bar;
              once guides' own +V/+H/Clear guides trio joined safe-zone/IG-UI
              there, that single row either overflowed its box or wrapped to
              a second line — a second row of buttons under the seek bar,
              not what a "one clean transport row" was supposed to look
              like. These three all share one real trait the bottom bar's
              other controls (play/zoom/mute) don't: every one of them is a
              non-rendered EDITOR OVERLAY toggle, never part of the actual
              export — grouping them together above the canvas reads as
              "view options for what you're looking at," while the bottom
              bar stays pure playback controls. */}
          <div className="canvas-toolbar">
            <button className={"btn small icon" + (showGuides ? " active" : "")}
              title={showGuides ? "Hide ruler guides (guide only — never rendered in export)" : "Show ruler guides (guide only — never rendered in export)"}
              aria-label="Toggle ruler guides" aria-pressed={showGuides}
              onClick={() => setShowGuides((v) => !v)}>
              <GuidesToggleIcon />
            </button>
            {showGuides && (
              <>
                <button className="btn small" title="Add a vertical guide (center of the canvas — drag to position)"
                  onClick={() => addGuide("x")}>+ V</button>
                <button className="btn small" title="Add a horizontal guide (center of the canvas — drag to position)"
                  onClick={() => addGuide("y")}>+ H</button>
                {(project.guides ?? []).length > 0 && (
                  <button className="btn small" title="Remove every guide on this project"
                    onClick={clearGuides}>Clear guides</button>
                )}
              </>
            )}
            {/* Meta's published Reels/Stories safe margins only mean
                anything on a portrait canvas — showing them over a
                landscape/square project would just be wrong, not merely
                irrelevant. */}
            {project.height > project.width && (
              <>
                <span className="canvas-toolbar-divider" />
                <button className={"btn small icon" + (showSafeZone ? " active" : "")}
                  title={showSafeZone ? "Hide Instagram Reels safe zone (guide only — never rendered in export)" : "Show Instagram Reels safe zone (guide only — never rendered in export)"}
                  aria-label="Toggle Instagram Reels safe zone guide" aria-pressed={showSafeZone}
                  onClick={() => setShowSafeZone((v) => !v)}>
                  <SafeZoneToggleIcon />
                </button>
                <button className={"btn small icon" + (showInstagramUI ? " active" : "")}
                  title={showInstagramUI ? "Hide Instagram Reels UI preview (stylized mockup — never rendered in export)" : "Show Instagram Reels UI preview (stylized mockup — never rendered in export)"}
                  aria-label="Toggle Instagram Reels UI preview" aria-pressed={showInstagramUI}
                  onClick={() => setShowInstagramUI((v) => !v)}>
                  <InstagramUiToggleIcon />
                </button>
              </>
            )}
            {/* Multi-select align — appears once 2+ layers are selected on
                the canvas (shift/ctrl/cmd+click to add to the selection).
                Aligns against the SELECTION's own bounding box, reusing the
                exact icons the per-layer "Box align" control already uses
                for the same idea against the canvas instead. */}
            {selectedLayerIndices.size >= 2 && (
              <>
                <span className="canvas-toolbar-divider" />
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} className="btn small icon" title={`Align selection to the ${a}`}
                    aria-label={`Align selection to the ${a}`} onClick={() => alignSelection(a)}>
                    <AlignBoxIcon align={a} />
                  </button>
                ))}
                {(["top", "middle", "bottom"] as const).map((a) => (
                  <button key={a} className="btn small icon" title={`Align selection to the ${a}`}
                    aria-label={`Align selection to the ${a}`} onClick={() => alignSelection(a)}>
                    <AlignBoxIconV align={a} />
                  </button>
                ))}
              </>
            )}
          </div>
          <div
            ref={playerWrapRef}
            style={{
              position: "relative",
              // Matches the storyboard's own >2 threshold above — otherwise
              // hiding the strip at 1-2 pages just leaves dead space instead
              // of giving it back to the player. zoom scales this "fit"
              // height directly (not a CSS transform) so CanvasHandles/
              // PhotoPanHandles/TextPlacementOverlay — which all derive their
              // own scale from this wrapper's real rendered width via
              // ResizeObserver — pick the new size up automatically, no
              // changes needed in any of them.
              height: `calc(${project.pages.length > 2 ? 66 : 80}vh * ${zoom})`,
              aspectRatio: `${project.width} / ${project.height}`,
              // .center is a column flex container, so every child (this
              // wrapper, the PlayerControls row, the safe-zone tab row
              // below) defaults to flex-shrink:1 — once zoom pushes this
              // wrapper's height past what .center has room for, the flex
              // algorithm was shrinking ALL of them back down to fit
              // (including squeezing PlayerControls/the safe-zone row,
              // which read as "everything zooming"), while clamping THIS
              // element hardest since it's the one asking for the most
              // extra space — net effect: zooming in visibly did nothing.
              // flexShrink:0 here (and on those sibling rows below) opts
              // every one of them out of that squeeze; .center's own
              // overflow:auto is what actually absorbs the extra height.
              flexShrink: 0,
            }}
            // Clicking empty canvas (not a handle — those stop this via
            // their own onClick) clears the multi-selection, same
            // "click away to deselect" convention as Figma/Illustrator.
            // Handles' onClick stopPropagation means this only ever fires
            // when the click genuinely landed on the background.
            onClick={() => { setSelectedLayerIndex(null); setSelectedLayerIndices(new Set()); }}
          >
            <Player
              ref={playerRef}
              component={Reel as any}
              inputProps={{ project, debugZones: false }}
              durationInFrames={reelDuration(project)}
              fps={project.fps}
              compositionWidth={project.width}
              compositionHeight={project.height}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 10,
                boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
              }}
              acknowledgeRemotionLicense
              loop
            />
            <CanvasHandles
              wrapperRef={playerWrapRef}
              canvas={[project.width, project.height]}
              handles={canvasHandles}
              userGuides={showGuides ? project.guides : undefined}
            />
            <PhotoPanHandles
              wrapperRef={playerWrapRef}
              canvas={[project.width, project.height]}
              targets={photoPanTargets}
            />
            {textTool && (
              <TextPlacementOverlay
                wrapperRef={playerWrapRef}
                canvas={[project.width, project.height]}
                defaultSize={[Math.round(project.width * 0.8), Math.round(project.height * 0.14)]}
                onPlace={(box) => onPlaceText(sel, box)}
                onCancel={() => setTextTool(false)}
              />
            )}
            {showSafeZone && project.height > project.width && <SafeZoneOverlay canvas={[project.width, project.height]} />}
            {showInstagramUI && project.height > project.width && <InstagramUIOverlay canvas={[project.width, project.height]} />}
            {showGuides && (
              <GuidesOverlay
                wrapperRef={playerWrapRef}
                canvas={[project.width, project.height]}
                guides={project.guides ?? []}
                onChange={moveGuide}
                onDelete={deleteGuide}
              />
            )}
            {/* Render progress — ON the canvas itself (not a side panel), so
                it's visible no matter which inspector tab is open. */}
            {renderProgress && (
              <div className="render-overlay">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, renderProgress.percent))}%` }} />
                </div>
                <div className="render-overlay-row">
                  <span>
                    {renderProgress.phase === "bundling" && "Bundling…"}
                    {renderProgress.phase === "rendering" &&
                      (renderProgress.totalFrames ? `Rendering… ${renderProgress.frame}/${renderProgress.totalFrames} frames` : "Rendering…")}
                    {renderProgress.phase === "encoding" && "Encoding…"}
                    {!renderProgress.phase && "Starting…"}
                  </span>
                  <span className="tabular">{Math.round(renderProgress.percent)}%</span>
                  <button className="btn small" style={{ width: "auto" }} onClick={onStopRender}
                    disabled={renderProgress.status === "cancelling"}
                    title="Stop this render — the partial file gets deleted, nothing is saved">
                    {renderProgress.status === "cancelling" ? "Stopping…" : "✕ Stop"}
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
        ) : <p className="sub">Loading…</p>}
        </div>
        {/* Bottom transport row — play/time/seek/fullscreen, then zoom% and
            (when this page has one) the video mute toggle, passed in as
            children right after Fullscreen. Guides/safe-zone/Instagram-UI
            used to live here too, but they're editor-overlay VIEW toggles,
            not playback controls — moved to their own .canvas-toolbar row
            above the artboard (see the "project ? (" branch above) once
            their own +V/+H/Clear guides trio started overflowing this row
            or forcing it to wrap onto a second line. */}
        {project && (() => {
          // The function panel's own mute button controls whichever video is
          // actually on this page — a page carries at most one main visual
          // in practice (the PSD-slot photo, or a shape's photo mask), so
          // "the page's video" is unambiguous; the first one found wins on
          // the rare page that somehow has more than one.
          const pageLayers = project.pages[sel]?.layers ?? [];
          const videoLayerIndex = pageLayers.findIndex(
            (l) => l.assetKind === "video" || (l.assetKind === "shape" && l.shapePhotoKind === "video")
          );
          const videoLayer = videoLayerIndex >= 0 ? pageLayers[videoLayerIndex] : null;
          return (
          <>
            <PlayerControls playerRef={playerRef} durationInFrames={reelDuration(project)} fps={project.fps}>
              {/* Zoom% right after Fullscreen — the one place the user can
                  always see the artboard's current zoom, at any project
                  shape, at any zoom level including 100%. */}
              <button className="btn small" title="Canvas zoom — Ctrl+wheel over the preview to adjust, click to reset to 100%"
                onClick={() => setZoom(1)} style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {Math.round(zoom * 100)}%
              </button>
              {videoLayer && (
                <button className={"btn small icon" + (videoLayer.videoMuted ? "" : " active")}
                  title={videoLayer.videoMuted ? "Muted — click to play with sound (in preview and export)" : "Playing with sound — click to mute (in preview and export)"}
                  aria-label="Toggle this page's video sound" aria-pressed={!videoLayer.videoMuted}
                  onClick={() => update((p) => {
                    const l = p.pages[sel].layers[videoLayerIndex];
                    l.videoMuted = !l.videoMuted;
                  })}>
                  {videoLayer.videoMuted ? <SoundOffIcon /> : <SoundOnIcon />}
                </button>
              )}
            </PlayerControls>
            {photoPanTargets.length > 0 && (
              <p className="hint" style={{ margin: 0, textAlign: "center" }}>
                Hold <b>Alt</b> and drag a photo to reposition its crop inside its frame instead of moving the frame itself
              </p>
            )}
          </>
          );
        })()}
        {/* Render result — done/error, shown right under the merged
            transport/zoom card (still "on the player," just not layered
            over the canvas once there's nothing left actively progressing).
            Cleared by starting a new render (onRender resets both) or
            dismissing here. */}
        {!renderProgress && (renderUrl || renderPath || renderErr) && (
          <div className="render-result">
            {renderErr ? (
              <span className="err" style={{ margin: 0, flex: 1 }}>{renderErr}</span>
            ) : renderUrl ? (
              <span className="hint" style={{ margin: 0, flex: 1 }}>Done → <a className="dl" href={renderUrl} target="_blank" rel="noreferrer">download reel</a></span>
            ) : (
              <span className="hint" style={{ margin: 0, flex: 1 }}>Done → saved to <span className="tabular" style={{ fontFamily: "var(--mono)" }}>{renderPath}</span></span>
            )}
            <button className="btn small" style={{ width: "auto" }} title="Dismiss"
              onClick={() => { setRenderUrl(null); setRenderPath(null); setRenderErr(null); }}>✕</button>
          </div>
        )}
      </div>

      {activeRightDock && (
        <div className="panel-resizer" onMouseDown={startPanelDrag("right")} title="Drag to resize" />
      )}

      {/* RIGHT dock: the page/element inspector — unchanged internals,
          just behind the Layers rail icon instead of always open. */}
      <aside className={"dock dock-right" + (activeRightDock ? " open" : "")}
        style={{ width: activeRightDock ? rightW : 0 }}>
        {activeRightDock === "layers" && (
          <div className="dockbody">
            {project && project.pages[sel] ? (
              <PageInspector
                key={project.pages[sel].id}
                page={project.pages[sel]}
                canvas={[project.width, project.height]}
                clip={motionClip}
                onCopyClip={setMotionClip}
                onChange={(fn) => update((p) => fn(p.pages[sel]))}
                onUploadPhoto={(li, file) => onUploadPhoto(sel, li, file)}
                onUploadShapePhoto={(li, file) => onUploadShapePhoto(sel, li, file)}
                onRemoveShapePhoto={(li) => onRemoveShapePhoto(sel, li)}
                onToggleTextTool={() => setTextTool((v) => !v)}
                textToolArmed={textTool}
                onAddPhoto={() => newPhotoInput.current?.click()}
                onAddShape={() => onAddShapeLayer(sel)}
                onDeleteLayer={(li) => onDeleteLayer(sel, li)}
                fonts={fonts}
                onSelectFont={(li, entry) => onSelectFont(sel, li, entry)}
                swatches={project.swatches ?? []} onAddSwatch={addSwatch} onRemoveSwatch={removeSwatch}
                brandColors={brandColors}
                motionPresets={motionPresets} onSaveMotionPreset={onSaveMotionPreset} onDeleteMotionPreset={onDeleteMotionPreset}
                newestLayerIndex={newestLayerIndex}
                selectedLayerIndex={selectedLayerIndex}
              />
            ) : <p className="sub">Select a page.</p>}
          </div>
        )}
      </aside>
      </div>
      </div>

      {/* Bottom page filmstrip — same shape as Canva's own (vertical cards
          here, since a reel is 9:16, not landscape). Replaces the old
          always-open Pages column entirely: there's no rail icon for it any
          more, this bar is just always here, same as the topbar above it. */}
      <div className="filmstrip">
        <div
          ref={filmstripScrollRef}
          className={"filmstrip-scroll" + (dragOver ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            if (e.dataTransfer.files?.length) onAddPages(e.dataTransfer.files);
          }}
        >
          {!project?.pages.length && <p className="hint" style={{ margin: "0 8px", flex: "none" }}>No pages yet — add one, or drag PSDs/SVGs here.</p>}
          {project?.pages.map((pg, i) => (
            <FilmstripPageCard key={pg.id} project={project} page={pg} index={i}
              selected={i === sel}
              isDragging={draggingPageIndex === i}
              isDragOver={dragOverPageIndex === i && draggingPageIndex !== i}
              onSelect={selectPage}
              onDragStartCard={setDraggingPageIndex}
              onDragOverCard={setDragOverPageIndex}
              onDropCard={(fromIndex, toIndex) => {
                reorderPages(fromIndex, toIndex);
                setDraggingPageIndex(null);
                setDragOverPageIndex(null);
              }}
              onDragEndCard={() => { setDraggingPageIndex(null); setDragOverPageIndex(null); }}
              onHoverCard={showHoverPageCard}
              onUnhoverCard={scheduleHideHoverPageCard}
            />
          ))}
        </div>
        {/* Save-as-template / delete — one shared pill for whichever card is
            hovered, positioned from its real rect (see hoverPageCard state
            above for why this isn't just a per-card CSS :hover reveal any
            more). */}
        {hoverPageCard && project?.pages[hoverPageCard.index] && (
          <div className="pagecard-actions"
            style={{
              left: hoverPageCard.rect.left + hoverPageCard.rect.width / 2,
              bottom: window.innerHeight - hoverPageCard.rect.top + 4,
              transform: "translateX(-50%)",
            }}
            onMouseEnter={() => { if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; } }}
            onMouseLeave={scheduleHideHoverPageCard}
          >
            <button className="btn small" title="Save this page's layout as a reusable template"
              onClick={() => {
                const idx = hoverPageCard.index;
                const pg = project.pages[idx];
                setSavingTemplateFor(idx);
                setTemplateName(pg.name ? `${pg.name} layout` : "My layout");
                setTemplateErr(null);
                setHoverPageCard(null);
              }}>
              <TemplateIcon />
            </button>
            <button className="btn small" title="Duplicate this page — same layers/motion, own copy of its images"
              onClick={() => { dupPage(hoverPageCard.index); setHoverPageCard(null); }}>⧉</button>
            <button className="btn small" title="Delete page"
              onClick={() => { delPage(hoverPageCard.index); setHoverPageCard(null); }}>✕</button>
          </div>
        )}
        <div className="addpage">
          <button type="button" title="Add a blank page" onClick={onAddBlankPage}>+</button>
          <div className="addpagediv" />
          <button type="button" title="More ways to add a page" onClick={() => setShowAddPageMenu((v) => !v)}>▾</button>
          {showAddPageMenu && (
            <>
              <div className="dropdown-catcher" onClick={() => setShowAddPageMenu(false)} />
              <div className="addmenu">
                <a onClick={() => { onAddBlankPage(); setShowAddPageMenu(false); }}>Blank page</a>
                <a onClick={() => { psdInput.current?.click(); setShowAddPageMenu(false); }}>Import sequence…</a>
                <a onClick={() => {
                  setShowTemplatePicker(true);
                  if (pageTemplates === null) listPageTemplates().then(setPageTemplates).catch(() => setPageTemplates([]));
                  setShowAddPageMenu(false);
                }}>From template…</a>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts cheatsheet — every one of these already worked
          before this modal existed; the only thing missing was any way to
          find out. Opened by the topbar's "?" button or the "?" key itself
          (see the global keydown effect above) — a real shortcut for the
          shortcuts list, same convention GitHub/Figma/Notion use. */}
      {showShortcuts && (
        <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Keyboard shortcuts</h2>
            {[
              { group: "Playback", rows: [["Space", "Play / pause"]] },
              { group: "Edit", rows: [["Ctrl/Cmd + Z", "Undo"], ["Ctrl/Cmd + Shift + Z (or Ctrl + Y)", "Redo"]] },
              { group: "Canvas selection", rows: [
                ["Click a layer", "Select it (replaces the current selection)"],
                ["Shift / Ctrl / Cmd + click", "Add or remove that layer from the selection"],
                ["Click empty canvas, or Esc", "Clear the selection"],
                ["Delete / Backspace", "Delete every selected layer"],
              ] },
              { group: "Nudge a selected layer", rows: [
                ["Arrow keys", "Move 1px"],
                ["Shift + Arrow keys", "Move 10px"],
              ] },
              { group: "Photo / video layers", rows: [["Hold Alt + drag", "Pan the image inside its frame instead of moving the frame"]] },
              { group: "Canvas zoom", rows: [["Ctrl + scroll, over the preview", "Zoom in / out"]] },
            ].map(({ group, rows }) => (
              <div key={group} style={{ marginTop: 14 }}>
                <div className="subhead" style={{ marginBottom: 6 }}>{group}</div>
                {rows.map(([keys, desc]) => (
                  <div key={keys} className="row between" style={{ gap: 12, padding: "4px 0" }}>
                    <span className="sub" style={{ margin: 0 }}>{desc}</span>
                    <span className="tag" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{keys}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowShortcuts(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Save current page as a template — a small named-save form, same
          "inline field, not window.prompt" spirit as motion presets'
          "Save current as preset…" flow above. */}
      {savingTemplateFor !== null && (
        <div className="modal-backdrop" onClick={() => !templateBusy && setSavingTemplateFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Save page as template</h2>
            <p className="sub" style={{ marginTop: -8 }}>
              Reusable in this or any other project — its layers, boxes, motion, and background style, asset files included.
            </p>
            <label>Template name</label>
            <input type="text" autoFocus value={templateName} placeholder="e.g. Title + subtitle, centered"
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitSaveTemplate(); if (e.key === "Escape") setSavingTemplateFor(null); }} />
            {templateErr && <p className="err">{templateErr}</p>}
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn" disabled={templateBusy} onClick={() => setSavingTemplateFor(null)}>Cancel</button>
              <button className="btn primary" disabled={templateBusy || !templateName.trim()} onClick={commitSaveTemplate}>
                {templateBusy ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template picker — insert a saved layout as a brand-new page. */}
      {showTemplatePicker && (
        <div className="modal-backdrop" onClick={() => setShowTemplatePicker(false)}>
          <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Page templates</h2>
            {templateErr && <p className="err">{templateErr}</p>}
            {pageTemplates === null && <p className="sub">Loading…</p>}
            {pageTemplates && pageTemplates.length === 0 && (
              <p className="sub">No templates saved yet — use the ▤ button on any page in the filmstrip to save its layout here.</p>
            )}
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {(pageTemplates ?? []).map((t) => (
                <div key={t.id} className="row between card compact" style={{ marginBottom: 8, alignItems: "center" }}>
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    {t.thumbnail ? (
                      <img src={t.thumbnail} alt="" style={{ width: 32, height: 56, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 32, height: 56, borderRadius: 4, background: "var(--panel2)", flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.name}>{t.name}</span>
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button className="btn small primary" disabled={templateBusy} onClick={() => onInsertTemplate(t.id)}>Insert</button>
                    <button className="btn small danger" disabled={templateBusy} title={`Delete "${t.name}"`}
                      onClick={() => onDeleteTemplate(t.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setShowTemplatePicker(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AssetControls: React.FC<{
  slot: LogoConfig;
  label: string;
  canvas: [number, number];
  onChange: (fn: (s: LogoConfig) => void) => void;
  onRemove: () => void;
}> = ({ slot, label, canvas, onChange, onRemove }) => {
  const [cw, ch] = canvas;
  const num = (v: string) => Math.round(parseFloat(v || "0"));
  // Same frame<->second convention as ElementMotion's own sec/toFr below
  // (hardcoded 30fps, matching the rest of the app's timing fields).
  const sec = (frames?: number, dflt = 0) => +(((frames ?? dflt) / 30)).toFixed(2);
  const toFr = (s: string) => Math.max(0, Math.round(parseFloat(s || "0") * 30));

  // Scale the box around its own center so "bigger/smaller" feels natural.
  const scale = (factor: number) =>
    onChange((s) => {
      const cx = s.box.left + s.box.width / 2;
      const cy = s.box.top + s.box.height / 2;
      s.box.width = Math.round(s.box.width * factor);
      s.box.height = Math.round(s.box.height * factor);
      s.box.left = Math.round(cx - s.box.width / 2);
      s.box.top = Math.round(cy - s.box.height / 2);
    });

  const centerX = () =>
    onChange((s) => { s.box.left = Math.round((cw - s.box.width) / 2); });
  const fullBleed = () =>
    onChange((s) => { s.box = { left: 0, top: 0, width: cw, height: ch }; });

  return (
    <div className="card compact" style={{ marginTop: 8 }}>
      <div className="row between">
        <span className="tag">{label} box</span>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small" onClick={() => scale(0.8)}>−</button>
          <button className="btn small" onClick={() => scale(1.25)}>＋</button>
          <button className="btn small" title={`Remove ${label}`} onClick={onRemove}>✕</button>
        </div>
      </div>
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>X</label><NumField value={slot.box.left}
          onChange={(e) => onChange((s) => { s.box.left = num(e.target.value); })} /></div>
        <div><label>Y</label><NumField value={slot.box.top}
          onChange={(e) => onChange((s) => { s.box.top = num(e.target.value); })} /></div>
        <div><label>Width</label><NumField value={slot.box.width}
          onChange={(e) => onChange((s) => { s.box.width = num(e.target.value); })} /></div>
        <div><label>Height</label><NumField value={slot.box.height}
          onChange={(e) => onChange((s) => { s.box.height = num(e.target.value); })} /></div>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn small" onClick={centerX}>Center X</button>
        <button className="btn small" onClick={fullBleed}>Full-bleed</button>
      </div>
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>Fit</label>
          <select value={slot.fit ?? "contain"}
            onChange={(e) => onChange((s) => { s.fit = e.target.value as any; })}>
            <option value="contain">contain</option>
            <option value="cover">cover</option>
          </select></div>
        <div><label>Opacity {Math.round(slot.opacity * 100)}%</label>
          <input type="range" min={0} max={1} step={0.05} value={slot.opacity}
            onChange={(e) => onChange((s) => { s.opacity = parseFloat(e.target.value); })} /></div>
      </div>

      {/* Entrance/exit FX — same 91-effect vocabulary a page's own content
          layers use, but ONE slot each (see LogoConfig in types.ts): this
          overlay spans the whole reel, entrance plays once at frame 0, exit
          plays once at the reel's own end. */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
        <div className="subhead">Effects</div>
        <div className="mini">
          <label>In effect</label>
          <div className="row" style={{ gap: 5 }}>
            <select value={slot.entrance ?? "none"} style={{ flex: "1.3 1 0" }}
              onChange={(e) => onChange((s) => { s.entrance = e.target.value === "none" ? undefined : e.target.value as any; })}>
              <option value="none">none</option>
              {ENTRANCE_CATEGORIES.map((cat) => (
                <optgroup key={cat.label} label={cat.label}>
                  {cat.names.map((n) => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={slot.entranceEasing ?? ""} style={{ flex: "1 1 0" }}
              disabled={!slot.entrance || slot.entrance === "none"}
              title="This effect's own easing — auto = a curve chosen to fit it"
              onChange={(e) => onChange((s) => { s.entranceEasing = e.target.value === "" ? undefined : e.target.value as any; })}>
              <option value="">(auto)</option>
              {EASINGS.map((en) => <option key={en} value={en}>{en}</option>)}
            </select>
          </div>
        </div>
        {slot.entrance && slot.entrance !== "none" && (
          <div className="grid2 mini" style={{ marginTop: 4 }}>
            <div><label>in delay (s)</label>
              <NumField step={0.1} min={0} value={sec(slot.delay)}
                onChange={(e) => onChange((s) => { s.delay = toFr(e.target.value); })} /></div>
            <div><label>in dur (s)</label>
              <DurationPresetField value={slot.inDuration} fallback={26}
                onChange={(frames) => onChange((s) => { s.inDuration = frames; })} /></div>
          </div>
        )}

        <div className="mini" style={{ marginTop: 8 }}>
          <label>Out effect</label>
          <div className="row" style={{ gap: 5 }}>
            <select value={slot.exit ?? "none"} style={{ flex: "1.3 1 0" }}
              onChange={(e) => onChange((s) => { s.exit = e.target.value === "none" ? undefined : e.target.value as any; })}>
              <option value="none">none</option>
              {EXIT_CATEGORIES.map((cat) => (
                <optgroup key={cat.label} label={cat.label}>
                  {cat.names.map((n) => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={slot.exitEasing ?? ""} style={{ flex: "1 1 0" }}
              disabled={!slot.exit || slot.exit === "none"}
              title="This effect's own easing — auto = a curve chosen to fit it"
              onChange={(e) => onChange((s) => { s.exitEasing = e.target.value === "" ? undefined : e.target.value as any; })}>
              <option value="">(auto)</option>
              {EASINGS.map((en) => <option key={en} value={en}>{en}</option>)}
            </select>
          </div>
        </div>
        {slot.exit && slot.exit !== "none" && (
          <div className="grid2 mini" style={{ marginTop: 4 }}>
            <div><label>out at (s) &mdash; blank = end of reel</label>
              <div className="row" style={{ gap: 4 }}>
                <NumField step={0.1} min={0} value={slot.outDelay != null ? sec(slot.outDelay) : ""}
                  placeholder="auto" style={{ flex: 1 }}
                  onChange={(e) => onChange((s) => { s.outDelay = e.target.value === "" ? undefined : toFr(e.target.value); })} />
                <button className="btn small" title="Reset to auto (end of reel)"
                  disabled={slot.outDelay == null}
                  onClick={() => onChange((s) => { s.outDelay = undefined; })}>✕</button>
              </div></div>
            <div><label>out dur (s)</label>
              <DurationPresetField value={slot.outDuration} fallback={24}
                onChange={(frames) => onChange((s) => { s.outDuration = frames; })} /></div>
          </div>
        )}
      </div>
    </div>
  );
};

const LOADER_STYLES: { value: LoaderStyle; label: string }[] = [
  { value: "bar", label: "bar (single, whole reel)" },
  { value: "segmented", label: "segmented (one per page)" },
  { value: "dots", label: "dots (one per page)" },
  { value: "folio", label: "folio (page count, e.g. 03 — 12)" },
];

const LoaderControls: React.FC<{
  loader: Box;
  style: LoaderStyle;
  visible: boolean;
  canvas: [number, number];
  onChangeBox: (fn: (b: Box) => void) => void;
  onChangeStyle: (s: LoaderStyle) => void;
  onChangeVisible: (v: boolean) => void;
}> = ({ loader, style, visible, canvas, onChangeBox, onChangeStyle, onChangeVisible }) => {
  const [cw, ch] = canvas;
  const [expanded, setExpanded] = React.useState(false);
  const num = (v: string) => Math.round(parseFloat(v || "0"));
  const centerX = () => onChangeBox((b) => { b.left = Math.round((cw - b.width) / 2); });

  return (
    <div>
      <button type="button" className={"assettile wide" + (visible ? " filled" : "") + (expanded ? " expanded" : "")}
        title="Style, position, and visibility for the reel-wide progress bar" onClick={() => setExpanded((v) => !v)}>
        <LoaderTileIcon /><span className="lbl">Loader</span><span className="st">{visible ? style : "off"}</span>
      </button>
      {expanded && (
        <div className="card compact" style={{ marginTop: 8 }}>
          <div className="row between">
            <span className="tag">Loader box</span>
            <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={visible} style={{ width: "auto" }}
                onChange={(e) => onChangeVisible(e.target.checked)} />
              Show loader
            </label>
          </div>
          <div className="mini" style={{ marginTop: 6 }}>
            <label>Style</label>
            <select value={style} disabled={!visible} onChange={(e) => onChangeStyle(e.target.value as LoaderStyle)}>
              {LOADER_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {style !== "folio" && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn small" disabled={!visible} onClick={centerX}>Center X</button>
            </div>
          )}
          <div className="grid2 mini" style={{ marginTop: 6 }}>
            <div><label>X</label><NumField value={loader.left}
              onChange={(e) => onChangeBox((b) => { b.left = num(e.target.value); })} /></div>
            <div><label>Y</label><NumField value={loader.top}
              onChange={(e) => onChangeBox((b) => { b.top = num(e.target.value); })} /></div>
            {style !== "folio" && (
              <>
                <div><label>Width</label><NumField value={loader.width}
                  onChange={(e) => onChangeBox((b) => { b.width = num(e.target.value); })} /></div>
                <div><label>Height</label><NumField value={loader.height}
                  onChange={(e) => onChangeBox((b) => { b.height = num(e.target.value); })} /></div>
              </>
            )}
          </div>
          {style === "folio" && (
            <p className="hint" style={{ marginTop: 6 }}>Folio is a fixed-size numeral — X/Y position it, drag the handle on canvas to place the corner.</p>
          )}
        </div>
      )}
    </div>
  );
};

type PageT = Project["pages"][number];
type LayerT = PageT["layers"][number];

// Everything about a layer that's worth copying to another layer — motion,
// timing AND style (font/size/color/align/direction/photo crop) — except the
// literal `text` string and structural fields (box, role, file, asset kind),
// which stay tied to the layer they came from. Also doubles as the shape
// saved server-side by motion presets.
export type MotionClip = {
  entrance: LayerT["entrance"];
  entrance2?: LayerT["entrance2"];
  entrance3?: LayerT["entrance3"];
  delay: number;
  inDuration?: number;
  entranceEasing?: LayerT["entranceEasing"];
  entranceEasing2?: LayerT["entranceEasing2"];
  entranceEasing3?: LayerT["entranceEasing3"];
  exit?: LayerT["exit"];
  exit2?: LayerT["exit2"];
  exit3?: LayerT["exit3"];
  outDuration?: number;
  exitEasing?: LayerT["exitEasing"];
  exitEasing2?: LayerT["exitEasing2"];
  exitEasing3?: LayerT["exitEasing3"];
  // Text style — never the `text` content itself.
  fontFamily?: LayerT["fontFamily"];
  fontFile?: LayerT["fontFile"];
  fontSize?: LayerT["fontSize"];
  textColor?: LayerT["textColor"];
  textAlign?: LayerT["textAlign"];
  direction?: LayerT["direction"];
  letterSpacing?: LayerT["letterSpacing"];
  lineHeight?: LayerT["lineHeight"];
  uppercase?: LayerT["uppercase"];
  // Photo/video crop + in-frame motion.
  fit?: LayerT["fit"];
  photoMotion?: LayerT["photoMotion"];
  photoPanX?: LayerT["photoPanX"];
  photoPanY?: LayerT["photoPanY"];
  photoZoom?: LayerT["photoZoom"];
  // Shape fill/stroke.
  shapeType?: LayerT["shapeType"];
  shapeFill?: LayerT["shapeFill"];
  shapeCornerRadius?: LayerT["shapeCornerRadius"];
  shapeStrokeColor?: LayerT["shapeStrokeColor"];
  shapeStrokeWidth?: LayerT["shapeStrokeWidth"];
};

function clipFromLayer(l: LayerT): MotionClip {
  return {
    entrance: l.entrance, entrance2: l.entrance2, entrance3: l.entrance3,
    delay: l.delay, inDuration: l.inDuration, entranceEasing: l.entranceEasing,
    entranceEasing2: l.entranceEasing2, entranceEasing3: l.entranceEasing3,
    exit: l.exit, exit2: l.exit2, exit3: l.exit3,
    outDuration: l.outDuration, exitEasing: l.exitEasing,
    exitEasing2: l.exitEasing2, exitEasing3: l.exitEasing3,
    fontFamily: l.fontFamily, fontFile: l.fontFile, fontSize: l.fontSize,
    textColor: l.textColor, textAlign: l.textAlign, direction: l.direction,
    letterSpacing: l.letterSpacing, lineHeight: l.lineHeight, uppercase: l.uppercase,
    fit: l.fit, photoMotion: l.photoMotion,
    photoPanX: l.photoPanX, photoPanY: l.photoPanY, photoZoom: l.photoZoom,
    shapeType: l.shapeType, shapeFill: l.shapeFill, shapeCornerRadius: l.shapeCornerRadius,
    shapeStrokeColor: l.shapeStrokeColor, shapeStrokeWidth: l.shapeStrokeWidth,
  };
}

function applyClip(l: LayerT, clip: MotionClip) {
  l.entrance = clip.entrance;
  l.entrance2 = clip.entrance2;
  l.entrance3 = clip.entrance3;
  l.delay = clip.delay;
  l.inDuration = clip.inDuration;
  l.entranceEasing = clip.entranceEasing;
  l.entranceEasing2 = clip.entranceEasing2;
  l.entranceEasing3 = clip.entranceEasing3;
  l.exit = clip.exit;
  l.exit2 = clip.exit2;
  l.exit3 = clip.exit3;
  l.outDuration = clip.outDuration;
  l.exitEasing = clip.exitEasing;
  l.exitEasing2 = clip.exitEasing2;
  l.exitEasing3 = clip.exitEasing3;
  // Style — skipped entirely for a field the clip never set (undefined),
  // so pasting an older clip that predates these fields is a no-op for them
  // instead of wiping the target layer's existing style back to defaults.
  if (clip.fontFamily !== undefined) l.fontFamily = clip.fontFamily;
  if (clip.fontFile !== undefined) l.fontFile = clip.fontFile;
  if (clip.fontSize !== undefined) l.fontSize = clip.fontSize;
  if (clip.textColor !== undefined) l.textColor = clip.textColor;
  if (clip.textAlign !== undefined) l.textAlign = clip.textAlign;
  if (clip.direction !== undefined) l.direction = clip.direction;
  if (clip.letterSpacing !== undefined) l.letterSpacing = clip.letterSpacing;
  if (clip.lineHeight !== undefined) l.lineHeight = clip.lineHeight;
  if (clip.uppercase !== undefined) l.uppercase = clip.uppercase;
  if (clip.fit !== undefined) l.fit = clip.fit;
  if (clip.photoMotion !== undefined) l.photoMotion = clip.photoMotion;
  if (clip.photoPanX !== undefined) l.photoPanX = clip.photoPanX;
  if (clip.photoPanY !== undefined) l.photoPanY = clip.photoPanY;
  if (clip.photoZoom !== undefined) l.photoZoom = clip.photoZoom;
  if (clip.shapeType !== undefined) l.shapeType = clip.shapeType;
  if (clip.shapeFill !== undefined) l.shapeFill = clip.shapeFill;
  if (clip.shapeCornerRadius !== undefined) l.shapeCornerRadius = clip.shapeCornerRadius;
  if (clip.shapeStrokeColor !== undefined) l.shapeStrokeColor = clip.shapeStrokeColor;
  if (clip.shapeStrokeWidth !== undefined) l.shapeStrokeWidth = clip.shapeStrokeWidth;
}

// Small inline icon set for the icon-only alignment/direction controls below
// — plain SVG (not emoji) so each stays crisp at any size and themes via
// currentColor, same as the button text/active color around it.

// Paragraph-style: 3 bars mimicking actual aligned text — this is TEXT
// alignment (CSS text-align inside the box), not the box's own position.
const AlignTextIcon: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => {
  const bars =
    align === "left" ? [{ x: 1, w: 13 }, { x: 1, w: 8 }, { x: 1, w: 11 }] :
    align === "right" ? [{ x: 1, w: 13 }, { x: 6, w: 8 }, { x: 3, w: 11 }] :
    [{ x: 1, w: 13 }, { x: 3.5, w: 8 }, { x: 2, w: 11 }];
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      {bars.map((b, i) => <rect key={i} x={b.x} y={2 + i * 4.5} width={b.w} height={1.6} rx={0.6} fill="currentColor" />)}
    </svg>
  );
};

// Illustrator-style "align to artboard": a dashed guide at the target edge
// plus a small box snapped to it — this is the BOX's position on the frame,
// deliberately drawn nothing like AlignTextIcon so the two are never
// mistaken for each other.
const AlignBoxIcon: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => {
  const guideX = align === "left" ? 1.5 : align === "right" ? 13.5 : 7.5;
  const boxX = align === "left" ? 1.5 : align === "right" ? 6.5 : 4;
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <line x1={guideX} y1="1" x2={guideX} y2="14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6,1.4" opacity="0.6" />
      <rect x={boxX} y="4.5" width="7" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" rx="0.5" />
    </svg>
  );
};

// Same idea, rotated: guide runs horizontally at the top/middle/bottom edge
// instead of vertically at left/center/right.
const AlignBoxIconV: React.FC<{ align: "top" | "middle" | "bottom" }> = ({ align }) => {
  const guideY = align === "top" ? 1.5 : align === "bottom" ? 13.5 : 7.5;
  const boxY = align === "top" ? 1.5 : align === "bottom" ? 6.5 : 4;
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <line x1="1" y1={guideY} x2="14" y2={guideY} stroke="currentColor" strokeWidth="1" strokeDasharray="1.6,1.4" opacity="0.6" />
      <rect x="4.5" y={boxY} width="6" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" rx="0.5" />
    </svg>
  );
};

// Snaps a layer's box to the canvas edges/center (like Illustrator's
// align-to-artboard) — a one-off action, not a stored state, so no button
// stays "pressed". Originally text-only; factored out so photo and shape
// layers can use the exact same control (they'd had no align-to-canvas
// tool at all — a real gap a user hit for real: "after uploading a
// picture we have no alignment tools for pictures").
const BoxAlignRow: React.FC<{
  canvas: [number, number];
  width: number;
  height: number;
  onChange: (fn: (l: LayerT) => void) => void;
}> = ({ canvas, width, height, onChange }) => (
  <div className="mini" style={{ marginTop: 10 }}>
    <label title="Snaps this box to the frame — not the same as any in-box alignment">Box align</label>
    <div className="row" style={{ gap: 6 }}>
      {(["left", "center", "right"] as const).map((a) => (
        <button key={a} className="btn small icon"
          title={`Align box to the ${a} of the frame`} aria-label={`Align box to the ${a} of the frame`}
          onClick={() => onChange((l) => {
            l.left = a === "left" ? 0 : a === "right" ? canvas[0] - width : Math.round((canvas[0] - width) / 2);
          })}>
          <AlignBoxIcon align={a} />
        </button>
      ))}
      {(["top", "middle", "bottom"] as const).map((a) => (
        <button key={a} className="btn small icon"
          title={`Align box to the ${a} of the frame`} aria-label={`Align box to the ${a} of the frame`}
          onClick={() => onChange((l) => {
            l.top = a === "top" ? 0 : a === "bottom" ? canvas[1] - height : Math.round((canvas[1] - height) / 2);
          })}>
          <AlignBoxIconV align={a} />
        </button>
      ))}
    </div>
  </div>
);

// RTL is just the LTR glyph mirrored — same bars/arrow, flipped, so the pair
// reads as one flow-direction control rather than two unrelated icons.
const DirectionIcon: React.FC<{ dir: "ltr" | "rtl" }> = ({ dir }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"
    style={dir === "rtl" ? { transform: "scaleX(-1)" } : undefined}>
    <rect x="1" y="3" width="9" height="1.6" rx="0.6" fill="currentColor" />
    <rect x="1" y="10" width="6" height="1.6" rx="0.6" fill="currentColor" />
    <path d="M10 10.8 H14 M12 8.8 L14 10.8 L12 12.8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// A big cap + small cap, side by side — the standard "toggle all-caps" glyph
// (same idea Google Docs/Word use), rendered as real SVG text rather than
// hand-drawn letterform paths since a literal "Aa" reads unambiguously at
// this size where a path approximation wouldn't.
const UppercaseIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <text x="7.5" y="11.3" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Arial, sans-serif" fill="currentColor">Aa</text>
  </svg>
);

// Preview-overlay toggles (safe zone / Instagram UI mockup) — a crop-guide
// corner-bracket glyph and a heart (echoing the IG overlay's own like icon),
// same 15x15/currentColor convention as the icons above.
const SafeZoneToggleIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M1.5 4.5v-3h3M13.5 4.5v-3h-3M1.5 10.5v3h3M13.5 10.5v3h-3" />
  </svg>
);
const InstagramUiToggleIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 12.5c-.13 0-.27-.03-.38-.11C4.4 10.8 1.5 8.7 1.5 5.9 1.5 3.9 3 2.5 4.9 2.5c1 0 1.9.5 2.6 1.3.7-.8 1.6-1.3 2.6-1.3 1.9 0 3.4 1.4 3.4 3.4 0 2.8-2.9 4.9-5.62 6.49-.11.08-.25.11-.38.11z" />
  </svg>
);
// Ruler guides toggle — a dashed crosshair, echoing the guide LINES
// themselves (also on-canvas), distinct at a glance from SafeZone's solid
// corner brackets and Instagram's filled heart.
const GuidesToggleIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M7.5 1v13" strokeDasharray="2 2" />
    <path d="M1 7.5h13" strokeDasharray="2 2" />
  </svg>
);
// Fullscreen toggle — diagonal arrows pointing to opposite corners (enter)
// vs. the same two arrows pointing back toward center (exit). Was corner
// brackets, same "state changes the glyph" convention as SoundOnIcon/
// SoundOffIcon below, but that path is IDENTICAL to SafeZoneToggleIcon's own
// — the two buttons now sit right next to each other in the merged
// transport row and read as the same icon. Arrows instead of brackets keeps
// them visually distinct at a glance.
const FullscreenEnterIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 7L12 3M9 3H12V6M7 8L3 12M3 9V12H6" />
  </svg>
);
const FullscreenExitIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3L8 7M11 7H8V4M3 12L7 8M4 8H7V11" />
  </svg>
);
// A video's own Sound toggle — same speaker glyph either way, sound-wave
// arcs swapped for a slash through it when muted, so the two states read
// as clearly opposite at a glance, not just a color change.
const SoundOnIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 5.8h2.2L7 3v9L3.7 9.2H1.5z" />
    <path d="M9.3 5.5c1.1 1 1.1 3 0 4M11.3 4c2 2 2 6 0 8" />
  </svg>
);
const SoundOffIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 5.8h2.2L7 3v9L3.7 9.2H1.5z" />
    <path d="M9.3 5v4.2M12.3 5v4.2" strokeLinecap="round" transform="rotate(45 10.8 7.1)" />
  </svg>
);

// Global asset tiles (Background/Title/Logo/Audio) — same 15x15/currentColor
// thin-outline convention as every other icon in the app, one silhouette
// per asset type so the 2x2 grid reads at a glance without the text label.
const BgTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1" y="2.5" width="13" height="10" rx="1.2" />
    <circle cx="5" cy="6" r="1.3" />
    <path d="M14 9.5L10 6L6.5 9L5 7.8L1 11.5" strokeLinejoin="round" />
  </svg>
);
const TitleTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M2 4h11M2 7.5h8M2 11h5" />
  </svg>
);
const LogoTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M7.5 1.5L13 4.7V10.3L7.5 13.5L2 10.3V4.7Z" />
    <path d="M7.5 1.5V13.5M2 4.7L13 10.3M13 4.7L2 10.3" />
  </svg>
);
const AudioTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M1.5 7.5h1.8L5 3.5v8L7.2 7.5H15" />
  </svg>
);

// BG style's 4 categories + Loader — same tile-icon convention, one
// silhouette per category.
const TextureTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="currentColor">
    <circle cx="3" cy="3.5" r="0.9" /><circle cx="8" cy="2.5" r="0.9" /><circle cx="12.5" cy="4" r="0.9" />
    <circle cx="5.5" cy="7" r="0.9" /><circle cx="11" cy="8" r="0.9" /><circle cx="2" cy="9.5" r="0.9" />
    <circle cx="7.5" cy="11.5" r="0.9" /><circle cx="13" cy="12" r="0.9" />
  </svg>
);
const ColorTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="5.5" cy="7.5" r="4" /><circle cx="9.5" cy="7.5" r="4" />
  </svg>
);
const GradeTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="1" y="1" width="13" height="13" rx="2" />
    <circle cx="7.5" cy="7.5" r="2.6" />
  </svg>
);
const MotionTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M1.5 4.5h6M1.5 7.5h9M1.5 10.5h5" />
    <circle cx="12.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
const LoaderTileIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1" y="6.5" width="13" height="2" rx="1" />
    <rect x="1" y="6.5" width="7" height="2" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

// Rail icon for the Layers dock — three stacked planes, the standard
// layers glyph (Figma/Photoshop), same 15x15/currentColor convention.
const RailLayersIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M7.5 1.5L13.5 4.7L7.5 7.9L1.5 4.7Z" />
    <path d="M1.5 8.3L7.5 11.5L13.5 8.3" />
    <path d="M1.5 11.6L7.5 14.5L13.5 11.6" />
  </svg>
);

// "Add sequence" vs "Add page" — the split is where the content comes from
// (imported/pre-designed vs. built here), not what it looks like when
// you're done, so the icons lean into that: a stack for "already-made
// pages coming in," a single page + a "+" for "one empty page, build it
// here." fill uses --panel2 directly (not currentColor) so the back
// rect's overlap with the front one reads as a real stack, not a solid
// blob — safe since every plain .btn shares that same background.
const SequenceIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <rect x="4.5" y="1" width="9" height="10.5" rx="1.2" fill="var(--panel2, #1c2126)" stroke="currentColor" strokeWidth="1.3" />
    <rect x="1.5" y="3.5" width="9" height="10.5" rx="1.2" fill="var(--panel2, #1c2126)" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
const PageIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <rect x="2" y="1.5" width="11" height="12" rx="1.4" />
    <path d="M7.5 6.2v3.6M5.7 8h3.6" />
  </svg>
);
const TemplateIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="1.5" width="12" height="12" rx="1.4" />
    <path d="M1.5 6.2h12M6 6.2v7.3" />
  </svg>
);

// Add-element toolbar (Text/Photo/Shape) — same 15x15/currentColor thin-
// outline convention as every other icon in the app. Text uses a plain "T"
// glyph (the universal text-tool convention in Figma/Canva/PowerPoint,
// distinct in meaning from ContentIcon's "document" — a whole panel — used
// elsewhere); Photo is the standard frame+sun+mountain "image" glyph.
const TextToolIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2.5 3.2h10M7.5 3.2v8.6" />
  </svg>
);
const PhotoToolIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="2.5" width="12" height="10" rx="1.4" />
    <circle cx="5.2" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <path d="M2.2 10.8 6 7l2 2 2.3-2.3 2.5 2.5" />
  </svg>
);
const ShapeToolIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="1.8" y="1.8" width="11.4" height="11.4" rx="2" />
  </svg>
);

// The element panel's rail (Content/Effects/Keyframes) — thin outline glyphs,
// same 15x15/currentColor convention as the align/direction icons above, kept
// visually distinct from those (this rail picks a whole SECTION, not a
// one-off alignment) so the two icon families are never confused at a glance.
const ContentIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <rect x="2" y="1.5" width="11" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <line x1="4.3" y1="5" x2="10.7" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="4.3" y1="7.5" x2="10.7" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="4.3" y1="10" x2="8.3" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const EffectsIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <path d="M7.5 1.5 L8.7 6.3 L13.5 7.5 L8.7 8.7 L7.5 13.5 L6.3 8.7 L1.5 7.5 L6.3 6.3 Z"
      fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
const KeyframesIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
    <rect x="4.5" y="4.5" width="6" height="6" rx="1" transform="rotate(45 7.5 7.5)"
      fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

// Up to 3 combined effects on one IN or OUT direction — FX1 is always shown,
// a "+" reveals FX2 then FX3 (capped there), each removable with its own ✕
// (removing one also clears anything after it, so there's never a gap).
// values/onChange/onAdd/onRemove all address slots by 0/1/2 (FX1/FX2/FX3).
// Each combined FX slot is a full row — effect AND its own easing,
// independent of every other slot — so "FX1 lands hard (easeOutBack), FX2
// settles slow (easeOutExpo)" is just two different dropdowns, not one
// shared curve fighting two different effects.
const FxSlots: React.FC<{
  label: string;
  hint?: string; // tooltip on the label — detail that doesn't need to sit in the visible text
  categories: { label: string; names: string[] }[];
  values: [string, string | undefined, string | undefined];
  easings: [string | undefined, string | undefined, string | undefined];
  onChangeSlot: (index: 0 | 1 | 2, value: string) => void;
  onChangeEasing: (index: 0 | 1 | 2, value: string | undefined) => void;
  onAdd: () => void;
  onRemove: (index: 1 | 2) => void;
  disabled?: boolean;
}> = ({ label, hint, categories, values, easings, onChangeSlot, onChangeEasing, onAdd, onRemove, disabled }) => {
  const shown = values[2] !== undefined ? 3 : values[1] !== undefined ? 2 : 1;
  return (
    <div className="mini fx-slots">
      <label title={hint}>{label}</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {([0, 1, 2] as const).slice(0, shown).map((i) => (
          <div key={i} className="row" style={{ gap: 5, alignItems: "center" }}>
            <span className="tag" style={{ padding: "2px 5px", flexShrink: 0 }}>FX{i + 1}</span>
            {/* `disabled` means "can't combine more effects yet" (e.g. OUT's
                FX1 is still "none") — it must never lock FX1 itself, or
                there'd be no way to ever set it away from "none" at all. */}
            <select value={values[i]} disabled={i > 0 && disabled} style={{ flex: "1.3 1 0" }}
              onChange={(e) => onChangeSlot(i, e.target.value)}>
              {/* "none" sits outside every group — an escape hatch, not a
                  motion family member — so it's the one bare <option>. */}
              <option value="none">none</option>
              {categories.map((cat) => (
                <optgroup key={cat.label} label={cat.label}>
                  {cat.names.map((o) => <option key={o} value={o}>{o}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={easings[i] ?? ""} disabled={disabled || values[i] === "none"} style={{ flex: "1 1 0" }}
              title="This slot's own easing — auto = a curve chosen to fit its effect"
              onChange={(e) => onChangeEasing(i, e.target.value === "" ? undefined : e.target.value)}>
              <option value="">(auto)</option>
              {EASINGS.map((en) => <option key={en} value={en}>{en}</option>)}
            </select>
            {i > 0 && (
              <button className="btn small" title={`Remove FX${i + 1}`} aria-label={`Remove FX${i + 1} effect`} disabled={disabled}
                onClick={() => onRemove(i as 1 | 2)}>✕</button>
            )}
          </div>
        ))}
        {shown < 3 && (
          <button className="btn small" title="Combine another effect" aria-label="Combine another effect" disabled={disabled} onClick={onAdd}>＋ Add FX{shown + 1}</button>
        )}
      </div>
    </div>
  );
};

// Quick-pick timings alongside "Auto" and an exact custom value — before
// this, in/out duration only had a raw number field with no way back to
// "auto" once touched at all (the easing pickers already had a working
// "(auto)" option; these two fields never did).
const DURATION_PRESETS: { label: string; frames: number }[] = [
  { label: "Fast (0.3s)", frames: 9 },
  { label: "Normal (0.6s)", frames: 18 },
  { label: "Slow (1.2s)", frames: 36 },
];

const DurationPresetField: React.FC<{
  value: number | undefined;
  fallback: number; // frames used when value is unset ("auto") — matches the app's own built-in default
  disabled?: boolean;
  onChange: (frames: number | undefined) => void;
}> = ({ value, fallback, disabled, onChange }) => {
  const matched = DURATION_PRESETS.find((p) => p.frames === value);
  const selectValue = value === undefined ? "auto" : matched ? String(matched.frames) : "custom";
  const secVal = +(((value ?? fallback) / 30)).toFixed(2);
  return (
    <div className="row" style={{ gap: 4 }}>
      <select value={selectValue} disabled={disabled} style={{ flex: 1 }}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") onChange(undefined);
          else if (v !== "custom") onChange(Number(v));
        }}>
        <option value="auto">Auto</option>
        {DURATION_PRESETS.map((p) => <option key={p.frames} value={p.frames}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {/* The 1-frame floor here (not 1 second — this converts typed seconds
          to frames first) is load-bearing: spring() throws outright at
          durationInFrames 0, so this can't be deferred to blur the way
          fontSize's floor was — it has to stay live per-keystroke, the same
          as it always has, so a value never mid-type reaches 0 frames. */}
      <NumField step={0.1} min={0.1} value={secVal} disabled={disabled} style={{ width: 64 }}
        onChange={(e) => onChange(Math.max(1, Math.round(parseFloat(e.target.value || "0") * 30)))} />
    </div>
  );
};

// Layer grouping — a small fixed palette of 5 colors, not arbitrary named
// groups any more (see ContentLayer.groupId's own comment in types.ts). A
// layer joins a group by clicking its dot; any two layers sharing a color's
// id move together (position only) when either is dragged on the canvas —
// that move-together logic already keyed off groupId equality before this,
// so it's untouched, only the picker UI changed. One dot lit at a time per
// layer: clicking the SAME lit dot again ungroups it, clicking a different
// one switches groups outright (a layer belongs to at most one group).
const GROUP_COLORS: { id: string; color: string; label: string }[] = [
  { id: "g1", color: "#e0575b", label: "Red" },
  { id: "g2", color: "#4a90d9", label: "Blue" },
  { id: "g3", color: "#4caf7d", label: "Green" },
  { id: "g4", color: "#e0a13a", label: "Orange" },
  { id: "g5", color: "#9b6fd1", label: "Purple" },
];

const GroupChips: React.FC<{ value?: string; onChange: (id: string | undefined) => void }> = ({ value, onChange }) => (
  <div className="group-chips" onClick={(e) => e.stopPropagation()}>
    {GROUP_COLORS.map((g) => (
      <button key={g.id} type="button"
        className={"group-chip" + (value === g.id ? " active" : "")}
        style={{ background: g.color }}
        title={value === g.id ? `${g.label} group — click to remove this layer` : `Group with other layers on ${g.label}`}
        onClick={() => onChange(value === g.id ? undefined : g.id)}
      />
    ))}
  </div>
);

const ElementMotion: React.FC<{
  layer: LayerT;
  clip: MotionClip | null;
  onCopy: (clip: MotionClip) => void;
  onChange: (fn: (l: LayerT) => void) => void;
  onUploadPhoto?: (file: File) => void;
  onUploadShapePhoto?: (file: File) => void;
  onRemoveShapePhoto?: () => void;
  fonts?: FontEntry[];
  onSelectFont?: (entry: FontEntry | null) => void;
  onDelete: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  swatches?: string[];
  onAddSwatch?: (hex: string) => void;
  onRemoveSwatch?: (hex: string) => void;
  brandColors?: string[];
  motionPresets?: MotionPresetEntry[];
  onSaveMotionPreset?: (name: string, clip: MotionClip) => void;
  onDeleteMotionPreset?: (id: string) => void;
  canvas: [number, number];
  // Page length (frames) — the Keyframes tab's "Keyframes" mode needs this
  // to size its timeline; the "Simple" fields above it don't.
  pageDuration: number;
  // True for exactly the one layer the text tool just placed — focuses its
  // textarea once, on mount, so placing text and typing is one continuous
  // motion instead of place-then-hunt-for-the-field.
  autoFocus?: boolean;
  // The layer (by l.index) selected via a canvas click, whatever it is right
  // now — not just whether THIS layer is it. Every ElementMotion watches the
  // same value so a click on any one of them can expand itself AND collapse
  // every sibling in the same pass; before the first canvas click this stays
  // null, so manual expand/collapse from before this feature existed is
  // left alone.
  selectedLayerIndex?: number | null;
  // "Expand all"/"Collapse all" (PageInspector's header button) — bumping
  // bulkExpandToken is the actual signal (see the effect below, which skips
  // its own first run so this never fights a freshly-placed layer's
  // autoFocus by force-collapsing it the instant it mounts); bulkExpanded
  // is just which direction that bump means.
  bulkExpanded?: boolean;
  bulkExpandToken?: number;
}> = ({ layer, clip, onCopy, onChange, onUploadPhoto, onUploadShapePhoto, onRemoveShapePhoto, fonts, onSelectFont, onDelete, onMove, canMoveUp, canMoveDown, swatches, onAddSwatch, onRemoveSwatch, brandColors, motionPresets, onSaveMotionPreset, onDeleteMotionPreset, canvas, pageDuration, autoFocus, selectedLayerIndex, bulkExpanded, bulkExpandToken }) => {
  const sec = (frames?: number, dflt = 0) => +(((frames ?? dflt) / 30)).toFixed(2);
  const toFr = (s: string) => Math.max(0, Math.round(parseFloat(s || "0") * 30));
  const photoInput = React.useRef<HTMLInputElement>(null);
  const shapePhotoInput = React.useRef<HTMLInputElement>(null);
  const textContentRef = React.useRef<HTMLTextAreaElement>(null);
  // Runs once, on mount — a freshly-placed text layer is a genuinely new
  // ElementMotion instance (key={l.index}), so this never re-fires later
  // and never steals focus from unrelated edits.
  React.useEffect(() => {
    if (autoFocus) textContentRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [savingPreset, setSavingPreset] = React.useState(false);
  const [presetName, setPresetName] = React.useState("");
  const commitSavePreset = () => {
    const name = presetName.trim();
    if (!name || !onSaveMotionPreset) return;
    onSaveMotionPreset(name, clipFromLayer(layer));
    setSavingPreset(false);
    setPresetName("");
  };
  // Collapsed by default is a trap (fields silently hidden on load, easy to
  // think they vanished) — starts expanded, same as before this existed;
  // collapsing is something the user opts into per layer.
  const [expanded, setExpanded] = React.useState(true);
  const cardRef = React.useRef<HTMLDivElement>(null);
  // Clicking a layer's handle on the canvas focuses it here: this one opens
  // (even if the user had collapsed it) and scrolls into view, every OTHER
  // layer's card on the page collapses. Skipped entirely until the first
  // real selection (selectedLayerIndex still null) so loading a page with
  // everything expanded — today's existing default — isn't disturbed.
  React.useEffect(() => {
    if (selectedLayerIndex == null) return;
    const isMe = layer.index === selectedLayerIndex;
    setExpanded(isMe);
    if (isMe) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerIndex]);
  // "Expand all"/"Collapse all" — ignores whatever bulkExpandToken already
  // was AT MOUNT (captured once, below), only acting once it changes to
  // something NEWER than that. Otherwise a freshly-placed layer (autoFocus)
  // would mount already-collapsed whenever the dock's last bulk click
  // happened to be "Collapse all," hiding the very textarea autoFocus is
  // about to focus.
  //
  // This has to be a VALUE comparison, not a "ran once" ref flag — tried
  // that first, and it broke under React.StrictMode: mount effects run
  // twice in dev (setup → cleanup → setup) specifically to catch
  // non-idempotent effects, and a boolean flag flipped inside the effect
  // body with no cleanup to undo it is exactly that — the first (throwaway)
  // pass silently consumed the "skip," so the second (real) pass no longer
  // skipped and force-collapsed the brand-new card for real. Comparing
  // against a captured baseline is naturally idempotent instead: running
  // the same check twice with the same inputs is a no-op both times.
  const expandTokenAtMount = React.useRef(bulkExpandToken);
  React.useEffect(() => {
    if (bulkExpandToken === expandTokenAtMount.current) return;
    expandTokenAtMount.current = bulkExpandToken;
    if (bulkExpandToken !== undefined) setExpanded(!!bulkExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkExpandToken]);
  // Which of Content/Effects/Keyframes this layer's own panel is showing —
  // used to be all three stacked and expanded together (a wall of fields per
  // layer); now one rail, one pane at a time, so a layer with a lot set
  // doesn't turn into a scroll marathon.
  const [panel, setPanel] = React.useState<"content" | "effects" | "keyframes">("content");
  const [managingPresets, setManagingPresets] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState(layer.name ?? "");
  const commitRename = () => {
    setRenaming(false);
    const trimmed = draftName.trim();
    if (trimmed !== (layer.name ?? "")) onChange((l) => { l.name = trimmed || undefined; });
  };
  const isPhotoSlot = layer.role === "photo";
  const isTextLayer = layer.assetKind === "text";
  const isShapeLayer = layer.assetKind === "shape";
  // A text layer's box is ALWAYS exactly the size of its own rendered
  // text — no manual resize (the canvas resize grip is hidden for text,
  // see canvasHandles' `resizable` flag in the Editor). Re-measures
  // whenever anything that actually affects the text's rendered SIZE
  // changes; text-align/box-align/color/etc. don't change size so aren't
  // in the dependency list.
  React.useEffect(() => {
    if (!isTextLayer) return;
    let cancelled = false;
    (async () => {
      // A just-picked custom font may still be loading — measuring
      // against its fallback would size the box wrong for a moment and
      // never self-correct once the real font actually finishes (nothing
      // else re-triggers this effect on its own). document.fonts is one
      // browser-wide registry, already shared with whatever the live
      // Player preview loaded via its own useLayerFont — no separate
      // font-loading logic needed here, just wait on the same registry.
      try { await document.fonts.ready; } catch { /* best-effort */ }
      if (cancelled) return;
      const { width, height } = measureTextBox({
        text: layer.text,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        uppercase: layer.uppercase,
        direction: layer.direction,
      });
      if (width !== layer.width || height !== layer.height) {
        onChange((l) => { l.width = width; l.height = height; });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTextLayer, layer.text, layer.fontFamily, layer.fontSize, layer.lineHeight, layer.letterSpacing, layer.uppercase, layer.direction, layer.fontFile]);
  // Simple (4 number fields) vs Keyframes (one draggable row per FX) — a
  // pure display choice, not stored data; always starts on Simple, same as
  // this whole component remounting (key={l.index}) on every layer switch.
  const [kfView, setKfView] = React.useState(false);
  // letterPopIn splits into per-character DOM nodes — only offered when
  // this text layer's own direction is already "ltr", never for Farsi/
  // Arabic content (splitting individual letters breaks cursive joining;
  // see the isLetterPop render-side gate in PageScene.tsx, which double-
  // checks the same thing so a stray saved "letterPopIn" on rtl text can
  // never actually render split).
  const inCategories = isTextLayer
    ? [
        ...ENTRANCE_CATEGORIES,
        { label: "Text reveal", names: layer.direction === "ltr" ? [...TEXT_ENTRANCE_NAMES, ...LATIN_TEXT_ENTRANCE_NAMES] : TEXT_ENTRANCE_NAMES },
      ]
    : ENTRANCE_CATEGORIES;
  const outCategories = isTextLayer
    ? [...EXIT_CATEGORIES, { label: "Text reveal", names: TEXT_EXIT_NAMES }]
    : EXIT_CATEGORIES;

  // Group the shared library by family name, for the two-step Font -> Style pickers.
  const families = React.useMemo(() => {
    const byFamily = new Map<string, FontEntry[]>();
    (fonts ?? []).forEach((f) => {
      if (!byFamily.has(f.family)) byFamily.set(f.family, []);
      byFamily.get(f.family)!.push(f);
    });
    return byFamily;
  }, [fonts]);
  const currentEntry = (fonts ?? []).find((f) => f.cssFamily === layer.fontFamily) ?? null;
  const currentFamilyVariants = currentEntry ? families.get(currentEntry.family) ?? [] : [];

  return (
    <div className="card compact" ref={cardRef}>
      <div className={"row between collapsible-header" + (expanded ? " expanded" : "")}
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Click to collapse" : "Click to expand"}
        role="button" tabIndex={0} aria-expanded={expanded}
        aria-label={`${layer.name || layer.role} layer, ${expanded ? "expanded" : "collapsed"}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); }
        }}>
        <span className="lname" style={{ minWidth: 0, overflow: "hidden" }}>
          <span className="chevron">▸</span>
          {renaming ? (
            <input
              className="lname-input"
              autoFocus
              value={draftName}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setDraftName(layer.name ?? ""); setRenaming(false); }
              }}
            />
          ) : (
            <span title={(layer.name || layer.role) + " — double-click to rename"}
              onDoubleClick={(e) => { e.stopPropagation(); setDraftName(layer.name ?? ""); setRenaming(true); }}>
              {layer.name ? layer.name : layer.role} <span className="tag">({layer.role})</span>
            </span>
          )}
        </span>
        <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn small" title="Bring forward (on top of the layer above)"
            disabled={!canMoveUp} onClick={() => onMove?.(1)}>↑</button>
          <button className="btn small" title="Send backward (behind the layer below)"
            disabled={!canMoveDown} onClick={() => onMove?.(-1)}>↓</button>
          <button className="btn small" title="Copy this element's motion + style (not its text)"
            onClick={() => onCopy(clipFromLayer(layer))}>Copy</button>
          <button className="btn small" title="Paste copied motion + style onto this element (its text is untouched)"
            disabled={!clip} onClick={() => clip && onChange((l) => applyClip(l, clip))}>Paste</button>
          <button className="btn small" title="Delete this layer" onClick={onDelete}>✕</button>
        </div>
      </div>

      {/* Group dots — always visible (collapsed or expanded), not buried
          behind expanding the layer, so grouping stays a one-click action.
          See GroupChips/GROUP_COLORS above. */}
      <div className="row" style={{ gap: 6, alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--line)" }}>
        <span className="hint" style={{ margin: 0, flexShrink: 0 }}>Group</span>
        <GroupChips value={layer.groupId} onChange={(id) => onChange((l) => { l.groupId = id; })} />
      </div>

      {!expanded && (
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {layer.entrance !== "none" || (layer.exit && layer.exit !== "none")
            ? `${layer.entrance}${layer.exit && layer.exit !== "none" ? ` → ${layer.exit}` : ""}`
            : "no motion set"}
        </p>
      )}

      {expanded && (
      <>
      <div className="el-body">
        <div className="el-rail">
          <button className={"el-rail-btn" + (panel === "content" ? " active" : "")}
            title="Content" aria-label="Content" aria-pressed={panel === "content"}
            onClick={() => setPanel("content")}>
            <ContentIcon /><span>Content</span>
          </button>
          <button className={"el-rail-btn" + (panel === "effects" ? " active" : "")}
            title="Effects" aria-label="Effects" aria-pressed={panel === "effects"}
            onClick={() => setPanel("effects")}>
            <EffectsIcon /><span>Effects</span>
          </button>
          <button className={"el-rail-btn" + (panel === "keyframes" ? " active" : "")}
            title="Keyframes" aria-label="Keyframes" aria-pressed={panel === "keyframes"}
            onClick={() => setPanel("keyframes")}>
            <KeyframesIcon /><span>Keys</span>
          </button>
        </div>
        <div className="el-pane">
        {panel === "content" && (
        <>
        {!isPhotoSlot && !isShapeLayer && !isTextLayer && (
          <p className="hint" style={{ margin: 0 }}>No content settings for this layer type.</p>
        )}
        {isPhotoSlot && onUploadPhoto && (
        <div className="card compact group" style={{ marginTop: 8 }}>
          <div className="subhead">Photo</div>
          <button className={"btn upload small" + (layer.assetKind ? " filled" : "")} style={{ width: "100%" }}
            onClick={() => photoInput.current?.click()}>
            {layer.assetKind ? "Replace photo/video" : "Upload photo/video"}
          </button>
          <input ref={photoInput} className="hidden-file" type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.webm,.mov,.mp4"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ""; }} />
          {layer.assetKind && (
            <>
              <div className="row between mini" style={{ marginTop: 6 }}>
                <span style={{ color: "var(--muted)" }}>Zoom {(layer.photoZoom ?? 1).toFixed(2)}×</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn small" title="Zoom out — can shrink the photo smaller than its frame, revealing what's behind it"
                    onClick={() => onChange((l) => { l.photoZoom = Math.max(0.3, +((l.photoZoom ?? 1) - 0.1).toFixed(2)); })}>−</button>
                  <button className="btn small" title="Zoom in"
                    onClick={() => onChange((l) => { l.photoZoom = Math.min(3, +((l.photoZoom ?? 1) + 0.1).toFixed(2)); })}>＋</button>
                  <button className="btn small" title="Reset crop to centered"
                    onClick={() => onChange((l) => { l.photoZoom = 1; l.photoPanX = 50; l.photoPanY = 50; })}>Reset</button>
                </div>
              </div>
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }} title="Cover fills the frame (crops mismatched aspect ratios); contain shows the whole photo (may letterbox).">Fit</span>
                <select value={layer.fit ?? "cover"} style={{ width: "auto" }}
                  onChange={(e) => onChange((l) => { l.fit = e.target.value as any; })}>
                  <option value="cover">cover (fill, may crop)</option>
                  <option value="contain">contain (whole photo, may letterbox)</option>
                </select>
              </div>
            </>
          )}
          <div className="mini" style={{ marginTop: 4 }}>
            <label>Photo motion (inside the frame)</label>
            <select value={layer.photoMotion ?? "none"}
              onChange={(e) => onChange((l) => { l.photoMotion = e.target.value as any; })}>
              {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <BoxAlignRow canvas={canvas} width={layer.width} height={layer.height} onChange={onChange} />
        </div>
      )}

      {isShapeLayer && (() => {
        const shapeType = layer.shapeType ?? "rect";
        // "ellipse" isn't offered as a choice any more (circle covers round
        // shapes) — still treated as round here so a project saved before
        // this change doesn't suddenly render square corners on an existing
        // ellipse layer.
        const isRound = shapeType === "ellipse" || shapeType === "circle";
        const isLine = shapeType === "line";
        return (
        <div className="card compact group" style={{ marginTop: 8 }}>
          <div className="subhead">Shape</div>
          <div className="grid2 mini">
            <div><label>Type</label>
              <select value={shapeType}
                onChange={(e) => onChange((l) => {
                  const next = e.target.value as NonNullable<LayerT["shapeType"]>;
                  l.shapeType = next;
                  // Square/circle/line are a convenience, not just a label —
                  // snap the box to what the name promises right away instead
                  // of leaving it however it happened to be sized before.
                  if (next === "square" || next === "circle") {
                    const side = Math.min(l.width, l.height);
                    l.width = side; l.height = side;
                  } else if (next === "line") {
                    l.height = 6;
                  }
                })}>
                <option value="rect">Rectangle</option>
                <option value="square">Square</option>
                <option value="circle">Circle</option>
                <option value="line">Line</option>
              </select></div>
            {/* Corner radius doesn't mean anything on a line — that grid slot
                becomes Thickness instead, the actual control this shape type
                was missing (a line's "thickness" is just its own height, but
                there was no field for it — only a corner-drag resize, which
                fights the width at the same time). */}
            {isLine ? (
              <div><label title="How thick the line is, in pixels">Thickness</label>
                <NumField min={1} value={layer.height}
                  onChange={(e) => onChange((l) => { l.height = Math.round(parseFloat(e.target.value || "6")); })}
                  onBlur={() => onChange((l) => { l.height = Math.max(1, l.height ?? 6); })} /></div>
            ) : (
              <div><label>Corner radius</label>
                <NumField min={0} value={layer.shapeCornerRadius ?? 0}
                  disabled={isRound}
                  title={isRound ? "Already round — corner radius doesn't apply" : undefined}
                  onChange={(e) => onChange((l) => { l.shapeCornerRadius = Math.max(0, Math.round(parseFloat(e.target.value || "0"))); })} /></div>
            )}
          </div>
          <div className="grid2 mini" style={{ marginTop: 4 }}>
            <div><label title={layer.shapePhotoFile ? "Not shown while a photo mask is set below — remove it to use this again" : undefined}>Fill</label>
              <ColorField value={layer.shapeFill ?? "#000000"}
                onChange={(hex) => onChange((l) => { l.shapeFill = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandColors} /></div>
            <div><label title="How see-through the fill/stroke is — 100% is fully solid, the color you pick exactly">Opacity</label>
              <NumField min={0} max={100} value={Math.round((layer.opacity ?? 1) * 100)}
                onChange={(e) => onChange((l) => { l.opacity = Math.min(100, Math.max(0, Math.round(parseFloat(e.target.value || "100")))) / 100; })} /></div>
          </div>
          {/* Photo mask — an uploaded photo/video, clipped to this shape's
              own outline (corner radius / circle roundness) instead of the
              flat Fill above. Reuses the exact same Zoom/Fit crop controls a
              real photo layer has, since a shape carrying one is
              pan/zoom-croppable the same way (see PhotoPanHandles' filter). */}
          <div className="mini" style={{ marginTop: 4 }}>
            <label title="Clips an uploaded photo/video to this shape's outline instead of the flat Fill above">Photo mask</label>
            <div className="row" style={{ gap: 4 }}>
              <button className={"btn small" + (layer.shapePhotoFile ? " filled" : "")} style={{ flex: 1 }}
                onClick={() => shapePhotoInput.current?.click()}>
                {layer.shapePhotoFile ? "Replace photo" : "Upload photo"}
              </button>
              {layer.shapePhotoFile && (
                <button className="btn small" title="Remove — falls back to Fill above"
                  onClick={() => onRemoveShapePhoto?.()}>✕</button>
              )}
            </div>
            <input ref={shapePhotoInput} className="hidden-file" type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.webm,.mov,.mp4"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadShapePhoto?.(f); e.target.value = ""; }} />
            {layer.shapePhotoFile && (
              <>
                <div className="row between mini" style={{ marginTop: 6 }}>
                  <span style={{ color: "var(--muted)" }}>Zoom {(layer.photoZoom ?? 1).toFixed(2)}×</span>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn small" title="Zoom out — can shrink the photo smaller than its frame, revealing what's behind it"
                      onClick={() => onChange((l) => { l.photoZoom = Math.max(0.3, +((l.photoZoom ?? 1) - 0.1).toFixed(2)); })}>−</button>
                    <button className="btn small" title="Zoom in"
                      onClick={() => onChange((l) => { l.photoZoom = Math.min(3, +((l.photoZoom ?? 1) + 0.1).toFixed(2)); })}>＋</button>
                    <button className="btn small" title="Reset crop to centered"
                      onClick={() => onChange((l) => { l.photoZoom = 1; l.photoPanX = 50; l.photoPanY = 50; })}>Reset</button>
                  </div>
                </div>
                <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                  <span style={{ color: "var(--muted)" }} title="Cover fills the shape (crops mismatched aspect ratios); contain shows the whole photo (may letterbox).">Fit</span>
                  <select value={layer.fit ?? "cover"} style={{ width: "auto" }}
                    onChange={(e) => onChange((l) => { l.fit = e.target.value as any; })}>
                    <option value="cover">cover (fill, may crop)</option>
                    <option value="contain">contain (whole photo, may letterbox)</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div className="grid2 mini" style={{ marginTop: 4 }}>
            <div><label>Stroke width</label>
              <NumField min={0} value={layer.shapeStrokeWidth ?? 0}
                onChange={(e) => onChange((l) => { l.shapeStrokeWidth = Math.max(0, Math.round(parseFloat(e.target.value || "0"))); })} /></div>
            <div><label>Stroke color</label>
              <ColorField value={layer.shapeStrokeColor ?? "#000000"}
                onChange={(hex) => onChange((l) => { l.shapeStrokeColor = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandColors} /></div>
          </div>
          <div className="mini" style={{ marginTop: 4 }}>
            <label title="A continuous loop for as long as this layer is visible — independent of its In/Out effect above">Motion (while visible)</label>
            <select value={layer.photoMotion ?? "none"}
              onChange={(e) => onChange((l) => { l.photoMotion = e.target.value as any; })}>
              {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <BoxAlignRow canvas={canvas} width={layer.width} height={layer.height} onChange={onChange} />
        </div>
        );
      })()}

      {isTextLayer && (
        <div className="card compact group" style={{ marginTop: 8 }}>
          <div className="subhead">Text</div>
          <textarea ref={textContentRef} dir={layer.direction ?? "rtl"}
            placeholder={(layer.direction ?? "rtl") === "ltr" ? "Text…" : "متن فارسی…"}
            value={layer.text ?? ""}
            onChange={(e) => onChange((l) => { l.text = e.target.value; })} />
          <div className="grid2 mini" style={{ marginTop: 6 }}>
            <div><label>Font</label>
              <select value={currentEntry?.family ?? ""}
                onChange={(e) => {
                  const fam = e.target.value;
                  if (!fam) { onSelectFont?.(null); return; }
                  const first = families.get(fam)?.[0] ?? null;
                  onSelectFont?.(first);
                }}>
                <option value="">System default</option>
                {Array.from(families.keys()).map((fam) => <option key={fam} value={fam}>{fam}</option>)}
              </select></div>
            <div><label>Style</label>
              <select value={currentEntry?.id ?? ""} disabled={!currentEntry}
                onChange={(e) => {
                  const entry = currentFamilyVariants.find((v) => v.id === e.target.value) ?? null;
                  onSelectFont?.(entry);
                }}>
                {currentFamilyVariants.map((v) => <option key={v.id} value={v.id}>{v.style}</option>)}
              </select></div>
          </div>
          {/* Uploading a NEW font file lives only in the Dashboard's Font
              manager now (one place, not two) — this picks from whatever's
              already in that shared library, via Font/Style above. */}
          <div className="grid3 mini" style={{ marginTop: 6 }}>
            <div><label>Size</label>
              {/* Clamping to the min on every keystroke (not just once you're
                  done) meant typing "1" toward "18" or "100" got force-
                  jumped to 8 immediately, before the next digit could land —
                  the min only gets enforced on blur now, so mid-typing is
                  never fought. */}
              <NumField min={8} value={layer.fontSize ?? 48}
                onChange={(e) => onChange((l) => { l.fontSize = Math.round(parseFloat(e.target.value || "48")); })}
                onBlur={() => onChange((l) => { l.fontSize = Math.max(8, l.fontSize ?? 48); })} /></div>
            <div style={{ gridColumn: "span 2" }}><label>Color</label>
              <ColorField value={layer.textColor ?? "#1a1a1a"}
                onChange={(hex) => onChange((l) => { l.textColor = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandColors} /></div>
          </div>
          <div className="grid3 mini" style={{ marginTop: 4 }}>
            <div><label title="Extra space between letters, in pixels">Letter spacing</label>
              <NumField step={0.5} value={layer.letterSpacing ?? 0}
                onChange={(e) => onChange((l) => { l.letterSpacing = parseFloat(e.target.value || "0"); })} /></div>
            <div><label title="Space between lines — a multiple of the font size, not a fixed pixel value">Line height</label>
              <NumField step={0.1} min={0.8} value={layer.lineHeight ?? 1.5}
                onChange={(e) => onChange((l) => { l.lineHeight = Math.max(0.8, parseFloat(e.target.value || "1.5")); })} /></div>
            <div><label>Case</label>
              <button className={"btn small icon" + (layer.uppercase ? " active" : "")}
                title={layer.uppercase ? "Turn off ALL CAPS" : "ALL CAPS — display only, the text itself is untouched"}
                aria-label="Toggle all-caps" aria-pressed={!!layer.uppercase}
                onClick={() => onChange((l) => { l.uppercase = !l.uppercase; })}>
                <UppercaseIcon />
              </button></div>
          </div>
          <div className="grid2 mini" style={{ marginTop: 4 }}>
            {/* Text align: where the TEXT sits inside its own box (CSS
                text-align). Not the same as Box align below — deliberately
                different icon style so the two are never confused. */}
            <div><label>Text align</label>
              <div className="segmented">
                {(["left", "center", "right"] as const).map((a) => {
                  const active = (layer.textAlign ?? "right") === a;
                  return (
                    <button key={a} className={"btn small icon" + (active ? " active" : "")}
                      title={`Align text ${a}`} aria-label={`Align text ${a}`} aria-pressed={active}
                      onClick={() => onChange((l) => { l.textAlign = a; })}>
                      <AlignTextIcon align={a} />
                    </button>
                  );
                })}
              </div>
            </div>
            <div><label>Direction</label>
              <div className="segmented">
                {(["rtl", "ltr"] as const).map((d) => {
                  const active = (layer.direction ?? "rtl") === d;
                  return (
                    <button key={d} className={"btn small icon" + (active ? " active" : "")}
                      title={d === "rtl" ? "RTL (Farsi/Arabic)" : "LTR (English/Latin)"}
                      aria-label={d === "rtl" ? "Right-to-left direction (Farsi/Arabic)" : "Left-to-right direction (English/Latin)"}
                      aria-pressed={active}
                      onClick={() => onChange((l) => { l.direction = d; })}>
                      <DirectionIcon dir={d} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <BoxAlignRow canvas={canvas} width={layer.width} height={layer.height} onChange={onChange} />
          <div className="mini" style={{ marginTop: 10 }}>
            <label title="A continuous loop for as long as this layer is visible — independent of its In/Out effect below">Motion (while visible)</label>
            <select value={layer.photoMotion ?? "none"}
              onChange={(e) => onChange((l) => { l.photoMotion = e.target.value as any; })}>
              {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      )}
        </>
        )}
        {panel === "effects" && (
        <>
      <div className="card compact group" style={{ marginTop: 8 }}>
        <div className="row between" style={{ alignItems: "center", marginBottom: 8 }}>
          <div className="subhead" style={{ margin: 0 }}>Effects</div>
          <button className="btn small" title="Clear every IN/OUT effect, easing, timing, and parallax setting on this element back to none"
            onClick={() => onChange((l) => {
              l.entrance = "none"; l.entrance2 = undefined; l.entrance3 = undefined;
              l.entranceEasing = undefined; l.entranceEasing2 = undefined; l.entranceEasing3 = undefined;
              l.inDuration = undefined; l.delay = 0;
              l.exit = undefined; l.exit2 = undefined; l.exit3 = undefined;
              l.exitEasing = undefined; l.exitEasing2 = undefined; l.exitEasing3 = undefined;
              l.outDuration = undefined; l.outDelay = undefined;
              l.parallaxDepth = undefined;
            })}>
            Reset
          </button>
        </div>

        {/* Motion presets — same MotionClip shape as Copy/Paste above, but
            named and saved server-side, so it's reusable in OTHER projects
            too, not just pasted around within this one session. An inline
            name field (not window.prompt, which is easy to mistake for
            "nothing happened") and a visible named list (not a hidden
            dropdown) so it's obvious where a saved preset lives and how to
            reuse it. */}
        {onSaveMotionPreset && (
          <div className="mini" style={{ marginBottom: 8 }}>
            <label>Motion presets (reusable across projects)</label>
            {/* Collapsed to one dropdown instead of a full always-open list —
                picking an entry applies it right away (same effect the old
                per-row "Apply" button had). Built-ins ship in source (not the
                gitignored presets data file) so they're always available and
                never deletable. */}
            <select value="" style={{ marginBottom: 6 }}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const preset = [...BUILT_IN_PRESETS, ...(motionPresets ?? [])].find((p) => p.id === id);
                if (preset) onChange((l) => applyClip(l, preset.clip));
                e.target.value = "";
              }}>
              <option value="">Apply preset…</option>
              <optgroup label="Built-in">
                {BUILT_IN_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
              {motionPresets && motionPresets.length > 0 && (
                <optgroup label="Yours">
                  {motionPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              )}
            </select>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {!savingPreset ? (
                <button className="btn small" onClick={() => setSavingPreset(true)}>Save current as preset…</button>
              ) : (
                <div className="row" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <input type="text" autoFocus placeholder="Preset name" value={presetName} style={{ flex: 1 }}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitSavePreset();
                      if (e.key === "Escape") { setSavingPreset(false); setPresetName(""); }
                    }} />
                  <button className="btn small primary" disabled={!presetName.trim()} onClick={commitSavePreset}>Save</button>
                  <button className="btn small" onClick={() => { setSavingPreset(false); setPresetName(""); }}>Cancel</button>
                </div>
              )}
              {!savingPreset && motionPresets && motionPresets.length > 0 && (
                <button className="btn small" onClick={() => setManagingPresets((v) => !v)}>
                  {managingPresets ? "Hide saved presets" : "Manage saved presets"}
                </button>
              )}
            </div>
            {/* Delete-capable list — tucked behind "Manage", not shown by
                default; built-ins never appear here since they can't be
                deleted anyway. */}
            {managingPresets && motionPresets && motionPresets.length > 0 && (
              <div className="preset-list" style={{ marginTop: 6 }}>
                {motionPresets.map((p) => (
                  <div key={p.id} className="row between preset-row">
                    <span className="preset-name" title={p.name}>{p.name}</span>
                    {onDeleteMotionPreset && (
                      <button className="btn small" title={`Delete "${p.name}"`}
                        onClick={() => onDeleteMotionPreset(p.id)}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <FxSlots
          label="In effect" hint="Combine up to 3 — each with its own easing"
          categories={inCategories}
          values={[layer.entrance, layer.entrance2, layer.entrance3]}
          easings={[layer.entranceEasing, layer.entranceEasing2, layer.entranceEasing3]}
          disabled={layer.entrance === "wordReveal" || layer.entrance === "lineReveal"}
          onChangeSlot={(i, v) => onChange((l) => {
            if (i === 0) l.entrance = v as any;
            else if (i === 1) l.entrance2 = v as any;
            else l.entrance3 = v as any;
          })}
          onChangeEasing={(i, v) => onChange((l) => {
            if (i === 0) l.entranceEasing = v as any;
            else if (i === 1) l.entranceEasing2 = v as any;
            else l.entranceEasing3 = v as any;
          })}
          onAdd={() => onChange((l) => {
            if (!l.entrance2) l.entrance2 = "none" as any;
            else l.entrance3 = "none" as any;
          })}
          onRemove={(i) => onChange((l) => {
            if (i === 1) { l.entrance2 = undefined; l.entranceEasing2 = undefined; l.entrance3 = undefined; l.entranceEasing3 = undefined; }
            else { l.entrance3 = undefined; l.entranceEasing3 = undefined; }
          })}
        />
        <FxSlots
          label="Out effect" hint="Combine up to 3 — each with its own easing"
          categories={outCategories}
          values={[layer.exit ?? "none", layer.exit2, layer.exit3]}
          easings={[layer.exitEasing, layer.exitEasing2, layer.exitEasing3]}
          disabled={(layer.exit ?? "none") === "none"}
          onChangeSlot={(i, v) => onChange((l) => {
            if (i === 0) l.exit = v as any;
            else if (i === 1) l.exit2 = v as any;
            else l.exit3 = v as any;
          })}
          onChangeEasing={(i, v) => onChange((l) => {
            if (i === 0) l.exitEasing = v as any;
            else if (i === 1) l.exitEasing2 = v as any;
            else l.exitEasing3 = v as any;
          })}
          onAdd={() => onChange((l) => {
            if (!l.exit2) l.exit2 = "none" as any;
            else l.exit3 = "none" as any;
          })}
          onRemove={(i) => onChange((l) => {
            if (i === 1) { l.exit2 = undefined; l.exitEasing2 = undefined; l.exit3 = undefined; l.exitEasing3 = undefined; }
            else { l.exit3 = undefined; l.exitEasing3 = undefined; }
          })}
        />
      </div>
        </>
        )}
        {panel === "keyframes" && (
        <>
      <div className="card compact group" style={{ marginTop: 8 }}>
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="subhead" style={{ marginBottom: 0 }}>Keyframes</div>
          {/* Purely a display choice — same delay/inDuration/outDelay/
              outDuration fields either way, nothing to get out of sync
              switching back and forth. Simple = 4 number fields (today's
              exact UI). Keyframes = one draggable timeline row per chosen
              FX (see KeyframeEditor.tsx) — same shared timing, just easier
              to see/drag, with each row's own ease chip. */}
          <div className="row" style={{ gap: 0 }}>
            <button className={"btn small" + (!kfView ? " active" : "")}
              onClick={() => setKfView(false)}>
              Simple
            </button>
            <button className={"btn small" + (kfView ? " active" : "")}
              title="One draggable row per chosen effect — same timing as Simple, just easier to see and drag"
              onClick={() => setKfView(true)}>
              Keyframes
            </button>
          </div>
        </div>
        {kfView ? (
          <KeyframeEditor layer={layer} pageDuration={pageDuration} onChange={onChange} />
        ) : (
        <>
        <div className="grid2 mini" style={{ marginTop: 8 }}>
          <div><label>in delay (s) &mdash; when it starts</label>
            <NumField step={0.1} min={0} value={sec(layer.delay)}
              onChange={(e) => onChange((l) => { l.delay = toFr(e.target.value); })} /></div>
          <div><label>in dur (s)</label>
            {/* spring() throws outright at durationInFrames 0 (unlike delay/out
                dur, which are safe at 0) — DurationPresetField already floors
                at 1 frame so this can't crash the player. */}
            <DurationPresetField value={layer.inDuration} fallback={26}
              onChange={(frames) => onChange((l) => { l.inDuration = frames; })} /></div>
        </div>
        <div className="grid2 mini" style={{ marginTop: 4 }}>
          <div><label>out at (s) &mdash; blank = end of page</label>
            {/* A bare number input relying on the user backspacing it fully
                empty is unreliable in practice (selecting-all + deleting a
                <input type="number"> doesn't always land on "" the way it
                does for text inputs) — this ✕ is a guaranteed one-click way
                back to "auto" instead of fighting the field's own text
                selection. */}
            <div className="row" style={{ gap: 4 }}>
              <NumField step={0.1} min={0} value={layer.outDelay != null ? sec(layer.outDelay) : ""}
                placeholder="auto"
                disabled={(layer.exit ?? "none") === "none"}
                style={{ flex: 1 }}
                onChange={(e) => onChange((l) => {
                  l.outDelay = e.target.value === "" ? undefined : toFr(e.target.value);
                })} />
              <button className="btn small" title="Reset to auto (end of page)"
                disabled={(layer.exit ?? "none") === "none" || layer.outDelay == null}
                onClick={() => onChange((l) => { l.outDelay = undefined; })}>✕</button>
            </div></div>
          <div><label>out dur (s)</label>
            {/* Same interpolate()-needs-a-real-range crash as in dur — with an
                explicit out delay this boundary is now always reachable
                mid-page, not just coincidentally safe at 0 like before.
                DurationPresetField already floors at 1 frame. */}
            <DurationPresetField value={layer.outDuration} fallback={24}
              disabled={(layer.exit ?? "none") === "none"}
              onChange={(frames) => onChange((l) => { l.outDuration = frames; })} /></div>
        </div>
        </>
        )}
        <div className="mini" style={{ marginTop: 4 }}>
          <label title="How much of the PAGE's own ambient motion (set on the Page tab, e.g. kenburns/sway) this layer follows. 1 = moves with it normally, 0 = stays still while everything else drifts, below 1 = drifts slower (background feel), above 1 = drifts more (foreground feel). No effect if the page's ambient is “none”.">
            Parallax depth (page ambient)
          </label>
          <NumField step={0.1} min={0} value={layer.parallaxDepth ?? 1}
            onChange={(e) => onChange((l) => { l.parallaxDepth = Math.max(0, parseFloat(e.target.value || "1")); })} />
        </div>
      </div>
        </>
        )}
        </div>
      </div>
      </>
      )}
    </div>
  );
};

const PageInspector: React.FC<{
  page: PageT;
  canvas: [number, number];
  clip: MotionClip | null;
  onCopyClip: (clip: MotionClip) => void;
  onChange: (fn: (pg: PageT) => void) => void;
  onUploadPhoto: (layerIndex: number, file: File) => void;
  onUploadShapePhoto: (layerIndex: number, file: File) => void;
  onRemoveShapePhoto: (layerIndex: number) => void;
  onToggleTextTool: () => void;
  textToolArmed: boolean;
  onAddPhoto: () => void;
  onAddShape: () => void;
  onDeleteLayer: (layerIndex: number) => void;
  fonts: FontEntry[];
  onSelectFont: (layerIndex: number, entry: FontEntry | null) => void;
  swatches: string[];
  onAddSwatch: (hex: string) => void;
  onRemoveSwatch: (hex: string) => void;
  brandColors?: string[];
  motionPresets: MotionPresetEntry[];
  onSaveMotionPreset: (name: string, clip: MotionClip) => void;
  onDeleteMotionPreset: (id: string) => void;
  newestLayerIndex: number | null;
  // The layer (by its stable l.index) selected via a canvas click, if any —
  // switches this inspector to the Elements tab and tells that one
  // ElementMotion to expand (collapsing its siblings), same identity
  // newestLayerIndex already uses.
  selectedLayerIndex: number | null;
}> = ({ page, canvas, clip, onCopyClip, onChange, onUploadPhoto, onUploadShapePhoto, onRemoveShapePhoto, onToggleTextTool, textToolArmed, onAddPhoto, onAddShape, onDeleteLayer, fonts, onSelectFont, swatches, onAddSwatch, onRemoveSwatch, brandColors, motionPresets, onSaveMotionPreset, onDeleteMotionPreset, newestLayerIndex, selectedLayerIndex }) => {
  // Duration/bg/ambient/transition/subtitle vs. the layer list were one long
  // stacked scroll before — split so each is reachable without scrolling
  // past the other. Defaults to "Elements" — this whole inspector is only
  // reachable through the rail's "Layers" icon now, so landing on "Page"
  // first (duration/bg-color/ambient/transition, no layers in sight) read
  // as "the layers panel doesn't show any layers." Resets to this default
  // on every mount (page switch, or the dock itself closing and reopening,
  // since this component unmounts along with it either way).
  const [tab, setTab] = React.useState<"page" | "elements">("elements");
  // A canvas click always means "show me that element," even if this
  // inspector is currently sitting on the Page tab.
  React.useEffect(() => {
    if (selectedLayerIndex != null) setTab("elements");
  }, [selectedLayerIndex]);

  // Expand/collapse ALL layer cards at once — each card's own `expanded` is
  // local state (see ElementMotion), so this doesn't own the true per-card
  // state, just broadcasts "everyone snap to this" via a token that bumps
  // on every click (so clicking the same direction twice in a row — e.g.
  // "Collapse all" again after manually reopening one card — still forces
  // it, not just a value that happened not to change). `bulkExpanded` here
  // only tracks what the LAST bulk click asked for, for the button's own
  // label/icon — not real aggregate state, good enough for a single toggle.
  const [bulkExpanded, setBulkExpanded] = React.useState(true);
  const [bulkExpandToken, setBulkExpandToken] = React.useState(0);
  const toggleAllLayers = () => {
    setBulkExpanded((v) => !v);
    setBulkExpandToken((t) => t + 1);
  };
  return (
    <div>
      <h1 title={page.id}>Page: {page.name ?? page.id}</h1>

      <div className="tabs">
        <button className={"tab" + (tab === "page" ? " active" : "")} onClick={() => setTab("page")}>Page</button>
        <button className={"tab" + (tab === "elements" ? " active" : "")} onClick={() => setTab("elements")}>
          Elements{page.layers.length > 0 ? ` (${page.layers.length})` : ""}
        </button>
      </div>

      {tab === "page" && (
        <>
          <label>Duration (seconds)</label>
          <NumField min={1} step={0.5}
            value={+(page.durationInFrames / 30).toFixed(2)}
            onChange={(e) => onChange((pg) => {
              // Remotion's <TransitionSeries.Sequence> throws outright at 0 (and
              // presumably chokes on negative) — clamp to at least 1 frame so a
              // stray "0" in this field can't crash the whole player.
              pg.durationInFrames = Math.max(1, Math.round(parseFloat(e.target.value || "1") * 30));
            })} />

          <div>
            <label style={{ margin: "10px 0 4px" }}>Background color (this page only — empty follows the project's)</label>
            {/* align-items: flex-start, not center — ColorField is two rows
                tall once it has saved swatches (the picker row + the swatch
                row below it), and centering Clear against its FULL height
                left it floating over the swatches instead of sitting next
                to the picker row it actually belongs to. */}
            <div className="row" style={{ gap: 4, alignItems: "flex-start" }}>
              <ColorField value={page.bgColor ?? "#e8e4dd"}
                onChange={(hex) => onChange((pg) => { pg.bgColor = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandColors} />
              {page.bgColor && (
                <button className="btn small color-field-clear" title="Clear — follow the project's backdrop color instead"
                  onClick={() => onChange((pg) => { pg.bgColor = undefined; })}>✕</button>
              )}
            </div>
          </div>

          <div className="card compact" style={{ marginTop: 10 }}>
            <div className="row between" style={{ alignItems: "center" }}>
              <div className="subhead">Background style {page.bgStyle ? "" : "(following the project's)"}</div>
              {page.bgStyle && (
                <button className="btn small" title="Clear — follow the project's background style instead"
                  onClick={() => onChange((pg) => { pg.bgStyle = undefined; })}>✕</button>
              )}
            </div>
            <BgStyleEditor value={page.bgStyle ?? {}}
              onChange={(fn) => onChange((pg) => { if (!pg.bgStyle) pg.bgStyle = {}; fn(pg.bgStyle); })}
              swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} brandSwatches={brandColors} />
          </div>

          <label>Ambient motion</label>
          <select value={page.ambient} onChange={(e) => onChange((pg) => { pg.ambient = e.target.value as any; })}>
            {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <label>Transition to next page</label>
          <select value={page.transition.type} onChange={(e) => onChange((pg) => { pg.transition.type = e.target.value as any; })}>
            {TRANSITIONS.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
        </>
      )}

      {tab === "elements" && (
        <>
          <div className="row between" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0, border: "none", padding: 0 }}>Element motion (in / out)</h2>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" disabled={page.layers.length === 0}
                title={bulkExpanded ? "Collapse every layer card" : "Expand every layer card"}
                onClick={toggleAllLayers}>
                {bulkExpanded ? "⌃ Collapse all" : "⌄ Expand all"}
              </button>
              <button className="btn small" disabled={!clip}
                title="Paste the copied motion + style onto every element on this page (text untouched)"
                onClick={() => onChange((pg) => { pg.layers.forEach((l) => applyClip(l, clip!)); })}>
                Paste to all
              </button>
            </div>
          </div>
          {/* Text is a real tool, not an instant action — arming it and
              cancelling (Esc, or clicking it again) both toggle textToolArmed,
              same "click again to turn it off" convention as everywhere else
              in the app that shows an active state. */}
          <div className="row" style={{ gap: 6, marginTop: 10, marginBottom: 8 }}>
            <button className={"btn small" + (textToolArmed ? " active" : "")} style={{ flex: 1 }}
              title={textToolArmed ? "Click again to cancel (or press Esc)" : "Click, or drag on the canvas to draw a text box"}
              aria-pressed={textToolArmed} onClick={onToggleTextTool}>
              <TextToolIcon /><span>Text</span>
            </button>
            <button className="btn small" style={{ flex: 1 }} title="Choose a photo/video to add" onClick={onAddPhoto}>
              <PhotoToolIcon /><span>Photo</span>
            </button>
            <button className="btn small" style={{ flex: 1 }} title="Add a shape" onClick={onAddShape}>
              <ShapeToolIcon /><span>Shape</span>
            </button>
          </div>
          {/* Rendered top-to-bottom = front-to-back (Photoshop/Figma convention)
              — reverses the DISPLAY order only; `li` stays the real array index
              so every callback still targets the right layer regardless of
              where it's drawn in this list. */}
          {page.layers.map((l, li) => (
            <ElementMotion key={l.index} layer={l} clip={clip} onCopy={onCopyClip}
              onChange={(fn) => onChange((pg) => fn(pg.layers[li]))}
              onMove={(dir) => onChange((pg) => {
                const j = li + dir;
                if (j < 0 || j >= pg.layers.length) return;
                [pg.layers[li], pg.layers[j]] = [pg.layers[j], pg.layers[li]];
              })}
              canMoveUp={li < page.layers.length - 1}
              canMoveDown={li > 0}
              onUploadPhoto={(file) => onUploadPhoto(li, file)}
              onUploadShapePhoto={(file) => onUploadShapePhoto(li, file)}
              onRemoveShapePhoto={() => onRemoveShapePhoto(li)}
              fonts={fonts}
              onSelectFont={(entry) => onSelectFont(li, entry)}
              swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch}
              brandColors={brandColors}
              motionPresets={motionPresets} onSaveMotionPreset={onSaveMotionPreset} onDeleteMotionPreset={onDeleteMotionPreset}
              autoFocus={l.index === newestLayerIndex}
              selectedLayerIndex={selectedLayerIndex}
              bulkExpanded={bulkExpanded}
              bulkExpandToken={bulkExpandToken}
              canvas={canvas}
              pageDuration={page.durationInFrames}
              onDelete={() => onDeleteLayer(li)} />
          )).reverse()}
        </>
      )}
    </div>
  );
};
