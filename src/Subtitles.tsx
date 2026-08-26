import React from "react";
import { useCurrentFrame } from "remotion";
import type { Box, Caption, SubtitleStyle } from "./types";

const DEFAULT_STYLE: SubtitleStyle = {
  fontFamily: "Arial, sans-serif",
  fontSize: 42,
  color: "#ffffff",
  background: "rgba(0,0,0,0.55)",
  align: "center",
};

// Renders English captions in the reserved safe zone.
// Priority: timed captions (from SRT) if any are active at this frame; otherwise
// the active page's per-page text. Empty => nothing renders. A debug guide box
// shows the zone outline when no caption is visible (turn off for export).
export const Subtitles: React.FC<{
  box: Box;
  style?: SubtitleStyle;
  captions?: Caption[];
  pageText?: string; // active page's subtitle text
  debug?: boolean;
}> = ({ box, style, captions, pageText, debug = false }) => {
  const frame = useCurrentFrame();
  const st = { ...DEFAULT_STYLE, ...(style ?? {}) };

  const timed = captions?.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  const text = (timed?.text ?? pageText ?? "").trim();

  if (!text) {
    if (!debug) return null;
    return (
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          border: "2px dashed rgba(0,0,0,0.35)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(0,0,0,0.4)",
          fontFamily: "sans-serif",
          fontSize: 22,
          letterSpacing: 1,
        }}
      >
        SUBTITLE SAFE ZONE
      </div>
    );
  }

  const justify =
    st.align === "left" ? "flex-start" : st.align === "right" ? "flex-end" : "center";

  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        display: "flex",
        alignItems: "center",
        justifyContent: justify,
      }}
    >
      <span
        style={{
          maxWidth: "100%",
          padding: "0.35em 0.6em",
          borderRadius: 8,
          backgroundColor: st.background,
          color: st.color,
          fontFamily: st.fontFamily,
          fontSize: st.fontSize,
          lineHeight: 1.25,
          textAlign: st.align,
          textShadow: "0 2px 6px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </span>
    </div>
  );
};
