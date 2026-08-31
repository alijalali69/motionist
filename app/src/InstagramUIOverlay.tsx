import React from "react";

// A stylized Instagram-Reels-style UI chrome — editor preview only, same
// pattern as SafeZoneOverlay (absolute, pointerEvents:none, mounted only in
// the preview panel, never part of the actual render/export). The point is
// to let a real caption/photo be judged against where the app's own chrome
// would sit, not to reproduce Instagram's actual artwork — every icon below
// is a generic, commonly-used glyph shape (the same stroke-outline family
// e.g. Feather/Heroicons use), not Meta's real icon set or wordmark.
//
// Everything is sized in cqw ("1% of this container's own rendered width")
// via CSS containment, NOT canvas pixels — the preview box renders at
// wildly different on-screen sizes (80vh with no storyboard, 66vh with one,
// a resized panel, etc.) while the canvas's *pixel* dimensions never change,
// so anything sized from canvas.width in raw px would be correct at exactly
// one on-screen size and comically oversized everywhere else. cqw tracks
// the box's actual rendered size instead, the same way the safe-zone
// overlay's percentages already do for its bands.

const iconShadow: React.CSSProperties = {
  filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.55))",
};
const textShadow = "0 1px 3px rgba(0,0,0,0.6)";

const HeartIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20.25c-.22 0-.43-.06-.62-.18C7.71 17.75 3 14.1 3 9.64 3 6.6 5.32 4.5 8.03 4.5c1.63 0 3.1.85 3.97 2.14.86-1.29 2.34-2.14 3.97-2.14 2.7 0 5.03 2.1 5.03 5.14 0 4.46-4.71 8.1-8.38 10.43-.19.12-.4.18-.62.18z" />
  </svg>
);
const CommentIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
const ShareIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </svg>
);
const MoreIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="#fff">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);
const MusicNoteIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="#fff">
    <path d="M9 18a3 3 0 1 1-2-2.83V4.3a1 1 0 0 1 .76-.97l9-2.25A1 1 0 0 1 18 2.05V13a3 3 0 1 1-2-2.83V6.36l-7 1.75V15a3 3 0 0 1 0 3z" />
  </svg>
);
const MuteIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H2v6h4l5 4z" fill="#fff" stroke="none" />
    <path d="m17 9-6 6M11 9l6 6" />
  </svg>
);

const RAIL_ITEMS: { icon: React.FC; count?: string }[] = [
  { icon: HeartIcon, count: "12.4K" },
  { icon: CommentIcon, count: "348" },
  { icon: ShareIcon, count: "89" },
  { icon: MoreIcon },
];

// Base icon size as a fraction of the container's own width — 1cqw = 1% of
// it, so "7.2" here means "7.2% of however big the preview box actually is."
const ICON = 7.2;

export const InstagramUIOverlay: React.FC<{ canvas: [number, number] }> = ({ canvas }) => {
  void canvas; // kept in the prop signature to match SafeZoneOverlay's call site — sizing here is container-relative, not canvas-pixel-relative

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", containerType: "inline-size" } as React.CSSProperties}>
      {/* Top-right: mute glyph — the one bit of chrome Reels shows up top */}
      <div style={{ position: "absolute", top: "3%", right: "4%", width: `${ICON * 0.62}cqw`, height: `${ICON * 0.62}cqw`, ...iconShadow }}>
        <MuteIcon />
      </div>

      {/* Right action rail */}
      <div style={{
        position: "absolute", right: "3.5%", top: "44%", bottom: "16%",
        display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center",
      }}>
        {/* Avatar + follow badge — a generic placeholder circle, not a real profile photo */}
        <div style={{ position: "relative", width: `${ICON}cqw`, height: `${ICON}cqw`, ...iconShadow }}>
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%",
            background: "linear-gradient(135deg, #7b5cff, #ff5c8a)",
            border: "0.35cqw solid #fff", boxSizing: "border-box",
          }} />
          <div style={{
            position: "absolute", bottom: "-6%", left: "50%", transform: "translateX(-50%)",
            width: "42%", height: "42%", borderRadius: "50%",
            background: "#3ea6ff", border: "0.3cqw solid #fff", boxSizing: "border-box",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: "2.1cqw", fontWeight: 900, lineHeight: 1,
          }}>+</div>
        </div>

        {RAIL_ITEMS.map(({ icon: Icon, count }, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4cqw" }}>
            <div style={{ width: `${ICON}cqw`, height: `${ICON}cqw`, ...iconShadow }}><Icon /></div>
            {count && (
              <span style={{ color: "#fff", fontSize: "2.1cqw", fontWeight: 600, textShadow }}>{count}</span>
            )}
          </div>
        ))}

        {/* Spinning audio disc — the one bit of real Reels chrome that
            actually animates; harmless here since this never renders. */}
        <div style={{
          width: `${ICON * 0.86}cqw`, height: `${ICON * 0.86}cqw`, borderRadius: "50%",
          background: "linear-gradient(135deg, #2a2a2a, #555)",
          border: "0.32cqw solid #fff", boxSizing: "border-box",
          animation: "motionist-ig-spin 3.5s linear infinite",
          ...iconShadow,
        }} />
      </div>

      {/* Bottom-left: username / caption / audio row */}
      <div style={{ position: "absolute", left: "4%", right: "20%", bottom: "6%", display: "flex", flexDirection: "column", gap: "1.2cqw" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.6cqw" }}>
          <div style={{
            width: "6cqw", height: "6cqw", borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, #7b5cff, #ff5c8a)", border: "0.3cqw solid #fff", boxSizing: "border-box",
            ...iconShadow,
          }} />
          <span style={{ color: "#fff", fontWeight: 700, fontSize: "2.9cqw", textShadow, whiteSpace: "nowrap" }}>yourhandle</span>
          <span style={{
            color: "#fff", fontSize: "2.1cqw", fontWeight: 700, textShadow, whiteSpace: "nowrap",
            border: "0.28cqw solid #fff", borderRadius: "0.9cqw", padding: "0.4cqw 1.4cqw",
          }}>Follow</span>
        </div>
        <span style={{ color: "#fff", fontSize: "2.5cqw", textShadow, opacity: 0.92, lineHeight: 1.3 }}>
          Your caption goes here — this is roughly how much room it has
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "1cqw" }}>
          <div style={{ width: "2.2cqw", height: "2.2cqw", flexShrink: 0, ...iconShadow }}><MusicNoteIcon /></div>
          <span style={{ color: "#fff", fontSize: "2.2cqw", textShadow, opacity: 0.9, whiteSpace: "nowrap" }}>Original audio · yourhandle</span>
        </div>
      </div>

      <style>{`@keyframes motionist-ig-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
