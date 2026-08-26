import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

export type TemplateLayer = {
  file: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
};

// Fixed chrome (logo, name lockup, frame). Ingested once, rendered locked on top
// of every page. Deliberately NO motion and OUTSIDE the transition stack, so it
// stays pin-sharp while content animates and pages cross-fade beneath it.
export const Template: React.FC<{ layers: TemplateLayer[] }> = ({ layers }) => {
  if (!layers.length) return null;
  return (
    <AbsoluteFill>
      {layers.map((l) => (
        <Img
          key={l.name + l.left + l.top}
          src={staticFile(l.file)}
          style={{
            position: "absolute",
            left: l.left,
            top: l.top,
            width: l.width,
            height: l.height,
            opacity: l.opacity,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
