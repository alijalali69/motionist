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
  type EntranceName, type ExitName, type EasingName,
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

  let m;
  if (inExitPhase) {
    m = combinedExitMotion(layer, frame, pageDuration);
  } else if (!isStagger) {
    m = combinedEntranceMotion(layer, frame, fps);
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
    lineHeight: layer.lineHeight ?? 1.5,
    letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
    textTransform: layer.uppercase ? "uppercase" : undefined,
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
          <OffthreadVideo src={staticFile(layer.shapePhotoFile)} transparent muted
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
