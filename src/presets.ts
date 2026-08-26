// Motion + transition preset library. This is the curated "menu" the app offers.
// Entrances are pure functions of a 0..1 progress; ambient is a function of frame.
import { interpolate } from "remotion";

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
  | "circleHide";

export const EXIT_NAMES: ExitName[] = [
  "none", "fadeOut", "slideOutLeft", "slideOutRight", "slideOutUp", "slideOutDown",
  "shrinkOut", "zoomOut", "popOut", "blurOut", "dropOut", "riseOut", "rotateOut", "flipOut",
  "wipeOutLeftToRight", "wipeOutRightToLeft", "wipeOutTopToBottom", "wipeOutBottomToTop", "circleHide",
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
};

const BASE: LayerMotion = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, rotateY: 0 };

// Spring feel per entrance — bouncy ones overshoot, the rest settle smoothly.
export function entranceSpring(name: EntranceName) {
  const bouncy = name === "pop" || name === "growIn" || name === "dropIn";
  return bouncy
    ? { damping: 12, mass: 0.85, stiffness: 130 }
    : { damping: 200, mass: 0.7 };
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
