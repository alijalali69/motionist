import React from "react";
import { AbsoluteFill } from "remotion";
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

export const Reel: React.FC<{ project: Project; debugZones?: boolean }> = ({
  project,
  debugZones = false,
}) => {
  const { pages } = project;

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
    <AbsoluteFill style={{ backgroundColor: "#e8e4dd" }}>
      {/* Global background — fills the backdrop behind all pages. */}
      <AssetSlot slot={project.bg ?? null} defaultFit="cover" />

      {/* Content pages: motion + transitions live here, and ONLY here. */}
      <TransitionSeries>
        {pages.flatMap((page, i) => {
          const seq = (
            <TransitionSeries.Sequence
              key={`seq-${page.id}`}
              durationInFrames={page.durationInFrames}
            >
              <PageScene page={page} />
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
      <Loader box={project.loader} style={project.loaderStyle} segments={loaderSegments} />

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
