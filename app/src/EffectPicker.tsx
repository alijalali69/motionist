import React from "react";
import { createPortal } from "react-dom";
import { EffectStage, useLoopFrame, REST, HOLD, type Sample } from "./EffectPreview";
import { MotionFilterDefs } from "../../src/MotionFx";

// The in-panel effect picker: a trigger chip showing the CURRENTLY SELECTED
// effect playing live, which opens a grid of small tiles each playing its
// own effect. Replaces a plain <select> of names.
//
// This is a second attempt at an idea that was tried and reverted once
// (d479514). What was wrong the first time, and what's different now:
//   - It previewed by writing transforms onto the dropdown's own text
//     label, so anything that isn't a transform — the entire glitch family,
//     every clip-path wipe — previewed as literally nothing happening. It
//     now renders a real sample layer through EffectStage, the same
//     renderer the full-page gallery uses, overlays included.
//   - Preview only happened on hover, one effect at a time, so you couldn't
//     compare. Every tile plays at once here, off ONE shared rAF loop.
// It also takes less panel room than the <select> it replaces, because the
// grid is an overlay rather than part of the panel.

const PREVIEW_SIZE = 68;
const TRIGGER_SIZE = 26;
const DURATION = 26; // frames, matching ContentLayer.inDuration's own default
const CYCLE = REST + DURATION + HOLD;
// The frame a closed, un-hovered trigger chip freezes on. Deliberately NOT
// frame 0 — most effects are invisible at 0 (that's the "before" state), so
// the chip would just be an empty box. Mid-arrival is the frame that most
// looks like the effect.
const STILL_FRAME = REST + Math.round(DURATION * 0.55);
const POP_W = 372;
const POP_MAX_H = 460;
const GAP = 5;

// The popover has to be a PORTAL, not an absolutely-positioned child.
// Verified the hard way: as a child it measured the right size and position
// but rendered as a ~170px sliver, because the Effects panel it lives in is
// a scroll container (overflow), and no amount of z-index lets a descendant
// escape an ancestor's overflow clip. Fixed positioning off the trigger's
// own rect is the way out, which also makes the viewport clamping below
// possible.
function popoverPosition(trigger: DOMRect): React.CSSProperties {
  // Right-aligned to the trigger: this panel is a narrow rail against the
  // window's right edge, so the popover grows leftward across the canvas.
  const left = Math.max(8, Math.min(trigger.right - POP_W, window.innerWidth - POP_W - 8));
  const below = window.innerHeight - trigger.bottom - GAP - 8;
  const flipUp = below < 240 && trigger.top > below;
  const maxHeight = Math.min(POP_MAX_H, flipUp ? trigger.top - GAP - 8 : below);
  return flipUp
    ? { position: "fixed", left, bottom: window.innerHeight - trigger.top + GAP, width: POP_W, maxHeight }
    : { position: "fixed", left, top: trigger.bottom + GAP, width: POP_W, maxHeight };
}

export const EffectPicker: React.FC<{
  value: string;
  onChange: (name: string) => void;
  categories: { label: string; names: string[] }[];
  kind: "in" | "out";
  sample: Sample;
  disabled?: boolean;
}> = ({ value, onChange, categories, kind, sample, disabled }) => {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // The loop only runs while this picker is open or hovered. There are up to
  // eight pickers mounted in the Effects panel at once, next to a live
  // Remotion <Player>; eight permanently-running rAF loops each doing a
  // setState per frame is real cost for no benefit when nobody is looking at
  // them. Closed and un-hovered, the chip is a still frame instead.
  const running = open || hover;
  const loopFrame = useLoopFrame(CYCLE, running);
  const frame = running ? loopFrame : STILL_FRAME;

  const q = query.trim().toLowerCase();
  const groups = categories
    .map((c) => ({ ...c, names: q ? c.names.filter((n) => n.toLowerCase().includes(q)) : c.names }))
    .filter((g) => g.names.length > 0);

  const pick = (name: string) => { onChange(name); setOpen(false); setQuery(""); };

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [popStyle, setPopStyle] = React.useState<React.CSSProperties | null>(null);
  // Re-measured every time it opens (and on scroll/resize while open) rather
  // than once on mount — the panel it hangs off is scrollable, so the
  // trigger's own position on screen moves.
  React.useEffect(() => {
    if (!open) { setPopStyle(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPopStyle(popoverPosition(r));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="fxp" style={{ flex: "1.3 1 0" }}>
      <button ref={triggerRef} type="button" className="fxp-trigger" disabled={disabled}
        title={value === "none" ? "Pick an effect" : `${value} — click to change`}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={() => setOpen((v) => !v)}>
        <span className="fxp-chip">
          {value === "none"
            ? <span className="fxp-chip-none">—</span>
            : <EffectStage name={value} tab={kind} sample={sample} frame={frame}
                easing={undefined} duration={DURATION} size={TRIGGER_SIZE} />}
        </span>
        <span className="fxp-triggerlbl">{value === "none" ? "None" : value}</span>
        <span className="fxp-caret">▾</span>
      </button>

      {open && !disabled && popStyle && createPortal(
        <>
          {/* Click-outside catcher, same pattern the app's other popovers use. */}
          <div className="dropdown-catcher" onClick={() => { setOpen(false); setQuery(""); }} />
          <div className="fxp-pop" style={popStyle}>
            {/* glitchIn's channel split and liquidIn's warp reference these
                filters by id. The gallery mounts its own set; a popover can
                be open with the gallery closed, so it needs them too. */}
            <MotionFilterDefs frame={frame} />
            <div className="fxp-pophead">
              <input type="text" className="fxp-search" autoFocus value={query} placeholder="Filter…"
                onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className={"fxp-noneopt" + (value === "none" ? " on" : "")}
                onClick={() => pick("none")}>None</button>
            </div>
            <div className="fxp-scroll">
              {groups.map((cat) => (
                <div key={cat.label}>
                  <div className="fxp-cathead">{cat.label}</div>
                  <div className="fxp-grid">
                    {cat.names.map((n) => (
                      <button type="button" key={n} title={n}
                        className={"fxp-cell" + (n === value ? " on" : "")}
                        onClick={() => pick(n)}>
                        <EffectStage name={n} tab={kind} sample={sample} frame={frame}
                          easing={undefined} duration={DURATION} size={PREVIEW_SIZE} />
                        <span className="fxp-cellname">{n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {groups.length === 0 && <p className="fxp-empty">No effect matches “{query}”.</p>}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};
