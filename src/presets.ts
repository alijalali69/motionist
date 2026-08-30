// Motion + transition preset library. This is the curated "menu" the app offers.
// Entrances are pure functions of a 0..1 progress; ambient is a function of frame.
import { interpolate, spring, Easing } from "remotion";

export type EntranceName =
  | "none"
  | "fade"
  | "slideRight"
  | "slideLeft"
  | "slideUp"
  | "slideDown"
  | "pop"
  | "zoomIn"
  | "zoomOut"
  | "growIn"
  | "dropIn"
  | "riseIn"
  | "blurIn"
  | "rotateIn"
  | "flipIn"
  | "floatIn"
  | "wipeLeftToRight"
  | "wipeRightToLeft"
  | "wipeTopToBottom"
  | "wipeBottomToTop"
  | "circleReveal"
  // 3D flip with a cast shadow that grows in as the layer "lands" flat —
  // like flipIn but with real weight to it (see LayerMotion.shadow).
  | "cardFlipIn"
  // A moving diagonal highlight sweeps across the layer once, on top of
  // whatever else is combined with it (see LayerMotion.shine).
  | "shineIn"
  // Stepped clip-path reveal (a handful of discrete jumps, not a smooth
  // wipe) — reads as "typed out" left-to-right. Text-shaping-safe: unlike
  // word/lineReveal this never splits the DOM text at all, it's the same
  // clip-path mechanism as wipeLeftToRight, just stepped instead of smooth.
  | "typewriter"
  // Text-only: split into words/lines and reveal in sequence — safe for
  // cursive Farsi/Arabic script because each WORD stays one intact shaped
  // unit (never splits individual letters, which would break joining).
  | "wordReveal"
  | "lineReveal";

export const ENTRANCE_NAMES: EntranceName[] = [
  "none", "fade", "slideRight", "slideLeft", "slideUp", "slideDown",
  "pop", "zoomIn", "zoomOut", "growIn", "dropIn", "riseIn",
  "blurIn", "rotateIn", "flipIn", "floatIn",
  "wipeLeftToRight", "wipeRightToLeft", "wipeTopToBottom", "wipeBottomToTop", "circleReveal",
  "cardFlipIn", "shineIn", "typewriter",
];

// Text-only entrances — offered in a separate list so image/photo layers
// don't show options that only make sense for live text.
export const TEXT_ENTRANCE_NAMES: EntranceName[] = ["wordReveal", "lineReveal"];

export type AmbientName =
  | "none"
  | "kenburns"
  | "kenburnsIn"
  | "panLeft"
  | "panRight"
  | "panUp"
  | "panDown"
  | "zoomIn"
  | "zoomOut"
  | "float"
  | "sway"
  | "pulse"
  | "parallax";

export const AMBIENT_NAMES: AmbientName[] = [
  "none", "kenburns", "kenburnsIn", "panLeft", "panRight", "panUp", "panDown",
  "zoomIn", "zoomOut", "float", "sway", "pulse", "parallax",
];

export type ExitName =
  | "none"
  | "fadeOut"
  | "slideOutLeft"
  | "slideOutRight"
  | "slideOutUp"
  | "slideOutDown"
  | "shrinkOut"
  | "zoomOut"
  | "popOut"
  | "blurOut"
  | "dropOut"
  | "riseOut"
  | "rotateOut"
  | "flipOut"
  | "wipeOutLeftToRight"
  | "wipeOutRightToLeft"
  | "wipeOutTopToBottom"
  | "wipeOutBottomToTop"
  | "circleHide"
  | "cardFlipOut"
  | "shineOut"
  | "typewriterOut";

export const EXIT_NAMES: ExitName[] = [
  "none", "fadeOut", "slideOutLeft", "slideOutRight", "slideOutUp", "slideOutDown",
  "shrinkOut", "zoomOut", "popOut", "blurOut", "dropOut", "riseOut", "rotateOut", "flipOut",
  "wipeOutLeftToRight", "wipeOutRightToLeft", "wipeOutTopToBottom", "wipeOutBottomToTop", "circleHide",
  "cardFlipOut", "shineOut", "typewriterOut",
];

// Page-to-page transitions. `name` is stored on the page; `label` shows in the UI.
export const TRANSITIONS: { name: string; label: string }[] = [
  { name: "none", label: "none / cut" },
  { name: "fade", label: "fade" },
  { name: "slide-from-right", label: "slide ← (from right)" },
  { name: "slide-from-left", label: "slide → (from left)" },
  { name: "slide-from-bottom", label: "slide ↑ (from bottom)" },
  { name: "slide-from-top", label: "slide ↓ (from top)" },
  { name: "wipe-from-right", label: "wipe ←" },
  { name: "wipe-from-left", label: "wipe →" },
  { name: "wipe-from-bottom", label: "wipe ↑" },
  { name: "wipe-from-top", label: "wipe ↓" },
  { name: "flip-from-right", label: "flip ←" },
  { name: "flip-from-left", label: "flip →" },
  { name: "flip-from-bottom", label: "flip ↑" },
  { name: "clock-wipe", label: "clock wipe" },
  { name: "iris", label: "iris (circle)" },
];

export type LayerMotion = {
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
  blur: number;
  rotate: number;
  rotateY: number; // 3D flip around the vertical axis — 0 = flat/facing forward
  clipPath?: string; // reveal/hide mask, applied on top of the other transforms
  shadow?: number; // 0..1 cast-shadow intensity — cardFlipIn/Out's "landing" shadow
  shine?: number; // 0..1 sweep position for a moving highlight overlay — shineIn/shineOut
};

const BASE: LayerMotion = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, rotateY: 0 };

// Combines up to 3 simultaneous entrance (or exit) motions into one. Each
// property has its own composition rule, chosen so combining doesn't
// double-count the same visual dimension:
//   opacity  — MIN, not multiply/average. Almost every effect already
//              encodes "fade" as part of its own opacity (e.g. slideRight
//              returns opacity: p, not 1) — multiplying several of those
//              together would compound into a much slower-looking fade
//              (p * p * p). MIN instead means the layer is only as visible
//              as whichever combined effect is currently the most
//              restrictive — a mask-reveal effect (opacity stays 1, the
//              clipPath does the hiding) never fights a genuine fade.
//   tx/ty/rotate/rotateY/blur — SUM. These are independent offsets that
//              naturally stack (slide right + float up = enters from the
//              lower-right, exactly the sum of each effect's own offset).
//   scale    — MULTIPLY. Scale factors compose multiplicatively, same as
//              stacking CSS transforms.
//   clipPath — first non-empty one wins. Two reveal masks can't both apply
//              to the same layer at once; combining two mask effects just
//              uses whichever was picked first (FX1 before FX2/FX3).
export function combineMotions(motions: LayerMotion[]): LayerMotion {
  if (motions.length === 0) return BASE;
  if (motions.length === 1) return motions[0];
  let opacity = 1, tx = 0, ty = 0, scale = 1, blur = 0, rotate = 0, rotateY = 0;
  let clipPath: string | undefined;
  let shadow: number | undefined;
  let shine: number | undefined;
  for (const m of motions) {
    opacity = Math.min(opacity, m.opacity);
    tx += m.tx; ty += m.ty;
    scale *= m.scale;
    blur += m.blur;
    rotate += m.rotate;
    rotateY += m.rotateY;
    if (!clipPath && m.clipPath) clipPath = m.clipPath;
    // Shadow intensity: MAX, not sum — two combined effects both casting a
    // shadow should read as one shadow at its strongest point, not a
    // doubled-up value that could exceed 1.
    if (m.shadow !== undefined) shadow = Math.max(shadow ?? 0, m.shadow);
    // Shine sweep, like clipPath: only one sweep makes sense on a layer at
    // once, first one set wins.
    if (shine === undefined && m.shine !== undefined) shine = m.shine;
  }
  return { opacity, tx, ty, scale, blur, rotate, rotateY, clipPath, shadow, shine };
}

// Spring feel per entrance — bouncy ones overshoot, the rest settle smoothly.
export function entranceSpring(name: EntranceName) {
  const bouncy = name === "pop" || name === "growIn" || name === "dropIn";
  return bouncy
    ? { damping: 12, mass: 0.85, stiffness: 130 }
    : { damping: 200, mass: 0.7 };
}

// --- Easing -----------------------------------------------------------
// "spring" is physics (Remotion's real spring() simulator, tuned per-effect
// above — bouncy ones overshoot). Everything else is a named cubic-bezier
// curve, using the actual industry-standard control points (the same ones
// CSS/Framer Motion/GSAP ship as their own named curves — easings.net is
// the common reference), not a generic one-size-fits-all "ease" for
// everything. A layer can override its effect's default via
// entranceEasing/exitEasing; leaving it unset uses the curated default
// below for whichever entrance/exit it's using.
export type EasingName =
  | "spring"
  | "linear"
  | "ease"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "easeOutCubic"
  | "easeInCubic"
  | "easeOutExpo"
  | "easeInExpo"
  | "easeOutBack"
  | "easeInBack"
  // A real multi-bounce settle (ball dropping and rebounding a few times,
  // each smaller) — genuinely different from easeOutBack's single overshoot.
  // Can't be expressed as a cubic-bezier at all (bezier is monotonic-ish by
  // nature; this needs several literal up-down rebounds), so it's the one
  // named curve here that isn't Easing.bezier(...) under the hood.
  | "bounce";

export const EASING_NAMES: EasingName[] = [
  "spring", "linear", "ease", "easeIn", "easeOut", "easeInOut",
  "easeOutCubic", "easeInCubic", "easeOutExpo", "easeInExpo",
  "easeOutBack", "easeInBack", "bounce",
];

// Standard easeOutBounce (the classic Penner formula, same one easings.net/
// every animation library ships) — a plain JS function works fine here,
// same as the Easing.bezier(...) results below; Remotion's `easing` option
// just wants any (t: number) => number.
function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
  if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

function easingFn(name: Exclude<EasingName, "spring">): (t: number) => number {
  switch (name) {
    case "bounce": return bounceOut;
    case "linear": return Easing.linear;
    case "ease": return Easing.bezier(0.25, 0.1, 0.25, 1.0);
    case "easeIn": return Easing.bezier(0.42, 0, 1.0, 1.0);
    case "easeOut": return Easing.bezier(0, 0, 0.58, 1.0);
    case "easeInOut": return Easing.bezier(0.42, 0, 0.58, 1.0);
    case "easeOutCubic": return Easing.bezier(0.215, 0.61, 0.355, 1);
    case "easeInCubic": return Easing.bezier(0.55, 0.055, 0.675, 0.19);
    case "easeOutExpo": return Easing.bezier(0.19, 1, 0.22, 1);
    case "easeInExpo": return Easing.bezier(0.95, 0.05, 0.795, 0.035);
    case "easeOutBack": return Easing.bezier(0.34, 1.56, 0.64, 1); // slight overshoot, then settles
    case "easeInBack": return Easing.bezier(0.36, 0, 0.66, -0.56); // slight pull-back before leaving
    default: return Easing.bezier(0.25, 0.1, 0.25, 1.0);
  }
}

// Crafted per motion character rather than one blanket curve for every
// entrance — a punchy zoom wants overshoot, a slide wants a clean
// decelerate, a mask wipe reads best fairly linear-ish (ease-in-out).
const DEFAULT_ENTRANCE_EASING: Partial<Record<EntranceName, EasingName>> = {
  fade: "easeInOut",
  slideRight: "easeOutCubic", slideLeft: "easeOutCubic",
  slideUp: "easeOutCubic", slideDown: "easeOutCubic",
  pop: "spring", growIn: "spring", dropIn: "spring",
  // NOT easeOutExpo here — measured it live: that curve is genuinely
  // correct for its name, but it means "snap to ~done almost instantly,
  // then sit still for the rest of the duration" — over a normal ~1s
  // entrance that reads as "barely animates," not smooth or punchy.
  zoomIn: "easeOutBack", zoomOut: "easeOutCubic",
  riseIn: "easeOutCubic", floatIn: "easeOutCubic",
  blurIn: "easeInOut",
  rotateIn: "easeOutBack",
  flipIn: "easeInOut",
  wipeLeftToRight: "easeInOut", wipeRightToLeft: "easeInOut",
  wipeTopToBottom: "easeInOut", wipeBottomToTop: "easeInOut",
  circleReveal: "easeInOut",
  cardFlipIn: "easeOutCubic",
  shineIn: "easeInOut",
  // Linear, deliberately — real typing happens at a constant rate; an eased
  // curve would bunch the steps up at one end instead of ticking evenly.
  typewriter: "linear",
};

// Exits mirror the entrance table's intent but reversed: things arriving
// decelerate INTO place (ease-out), things leaving accelerate AWAY
// (ease-in) — the standard motion-design convention, now actually applied
// per-effect instead of every exit sharing one identical curve.
const DEFAULT_EXIT_EASING: Partial<Record<ExitName, EasingName>> = {
  fadeOut: "easeIn",
  slideOutLeft: "easeInCubic", slideOutRight: "easeInCubic",
  slideOutUp: "easeInCubic", slideOutDown: "easeInCubic",
  // NOT easeInExpo — measured it live (see the entrance table's zoomOut
  // comment): near-zero visible motion for ~85% of the duration, then a
  // sudden snap in the last couple frames. Reads as broken, not gradual.
  shrinkOut: "easeInCubic", zoomOut: "easeInCubic", popOut: "easeIn",
  blurOut: "easeIn",
  dropOut: "easeInCubic", riseOut: "easeInCubic",
  rotateOut: "easeInCubic",
  flipOut: "easeInOut",
  wipeOutLeftToRight: "easeInOut", wipeOutRightToLeft: "easeInOut",
  wipeOutTopToBottom: "easeInOut", wipeOutBottomToTop: "easeInOut",
  circleHide: "easeInOut",
  cardFlipOut: "easeInCubic",
  shineOut: "easeIn",
  typewriterOut: "linear",
};

// 0..1 entrance progress, driven by whichever easing applies — physics
// (spring) or a bezier curve. `easingOverride` is the layer's own explicit
// choice (from the picker); leave it undefined to use the curated default
// for this entrance.
export function entranceProgress(
  name: EntranceName,
  easingOverride: EasingName | undefined,
  frame: number,
  fps: number,
  delay: number,
  inDuration: number
): number {
  const easing = easingOverride ?? DEFAULT_ENTRANCE_EASING[name] ?? "ease";
  if (easing === "spring") {
    return spring({ frame: frame - delay, fps, config: entranceSpring(name), durationInFrames: inDuration });
  }
  return interpolate(frame - delay, [0, inDuration], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easingFn(easing),
  });
}

// 0..1 exit progress (0 = fully in / at rest, 1 = fully gone). "spring" as
// an exit choice falls back to a clean ease-in — a settle-to-rest simulator
// run backwards doesn't read as a natural "leaving" motion, so exits don't
// offer real spring physics, only the curated/overridden bezier curve.
export function exitProgress(
  name: ExitName,
  easingOverride: EasingName | undefined,
  frame: number,
  outStart: number,
  outDuration: number
): number {
  const resolved = easingOverride ?? DEFAULT_EXIT_EASING[name] ?? "easeIn";
  const easing = resolved === "spring" ? "easeIn" : resolved;
  return interpolate(frame, [outStart, outStart + outDuration], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easingFn(easing),
  });
}

// p = spring progress 0..1 for this layer's entrance.
export function entranceMotion(name: EntranceName, p: number): LayerMotion {
  switch (name) {
    case "none":
      return BASE;
    case "fade":
      return { ...BASE, opacity: p };
    case "slideRight": // enters from the right (natural for RTL)
      return { ...BASE, opacity: p, tx: (1 - p) * 90 };
    case "slideLeft":
      return { ...BASE, opacity: p, tx: -(1 - p) * 90 };
    case "slideUp":
      return { ...BASE, opacity: p, ty: (1 - p) * 90 };
    case "slideDown":
      return { ...BASE, opacity: p, ty: -(1 - p) * 90 };
    case "pop":
      return { ...BASE, opacity: p, scale: interpolate(p, [0, 1], [0.9, 1]) };
    case "zoomIn":
      return { ...BASE, opacity: p, scale: interpolate(p, [0, 1], [0.6, 1]) };
    case "zoomOut":
      return { ...BASE, opacity: p, scale: interpolate(p, [0, 1], [1.25, 1]) };
    case "growIn":
      return { ...BASE, opacity: p, scale: interpolate(p, [0, 1], [0.0, 1]) };
    case "dropIn":
      return { ...BASE, opacity: p, ty: -(1 - p) * 160 };
    case "riseIn":
      return { ...BASE, opacity: p, ty: (1 - p) * 160 };
    case "blurIn":
      return { ...BASE, opacity: p, blur: interpolate(p, [0, 1], [16, 0]) };
    case "rotateIn":
      return { ...BASE, opacity: p, rotate: (1 - p) * -10, scale: interpolate(p, [0, 1], [0.96, 1]) };
    case "flipIn": // 3D card-flip around the vertical axis, settling face-on
      return { ...BASE, opacity: p, rotateY: (1 - p) * -100 };
    case "floatIn":
      return { ...BASE, opacity: p, ty: (1 - p) * 30 };
    // Reveal masks: the layer stays fully opaque; a clip-path shape grows to
    // uncover it, instead of the layer itself fading/sliding/scaling in.
    case "wipeLeftToRight":
      return { ...BASE, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
    case "wipeRightToLeft":
      return { ...BASE, clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` };
    case "wipeTopToBottom":
      return { ...BASE, clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
    case "wipeBottomToTop":
      return { ...BASE, clipPath: `inset(${(1 - p) * 100}% 0 0 0)` };
    case "circleReveal":
      return { ...BASE, clipPath: `circle(${p * 100}% at 50% 50%)` };
    // Like flipIn but with real weight: a slight scale dip (like it's been
    // lifted off the table) and a cast shadow that grows in as it lands
    // flat — see LayerMotion.shadow, rendered as a boxShadow in PageScene.
    case "cardFlipIn":
      return { ...BASE, opacity: p, rotateY: (1 - p) * -110, scale: interpolate(p, [0, 1], [0.92, 1]), shadow: p };
    // A fade-in with a diagonal highlight sweeping across in sync — see
    // LayerMotion.shine, rendered as an overlay gradient in PageScene.
    case "shineIn":
      return { ...BASE, opacity: p, shine: p };
    // Same clip-path mechanism as wipeLeftToRight, just stepped instead of
    // smooth — a handful of discrete jumps reads as "typed out" rather than
    // wiped. Never splits the actual text into characters (that would break
    // Farsi/Arabic letter joining), it's purely a mask over the intact
    // string, exactly like every other wipe/circle entrance above.
    case "typewriter": {
      const steps = 16;
      const stepped = Math.floor(p * steps) / steps;
      return { ...BASE, clipPath: `inset(0 ${(1 - stepped) * 100}% 0 0)` };
    }
    default:
      return BASE;
  }
}

// q = exit progress 0..1 (0 = fully in / at rest, 1 = fully gone).
export function exitMotion(name: ExitName, q: number): LayerMotion {
  switch (name) {
    case "none":
      return BASE;
    case "fadeOut":
      return { ...BASE, opacity: 1 - q };
    case "slideOutLeft":
      return { ...BASE, opacity: 1 - q, tx: -q * 90 };
    case "slideOutRight":
      return { ...BASE, opacity: 1 - q, tx: q * 90 };
    case "slideOutUp":
      return { ...BASE, opacity: 1 - q, ty: -q * 90 };
    case "slideOutDown":
      return { ...BASE, opacity: 1 - q, ty: q * 90 };
    case "shrinkOut":
      return { ...BASE, opacity: 1 - q, scale: interpolate(q, [0, 1], [1, 0.6]) };
    case "zoomOut": // grows past the frame while fading (opposite of shrink)
      return { ...BASE, opacity: 1 - q, scale: interpolate(q, [0, 1], [1, 1.3]) };
    case "popOut":
      return { ...BASE, opacity: 1 - q, scale: interpolate(q, [0, 1], [1, 0.9]) };
    case "blurOut":
      return { ...BASE, opacity: 1 - q, blur: q * 16 };
    case "dropOut":
      return { ...BASE, opacity: 1 - q, ty: q * 160 };
    case "riseOut":
      return { ...BASE, opacity: 1 - q, ty: -q * 160 };
    case "rotateOut":
      return { ...BASE, opacity: 1 - q, rotate: q * 10, scale: interpolate(q, [0, 1], [1, 0.96]) };
    case "flipOut": // turns away around the vertical axis as it fades
      return { ...BASE, opacity: 1 - q, rotateY: q * 100 };
    // Reveal masks in reverse: the layer stays fully opaque; a clip-path shape
    // shrinks/sweeps to cover it up, instead of fading/sliding/scaling out.
    case "wipeOutLeftToRight":
      return { ...BASE, clipPath: `inset(0 0 0 ${q * 100}%)` };
    case "wipeOutRightToLeft":
      return { ...BASE, clipPath: `inset(0 ${q * 100}% 0 0)` };
    case "wipeOutTopToBottom":
      return { ...BASE, clipPath: `inset(${q * 100}% 0 0 0)` };
    case "wipeOutBottomToTop":
      return { ...BASE, clipPath: `inset(0 0 ${q * 100}% 0)` };
    case "circleHide":
      return { ...BASE, clipPath: `circle(${(1 - q) * 100}% at 50% 50%)` };
    // Mirror of cardFlipIn: shadow lifts away as it turns and fades.
    case "cardFlipOut":
      return { ...BASE, opacity: 1 - q, rotateY: q * 110, scale: interpolate(q, [0, 1], [1, 0.92]), shadow: 1 - q };
    case "shineOut":
      return { ...BASE, opacity: 1 - q, shine: q };
    case "typewriterOut": {
      const steps = 16;
      const stepped = Math.floor(q * steps) / steps;
      return { ...BASE, clipPath: `inset(0 0 0 ${stepped * 100}%)` };
    }
    default:
      return BASE;
  }
}

// Page-level ambient motion applied to the whole scene container.
export function ambientMotion(
  name: AmbientName,
  frame: number,
  durationInFrames: number
): { scale: number; tx: number; ty: number; rotate: number } {
  const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const lin = (a: number, b: number) => a + (b - a) * Math.min(1, Math.max(0, t));
  const z = { scale: 1, tx: 0, ty: 0, rotate: 0 };

  switch (name) {
    case "kenburns":
      return { ...z, scale: lin(1.08, 1.0) };
    case "kenburnsIn":
      return { ...z, scale: lin(1.0, 1.08) };
    case "panLeft":
      return { ...z, scale: 1.06, tx: lin(40, -40) };
    case "panRight":
      return { ...z, scale: 1.06, tx: lin(-40, 40) };
    case "panUp":
      return { ...z, scale: 1.06, ty: lin(40, -40) };
    case "panDown":
      return { ...z, scale: 1.06, ty: lin(-40, 40) };
    case "zoomIn":
      return { ...z, scale: lin(1.0, 1.12) };
    case "zoomOut":
      return { ...z, scale: lin(1.12, 1.0) };
    case "float":
      return { ...z, scale: 1.04, ty: Math.sin(frame * 0.06) * 12 };
    case "sway":
      return { ...z, scale: 1.05, tx: Math.sin(frame * 0.05) * 16, rotate: Math.sin(frame * 0.05) * 0.6 };
    case "pulse":
      return { ...z, scale: 1 + Math.sin(frame * 0.08) * 0.02 };
    case "parallax":
      return { ...z, scale: 1.05, ty: lin(24, -24) };
    case "none":
    default:
      return z;
  }
}
