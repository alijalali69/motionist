// Bucket A of the "advanced/cinematic motion presets" ask: ready-made combo
// presets built entirely from existing entrance/exit effects + easing +
// duration — no new render-engine primitives, just curated combinations
// tuned to look smoother/more deliberate than picking one bare FX1 with
// default timing. Shipped in source (not the user's saved-presets data
// file, which is gitignored) so they're always present on every machine,
// versioned in git, and can't be accidentally deleted from the list.
import type { MotionClip } from "./App";

export type BuiltInPreset = { id: string; name: string; clip: MotionClip };

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: "builtin-cinematic-reveal",
    name: "Cinematic Reveal",
    clip: {
      entrance: "blurIn", entrance2: "slideUp",
      delay: 0, inDuration: 36, entranceEasing: "easeOutCubic",
      exit: "fadeOut", exit2: "blurOut",
      outDuration: 18, exitEasing: "easeInCubic",
    },
  },
  {
    id: "builtin-soft-glass-fade",
    name: "Soft Glass Fade",
    clip: {
      entrance: "fade", entrance2: "zoomIn",
      delay: 0, inDuration: 36, entranceEasing: "easeOut",
      exit: "fadeOut",
      outDuration: 36, exitEasing: "easeIn",
    },
  },
  {
    id: "builtin-dramatic-punch-in",
    name: "Dramatic Punch In",
    clip: {
      entrance: "zoomIn", entrance2: "pop",
      delay: 0, inDuration: 9, entranceEasing: "easeOutBack",
      exit: "shrinkOut",
      outDuration: 9, exitEasing: "easeInBack",
    },
  },
  {
    id: "builtin-elegant-rise",
    name: "Elegant Rise",
    clip: {
      entrance: "riseIn", entrance2: "blurIn",
      delay: 0, inDuration: 18, entranceEasing: "easeOutCubic",
      exit: "dropOut", exit2: "blurOut",
      outDuration: 18, exitEasing: "easeInCubic",
    },
  },
  {
    id: "builtin-cross-dissolve-slide",
    name: "Cross Dissolve Slide",
    clip: {
      entrance: "fade", entrance2: "slideLeft",
      delay: 0, inDuration: 18, entranceEasing: "easeInOut",
      exit: "fadeOut", exit2: "slideOutRight",
      outDuration: 18, exitEasing: "easeInOut",
    },
  },
  {
    id: "builtin-bounce-settle",
    name: "Bounce Settle",
    clip: {
      entrance: "dropIn", entrance2: "pop",
      delay: 0, inDuration: 18, entranceEasing: "easeOutBack",
      exit: "popOut",
      outDuration: 9, exitEasing: "easeInBack",
    },
  },
  {
    id: "builtin-wipe-reveal",
    name: "Wipe Reveal",
    clip: {
      entrance: "wipeLeftToRight",
      delay: 0, inDuration: 18, entranceEasing: "easeInOut",
      exit: "wipeOutRightToLeft",
      outDuration: 18, exitEasing: "easeInOut",
    },
  },
  {
    id: "builtin-circle-spotlight",
    name: "Circle Spotlight",
    clip: {
      entrance: "circleReveal",
      delay: 0, inDuration: 36, entranceEasing: "easeOutCubic",
      exit: "circleHide",
      outDuration: 36, exitEasing: "easeInCubic",
    },
  },
];
