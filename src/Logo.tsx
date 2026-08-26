import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { Gif } from "@remotion/gif";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import { continueRender, delayRender } from "remotion";
import type { LogoConfig } from "./types";

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
export const AssetSlot: React.FC<{ slot: LogoConfig | null; defaultFit?: "contain" | "cover" }> = ({
  slot,
  defaultFit = "contain",
}) => {
  if (!slot) return null;
  const { box } = slot;
  const src = slot.file ?? slot.fallback;
  if (!src) return null;
  const url = staticFile(src);
  const fit = slot.fit ?? defaultFit;

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
          opacity: slot.opacity,
        }}
      >
        {inner}
      </div>
    </AbsoluteFill>
  );
};

// Back-compat alias.
export const Logo: React.FC<{ logo: LogoConfig | null }> = ({ logo }) => (
  <AssetSlot slot={logo} defaultFit="contain" />
);
