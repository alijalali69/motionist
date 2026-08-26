import React from "react";
import { AbsoluteFill } from "remotion";
import { PageScene } from "./PageScene";
import { Template } from "./Template";
import { AssetSlot } from "./Logo";
import type { Project, Page } from "./types";

// One page rendered in isolation at frame 0 — used for the storyboard strip's
// thumbnails via Remotion's <Thumbnail> (a single static frame, not a full
// running Player — cheap enough to have many on screen at once, unlike the
// main editor's Player). Deliberately lighter than the real Reel: no loader
// (illegible at thumbnail scale) or subtitles (not what "what does this page
// look like" is asking), no transitions (there's nothing to transition
// between — it's one page, one frame).
export const PageThumb: React.FC<{ project: Project; page: Page }> = ({ project, page }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: project.bgColor ?? "#e8e4dd", overflow: "hidden" }}>
      <AssetSlot slot={project.bg ?? null} defaultFit="cover" />
      <PageScene page={page} background={page.bgColor} />
      <AssetSlot slot={project.title ?? null} defaultFit="contain" />
      <Template layers={project.template.layers} />
      <AssetSlot slot={project.logo} defaultFit="contain" />
    </AbsoluteFill>
  );
};
