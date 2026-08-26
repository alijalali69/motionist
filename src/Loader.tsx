import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import type { Box, LoaderStyle } from "./types";

export type Segment = { start: number; end: number }; // frame range per page

// Guard against a 0/1-frame segment: interpolate() requires a strictly
// increasing input range, so [x, x] would throw and crash the whole Player
// into its (non-self-healing) error state.
function segProgress(frame: number, seg: Segment): number {
  return interpolate(frame, [seg.start, Math.max(seg.start + 1, seg.end)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export const Loader: React.FC<{
  box: Box;
  style?: LoaderStyle; // "bar" (single, whole-reel) | "segmented" | "dots" (one per page)
  segments?: Segment[]; // required for "segmented"/"dots" — one frame range per page
  track?: string;
  fill?: string;
}> = ({ box, style = "bar", segments, track = "rgba(0,0,0,0.15)", fill = "#8a1c1c" }) => {
  const frame = useCurrentFrame();

  if (style === "segmented" && segments && segments.length > 0) {
    const gap = 4;
    const n = segments.length;
    const segWidth = (box.width - gap * (n - 1)) / n;
    const radius = box.height / 2;
    return (
      <div style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, display: "flex", gap }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ width: segWidth, height: "100%", borderRadius: radius, backgroundColor: track, overflow: "hidden" }}>
            <div style={{ width: `${segProgress(frame, seg) * 100}%`, height: "100%", borderRadius: radius, backgroundColor: fill }} />
          </div>
        ))}
      </div>
    );
  }

  // Magazine-style folio mark — "03 — 12" in a small serif numeral, sitting
  // wherever the loader box is placed. Unlike the other styles this isn't a
  // filling shape: it's a page COUNT, so it only needs to know which segment
  // `frame` currently falls in (current page) out of how many (total pages).
  // Font size is fixed (editorial numerals don't stretch to fill a box) —
  // the box only anchors position, same drag handle as the other styles.
  if (style === "folio" && segments && segments.length > 0) {
    let idx = segments.findIndex((s) => frame < s.end);
    if (idx === -1) idx = segments.length - 1;
    const current = String(idx + 1).padStart(2, "0");
    const total = String(segments.length).padStart(2, "0");
    return (
      <div
        style={{
          position: "absolute", left: box.left, top: box.top,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 30, letterSpacing: 1.5, color: fill,
          whiteSpace: "nowrap",
        }}
      >
        {current} &mdash; {total}
      </div>
    );
  }

  if (style === "dots" && segments && segments.length > 0) {
    const gap = 8;
    const n = segments.length;
    const dotSize = Math.max(4, Math.min(box.height, (box.width - gap * (n - 1)) / n));
    return (
      <div style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, display: "flex", alignItems: "center", justifyContent: "center", gap }}>
        {segments.map((seg, i) => {
          const p = segProgress(frame, seg);
          return (
            <div key={i} style={{ width: dotSize, height: dotSize, borderRadius: "50%", backgroundColor: track, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", backgroundColor: fill, opacity: p, transform: `scale(${0.5 + p * 0.5})` }} />
            </div>
          );
        })}
      </div>
    );
  }

  // "bar" (default/fallback) — single progress bar filling 0->100% over
  // whatever frame range it's given (the whole reel, via a single segment).
  const seg = segments && segments.length > 0
    ? { start: segments[0].start, end: segments[segments.length - 1].end }
    : { start: 0, end: 1 };
  const progress = segProgress(frame, seg);
  const radius = box.height / 2;
  return (
    <div
      style={{
        position: "absolute",
        left: box.left, top: box.top, width: box.width, height: box.height,
        borderRadius: radius, backgroundColor: track, overflow: "hidden",
      }}
    >
      <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: radius, backgroundColor: fill }} />
    </div>
  );
};
