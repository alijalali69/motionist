import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { iris } from "@remotion/transitions/iris";
import { none } from "@remotion/transitions/none";
import { PageScene } from "./PageScene";
import { MotionFilterDefs } from "./MotionFx";
import { Template } from "./Template";
import { Loader } from "./Loader";
import { AssetSlot } from "./Logo";
import { Subtitles } from "./Subtitles";
import { pageStarts, transitionFrames, type Project, type Caption } from "./types";

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
  // Drives liquidIn/Out's SVG-filter noise (see MotionFilterDefs below).
  const frame = useCurrentFrame();

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

  // Global background-music track (see AudioTrack in types.ts) — spans the
  // whole reel, independent of any per-layer video's own embedded sound.
  // Fade in/out is expressed as a per-frame volume callback (not a flat
  // number) because Remotion needs a real value at every captured frame,
  // same reasoning as MotionFilterDefs' frame-driven noise below — no
  // CSS/Web Audio fade exists at render time.
  const audio = project.audio;
  const totalFrames = pages.length ? starts[pages.length - 1] + pages[pages.length - 1].durationInFrames : 0;
  const fadeInFrames = Math.round((audio?.fadeInSec ?? 0) * project.fps);
  const fadeOutFrames = Math.round((audio?.fadeOutSec ?? 0) * project.fps);
  const baseVolume = audio?.volume ?? 1;
  const audioVolumeAt = (f: number) => {
    if (baseVolume <= 0) return 0;
    let v = baseVolume;
    if (fadeInFrames > 0 && f < fadeInFrames) v *= f / fadeInFrames;
    if (fadeOutFrames > 0 && f > totalFrames - fadeOutFrames) {
      v *= Math.max(0, totalFrames - f) / fadeOutFrames;
    }
    return Math.max(0, Math.min(1, v));
  };

  return (
    <AbsoluteFill style={{ backgroundColor: transparent ? "transparent" : (project.bgColor ?? "#e8e4dd") }}>
      {/* glitchIn/Out's and liquidIn/Out's SVG filters, mounted once for
          the whole reel (not per-PageScene: a page-transition crossfade can
          briefly mount two PageScenes at once, and duplicate filter ids
          would collide). Shared with the Effects gallery via MotionFx.tsx. */}
      <MotionFilterDefs frame={frame} />
      {/* Global background-music track. Muted is a real toggle (matches
          ContentLayer.videoMuted's convention) — kept out of the tree
          entirely when muted, same as when there's no file yet. */}
      {audio?.file && !audio.muted && (
        <Audio
          src={staticFile(audio.file)}
          startFrom={Math.round((audio.startOffset ?? 0) * project.fps)}
          volume={audioVolumeAt}
        />
      )}

      {/* Global background — fills the backdrop behind all pages. Skipped
          entirely on a transparent export too — it's a fill, same as bgColor,
          not something the user uploaded on purpose to sit under other footage. */}
      {!transparent && <AssetSlot slot={project.bg ?? null} defaultFit="cover" reelDuration={totalFrames} />}

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
                durationInFrames: transitionFrames(project, i),
              })}
            />,
          ];
        })}
      </TransitionSeries>

      {/* Global title — locked overlay, same on every page. */}
      <AssetSlot slot={project.title ?? null} defaultFit="contain" reelDuration={totalFrames} />

      {/* Fixed chrome — locked overlay, no motion, immune to transitions. */}
      <Template layers={project.template.layers} />

      {/* Branded logo with its own uploaded animation (static fallback). */}
      <AssetSlot slot={project.logo} defaultFit="contain" reelDuration={totalFrames} />

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
