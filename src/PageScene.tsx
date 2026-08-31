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
  type EntranceName, type ExitName,
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

// cardFlipIn/Out's "landing" shadow (LayerMotion.shadow, 0..1 intensity) —
// a plain boxShadow scaled by intensity, cheap and works on any layer.
function shadowStyle(shadow: number | undefined): string | undefined {
  if (!shadow) return undefined;
  return `0 ${18 * shadow}px ${40 * shadow}px rgba(0,0,0,${0.45 * shadow})`;
}
import type { Page, ContentLayer } from "./types";

// Resolves a layer's up-to-3 combined entrance (or exit) slots into one
// LayerMotion — each slot gets its own progress (so "auto" easing still
// resolves per-effect even when combined, e.g. zoomIn keeps its own
// overshoot while slideRight keeps its own decelerate), then combineMotions
// layers them together. Slots left unset (or "none") are skipped entirely.
function combinedEntranceMotion(
  layer: ContentLayer, frame: number, fps: number, inDuration: number
) {
  const names = [layer.entrance, layer.entrance2, layer.entrance3]
    .filter((n): n is EntranceName => !!n && n !== "none");
  if (names.length === 0) return entranceMotion("none", 1);
  const motions = names.map((name) =>
    entranceMotion(name, entranceProgress(name, layer.entranceEasing, frame, fps, layer.delay, inDuration))
  );
  return combineMotions(motions);
}

function combinedExitMotion(
  layer: ContentLayer, frame: number, outStart: number, outDuration: number
) {
  const names = [layer.exit, layer.exit2, layer.exit3]
    .filter((n): n is ExitName => !!n && n !== "none");
  if (names.length === 0) return entranceMotion("none", 1);
  const motions = names.map((name) =>
    exitMotion(name, exitProgress(name, layer.exitEasing, frame, outStart, outDuration))
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
  const outDuration = layer.outDuration ?? 24;
  const hasExit = (layer.exit && layer.exit !== "none") || (layer.exit2 && layer.exit2 !== "none") || (layer.exit3 && layer.exit3 !== "none");
  const outStart = layer.outDelay ?? (pageDuration - outDuration);
  const inExitPhase = hasExit && frame >= outStart;
  const isStagger = layer.entrance === "wordReveal" || layer.entrance === "lineReveal";

  let m;
  if (inExitPhase) {
    m = combinedExitMotion(layer, frame, outStart, outDuration);
  } else if (!isStagger) {
    m = combinedEntranceMotion(layer, frame, fps, inDuration);
  } else {
    m = { opacity: 1, tx: 0, ty: 0, scale: 1, blur: 0, rotate: 0, clipPath: undefined as string | undefined };
  }

  const justify = layer.textAlign === "left" ? "flex-start" : layer.textAlign === "center" ? "center" : "flex-end";
  const textStyle: React.CSSProperties = {
    fontFamily: layer.fontFamily || "Tahoma, Arial, sans-serif",
    fontSize: layer.fontSize ?? 48,
    color: layer.textColor ?? "#1a1a1a",
    textAlign: layer.textAlign ?? "right",
    direction: layer.direction ?? "rtl",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  };

  const boxStyle: React.CSSProperties = {
    position: "absolute",
    left: layer.left, top: layer.top, width: layer.width, height: layer.height,
    opacity: m.opacity * layer.opacity,
    filter: m.blur ? `blur(${m.blur}px)` : undefined,
    transform: `perspective(900px) translate(${m.tx}px, ${m.ty}px) scale(${m.scale}) rotate(${m.rotate}deg) rotateY(${m.rotateY}deg)`,
    transformOrigin: "center center",
    clipPath: m.clipPath,
    boxShadow: shadowStyle(m.shadow),
    overflow: "visible", // text isn't a mask — don't silently clip slightly-oversized content
    display: "flex",
    alignItems: "center",
    justifyContent: justify,
  };

  if (!isStagger || inExitPhase) {
    return (
      <div style={boxStyle}>
        <div style={textStyle}>{layer.text}</div>
        {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
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

  const inDuration = layer.inDuration ?? 26;
  const outDuration = layer.outDuration ?? 24;
  const hasExit = (layer.exit && layer.exit !== "none") || (layer.exit2 && layer.exit2 !== "none") || (layer.exit3 && layer.exit3 !== "none");
  const outStart = layer.outDelay ?? (pageDuration - outDuration);

  // Up to 3 combined entrance/exit effects (FX1/FX2/FX3), each keeping its
  // own progress/easing — see combinedEntranceMotion/combinedExitMotion and
  // combineMotions in presets.ts.
  let m;
  if (hasExit && frame >= outStart) {
    m = combinedExitMotion(layer, frame, outStart, outDuration);
  } else {
    m = combinedEntranceMotion(layer, frame, fps, inDuration);
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
  // kind but keep the layer's box + entrance + page ambient motion. A shape
  // layer has no asset at all — just a solid-color (or stroked) box, same
  // pipeline otherwise.
  const media = isShape ? (
    <div
      style={{
        width: "100%", height: "100%", boxSizing: "border-box",
        background: layer.shapeFill ?? "#000000",
        borderRadius: (layer.shapeType === "ellipse" || layer.shapeType === "circle") ? "50%" : (layer.shapeCornerRadius ?? 0),
        border: layer.shapeStrokeWidth
          ? `${layer.shapeStrokeWidth}px solid ${layer.shapeStrokeColor ?? "#000000"}`
          : undefined,
      }}
    />
  ) :
    layer.assetKind === "video" ? (
      <OffthreadVideo src={url} transparent muted
        style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
    ) : layer.assetKind === "gif" ? (
      <Gif src={url} fit={fit} width={layer.width} height={layer.height} />
    ) : (
      <Img src={url} style={{ width: "100%", height: "100%", objectFit: fit, objectPosition, transform: `scale(${zoom})` }} />
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
        filter: m.blur ? `blur(${m.blur}px)` : undefined,
        transform: `perspective(900px) translate(${m.tx}px, ${m.ty}px) scale(${m.scale}) rotate(${m.rotate}deg) rotateY(${m.rotateY}deg)`,
        transformOrigin: "center center",
        clipPath: m.clipPath, // reveal/hide mask (wipe, circle) — undefined = no mask
        boxShadow: shadowStyle(m.shadow),
        overflow: "hidden", // the box IS the mask — anything inside gets cropped to its shape
      }}
    >
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
      {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
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
