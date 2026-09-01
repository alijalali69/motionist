import React from "react";
import { AbsoluteFill } from "remotion";
import { PageScene } from "./PageScene";
import type { Page } from "./types";

// One webpage SECTION rendered in isolation — deliberately NOT the same as
// PageThumb (which also layers in the project's global bg/logo/title/loader,
// all positioned assuming one shared project.height). A webpage's sections
// each have their own independent height, so a global box positioned for a
// ~1920px-tall reel frame would render nonsensically inside a 480px-tall
// section. Sections start as a blank canvas — just this page's own layers —
// until global webpage chrome (if any) gets designed on its own terms later.
export const WebpageSectionThumb: React.FC<{ page: Page }> = ({ page }) => (
  <AbsoluteFill style={{ backgroundColor: page.bgColor ?? "#e8e4dd", overflow: "hidden" }}>
    <PageScene page={page} background={page.bgColor} />
  </AbsoluteFill>
);
