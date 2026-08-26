import React from "react";

// Instagram Reels safe zone — Meta's own published margins for avoiding the
// profile icon, caption, and action-button UI (top 14%, bottom 35%, sides 6%
// each; source: Meta Business Help Center, "Safe Zone for ads in Stories and
// Reels"). Editor-only reference guide — purely visual, non-interactive, and
// never part of the actual render/export (only mounted in the preview panel).
const INSTAGRAM_MARGINS = { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 };

export const SafeZoneOverlay: React.FC<{ canvas: [number, number] }> = ({ canvas }) => {
  const [cw, ch] = canvas;
  const top = INSTAGRAM_MARGINS.top * ch;
  const bottom = INSTAGRAM_MARGINS.bottom * ch;
  const left = INSTAGRAM_MARGINS.left * cw;
  const right = INSTAGRAM_MARGINS.right * cw;

  const bandStyle: React.CSSProperties = {
    position: "absolute",
    background: "rgba(0,0,0,0.55)",
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Dimmed unsafe margins */}
      <div style={{ ...bandStyle, left: 0, top: 0, width: "100%", height: `${(top / ch) * 100}%` }} />
      <div style={{ ...bandStyle, left: 0, bottom: 0, width: "100%", height: `${(bottom / ch) * 100}%` }} />
      <div style={{ ...bandStyle, left: 0, top: `${(top / ch) * 100}%`, width: `${(left / cw) * 100}%`, height: `${100 - ((top + bottom) / ch) * 100}%` }} />
      <div style={{ ...bandStyle, right: 0, top: `${(top / ch) * 100}%`, width: `${(right / cw) * 100}%`, height: `${100 - ((top + bottom) / ch) * 100}%` }} />

      {/* Safe area outline — percentages, so it scales with the rendered
          preview size instead of using raw canvas-pixel units (which would
          be wildly oversized against the actual on-screen box). */}
      <div
        style={{
          position: "absolute",
          left: `${(left / cw) * 100}%`,
          top: `${(top / ch) * 100}%`,
          width: `${((cw - left - right) / cw) * 100}%`,
          height: `${((ch - top - bottom) / ch) * 100}%`,
          border: "2px dashed #00f2ea",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            position: "absolute", top: -22, left: -2,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            color: "#0e1013", background: "#00f2ea",
            padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap",
          }}
        >
          INSTAGRAM REELS SAFE ZONE
        </span>
      </div>
    </div>
  );
};
