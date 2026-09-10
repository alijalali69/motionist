import React from "react";
import {
  ENTRANCE_CATEGORIES, EXIT_CATEGORIES, AMBIENT_NAMES,
  TEXT_ENTRANCE_NAMES, TEXT_EXIT_NAMES, LATIN_TEXT_ENTRANCE_NAMES, EASING_NAMES,
  entranceMotion, entranceProgress, exitMotion, exitProgress, ambientMotion,
  motionTransform, motionFilter, shadowStyle, blobRadius,
  type EntranceName, type ExitName, type AmbientName, type EasingName, type LayerMotion,
} from "../../src/presets";
import {
  MotionFilterDefs, ShineOverlay, ScanlineOverlay, GlitchOverlay, DataMoshOverlay,
  LiquidOverlay, BurstOverlay, StrokeDrawOverlay, ChromaOverlay, StaticOverlay,
  scrambledText, StaggerText, LetterPopText,
} from "../../src/MotionFx";

// The shared "play one effect, for real" renderer, used by BOTH the
// full-page Effects gallery and the compact picker inside the Effects panel.
//
// Nothing here is a hand-drawn approximation of what an effect "roughly
// looks like": it calls the SAME entranceProgress/entranceMotion/exitMotion/
// ambientMotion the real reel calls, turns the resulting LayerMotion into
// CSS through the SAME motionTransform/motionFilter/shadowStyle/blobRadius,
// and mounts the SAME overlay components (MotionFx.tsx) for the fields that
// need real DOM. An earlier in-app preview (reverted in d479514) skipped
// those overlays, which silently showed ~10 effects — glitchIn, dataMoshIn,
// liquidIn, vhsIn, burstIn, strokeIn, shineIn and their exits — as "nothing
// happens". Everything shown here is what an export actually does.
//
// The one deliberate difference from a real render: Remotion drives frames,
// this drives a plain rAF loop, because dozens of simultaneous <Player>s
// would crawl. Since every motion function above is a pure function of
// `frame`, the numbers are identical either way.

export const FPS = 30;
// Real page coordinates. Tiles show a square 1080×1080 window of a 1080-wide
// page rather than the whole 9:16 frame — a crop, not a rescale, so every
// distance an effect moves is still at true page scale relative to the
// layer (a 90px slide really is 90 page-pixels). Square tiles just fit far
// more of the library on screen at once, which is the job here.
const WINDOW = 1080;
export const TILE = 176;
// A layer roughly the size of a real headline block, centered in the window.
const BOX = { left: 140, top: 330, width: 800, height: 420 };

export const REST = 6;   // idle frames before the effect starts, so the "before" state is visible
export const HOLD = 30;  // frames held after it lands, so the "after" state is too
export const AMBIENT_CYCLE = 150; // 5s — a realistic page length, which is what ambient motion is scaled to

// A synthetic photo, inline rather than a shipped binary: real edges and
// color boundaries in it (horizon, sun, stripes) are what make glitchIn's
// channel split, dataMoshIn's block tear and liquidIn's warp legible at
// all — over a flat gradient those three read as nothing happening.
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#1b3a6b"/><stop offset="0.55" stop-color="#c95f7a"/><stop offset="1" stop-color="#f0a259"/>
</linearGradient></defs>
<rect width="800" height="420" fill="url(#s)"/>
<circle cx="560" cy="180" r="72" fill="#ffe9b0"/>
<path d="M0 420 L180 250 L320 360 L470 210 L640 380 L800 300 L800 420 Z" fill="#25304a"/>
<path d="M0 420 L140 330 L300 420 Z" fill="#161d2e"/>
<rect x="60" y="60" width="240" height="14" fill="#ffffff" opacity="0.85"/>
<rect x="60" y="92" width="150" height="14" fill="#ffffff" opacity="0.55"/>
</svg>`;
const PHOTO_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PHOTO_SVG)}`;

export type Tab = "in" | "out" | "ambient";
export type Sample = "text" | "photo" | "shape";

// The five effects that bypass the LayerMotion pipeline entirely — they're
// not a transform on one box, they're N separately-timed spans or a string
// whose CONTENT changes frame to frame. Listed here so a tile knows to take
// the text-split branch instead of the normal motion one.
const TEXT_SPLIT = new Set<string>(["wordReveal", "lineReveal", "scrambleIn", "letterPopIn", "scrambleOut"]);

const SAMPLE_TEXT = "Motion with freedom";
// A thumbnail-sized stage renders the whole 1080-wide page into ~68px, so a
// full sample sentence comes out around 6px tall and wraps to three lines —
// unreadable, and the wrapping itself obscures the motion. Below this size
// the stage swaps to a short sample at a proportionally larger page font.
// Type size is not what these small tiles are for; showing the motion is.
const COMPACT_BELOW = 110;
const COMPACT_TEXT = "Aa";
const COMPACT_FONT = 340;

// Which LayerMotion fields an effect actually drives, discovered by sampling
// its own curve rather than hardcoded — so this can never fall out of sync
// with presets.ts, and so two effects that turn out to move the exact same
// fields are visible as such at a glance (the point, when the question is
// "do we have near-duplicates in here?").
const BASE_FIELDS: Record<string, number> = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, rotateY: 0 };
export function drivenFields(kind: "in" | "out", name: string): string[] {
  const found = new Set<string>();
  for (const p of [0, 0.15, 0.35, 0.5, 0.75, 0.9, 1]) {
    const m = kind === "in"
      ? entranceMotion(name as EntranceName, p)
      : exitMotion(name as ExitName, p);
    for (const [k, v] of Object.entries(m) as [string, unknown][]) {
      if (v === undefined) continue;
      if (k in BASE_FIELDS) { if (Math.abs((v as number) - BASE_FIELDS[k]) > 1e-6) found.add(k); }
      else found.add(k); // clipPath/shine/glitch/… are absent unless the effect uses them
    }
  }
  return [...found];
}

// One rAF loop for the whole gallery — every tile reads the same frame, so
// they play in lockstep and there's a single animation driver on the page
// regardless of how many effects are listed.
export function useLoopFrame(cycle: number, playing: boolean): number {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      setFrame(Math.floor(((t - t0) / 1000) * FPS) % cycle);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycle, playing]);
  return frame;
}

const textStyleFor = (fontSize: number): React.CSSProperties => ({
  fontFamily: "Tahoma, Arial, sans-serif",
  fontSize,
  color: "#f2f4f7",
  textAlign: "center",
  direction: "ltr", // letterPopIn is Latin-only by design (it splits characters, which breaks cursive Farsi joining)
  lineHeight: 1.25,
  whiteSpace: "pre-wrap",
  fontWeight: 700,
});

// The layer's own content, wrapped in the ambient (while-visible) transform
// exactly the way PageScene.tsx wraps a real layer's content.
const SampleContent: React.FC<{
  sample: Sample;
  pz: { tx: number; ty: number; scale: number; rotate: number };
  text: string;
  textStyle: React.CSSProperties;
}> = ({ sample, pz, text, textStyle }) => {
  const inner =
    sample === "text" ? <div style={textStyle}>{text}</div>
    : sample === "photo" ? <img src={PHOTO_URI} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#3ea6ff,#7b5cff)", borderRadius: 24 }} />;
  return (
    <div style={{
      width: sample === "text" ? undefined : "100%",
      height: sample === "text" ? undefined : "100%",
      transform: `translate(${pz.tx}px, ${pz.ty}px) scale(${pz.scale}) rotate(${pz.rotate}deg)`,
      transformOrigin: "center center",
    }}>
      {inner}
    </div>
  );
};

const IDENTITY: LayerMotion = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, rotateY: 0 };
const NO_AMBIENT = { tx: 0, ty: 0, scale: 1, rotate: 0 };

// One effect playing. Mirrors PageScene.tsx's own layer box: same style
// fields in the same order, same overlay list, same overflow rule (text
// isn't a mask and must not clip; a photo/shape box IS the mask).
export const EffectStage: React.FC<{
  name: string;
  tab: Tab;
  sample: Sample;
  frame: number;
  easing: EasingName | undefined;
  duration: number;
  size?: number; // rendered square, in CSS px (the page inside is scaled to fit)
}> = ({ name, tab, sample, frame, easing, duration, size = TILE }) => {
  const scale = size / WINDOW;
  const compact = size < COMPACT_BELOW;
  const sampleText = compact ? COMPACT_TEXT : SAMPLE_TEXT;
  const textStyle = textStyleFor(compact ? COMPACT_FONT : 96);
  const isTextSplit = TEXT_SPLIT.has(name);

  let m: LayerMotion = IDENTITY;
  let pz = NO_AMBIENT;
  if (tab === "ambient") {
    pz = ambientMotion(name as AmbientName, frame, AMBIENT_CYCLE);
  } else if (!isTextSplit) {
    m = tab === "in"
      ? entranceMotion(name as EntranceName, entranceProgress(name as EntranceName, easing, frame, FPS, REST, duration))
      : exitMotion(name as ExitName, exitProgress(name as ExitName, easing, frame, REST, duration));
  }

  const boxStyle: React.CSSProperties = {
    position: "absolute",
    left: BOX.left, top: BOX.top, width: BOX.width, height: BOX.height,
    opacity: m.opacity,
    filter: motionFilter(m),
    transform: motionTransform(m),
    transformOrigin: "center center",
    clipPath: m.clipPath,
    boxShadow: shadowStyle(m.shadow),
    borderRadius: m.morph !== undefined ? blobRadius(m.morph, frame) : undefined,
    overflow: sample === "text" ? "visible" : "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
  };

  let body: React.ReactNode;
  if (isTextSplit) {
    // Same three branches TextLayerView takes, calling the same shared
    // renderers from MotionFx.tsx — not a re-implementation of the timing.
    if (name === "scrambleIn" || name === "scrambleOut") {
      const progress = name === "scrambleIn"
        ? entranceProgress("scrambleIn", easing, frame, FPS, REST, duration)
        : exitProgress("scrambleOut", easing, frame, REST, duration);
      const revealFrac = name === "scrambleIn" ? progress : 1 - progress;
      body = <div style={textStyle}>{scrambledText(sampleText, revealFrac, frame)}</div>;
    } else if (name === "letterPopIn") {
      body = <LetterPopText text={sampleText} frame={frame} fps={FPS} delay={REST}
        inDuration={duration} justify="center" textStyle={textStyle} />;
    } else {
      body = <StaggerText text={sampleText} lineMode={name === "lineReveal"} frame={frame} fps={FPS}
        delay={REST} inDuration={duration} justify="center" textStyle={textStyle} />;
    }
  } else {
    body = <SampleContent sample={sample} pz={pz} text={sampleText} textStyle={textStyle} />;
  }

  return (
    <div className="fxg-stage" style={{ width: size, height: size }}>
      <div style={{ width: WINDOW, height: WINDOW, position: "relative", transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <div style={boxStyle}>
          {body}
          {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
          {m.scanline !== undefined && <ScanlineOverlay scanline={m.scanline} frame={frame} />}
          {m.glitch !== undefined && <GlitchOverlay amount={m.glitch} frame={frame}>{body}</GlitchOverlay>}
          {m.chroma !== undefined && <ChromaOverlay amount={m.chroma}>{body}</ChromaOverlay>}
          {m.glitchBlocks !== undefined && <DataMoshOverlay amount={m.glitchBlocks} frame={frame}>{body}</DataMoshOverlay>}
          {m.liquid !== undefined && <LiquidOverlay amount={m.liquid}>{body}</LiquidOverlay>}
          {m.staticNoise !== undefined && <StaticOverlay amount={m.staticNoise} frame={frame} />}
          {m.burst !== undefined && <BurstOverlay amount={m.burst} frame={frame} />}
          {m.stroke !== undefined && <StrokeDrawOverlay amount={m.stroke} />}
        </div>
      </div>
    </div>
  );
};

