import React from "react";

// The Kadr wordmark. کادر splits into exactly the three clusters Persian
// itself breaks it into — کا · د · ر, because ا, د and ر never join the
// letter after them — and each cluster gets its own frame. The first frame
// (rightmost, in reading order) is lit, with the echo trail of a frame that
// just moved. Three frames for the three things you set on a layer
// (Content · Effects · Keys); what comes out the other end is motion.
//
// HTML rather than an SVG file on purpose: the lettering needs a real
// Persian face, and an SVG loaded through <img> can't reach the page's
// fonts. The square app icon (public/brand/kadr-icon.svg) is the same mark
// reduced to the lit frame, with no lettering at all.
export const KadrWordmark: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <span className="kadr-wm" style={{ "--cell": `${size}px` } as React.CSSProperties}
    role="img" aria-label="Kadr">
    <span className="kadr-cell lit" aria-hidden="true">کا</span>
    <span className="kadr-cell" aria-hidden="true">د</span>
    <span className="kadr-cell" aria-hidden="true">ر</span>
  </span>
);
