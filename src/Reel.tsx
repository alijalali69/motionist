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

export const Reel: React.FC<{ project: Project; debugZones?: boolean; transparent?: boolean }> = ({
  project,
  debugZones = false,
  transparent = false,
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
              <PageScene page={page} background={transparent ? "transparent" : page.bgColor} />
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
