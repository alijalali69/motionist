import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { none } from "@remotion/transitions/none";
import { PageScene } from "./PageScene";
import { Template } from "./Template";
import { Loader } from "./Loader";
import { AssetSlot } from "./Logo";
import { Subtitles } from "./Subtitles";
import { pageStarts, type Project, type Caption } from "./types";

function presentationFor(type: string, w: number, h: number) {
  if (type === "none") return none();
  if (type === "fade") return fade();
  if (type === "clock-wipe") return clockWipe({ width: w, height: h });
  if (type === "iris") return iris({ width: w, height: h });
  if (type.startsWith("slide-")) return slide({ direction: type.slice(6) as any });
  if (type.startsWith("wipe-")) return wipe({ direction: type.slice(5) as any });
  if (type.startsWith("flip-")) return flip({ direction: type.slice(5) as any });
  return fade();
}

export const Reel: React.FC<{ project: Project; debugZones?: boolean; transparent?: boolean }> = ({
  project,
  debugZones = false,
  transparent = false,
}) => {
  const { pages } = project;
  // Slowly oscillating noise frequency for liquidIn/Out's SVG filter (see
  // the hidden <svg> below) — a real "flow" over time, not a static warp.
  // A shared filter, not one per layer: the WARP TEXTURE (how the noise
  // itself evolves) is the same everywhere; how much a given layer shows
  // of it is a separate per-layer opacity crossfade (LiquidOverlay in
  // PageScene.tsx), not this filter's own strength.
  const frame = useCurrentFrame();
  const liquidBaseFreq = 0.018 + Math.sin(frame * 0.045) * 0.007;

  // Per-page subtitle text -> caption windows; SRT captions override when present.
  const starts = pageStarts(project);
  const pageCaptions: Caption[] = pages.map((p, i) => ({
    fromFrame: starts[i],
    toFrame: starts[i] + p.durationInFrames,
    text: p.subtitle ?? "",
  }));
  const captions =
    project.captions && project.captions.length ? project.captions : pageCaptions;

  // Per-page frame ranges, for the segmented/dots loader styles (one segment
  // per page, Instagram-story style). The "bar" style just spans start-to-end.
  const loaderSegments = pages.map((p, i) => ({ start: starts[i], end: starts[i] + p.durationInFrames }));

  return (
    <AbsoluteFill style={{ backgroundColor: transparent ? "transparent" : (project.bgColor ?? "#e8e4dd") }}>
      {/* Hidden SVG filter defs, once for the whole reel — glitchIn/Out's RGB
          channel split (see GlitchOverlay in PageScene.tsx) needs a real
          feColorMatrix to isolate a single color channel on arbitrary
          content (photo/video/text alike); no CSS-only trick does that.
          Defined once here (not per-PageScene) so a page-transition
          crossfade, which can briefly mount two PageScenes at once, never
          collides on the id. width/height 0 — the filters themselves are
          referenced via url(#id), this element paints nothing of its own. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="glitchRedChannel" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          </filter>
          <filter id="glitchCyanChannel" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          </filter>
          {/* liquidIn/Out's organic warp — feTurbulence generates the noise,
              feDisplacementMap uses it to physically shift pixels, on
              WHATEVER content sits under the filter (no transform can fake
              this). baseFrequency comes straight from `frame` above — a
              plain React-controlled attribute re-rendered every frame like
              everything else in this file, not a CSS/SMIL loop (Remotion's
              headless render captures one frame at a time; a live loop
              has no reliable state to capture at export time). */}
          <filter id="liquidWarp" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency={`${liquidBaseFreq} ${liquidBaseFreq * 2.2}`} numOctaves={2} seed={4} result="liquidNoise" />
            <feDisplacementMap in="SourceGraphic" in2="liquidNoise" scale={22} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      {/* Global background — fills the backdrop behind all pages. Skipped
          entirely on a transparent export too — it's a fill, same as bgColor,
          not something the user uploaded on purpose to sit under other footage. */}
      {!transparent && <AssetSlot slot={project.bg ?? null} defaultFit="cover" />}

      {/* Content pages: motion + transitions live here, and ONLY here. */}
      <TransitionSeries>
        {pages.flatMap((page, i) => {
          const seq = (
            <TransitionSeries.Sequence
              key={`seq-${page.id}`}
              durationInFrames={page.durationInFrames}
            >
              <PageScene page={page} background={transparent ? "transparent" : page.bgColor}
                bgStyle={transparent ? undefined : (page.bgStyle ?? project.bgStyle)} />
            </TransitionSeries.Sequence>
          );
          if (i === pages.length - 1) return [seq];
          return [
            seq,
            <TransitionSeries.Transition
              key={`trans-${page.id}`}
              presentation={presentationFor(page.transition.type, project.width, project.height)}
              timing={linearTiming({
                durationInFrames: page.transition.durationInFrames,
              })}
            />,
          ];
        })}
      </TransitionSeries>

      {/* Global title — locked overlay, same on every page. */}
      <AssetSlot slot={project.title ?? null} defaultFit="contain" />

      {/* Fixed chrome — locked overlay, no motion, immune to transitions. */}
      <Template layers={project.template.layers} />

      {/* Branded logo with its own uploaded animation (static fallback). */}
      <AssetSlot slot={project.logo} defaultFit="contain" />

      {/* Reel-wide progress bar (or per-page segments/dots, per loaderStyle). */}
      {(project.loaderVisible ?? true) && (
        <Loader box={project.loader} style={project.loaderStyle} segments={loaderSegments} />
      )}

      {/* English captions in the reserved zone (per-page text or SRT). */}
      <Subtitles
        box={project.subtitle}
        style={project.subtitleStyle}
        captions={captions}
        debug={debugZones}
      />
    </AbsoluteFill>
  );
};
