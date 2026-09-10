import React from "react";
import { spring } from "remotion";
import { glitchNoise } from "./presets";

// Shared render-side pieces for the LayerMotion fields that need real DOM
// on top of the layer, not just a transform/filter on it — the glitch
// family (glitch, glitchBlocks, liquid, scanline, burst, stroke, shine),
// plus the SVG filter defs two of them reference by id, plus scrambleIn/
// Out's text substitution.
//
// These lived inside PageScene.tsx until the Effects gallery needed them
// too: a gallery that skips these overlays shows ~10 of the app's effects
// as "nothing happens" (glitchIn, dataMoshIn, liquidIn, vhsIn, burstIn,
// strokeIn, shineIn and their exits), which is worse than not listing them
// at all. Same reasoning as motionTransform/motionFilter/shadowStyle/
// blobRadius living in presets.ts — one copy, every render path uses it, so
// a preview can never drift from what the real export actually does.

// A moving diagonal highlight for shineIn/shineOut (LayerMotion.shine,
// 0..1 sweep position) — an overlay on top of the content, not a filter on
// it, so it works the same over text, photos, or video. `screen` blend
// brightens what's underneath instead of just painting a flat white stripe.
//
// Band width, measured rather than eyeballed: the gradient stops are
// percentages of a background sized to 300% of the layer, so a stop range
// of N% covers 3N% of the LAYER. The original 35%->65% stops therefore
// painted a highlight 90% as wide as the layer — which is not a specular
// flick, it's the whole layer washing white and staying that way for most
// of the sweep (the reported "the shine stays on the text"). 44%->56% is
// 36% of the layer: a stripe you can actually see travel across it.
const SHINE_BAND = { from: 44, mid: 50, to: 56 };
export const ShineOverlay: React.FC<{ shine: number }> = ({ shine }) => (
  <div
    style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      backgroundImage: `linear-gradient(115deg, transparent ${SHINE_BAND.from}%, rgba(255,255,255,0.75) ${SHINE_BAND.mid}%, transparent ${SHINE_BAND.to}%)`,
      backgroundSize: "300% 300%",
      backgroundPositionX: `${-100 + shine * 300}%`,
      mixBlendMode: "screen",
    }}
  />
);

// rgbSplitIn/Out's steady chromatic aberration (LayerMotion.chroma, 0..1
// split distance). Two ghost copies of the layer's own content, each
// isolated to one color channel by the same shared filters GlitchOverlay
// uses, pulled apart horizontally. The difference from GlitchOverlay is the
// whole point of having both: this one renders EVERY frame with no random
// gate and no clipped slices, so it reads as a lens/registration error that
// resolves, where glitchIn reads as intermittent digital corruption.
export const ChromaOverlay: React.FC<{ amount: number; children: React.ReactNode }> = ({ amount, children }) => {
  if (!amount) return null;
  const dx = amount * 14;
  const ghost = (offset: number, filterId: string): React.CSSProperties => ({
    position: "absolute", inset: 0, pointerEvents: "none", mixBlendMode: "screen",
    transform: `translateX(${offset}px)`,
    filter: `url(#glitch${filterId}Channel)`,
  });
  return (
    <>
      <div style={ghost(-dx, "Red")}>{children}</div>
      <div style={ghost(dx, "Cyan")}>{children}</div>
    </>
  );
};

// staticIn/Out's TV static (LayerMotion.staticNoise, 0..1 opacity). Real
// generated noise via feTurbulence, not a tiled image asset — and reseeded
// from `frame` so it actually churns instead of sitting still. The seed has
// to come through a prop like this (rather than a CSS animation) for the
// same determinism reason as every other overlay in this file: Remotion's
// export captures one frame at a time.
export const StaticOverlay: React.FC<{ amount: number; frame: number }> = ({ amount, frame }) => {
  if (!amount) return null;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: amount, mixBlendMode: "screen" }}
      aria-hidden="true">
      {/* colorInterpolationFilters="sRGB" matters here: the default
          linearRGB pushes the noise's midtones down, and a first attempt
          that also painted the speckle a flat mid-grey came out almost
          invisible once `screen` blended it over real content (screen
          barely moves anything with a dark source). Compared three
          formulations side by side on a real photo before settling on
          this one: paint the speckle WHITE and take its alpha from the
          noise's own luminance, which screen-blends to a bright, legible
          static field. */}
      <filter id={`tvStatic${frame % 8}`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={frame % 64} />
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.7 0.7 0.7 0 -0.55" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#tvStatic${frame % 8})`} />
    </svg>
  );
};


// vhsIn/Out's scanline + jitter overlay (LayerMotion.scanline, 0..1
// intensity). Deterministic from `frame` (not a CSS @keyframes loop) —
// Remotion's headless render captures one frame at a time, not in real
// time, so a live CSS animation has no reliable state to capture; every
// visual change here — and every glitch/data-mosh jitter below — has to be
// a plain function of the actual frame number instead.
export const ScanlineOverlay: React.FC<{ scanline: number; frame: number }> = ({ scanline, frame }) => (
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
export function scrambledText(text: string, revealFrac: number, frame: number): string {
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
export const GlitchOverlay: React.FC<{ amount: number; frame: number; children: React.ReactNode }> = ({ amount, frame, children }) => {
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
export const DataMoshOverlay: React.FC<{ amount: number; frame: number; children: React.ReactNode }> = ({ amount, frame, children }) => {
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
export const LiquidOverlay: React.FC<{ amount: number; children: React.ReactNode }> = ({ amount, children }) => (
  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: amount, filter: "url(#liquidWarp)" }}>
    {children}
  </div>
);

// burstIn/Out's confetti release (LayerMotion.burst, 0..1 progress) — a
// handful of small bits fly outward from center only in the last 30% of
// `amount`'s own range, so it reads as a release right at the moment of
// arrival/departure, not a burst spread evenly across the whole motion.
// Deterministic from (frame, amount), same as every other glitch-family
// overlay in this file.
const PARTICLE_COLORS = ["#ff4d6d", "#ffd23f", "#3fa7ff", "#7cff6b", "#c96bff"];
export const BurstOverlay: React.FC<{ amount: number; frame: number }> = ({ amount, frame }) => {
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
export const StrokeDrawOverlay: React.FC<{ amount: number }> = ({ amount }) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
    <rect x="1.5" y="1.5" width="97" height="97" rx="4" fill="none" stroke="#ffffff" strokeWidth="1.5"
      vectorEffect="non-scaling-stroke" strokeDasharray="392" strokeDashoffset={392 * (1 - amount)} />
  </svg>
);

// The SVG filters GlitchOverlay and LiquidOverlay reference by id. Mounted
// once per render surface — Reel.tsx does it for the real reel, the Effects
// gallery does it for itself — never per-layer: a page-transition crossfade
// can briefly mount two PageScenes at once, and duplicate filter ids would
// collide. width/height 0, this element paints nothing of its own.
//
// `frame` drives liquidWarp's noise frequency as a plain React-controlled
// attribute, re-rendered every frame like everything else, NOT a CSS/SMIL
// loop: Remotion's headless export captures one frame at a time, so a live
// self-running loop has no reliable state to capture.
export const MotionFilterDefs: React.FC<{ frame: number }> = ({ frame }) => {
  // Slowly oscillating, so the warp reads as a real flow over time rather
  // than a frozen distortion. A shared texture: how MUCH of it a given
  // layer shows is that layer's own opacity crossfade (LiquidOverlay), not
  // this filter's strength.
  const liquidBaseFreq = 0.018 + Math.sin(frame * 0.045) * 0.007;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {/* glitchIn/Out's RGB channel split needs a real feColorMatrix to
            isolate one color channel on arbitrary content (photo, video or
            text alike) — no CSS-only trick does that. */}
        <filter id="glitchRedChannel" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        </filter>
        <filter id="glitchCyanChannel" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        </filter>
        {/* liquidIn/Out's organic warp — feTurbulence generates the noise,
            feDisplacementMap uses it to physically shift pixels of whatever
            content sits under the filter (no transform can fake this). */}
        <filter id="liquidWarp" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency={`${liquidBaseFreq} ${liquidBaseFreq * 2.2}`} numOctaves={2} seed={4} result="liquidNoise" />
          <feDisplacementMap in="SourceGraphic" in2="liquidNoise" scale={22} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
};

// --- Text-split reveals -------------------------------------------------
// wordReveal / lineReveal / letterPopIn bypass the LayerMotion pipeline
// entirely: they're not a transform on one box, they're N separately-timed
// spans. Both live here rather than inline in PageScene.tsx's TextLayerView
// for the same reason the overlays above do — the Effects gallery has to
// render them the same way or it shows them as a static block of text.

// Word/line stagger — split on the boundary, spread each unit's own short
// pop-in across the layer's total inDuration window, in reading order.
// Splitting on WORD (or line) boundaries and never on individual letters is
// deliberate and load-bearing: cursive Farsi/Arabic joins letters within a
// word, so a per-letter split visibly breaks the script. See LetterPopText
// below, which is Latin-only for exactly this reason.
export const StaggerText: React.FC<{
  text: string;
  lineMode: boolean;
  frame: number;
  fps: number;
  delay: number;
  inDuration: number;
  justify: React.CSSProperties["justifyContent"];
  textStyle: React.CSSProperties;
}> = ({ text, lineMode, frame, fps, delay, inDuration, justify, textStyle }) => {
  const units = text.split(lineMode ? "\n" : /\s+/).filter((u) => u.length > 0);
  const n = Math.max(1, units.length);
  const perUnit = 16;
  const window = Math.max(1, inDuration - perUnit);
  return (
    <div style={{ ...textStyle, display: "flex", flexDirection: lineMode ? "column" : "row", flexWrap: "wrap", justifyContent: justify, gap: lineMode ? 0 : "0.3em", width: "100%" }}>
      {units.map((u, i) => {
        const unitDelay = delay + Math.round((i / Math.max(1, n - 1)) * window);
        const p = spring({ frame: frame - unitDelay, fps, config: { damping: 200, mass: 0.7 }, durationInFrames: perUnit });
        return (
          <span key={i} style={{ opacity: p, display: "inline-block", transform: `translateY(${(1 - p) * 14}px)`, width: lineMode ? "100%" : undefined }}>
            {u}
          </span>
        );
      })}
    </div>
  );
};

// letterPopIn — individual characters, each with its own spring pop staggered
// by index. LATIN ONLY; callers gate on the layer's own direction === "ltr"
// (see the picker in App.tsx and the isLetterPop check in PageScene.tsx).
export const LetterPopText: React.FC<{
  text: string;
  frame: number;
  fps: number;
  delay: number;
  inDuration: number;
  justify: React.CSSProperties["justifyContent"];
  textStyle: React.CSSProperties;
}> = ({ text, frame, fps, delay, inDuration, justify, textStyle }) => {
  const chars = text.split("");
  const perChar = 14;
  const window = Math.max(1, inDuration - perChar);
  const n = Math.max(1, chars.length);
  return (
    <div style={{ ...textStyle, display: "flex", flexWrap: "wrap", justifyContent: justify, width: "100%" }}>
      {chars.map((c, i) => {
        const charDelay = delay + Math.round((i / Math.max(1, n - 1)) * window);
        const p = spring({ frame: frame - charDelay, fps, config: { damping: 11, mass: 0.7, stiffness: 140 }, durationInFrames: perChar });
        return (
          <span key={i} style={{ display: "inline-block", opacity: p, transform: `scale(${p}) translateY(${(1 - p) * 10}px)` }}>
            {c === " " ? " " : c}
          </span>
        );
      })}
    </div>
  );
};
