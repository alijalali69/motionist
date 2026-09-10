import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Gif } from "@remotion/gif";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { continueRender, delayRender } from "remotion";
import type { LogoConfig } from "./types";
import {
  entranceMotion, entranceProgress, exitMotion, exitProgress,
  motionTransform, motionFilter, shadowStyle, blobRadius,
  type LayerMotion,
} from "./presets";
import {
  ShineOverlay, ScanlineOverlay, GlitchOverlay, DataMoshOverlay, LiquidOverlay,
  BurstOverlay, StrokeDrawOverlay, ChromaOverlay, StaticOverlay,
} from "./MotionFx";

// Same entrance/exit resolution PageScene.tsx's combinedEntranceMotion/
// combinedExitMotion do for a content layer, but for ONE slot instead of up
// to 3 (see the LogoConfig.entrance/exit doc comment in types.ts) — a
// Logo/Title/BG overlay spans the whole reel and switches from playing its
// entrance to playing its exit once, not per-page. `reelDuration` anchors
// an unset outDelay to "exit ends exactly at the reel's last frame", same
// convention as a page's own outDelay.
function slotMotion(slot: LogoConfig, frame: number, fps: number, reelDuration: number): LayerMotion {
  const hasEntrance = !!slot.entrance && slot.entrance !== "none";
  const hasExit = !!slot.exit && slot.exit !== "none";
  const outDuration = slot.outDuration ?? 24;
  const outStart = slot.outDelay ?? Math.max(0, reelDuration - outDuration);
  if (hasExit && frame >= outStart) {
    return exitMotion(slot.exit!, exitProgress(slot.exit!, slot.exitEasing, frame, outStart, outDuration));
  }
  if (hasEntrance) {
    return entranceMotion(slot.entrance!, entranceProgress(slot.entrance!, slot.entranceEasing, frame, fps, slot.delay ?? 0, slot.inDuration ?? 26));
  }
  return entranceMotion("none", 1); // identity: opacity 1, no offset
}

// Plays the user's pre-animated MOMKEN logo in the top-right slot.
// kind: video (transparent webm/mov) | gif | lottie | image/none (static fallback).
// Until an animation is uploaded, shows the static PSD logo PNG (fallback).
const LottieLogo: React.FC<{ src: string }> = ({ src }) => {
  const [data, setData] = React.useState<LottieAnimationData | null>(null);
  const [handle] = React.useState(() => delayRender("loading lottie logo"));

  React.useEffect(() => {
    fetch(src)
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        continueRender(handle);
      })
      .catch((e) => {
        console.error(e);
        continueRender(handle);
      });
  }, [handle, src]);

  if (!data) return null;
  return <Lottie animationData={data} style={{ width: "100%", height: "100%" }} />;
};

// Generic asset slot — renders a LogoConfig-shaped asset (video/gif/lottie/image)
// in its box. Used for the logo, the global BG, and the global Title.
// `reelDuration` (frames) is only needed to resolve an unset exit's outStart
// (see slotMotion above) — pass 0 when the caller has no entrance/exit set,
// the motion falls back to identity either way.
export const AssetSlot: React.FC<{ slot: LogoConfig | null; defaultFit?: "contain" | "cover"; reelDuration?: number }> = ({
  slot,
  defaultFit = "contain",
  reelDuration = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!slot) return null;
  const { box } = slot;
  const src = slot.file ?? slot.fallback;
  if (!src) return null;
  const url = staticFile(src);
  const fit = slot.fit ?? defaultFit;
  const m = slotMotion(slot, frame, fps, reelDuration);

  const inner = (() => {
    if (slot.file && slot.kind === "video") {
      // `transparent` makes OffthreadVideo honor the WebM VP9 alpha channel in
      // renders (the browser <video> in the Player already respects it).
      return (
        <OffthreadVideo
          src={url}
          transparent
          style={{ width: "100%", height: "100%", objectFit: fit }}
        />
      );
    }
    if (slot.file && slot.kind === "gif") {
      return <Gif src={url} fit={fit} width={box.width} height={box.height} />;
    }
    if (slot.file && slot.kind === "lottie") {
      return <LottieLogo src={url} />;
    }
    return (
      <Img src={url} style={{ width: "100%", height: "100%", objectFit: fit }} />
    );
  })();

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          opacity: m.opacity * slot.opacity,
          filter: motionFilter(m),
          transform: motionTransform(m),
          transformOrigin: "center center",
          clipPath: m.clipPath,
          boxShadow: shadowStyle(m.shadow),
          borderRadius: m.morph !== undefined ? blobRadius(m.morph, frame) : undefined,
          overflow: m.morph !== undefined ? "hidden" : undefined,
        }}
      >
        {inner}
        {/* The same overlay list a content layer gets in PageScene.tsx.
            These were missing here, so every overlay-driven effect
            (glitchIn, dataMoshIn, liquidIn, staticIn, vhsIn, rgbSplitIn,
            shineIn, burstIn, strokeIn) silently did nothing at all when
            picked on the Logo / Title / BG slots — the picker offered the
            full vocabulary and roughly a fifth of it was inert. */}
        {m.shine !== undefined && <ShineOverlay shine={m.shine} />}
        {m.scanline !== undefined && <ScanlineOverlay scanline={m.scanline} frame={frame} />}
        {m.glitch !== undefined && <GlitchOverlay amount={m.glitch} frame={frame}>{inner}</GlitchOverlay>}
        {m.chroma !== undefined && <ChromaOverlay amount={m.chroma}>{inner}</ChromaOverlay>}
        {m.glitchBlocks !== undefined && <DataMoshOverlay amount={m.glitchBlocks} frame={frame}>{inner}</DataMoshOverlay>}
        {m.liquid !== undefined && <LiquidOverlay amount={m.liquid}>{inner}</LiquidOverlay>}
        {m.staticNoise !== undefined && <StaticOverlay amount={m.staticNoise} frame={frame} />}
        {m.burst !== undefined && <BurstOverlay amount={m.burst} frame={frame} />}
        {m.stroke !== undefined && <StrokeDrawOverlay amount={m.stroke} />}
      </div>
    </AbsoluteFill>
  );
};

// Back-compat alias.
export const Logo: React.FC<{ logo: LogoConfig | null }> = ({ logo }) => (
  <AssetSlot slot={logo} defaultFit="contain" />
);
