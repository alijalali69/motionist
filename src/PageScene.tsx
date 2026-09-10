import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  staticFile,
  delayRender,
  continueRender,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Gif } from "@remotion/gif";
import {
  entranceMotion, entranceProgress, exitMotion, exitProgress, combineMotions, ambientMotion, glitchNoise,
  motionTransform, motionFilter, shadowStyle, blobRadius,
  type EntranceName, type ExitName, type EasingName, type LayerMotion,
} from "./presets";

// The overlay components every glitch-family LayerMotion field renders as
// real DOM (shine, scanline, glitch, glitchBlocks, liquid, burst, stroke),
// plus scrambleIn/Out's text substitution, now live in MotionFx.tsx —
// shared with the Effects gallery, which needs the exact same ones to show
// those effects as anything other than "nothing happens".
// shadowStyle/motionTransform/motionFilter/blobRadius likewise live in
// presets.ts (imported above) — shared with Logo.tsx's AssetSlot, so a
// content layer and a global Logo/Title/BG overlay render the same
// LayerMotion the same way.
import {
  ShineOverlay, ScanlineOverlay, GlitchOverlay, DataMoshOverlay, LiquidOverlay,
  BurstOverlay, StrokeDrawOverlay, scrambledText, StaggerText, LetterPopText,
} from "./MotionFx";
import type { Page, ContentLayer, BgStyle } from "./types";
import { Backdrop } from "./Backdrop";

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

  // Continuous while-visible motion (kenburns/float/sway/pulse/etc — see
  // ambientMotion in presets.ts), independent of the one-shot entrance/exit
  // above. Reuses the same photoMotion field LayerView's photo/video/shape
  // layers already use — "photo" in the name is legacy (it started there
  // first); a text layer picking, say, "pulse" gets the same live emphasis
  // wobble a photo would, applied to the text itself rather than a crop.
  const pz = ambientMotion(layer.photoMotion ?? "none", frame, pageDuration);

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
    return (
      <div style={boxStyle}>
        <LetterPopText text={layer.text ?? ""} frame={frame} fps={fps}
          delay={layer.delay} inDuration={inDuration} justify={justify} textStyle={textStyle} />
      </div>
    );
  }

  if (!isStagger || inExitPhase) {
    const textNode = (
      <div style={{ transform: `translate(${pz.tx}px, ${pz.ty}px) scale(${pz.scale}) rotate(${pz.rotate}deg)`, transformOrigin: "center center" }}>
        <div style={textStyle}>{layer.text}</div>
      </div>
    );
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

  // Word/line stagger (see StaggerText in MotionFx.tsx for the timing).
  return (
    <div style={boxStyle}>
      <StaggerText text={layer.text ?? ""} lineMode={layer.entrance === "lineReveal"}
        frame={frame} fps={fps} delay={layer.delay} inDuration={inDuration}
        justify={justify} textStyle={textStyle} />
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

export const PageScene: React.FC<{ page: Page; background?: string; bgStyle?: BgStyle }> = ({
  page,
  background = "transparent", // let the global BG / reel backdrop show through
  bgStyle,
}) => {
  const frame = useCurrentFrame();
  const a = ambientMotion(page.ambient, frame, page.durationInFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: background, overflow: "hidden" }}>
      {/* Backdrop treatment (grain/gradient/grade/particles) — resolved by
          the caller (Reel.tsx: page.bgStyle ?? project.bgStyle, the same
          whole-object fallback page.bgColor already uses) so this component
          stays decoupled from Project, same as `background` above. Sits
          right on top of the flat color fill, under every real layer. */}
      {bgStyle && <Backdrop style={bgStyle} frame={frame} />}
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
