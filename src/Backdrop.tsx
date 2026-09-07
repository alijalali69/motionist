// Backdrop treatment renderer — the 4-layer composable system from "The
// Backdrop Reel" research (texture / color / grade / motion), each
// independently optional so they stack instead of being 24 mutually
// exclusive named looks. See BgStyle in types.ts for the field shapes and
// their per-field docs, and BG_*_NAMES / BG_COLOR_DEFAULTS in presets.ts
// for the option lists. Every animated piece here is driven directly by
// `frame` (sin/cos or a seeded pseudo-random, never a CSS @keyframes loop
// or setInterval) — Remotion's headless render captures one frame at a
// time, not in real time, so a live CSS/JS animation has no reliable state
// to capture at export time. Same reasoning as glitchIn/liquidIn/etc. in
// PageScene.tsx, whose glitchNoise() this file reuses directly.
import React from "react";
import { useVideoConfig } from "remotion";
import { noise3D } from "@remotion/noise";
import { glitchNoise, BG_COLOR_DEFAULTS, type BgTextureName, type BgColorName, type BgGradeName, type BgMotionName } from "./presets";
import type { BgStyle } from "./types";

// Real per-pixel noise, not a repeating dot lattice. Two different
// generators, picked per job:
//  - hash3(): a plain sin-hash (same trick glitchNoise() above already uses,
//    just extended to 3 inputs) — genuinely independent from one pixel to
//    the next, which is what fine grain/tooth actually looks like.
//  - noise3D() from @remotion/noise: a real simplex field, deliberately
//    SMOOTH from one sample to the next — right for paper's large-scale
//    fiber clumps, wrong for fine grain (sampling it at a high enough
//    frequency to fake independence instead surfaces its underlying skewed
//    triangular lattice as visible diagonal streaking — hit this for real
//    before switching fine detail over to hash3()).
// Both are deterministic (same seed+coords always gives the same value),
// which a Remotion render needs: sampled fresh every frame with no
// persisted state, every frame — and every re-render of the same frame,
// e.g. seeking in the Player, or a parallel-chunked CLI render — has to
// land on identical pixels.
//
// Drawn onto a small offscreen-resolution <canvas> and CSS-stretched to
// fill the frame: computing true per-pixel noise at full composition
// resolution (2M+ pixels on a 1080x1920 reel) every few frames would be
// real work for no visible gain, and the low resolution IS the grain's own
// size besides — real film grain isn't one photo pixel wide either.
function hash3(x: number, y: number, z: number, seed: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 93.989) * 43758.5453;
  return v - Math.floor(v); // [0, 1)
}

function noiseCanvasSize(compW: number, compH: number, divisor: number, min: number, max: number) {
  // min/max bound the WIDTH only — h is then derived from the real aspect
  // ratio so a tall 9:16 reel doesn't get its grain squashed by clamping h
  // against the same ceiling as w (a portrait canvas needs h > w).
  const w = Math.max(min, Math.min(max, Math.round(compW / divisor)));
  const h = Math.max(1, Math.round((compH / compW) * w));
  return { w, h };
}

const NoiseCanvas: React.FC<{
  seed: number;
  z: number;
  resW: number;
  resH: number;
  kind: "grain" | "paperFiber";
  tintColor?: string;
}> = ({ seed, z, resW, resH, kind, tintColor }) => {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = resW;
    canvas.height = resH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(resW, resH);
    const data = img.data;
    // Paper's fiber texture layers a slow, large-scale field (clumps/
    // watermark-like mottling, real simplex) with a fast, fine one (the
    // paper's own "tooth", hash white noise) — one alone looks like either
    // a blurry cloud or flat static, neither of which reads as a physical
    // sheet the way both together do.
    //
    // The +0.5-ish offsets on the simplex sample aren't decorative: classic
    // Perlin/simplex noise is exactly 0 at every integer lattice coordinate
    // on every axis by construction, and x/y/z here are otherwise all whole
    // numbers (loop indices, and a whole-number z) — sampled raw, EVERY
    // pixel lands exactly on a lattice point and the whole canvas comes out
    // a flat, noise-free gray (hit this for real: min===max===128 over the
    // entire buffer). Nudging each axis off-integer is the fix; hash3()
    // doesn't need it — it has no lattice to land on.
    const [tr, tg, tb] = tintColor ? hexToRgb(tintColor) : [120, 100, 60];
    for (let y = 0; y < resH; y++) {
      for (let x = 0; x < resW; x++) {
        const i = (y * resW + x) * 4;
        if (kind === "grain") {
          const r = hash3(x, y, z, seed);
          const v = Math.max(0, Math.min(255, Math.round(128 + (r - 0.5) * 200)));
          data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        } else {
          const clump = noise3D(seed, x * 0.05 + 0.213, y * 0.05 + 0.859, z + 0.417) * 0.5 + 0.5;
          const tooth = hash3(x, y, z, seed + 100);
          const lum = clump * 0.6 + tooth * 0.4;
          data[i] = tr; data[i + 1] = tg; data[i + 2] = tb;
          data[i + 3] = Math.round(lum * 255);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [seed, z, resW, resH, kind, tintColor]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
};

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  if (Number.isNaN(n)) return [120, 100, 60];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TextureLayer: React.FC<{ name: BgTextureName; intensity: number; colorA?: string; frame: number }> = ({ name, intensity, colorA, frame }) => {
  const { width: compW, height: compH } = useVideoConfig();
  if (name === "none" || !intensity) return null;
  switch (name) {
    case "filmGrain": {
      // A fresh noise field every 4 frames (stepped, not smoothly
      // interpolated) — a flickering grain read, matching how real
      // emulsion grain "boils" from frame to frame, not a slow crawl.
      const step = Math.floor(frame / 4);
      const { w, h } = noiseCanvasSize(compW, compH, 5, 90, 260);
      return (
        <div style={{ position: "absolute", inset: 0, opacity: intensity, mixBlendMode: "overlay", pointerEvents: "none" }}>
          <NoiseCanvas seed={7.13} z={step} resW={w} resH={h} kind="grain" />
        </div>
      );
    }
    case "paperGrain": {
      // Static — real paper doesn't animate, so z is a fixed constant, not
      // frame-driven (computed once per mount, unlike filmGrain above).
      const { w, h } = noiseCanvasSize(compW, compH, 3, 140, 420);
      return (
        <>
          <div style={{ position: "absolute", inset: 0, opacity: intensity, mixBlendMode: "multiply", pointerEvents: "none" }}>
            {/* Fixed warm paper tone, not colorA — colorA is this backdrop's
                accent color (used by halftone/riso's ink dots), a different
                knob than "what shade is the paper itself." */}
            <NoiseCanvas seed={41.7} z={0} resW={w} resH={h} kind="paperFiber" />
          </div>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: intensity,
            background: "radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(90,70,30,0.25) 100%)" }} />
        </>
      );
    }
    case "halftone": {
      const px = (frame * 0.3) % 9;
      const py = (frame * 0.6) % 18;
      return (
        <div style={{
          position: "absolute", inset: "-10%", opacity: 0.4 + intensity * 0.6, mixBlendMode: "multiply", pointerEvents: "none",
          backgroundImage: `radial-gradient(${colorA ?? "#0d0b13"} 32%, transparent 34%)`, backgroundSize: "9px 9px",
          backgroundPosition: `${px}px ${py}px`,
        }} />
      );
    }
    case "canvasWeave":
      return (
        <div style={{
          position: "absolute", inset: 0, opacity: intensity, mixBlendMode: "multiply", pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(90deg, rgba(90,70,40,0.5) 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, rgba(90,70,40,0.35) 0 1px, transparent 1px 3px)",
        }} />
      );
    case "scratches": {
      // Each scratch flickers into view only during a short window of its
      // own frame-modulo cycle — same "bursty, not constant" idea as
      // GlitchOverlay, just on a longer/gentler cadence.
      const seeds = [11, 47, 83];
      const scratches = seeds.map((s, i) => {
        const cycle = (frame + s) % 90;
        if (!(cycle > 78 && cycle < 86)) return null;
        return (
          <div key={i} style={{
            position: "absolute", top: "-10%", left: `${20 + i * 28}%`, width: 1, height: "120%",
            background: "rgba(255,255,255,0.55)",
          }} />
        );
      });
      return (
        <div style={{ position: "absolute", inset: 0, opacity: intensity, mixBlendMode: "screen", pointerEvents: "none" }}>
          {scratches}
          <div style={{
            position: "absolute", inset: 0, opacity: 0.15,
            backgroundImage: "radial-gradient(rgba(255,255,255,0.7) 0.7px, transparent 0.7px)", backgroundSize: "14px 14px",
          }} />
        </div>
      );
    }
    case "riso":
      return (
        <div style={{ position: "absolute", inset: 0, opacity: intensity, pointerEvents: "none" }}>
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", transform: "translate(1.5px,-1px)",
            background: `radial-gradient(circle at 30% 35%, ${colorA ?? "#ff5678"}8c, transparent 60%)` }} />
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", transform: "translate(-1.5px,1px)",
            background: "radial-gradient(circle at 68% 62%, #148cb480, transparent 60%)" }} />
          <div style={{ position: "absolute", inset: 0, opacity: 0.35, mixBlendMode: "multiply",
            backgroundImage: "radial-gradient(rgba(0,0,0,0.6) 0.5px, transparent 0.5px)", backgroundSize: "2.5px 2.5px" }} />
        </div>
      );
    default:
      return null;
  }
};

const ColorLayer: React.FC<{ name: BgColorName; colorA?: string; colorB?: string; colorC?: string; intensity: number; speed: number; frame: number }> = ({ name, colorA, colorB, colorC, intensity, speed, frame }) => {
  if (name === "none") return null;
  const [dA, dB, dC] = BG_COLOR_DEFAULTS[name];
  const a = colorA || dA, b = colorB || dB, c = colorC || dC;
  const t = frame * speed;
  let content: React.ReactNode;
  switch (name) {
    case "mesh": {
      const ox = Math.sin(t * 0.02) * 10, oy = Math.cos(t * 0.017) * 8;
      content = (
        <div style={{ position: "absolute", inset: 0,
          background: `radial-gradient(circle at ${20 + ox}% 25%, ${a} 0%, transparent 45%), radial-gradient(circle at 80% ${30 + oy}%, ${b} 0%, transparent 50%), radial-gradient(circle at 50% 85%, ${c} 0%, transparent 50%), #161320` }} />
      );
      break;
    }
    case "duotone":
      content = (
        <>
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(150deg, ${a}, ${b} 70%)` }} />
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "screen", background: `radial-gradient(circle at 65% 30%, ${c}59, transparent 60%)` }} />
        </>
      );
      break;
    case "aurora": {
      const skew = Math.sin(t * 0.03) * 6 - 4;
      const tx = Math.sin(t * 0.03) * 12;
      content = (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: b }}>
          <div style={{ position: "absolute", inset: "-20% -50%", filter: "blur(6px)", transform: `translateX(${tx}%) skewY(${skew}deg)`,
            background: `linear-gradient(100deg, transparent 10%, ${a}59 30%, ${c}4d 45%, transparent 60%)` }} />
        </div>
      );
      break;
    }
    case "spotlight": {
      const pulse = 0.7 + Math.sin(t * 0.05) * 0.3;
      content = (
        <div style={{ position: "absolute", inset: 0, background: b }}>
          <div style={{ position: "absolute", inset: 0, opacity: pulse,
            background: `radial-gradient(circle at 50% 38%, ${a}, transparent 45%)` }} />
        </div>
      );
      break;
    }
    case "neonGlow": {
      const rot = (t * 2) % 360;
      content = (
        <div style={{ position: "absolute", inset: "-20%", filter: "blur(24px) saturate(1.6)",
          background: `conic-gradient(from ${rot}deg, ${a}, ${b}, ${c}, ${a})` }} />
      );
      break;
    }
    case "monoBreathe": {
      const breathe = 0.15 + (Math.sin(t * 0.04) * 0.5 + 0.5) * 0.35;
      content = (
        <>
          <div style={{ position: "absolute", inset: 0, background: b }} />
          <div style={{ position: "absolute", inset: 0, background: a, mixBlendMode: "overlay", opacity: breathe * 2 }} />
        </>
      );
      break;
    }
    default:
      content = null;
  }
  return <div style={{ position: "absolute", inset: 0, opacity: intensity, pointerEvents: "none" }}>{content}</div>;
};

// vignette/letterbox/tealOrange/flare render as their own overlay; black &
// white/sepia are a CSS `filter` on the WHOLE backdrop stack (see
// gradeFilter below) since desaturating/toning has to affect the texture
// and color layers together, not just add one more overlay on top of them.
const GradeOverlay: React.FC<{ name: BgGradeName; intensity: number; frame: number }> = ({ name, intensity, frame }) => {
  switch (name) {
    case "vignette":
      return <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        boxShadow: `inset 0 0 ${60 * intensity}px ${18 * intensity}px rgba(0,0,0,0.75)` }} />;
    case "letterbox": {
      const h = 8 + intensity * 10;
      return (
        <>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: `${h}%`, background: "#000", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${h}%`, background: "#000", pointerEvents: "none" }} />
        </>
      );
    }
    case "tealOrange":
      return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: intensity, mixBlendMode: "overlay",
        background: "linear-gradient(165deg, rgba(255,150,80,0.25), rgba(20,90,90,0.25))" }} />;
    case "sepia":
      // The warm tone itself is the wrapper's filter: sepia(); this is just
      // sepia's own extra vignette, matching the reference look.
      return <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        boxShadow: `inset 0 0 ${50 * intensity}px ${14 * intensity}px rgba(30,15,5,0.6)` }} />;
    case "flare": {
      const cycle = 130;
      const phase = (frame % cycle) / cycle;
      const tx = -20 + phase * 140;
      const envelope = Math.sin(phase * Math.PI);
      return (
        <div style={{
          position: "absolute", top: "14%", left: "-30%", width: "160%", height: "6%", pointerEvents: "none",
          opacity: envelope * intensity, transform: `translateX(${tx}%) rotate(-8deg)`,
          background: "linear-gradient(90deg, transparent, rgba(140,200,255,0.55) 45%, rgba(255,255,255,0.85) 50%, rgba(140,200,255,0.55) 55%, transparent)",
        }} />
      );
    }
    default:
      return null;
  }
};

function gradeFilter(name: BgGradeName, intensity: number): string | undefined {
  if (name === "blackWhite") return `grayscale(${intensity}) contrast(1.1)`;
  if (name === "sepia") return `sepia(${intensity * 0.7})`;
  return undefined;
}

const MOTION_BASE_COUNT: Record<Exclude<BgMotionName, "none">, number> = {
  bokeh: 6, dust: 8, snow: 10, embers: 8, lightLeak: 1, parallaxBlobs: 2,
};
const BOKEH_COLORS = ["#ff6fa5", "#3fa7ff", "#ffd23f", "#7cff6b", "#c96bff"];

const MotionLayer: React.FC<{ name: BgMotionName; density: number; speed: number; frame: number; colorA?: string; colorB?: string }> = ({ name, density, speed, frame, colorA, colorB }) => {
  if (name === "none") return null;
  const t = frame * speed;
  const countFor = (base: number) => Math.max(1, Math.round(base * (0.4 + density * 1.3)));
  switch (name) {
    case "bokeh": {
      const n = countFor(MOTION_BASE_COUNT.bokeh);
      return <>{Array.from({ length: n }, (_, i) => {
        const left = glitchNoise(i, 201) * 90 + 5, top = glitchNoise(i, 202) * 90 + 5;
        const size = 14 + glitchNoise(i, 203) * 24;
        const bob = Math.sin(t * 0.03 + i * 1.7) * 14;
        return <div key={i} style={{ position: "absolute", left: `${left}%`, top: `${top}%`, width: size, height: size,
          borderRadius: "50%", background: BOKEH_COLORS[i % BOKEH_COLORS.length], opacity: 0.45, filter: "blur(1px)",
          transform: `translateY(${bob}px)`, pointerEvents: "none" }} />;
      })}</>;
    }
    case "dust": {
      const n = countFor(MOTION_BASE_COUNT.dust);
      return <>{Array.from({ length: n }, (_, i) => {
        const left = glitchNoise(i, 211) * 100;
        const cycle = 300 + glitchNoise(i, 212) * 150;
        const phase = (t + i * 71) % cycle;
        const y = 110 - (phase / cycle) * 120;
        return <div key={i} style={{ position: "absolute", left: `${left}%`, top: `${y}%`, width: 2.5, height: 2.5,
          borderRadius: "50%", background: "#fff", opacity: 0.5, pointerEvents: "none" }} />;
      })}</>;
    }
    case "snow": {
      const n = countFor(MOTION_BASE_COUNT.snow);
      return <>{Array.from({ length: n }, (_, i) => {
        const left = glitchNoise(i, 221) * 100;
        const cycle = 200 + glitchNoise(i, 222) * 150;
        const phase = (t + i * 53) % cycle;
        const y = -10 + (phase / cycle) * 130;
        return <div key={i} style={{ position: "absolute", left: `${left}%`, top: `${y}%`, width: 4, height: 4,
          borderRadius: "50%", background: "#fff", pointerEvents: "none" }} />;
      })}</>;
    }
    case "embers": {
      const n = countFor(MOTION_BASE_COUNT.embers);
      return <>{Array.from({ length: n }, (_, i) => {
        const left = glitchNoise(i, 231) * 100;
        const cycle = 130 + glitchNoise(i, 232) * 100;
        const phase = (t + i * 67) % cycle;
        const frac = phase / cycle;
        const y = 100 - frac * 140;
        const x = left + frac * (glitchNoise(i, 233) * 20 - 10);
        return <div key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 3, height: 3,
          borderRadius: "50%", background: "#ff8a3d", boxShadow: "0 0 5px 1px #ff8a3d",
          opacity: 1 - frac, pointerEvents: "none" }} />;
      })}</>;
    }
    case "lightLeak": {
      const dx = Math.sin(t * 0.02) * 30, dy = Math.cos(t * 0.017) * 20;
      return <div style={{ position: "absolute", inset: "-30%", pointerEvents: "none", mixBlendMode: "screen",
        transform: `translate(${dx}%, ${dy}%)`,
        background: `radial-gradient(circle at 20% 30%, ${colorA ?? "#ffaa5a"}8c, transparent 40%)` }} />;
    }
    case "parallaxBlobs": {
      const dx1 = Math.sin(t * 0.02) * 10, dy1 = Math.cos(t * 0.018) * 8;
      return (
        <>
          <div style={{ position: "absolute", width: "70%", height: "40%", top: "10%", left: "-15%",
            borderRadius: "50%", background: colorA ?? "#5a3fd6", opacity: 0.55, filter: "blur(18px)", pointerEvents: "none",
            transform: `translate(${dx1}%, ${dy1}%)` }} />
          <div style={{ position: "absolute", width: "60%", height: "35%", bottom: "8%", right: "-15%",
            borderRadius: "50%", background: colorB ?? "#ff3d78", opacity: 0.5, filter: "blur(18px)", pointerEvents: "none",
            transform: `translate(${-dx1}%, ${-dy1}%)` }} />
        </>
      );
    }
    default:
      return null;
  }
};

// Top-level composite — stacks color under texture under the grade overlay
// (grade's filter half wraps all three, plus motion, since desaturating a
// backdrop means desaturating everything on it, particles included).
// Renders nothing at all when every layer is "none" (the common case for a
// project that's never touched this feature).
export const Backdrop: React.FC<{ style: BgStyle; frame: number }> = ({ style, frame }) => {
  const texture = style.texture ?? "none";
  const color = style.color ?? "none";
  const grade = style.grade ?? "none";
  const motion = style.motion ?? "none";
  if (texture === "none" && color === "none" && grade === "none" && motion === "none") return null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", filter: gradeFilter(grade, style.gradeIntensity ?? 0.5) }}>
      <ColorLayer name={color} colorA={style.colorA} colorB={style.colorB} colorC={style.colorC}
        intensity={style.colorIntensity ?? 0.6} speed={style.colorSpeed ?? 1} frame={frame} />
      <TextureLayer name={texture} intensity={style.textureIntensity ?? 0.5} colorA={style.colorA} frame={frame} />
      <GradeOverlay name={grade} intensity={style.gradeIntensity ?? 0.5} frame={frame} />
      <MotionLayer name={motion} density={style.motionDensity ?? 0.5} speed={style.motionSpeed ?? 1}
        frame={frame} colorA={style.colorA} colorB={style.colorB} />
    </div>
  );
};
