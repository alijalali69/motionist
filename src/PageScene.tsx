import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  staticFile,
  spring,
  delayRender,
  continueRender,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Gif } from "@remotion/gif";
import {
  entranceMotion, entranceProgress, exitMotion, exitProgress, combineMotions, ambientMotion,
  type EntranceName, type ExitName, type EasingName, type LayerMotion,
} from "./presets";

// A moving diagonal highlight for shineIn/shineOut (LayerMotion.shine,
// 0..1 sweep position) — an overlay on top of the content, not a filter on
// it, so it works the same over text, photos, or video. `screen` blend
// brightens what's underneath instead of just painting a flat white stripe.
const ShineOverlay: React.FC<{ shine: number }> = ({ shine }) => (
  <div
    style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      backgroundImage: "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)",
      backgroundSize: "300% 300%",
      backgroundPositionX: `${-100 + shine * 300}%`,
      mixBlendMode: "screen",
    }}
  />
);

// cardFlipIn/Out's "landing" shadow (LayerMotion.shadow, 0..1 intensity) and
// glowPulseIn/Out's breathing glow (LayerMotion.glow) — both are just
// boxShadow at different colors/spreads, so one layer's box-shadow can
// carry both at once (CSS box-shadow accepts a comma-separated list).
function shadowStyle(shadow: number | undefined, glow: number | undefined): string | undefined {
  const parts: string[] = [];
  if (shadow) parts.push(`0 ${18 * shadow}px ${40 * shadow}px rgba(0,0,0,${0.45 * shadow})`);
  if (glow) parts.push(`0 0 ${40 * glow}px ${10 * glow}px rgba(255,255,255,${0.8 * glow})`);
  return parts.length ? parts.join(", ") : undefined;
}

// The transform/filter strings both LayerView and TextLayerView build,
// pulled out once so the two never drift out of sync when a new field
// (skewX, scaleX/scaleY, tint) gets added to LayerMotion.
function motionTransform(m: LayerMotion): string {
  const sx = m.scaleX ?? m.scale;
  const sy = m.scaleY ?? m.scale;
  const skew = m.skewX ? ` skewX(${m.skewX}deg)` : "";
  return `perspective(900px) translate(${m.tx}px, ${m.ty}px) scale(${sx}, ${sy}) rotate(${m.rotate}deg) rotateY(${m.rotateY}deg)${skew}`;
}
function motionFilter(m: LayerMotion): string | undefined {
  const parts: string[] = [];
  if (m.blur) parts.push(`blur(${m.blur}px)`);
  if (m.tint) parts.push(`hue-rotate(${m.tint * 45}deg) saturate(${1 + m.tint * 0.6})`);
  return parts.length ? parts.join(" ") : undefined;
}

// vhsIn/Out's scanline + jitter overlay (LayerMotion.scanline, 0..1
// intensity). Deterministic from `frame` (not a CSS @keyframes loop) —
// Remotion's headless render captures one frame at a time, not in real
// time, so a live CSS animation has no reliable state to capture; every
// visual change here — and every glitch/data-mosh jitter below — has to be
// a plain function of the actual frame number instead.
const ScanlineOverlay: React.FC<{ scanline: number; frame: number }> = ({ scanline, frame }) => (
  <div
    style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      opacity: scanline,
      transform: `translateX(${Math.sin(frame * 0.9) * 1.5}px)`,
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.12) 0px, transparent 1px, transparent 3px)," +
        "linear-gradient(180deg, transparent 40%, rgba(140,255,235,0.18) 50%, transparent 60%)",
      backgroundSize: "100% 100%, 100% 260%",
      backgroundPositionY: `0px, ${(frame * 5) % 260}%`,
      mixBlendMode: "overlay",
    }}
  />
);

// A cheap deterministic 0..1 pseudo-random value from (frame, seed) —
// looks chaotic, renders identically on every pass of the same frame
// (live preview and the actual export alike). Never Math.random() here;
// glitchIn/dataMoshIn's whole point is that the same frame always glitches
// the same way.
function glitchNoise(frame: number, seed: number): number {
  const x = Math.sin(frame * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// scrambleIn/Out's decrypt-style reveal — Persian digits and a few
// script-neutral symbols, not Latin letters: a Latin run embedded inside
// RTL Farsi text triggers the Unicode bidi algorithm and can visibly
// reorder mid-word, where Arabic-Indic digits carry the same run direction
// as the surrounding text and drop in cleanly instead.
const SCRAMBLE_NOISE_CHARS = "۰۱۲۳۴۵۶۷۸۹#*+=-؟";

// Whole-STRING substitution, not per-letter DOM spans — this is the part
// that keeps it Farsi/Arabic-safe (the actual reason word/lineReveal never
// split individual letters either): the resolved prefix is the real intact
// string, cursive joining untouched; only the still-scrambled tail swaps
// character-by-character, and whitespace is never touched so word spacing
// never visibly glitches. `frame`-seeded per position, not Math.random() —
// the churn has to render identically on every pass of the same frame.
function scrambledText(text: string, revealFrac: number, frame: number): string {
  const resolved = Math.floor(Math.min(1, Math.max(0, revealFrac)) * text.length);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (i < resolved || ch === " " || ch === "\n") { out += ch; continue; }
    const idx = Math.floor(glitchNoise(frame, i * 7 + 3) * SCRAMBLE_NOISE_CHARS.length);
    out += SCRAMBLE_NOISE_CHARS[Math.min(idx, SCRAMBLE_NOISE_CHARS.length - 1)];
  }
  return out;
}

// glitchIn/Out's RGB channel-split — two real duplicates of the layer's
// OWN content (not a flat overlay div, so it works identically over text,
// photos, and video), each isolated to a single color channel (see the
// feColorMatrix filters defined once in Reel.tsx) and jittered as a clipped
// horizontal slice. Bursty, not constant: most frames render nothing extra
// at all — reads as sudden corruption, not a steady wobble.
const GlitchOverlay: React.FC<{ amount: number; frame: number; children: React.ReactNode }> = ({ amount, frame, children }) => {
  if (!amount || glitchNoise(frame, 1) >= 0.32 * amount) return null;
  const dxR = (glitchNoise(frame, 2) - 0.5) * 16 * amount;
  const dxC = (glitchNoise(frame, 3) - 0.5) * 16 * amount;
  const yR = glitchNoise(frame, 4) * 65;
  const hR = 8 + glitchNoise(frame, 5) * 30;
  const yC = glitchNoise(frame, 6) * 65;
  const hC = 8 + glitchNoise(frame, 7) * 30;
  const sliceStyle = (dx: number, y: number, h: number, filterId: string): React.CSSProperties => ({
    position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen",
    transform: `translateX(${dx}px)`,
    clipPath: `inset(${y}% 0 ${Math.max(0, 100 - y - h)}% 0)`,
    filter: `url(#glitch${filterId}Channel)`,
  });
  return (
    <>
      <div style={sliceStyle(dxR, yR, hR, "Red")}>{children}</div>
      <div style={sliceStyle(dxC, yC, hC, "Cyan")}>{children}</div>
    </>
  );
};

// dataMoshIn/Out's block-tear — several horizontal bands of the layer's own
// content, each independently offset sideways with no color tint — the
// compression-artifact "block copy" read, distinct from glitchIn's
// chromatic-aberration read.
const DataMoshOverlay: React.FC<{ amount: number; frame: number; children: React.ReactNode }> = ({ amount, frame, children }) => {
  if (!amount || glitchNoise(frame, 11) >= 0.3 * amount) return null;
  const bands = 4;
  const slices = Array.from({ length: bands }, (_, i) => {
    const y = (i / bands) * 100;
    const h = 100 / bands;
    const dx = (glitchNoise(frame, 20 + i) - 0.5) * 60 * amount;
    return (
      <div key={i} style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        transform: `translateX(${dx}px)`,
        clipPath: `inset(${y}% 0 ${100 - y - h}% 0)`,
      }}>
        {children}
      </div>
    );
  });
  return <>{slices}</>;
};

// liquidIn/Out's organic warp — one ghost copy of the layer's own content
// with the shared feTurbulence/feDisplacementMap filter (defined once in
// Reel.tsx) applied, crossfaded in over the crisp base via plain opacity.
// The filter's own noise flows on its own (driven by frame in Reel.tsx);
// this is just how much of that warped copy shows through for THIS layer.
const LiquidOverlay: React.FC<{ amount: number; children: React.ReactNode }> = ({ amount, children }) => (
  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: amount, filter: "url(#liquidWarp)" }}>
    {children}
  </div>
);

// morphIn/Out's blob border-radius (LayerMotion.morph, 0..1 intensity) — 8
// independently wobbling corner radii (frame-seeded, same glitchNoise as
// everything else), each scaled by `amount` so 0 is a plain sharp rect and
// 1 is a full organic blob. A cheap approximation of true shape-to-shape
// morphing (which would need a path-interpolation dependency) — this is
// just CSS border-radius, applied on the same div that already clips its
// content via overflow:hidden.
function blobRadius(amount: number, frame: number): string | undefined {
  if (!amount) return undefined;
  const w = (seed: number) => 35 + glitchNoise(frame, seed) * 25;
  const h = [31, 32, 33, 34].map((s) => (amount * w(s)).toFixed(1)).join("% ");
  const v = [41, 42, 43, 44].map((s) => (amount * w(s)).toFixed(1)).join("% ");
  return `${h}% / ${v}%`;
}

// burstIn/Out's confetti release (LayerMotion.burst, 0..1 progress) — a
// handful of small bits fly outward from center only in the last 30% of
// `amount`'s own range, so it reads as a release right at the moment of
// arrival/departure, not a burst spread evenly across the whole motion.
// Deterministic from (frame, amount), same as every other glitch-family
// overlay in this file.
const PARTICLE_COLORS = ["#ff4d6d", "#ffd23f", "#3fa7ff", "#7cff6b", "#c96bff"];
const BurstOverlay: React.FC<{ amount: number; frame: number }> = ({ amount, frame }) => {
  const t = Math.min(1, Math.max(0, (amount - 0.7) / 0.3));
  if (t <= 0) return null;
  const bits = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2 + glitchNoise(frame, 50 + i) * 0.6;
    const dist = t * (30 + glitchNoise(frame, 60 + i) * 55);
    const size = 5 + glitchNoise(frame, 70 + i) * 6;
    return (
      <div key={i} style={{
        position: "absolute", left: "50%", top: "50%",
        width: size, height: size, borderRadius: 2,
        background: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        opacity: (1 - t) * amount,
        transform: `translate(-50%, -50%) translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) rotate(${dist * 4}deg)`,
        pointerEvents: "none",
      }} />
    );
  });
  return <>{bits}</>;
};

// strokeIn/Out's outline draw-on (LayerMotion.stroke, 0..1 progress) — a
// rounded-rect outline traces itself around the layer's own bounding box.
// preserveAspectRatio="none" + vectorEffect="non-scaling-stroke" so it
// stretches to any layer's real aspect ratio instead of assuming square;
// the dash length (392, a rounded-rect perimeter's rough length in the
// 0..100 viewBox this draws in) is an approximation, not exact per corner
// radius — a stylized "traces itself" read, not a precise vector reveal.
const StrokeDrawOverlay: React.FC<{ amount: number }> = ({ amount }) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
    <rect x="1.5" y="1.5" width="97" height="97" rx="4" fill="none" stroke="#ffffff" strokeWidth="1.5"
      vectorEffect="non-scaling-stroke" strokeDasharray="392" strokeDashoffset={392 * (1 - amount)} />
  </svg>
);
import type { Page, ContentLayer } from "./types";

// Resolves a layer's up-to-3 combined entrance (or exit) slots into one
// LayerMotion — each slot gets its own progress, easing, AND now its own
// timing (delay/duration) too. FX2/FX3 fall back to FX1's own delay/
// inDuration whenever their own is unset, so a layer that's never had FX2/3
// dragged independently in the Keyframes tab behaves exactly as before.
// Slots left unset (or "none") are skipped entirely; pairing name+easing+
// timing BEFORE filtering keeps FX3's own values tied to FX3 even if FX2
// happens to be "none" in between.
function combinedEntranceMotion(layer: ContentLayer, frame: number, fps: number) {
  const d1 = layer.delay, u1 = layer.inDuration ?? 26;
  const slots = ([
    [layer.entrance, layer.entranceEasing, d1, u1],
    [layer.entrance2, layer.entranceEasing2, layer.delay2 ?? d1, layer.inDuration2 ?? u1],
    [layer.entrance3, layer.entranceEasing3, layer.delay3 ?? d1, layer.inDuration3 ?? u1],
  ] as [EntranceName | undefined, EasingName | undefined, number, number][])
    .filter((s): s is [EntranceName, EasingName | undefined, number, number] => !!s[0] && s[0] !== "none");
  if (slots.length === 0) return entranceMotion("none", 1);
  const motions = slots.map(([name, ease, delay, dur]) =>
    entranceMotion(name, entranceProgress(name, ease, frame, fps, delay, dur))
  );
  return combineMotions(motions);
}

// The earliest of all ACTIVE exit slots' own resolved start frames — used
// only to decide when to switch from rendering entrance to rendering exit at
// all. Needs to be the earliest (not just FX1's), now that FX2/FX3 can have
// their own independent exit timing — a layer whose FX2 exit starts before
// FX1's must already be in "exit mode" by FX2's own start, not FX1's.
// combinedExitMotion itself is safe to call before every slot has actually
// started: exitMotion(name, 0) is identity (opacity 1, no offset), so a
// not-yet-started slot just contributes nothing until its own turn.
function earliestExitStart(layer: ContentLayer, pageDuration: number): number {
  const u1 = layer.outDuration ?? 24;
  const s1 = layer.outDelay ?? (pageDuration - u1);
  const starts: number[] = [];
  if (layer.exit && layer.exit !== "none") starts.push(s1);
  if (layer.exit2 && layer.exit2 !== "none") starts.push(layer.outDelay2 ?? s1);
  if (layer.exit3 && layer.exit3 !== "none") starts.push(layer.outDelay3 ?? s1);
  return starts.length ? Math.min(...starts) : s1;
}

function combinedExitMotion(layer: ContentLayer, frame: number, pageDuration: number) {
  const u1 = layer.outDuration ?? 24;
  const s1 = layer.outDelay ?? (pageDuration - u1);
  const slots = ([
    [layer.exit, layer.exitEasing, s1, u1],
    [layer.exit2, layer.exitEasing2, layer.outDelay2 ?? s1, layer.outDuration2 ?? u1],
    [layer.exit3, layer.exitEasing3, layer.outDelay3 ?? s1, layer.outDuration3 ?? u1],
  ] as [ExitName | undefined, EasingName | undefined, number, number][])
    .filter((s): s is [ExitName, EasingName | undefined, number, number] => !!s[0] && s[0] !== "none");
  if (slots.length === 0) return entranceMotion("none", 1);
  const motions = slots.map(([name, ease, outStart, outDuration]) =>
    exitMotion(name, exitProgress(name, ease, frame, outStart, outDuration))
  );
  return combineMotions(motions);
}

export type { Page } from "./types";

// Loads an uploaded custom font (if any) before the frame is captured — same
// delayRender/continueRender pattern used for the Lottie logo. Re-runs
// whenever fontFile/family actually change (not just on mount) — a text
// layer is created font-less and gets a font picked afterward from the
// dropdown, which is a prop change on an already-mounted layer, not a fresh
// mount; keying this to [] like the Lottie logo (which never changes after
// upload) silently skipped loading the font in that — the common — case.
function useLayerFont(fontFile: string | undefined, family: string | undefined) {
  React.useEffect(() => {
    if (!fontFile) return;
    const handle = delayRender(`font: ${family}`);
    const face = new FontFace(family || "CustomFont", `url(${staticFile(fontFile)})`);
    face.load()
      .then((loaded) => { document.fonts.add(loaded); continueRender(handle); })
      .catch((e) => { console.error("font load failed:", e); continueRender(handle); });
  }, [fontFile, family]);
}

// A live-typed text layer (Farsi input + optional uploaded font) — distinct
// from image/video layers, which come from baked PSD/SVG art. Word/line
// reveal entrances split on WORD or LINE boundaries only, never individual
// characters, because splitting cursive Farsi/Arabic letters into separate
// elements breaks their contextual joining. Every other entrance (including
// the mask-wipe ones) renders the text as one intact block via clip-path,
// which never touches the glyph run and is always shaping-safe.
const TextLayerView: React.FC<{ layer: ContentLayer; pageDuration: number }> = ({
  layer,
  pageDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  useLayerFont(layer.fontFile, layer.fontFamily);

  const inDuration = layer.inDuration ?? 26;
  const hasExit = (layer.exit && layer.exit !== "none") || (layer.exit2 && layer.exit2 !== "none") || (layer.exit3 && layer.exit3 !== "none");
  const outStart = earliestExitStart(layer, pageDuration);
  const inExitPhase = hasExit && frame >= outStart;
  const isStagger = layer.entrance === "wordReveal" || layer.entrance === "lineReveal";
  // Decrypt/scramble reveal — bypasses the normal LayerMotion pipeline
  // entirely, same as word/lineReveal above: it's not a transform, it's the
  // TEXT CONTENT itself changing frame to frame. Only checks the primary
  // entrance/exit slot, matching word/lineReveal's own existing limitation
  // (FX2/FX3 combos aren't considered for either).
  const isScrambleIn = layer.entrance === "scrambleIn" && !inExitPhase;
  const isScrambleOut = layer.exit === "scrambleOut" && inExitPhase;
  const isScramble = isScrambleIn || isScrambleOut;
  // Per-character pop — the render-side half of the direction==="ltr" gate
  // (the picker in App.tsx is the other half): even if a layer's own saved
  // data somehow has entrance="letterPopIn" with direction="rtl" (an old
  // save from before this gate existed, say), this still refuses to split
  // Farsi/Arabic text into letters — falls through to the plain render.
  const isLetterPop = layer.entrance === "letterPopIn" && !inExitPhase && (layer.direction ?? "rtl") === "ltr";

  let m;
  if (inExitPhase) {
    m = combinedExitMotion(layer, frame, pageDuration);
  } else if (!isStagger) {
    m = combinedEntranceMotion(layer, frame, fps);
  } else {
    m = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, rotateY: 0, clipPath: undefined as string | undefined };
  }

  const justify = layer.textAlign === "left" ? "flex-start" : layer.textAlign === "center" ? "center" : "flex-end";
  const textStyle: React.CSSProperties = {
    fontFamily: layer.fontFamily || "Tahoma, Arial, sans-serif",
    fontSize: layer.fontSize ?? 48,
    color: layer.textColor ?? "#1a1a1a",
    textAlign: layer.textAlign ?? "right",
    direction: layer.direction ?? "rtl",
    lineHeight: layer.lineHeight ?? 1.5,
    letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
    textTransform: layer.uppercase ? "uppercase" : undefined,
    whiteSpace: "pre-wrap",
  };

  const boxStyle: React.CSSProperties = {
    position: "absolute",
    left: layer.left, top: layer.top, width: layer.width, height: layer.height,
    opacity: m.opacity * layer.opacity,
    filter: motionFilter(m),
    transform: motionTransform(m),
    transformOrigin: "center center",
    clipPath: m.clipPath,
    boxShadow: shadowStyle(m.shadow, m.glow),
    overflow: "visible", // text isn't a mask — don't silently clip slightly-oversized content
    display: "flex",
    alignItems: "center",
    justifyContent: justify,
  };

  if (isScramble) {
    const outDuration = layer.outDuration ?? 24;
    const progress = isScrambleIn
      ? entranceProgress("scrambleIn", layer.entranceEasing, frame, fps, layer.delay, inDuration)
      : exitProgress("scrambleOut", layer.exitEasing, frame, outStart, outDuration);
    // Real characters resolve left-to-right through the STRING's own
    // logical order — for RTL Farsi text that's the same order the reader
    // reaches each character in (bidi/CSS direction handles the visual
    // mirroring), so "reveal position 0 first" already reads correctly
    // right-to-left with no extra direction-aware logic needed.
    const revealFrac = isScrambleIn ? progress : 1 - progress;
    const textNode = <div style={textStyle}>{scrambledText(layer.text ?? "", revealFrac, frame)}</div>;
    return (
      <div style={boxStyle}>
        {textNode}
        {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
        {m.scanline !== undefined && <ScanlineOverlay scanline={m.scanline} frame={frame} />}
      </div>
    );
  }

  if (isLetterPop) {
    // Individual characters, each with its own spring pop-in staggered by
    // index — same shape as the word/line stagger below, just at letter
    // granularity, which is exactly why it's Latin-only (see isLetterPop
    // above and the direction gate in App.tsx).
    const chars = (layer.text ?? "").split("");
    const perChar = 14;
    const window = Math.max(1, inDuration - perChar);
    const n = Math.max(1, chars.length);
    return (
      <div style={boxStyle}>
        <div style={{ ...textStyle, display: "flex", flexWrap: "wrap", justifyContent: justify, width: "100%" }}>
          {chars.map((c, i) => {
            const charDelay = layer.delay + Math.round((i / Math.max(1, n - 1)) * window);
            const p = spring({ frame: frame - charDelay, fps, config: { damping: 11, mass: 0.7, stiffness: 140 }, durationInFrames: perChar });
            return (
              <span key={i} style={{ display: "inline-block", opacity: p, transform: `scale(${p}) translateY(${(1 - p) * 10}px)` }}>
                {c === " " ? " " : c}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  if (!isStagger || inExitPhase) {
    const textNode = <div style={textStyle}>{layer.text}</div>;
    return (
      <div style={boxStyle}>
        {textNode}
        {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
        {m.scanline !== undefined && <ScanlineOverlay scanline={m.scanline} frame={frame} />}
        {m.glitch !== undefined && <GlitchOverlay amount={m.glitch} frame={frame}>{textNode}</GlitchOverlay>}
        {m.glitchBlocks !== undefined && <DataMoshOverlay amount={m.glitchBlocks} frame={frame}>{textNode}</DataMoshOverlay>}
        {m.liquid !== undefined && <LiquidOverlay amount={m.liquid}>{textNode}</LiquidOverlay>}
        {m.burst !== undefined && <BurstOverlay amount={m.burst} frame={frame} />}
        {m.stroke !== undefined && <StrokeDrawOverlay amount={m.stroke} />}
      </div>
    );
  }

  // Word/line stagger — split on the boundary, spread each unit's own short
  // pop-in across the layer's total inDuration window, in reading order.
  const units = (layer.text ?? "")
    .split(layer.entrance === "lineReveal" ? "\n" : /\s+/)
    .filter((u) => u.length > 0);
  const n = Math.max(1, units.length);
  const perUnit = 16;
  const window = Math.max(1, inDuration - perUnit);
  const lineMode = layer.entrance === "lineReveal";

  return (
    <div style={boxStyle}>
      <div style={{ ...textStyle, display: "flex", flexDirection: lineMode ? "column" : "row", flexWrap: "wrap", justifyContent: justify, gap: lineMode ? 0 : "0.3em", width: "100%" }}>
        {units.map((u, i) => {
          const unitDelay = layer.delay + Math.round((i / Math.max(1, n - 1)) * window);
          const p = spring({ frame: frame - unitDelay, fps, config: { damping: 200, mass: 0.7 }, durationInFrames: perUnit });
          return (
            <span key={i} style={{ opacity: p, display: "inline-block", transform: `translateY(${(1 - p) * 14}px)`, width: lineMode ? "100%" : undefined }}>
              {u}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const LayerView: React.FC<{ layer: ContentLayer; pageDuration: number }> = ({
  layer,
  pageDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hasExit = (layer.exit && layer.exit !== "none") || (layer.exit2 && layer.exit2 !== "none") || (layer.exit3 && layer.exit3 !== "none");
  const outStart = earliestExitStart(layer, pageDuration);

  // Up to 3 combined entrance/exit effects (FX1/FX2/FX3), each keeping its
  // own progress/easing/timing — see combinedEntranceMotion/
  // combinedExitMotion and combineMotions in presets.ts.
  let m;
  if (hasExit && frame >= outStart) {
    m = combinedExitMotion(layer, frame, pageDuration);
  } else {
    m = combinedEntranceMotion(layer, frame, fps);
  }
  const opacity = m.opacity * layer.opacity;
  const isShape = layer.assetKind === "shape";
  const url = isShape ? "" : staticFile(layer.file);
  // Original PSD/SVG-extracted art is pre-cropped to exactly its box's pixel
  // size, so "cover" vs "fill" looks identical there — but a freshly uploaded
  // replacement photo can be any aspect ratio, and "cover" is what keeps it
  // undistorted (crops to fill instead of stretching).
  const fit = layer.fit ?? "cover";

  // Animated in-frame pan/zoom (optional "cinematic" motion): moves the PHOTO
  // inside its fixed box over time, independent of the box's own
  // entrance/exit/rotate. "none" => scale 1, no movement.
  const pz = ambientMotion(layer.photoMotion ?? "none", frame, pageDuration);

  // Static crop position/zoom: WHICH part of the photo shows inside the fixed
  // frame, and how tight the crop is. The frame (box) itself never moves —
  // this is the user-adjustable knob instead, set by dragging the photo (not
  // the frame) in the editor. 50/50/1 = default centered "cover" crop.
  const panX = layer.photoPanX ?? 50;
  const panY = layer.photoPanY ?? 50;
  const zoom = layer.photoZoom ?? 1;
  const objectPosition = `${panX}% ${panY}%`;

  // BG/Title/photo slots can be replaced by an uploaded asset; render it by
  // kind but keep the layer's box + entrance + page ambient motion. A plain
  // shape layer has no asset at all — just a solid-color (or stroked) box —
  // unless it's carrying an uploaded photo mask, in which case the SHAPE's
  // own geometry (corner radius / circle roundness) clips that photo instead
  // of filling with a flat color; the stroke (if any) still draws on top.
  const shapeRadius = (layer.shapeType === "ellipse" || layer.shapeType === "circle") ? "50%" : (layer.shapeCornerRadius ?? 0);
  const shapeBorder = layer.shapeStrokeWidth
    ? `${layer.shapeStrokeWidth}px solid ${layer.shapeStrokeColor ?? "#000000"}`
    : undefined;
  const media = isShape ? (
    layer.shapePhotoFile ? (
      // A plain overflow:hidden wrapper clips whichever media component
      // renders inside it (Img/OffthreadVideo/Gif each have their own style
      // API — clipping the wrapper instead of each one individually is one
      // rule that works no matter which kind got uploaded).
      <div style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: shapeRadius, border: shapeBorder, overflow: "hidden" }}>
        {layer.shapePhotoKind === "video" ? (
          <OffthreadVideo src={staticFile(layer.shapePhotoFile)} transparent muted={!!layer.videoMuted}
            style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
        ) : layer.shapePhotoKind === "gif" ? (
          <Gif src={staticFile(layer.shapePhotoFile)} fit={fit} width={layer.width} height={layer.height} />
        ) : (
          <Img src={staticFile(layer.shapePhotoFile)}
            style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
        )}
      </div>
    ) : (
      <div
        style={{
          width: "100%", height: "100%", boxSizing: "border-box",
          background: layer.shapeFill ?? "#000000",
          borderRadius: shapeRadius,
          border: shapeBorder,
        }}
      />
    )
  ) :
    layer.assetKind === "video" ? (
      <OffthreadVideo src={url} transparent muted={!!layer.videoMuted}
        style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
    ) : layer.assetKind === "gif" ? (
      <Gif src={url} fit={fit} width={layer.width} height={layer.height} />
    ) : (
      <Img src={url} style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
    );

  // The pan/zoom-wrapped media, reused as-is for both the normal render and
  // (via GlitchOverlay/DataMoshOverlay's children) each glitch ghost copy —
  // so a ghost inherits the exact same crop/pan/zoom as the base instead of
  // duplicating that wrapper's own style object a second and third time.
  const zoomedMedia = (
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: `translate(${pz.tx}px, ${pz.ty}px) scale(${pz.scale}) rotate(${pz.rotate}deg)`,
        transformOrigin: "center center",
      }}
    >
      {media}
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: layer.left,
        top: layer.top,
        width: layer.width,
        height: layer.height,
        opacity,
        filter: motionFilter(m),
        transform: motionTransform(m),
        transformOrigin: "center center",
        clipPath: m.clipPath, // reveal/hide mask (wipe, circle) — undefined = no mask
        boxShadow: shadowStyle(m.shadow, m.glow),
        borderRadius: m.morph !== undefined ? blobRadius(m.morph, frame) : undefined,
        overflow: "hidden", // the box IS the mask — anything inside gets cropped to its shape
      }}
    >
      {zoomedMedia}
      {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
      {m.scanline !== undefined && <ScanlineOverlay scanline={m.scanline} frame={frame} />}
      {m.glitch !== undefined && <GlitchOverlay amount={m.glitch} frame={frame}>{zoomedMedia}</GlitchOverlay>}
      {m.glitchBlocks !== undefined && <DataMoshOverlay amount={m.glitchBlocks} frame={frame}>{zoomedMedia}</DataMoshOverlay>}
      {m.liquid !== undefined && <LiquidOverlay amount={m.liquid}>{zoomedMedia}</LiquidOverlay>}
      {m.burst !== undefined && <BurstOverlay amount={m.burst} frame={frame} />}
      {m.stroke !== undefined && <StrokeDrawOverlay amount={m.stroke} />}
    </div>
  );
};

export const PageScene: React.FC<{ page: Page; background?: string }> = ({
  page,
  background = "transparent", // let the global BG / reel backdrop show through
}) => {
  const frame = useCurrentFrame();
  const a = ambientMotion(page.ambient, frame, page.durationInFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: background, overflow: "hidden" }}>
      {/* Each layer gets its OWN full-page ambient wrapper instead of one
          shared wrapper around all of them — at the default depth (1, same
          as every layer got before this existed) this renders pixel-
          identical to one shared wrapper, since every wrapper is the same
          size/position with the same transform. What it buys: a layer can
          scale that same page-centered transform by its own depth (0 =
          ignores the page ambient entirely, <1 = drifts slower/background
          feel, >1 = drifts more/foreground feel) — real parallax instead of
          every layer moving as one rigid unit. Depth still pivots around
          the PAGE's center (this wrapper spans the whole page), not the
          layer's own center, which is what keeps depth=1 identical to the
          old shared-wrapper behavior. */}
      {page.layers.map((layer) => {
        const depth = layer.parallaxDepth ?? 1;
        const scaled = depth === 1 ? a : {
          tx: a.tx * depth,
          ty: a.ty * depth,
          scale: 1 + (a.scale - 1) * depth,
          rotate: a.rotate * depth,
        };
        return (
          <AbsoluteFill
            key={layer.index}
            style={{
              transform: `translate(${scaled.tx}px, ${scaled.ty}px) scale(${scaled.scale}) rotate(${scaled.rotate}deg)`,
              transformOrigin: "center center",
            }}
          >
            {layer.assetKind === "text" ? (
              <TextLayerView layer={layer} pageDuration={page.durationInFrames} />
            ) : (
              <LayerView layer={layer} pageDuration={page.durationInFrames} />
            )}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
