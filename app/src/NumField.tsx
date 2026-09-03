import React from "react";

// A tiny arrow up/down for its own class, and — per an old code comment —
// tried once already: a CSS filter to recolor the native spinner toward the
// app's accent, and it recolored an opaque box Chrome/Windows paints BEHIND
// the arrows (not something plain CSS controls at all), not just the two
// glyphs. Real "our style" arrows means a real custom control, not a filter.
const ChevronUpIcon: React.FC = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 6 L4.5 3 L7.5 6" />
  </svg>
);
const ChevronDownIcon: React.FC = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 3 L4.5 6 L7.5 3" />
  </svg>
);

// Drop-in replacement for <input type="number"> — same props, spread
// straight through, so every existing value/onChange/min/max/step (each
// with its own rounding/clamping logic already) keeps working completely
// unchanged. The native spinner is hidden via CSS; these two buttons call
// the real DOM stepUp()/stepDown() (which already respects the input's own
// min/max/step attributes, same as the native arrows did) and dispatch a
// real "input" event so React's existing onChange fires exactly as if the
// browser's own spinner had been clicked — no call site needed its own
// logic touched, just the tag renamed. Its own file (not defined alongside
// ColorField etc. in App.tsx) specifically so Dashboard.tsx — which App.tsx
// itself imports — can use it too without a circular import between them.
// Press-and-hold typematic repeat for the spin buttons — matches the native
// OS/browser spinner convention (and most number steppers generally): one
// step immediately on press, then a pause, then repeats while still held,
// speeding up slightly the longer it's held so a big jump doesn't take
// forever. Stops on release/leave/cancel — never on a timer running past
// the actual press.
const REPEAT_DELAY_MS = 400; // pause before repeating starts
const REPEAT_INTERVAL_START_MS = 90;
const REPEAT_INTERVAL_MIN_MS = 30;

export const NumField: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const ref = React.useRef<HTMLInputElement>(null);
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatCount = React.useRef(0);

  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el || props.disabled) return;
    dir === 1 ? el.stepUp() : el.stepDown();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const clearHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    repeatCount.current = 0;
  };

  const startHold = (dir: 1 | -1) => {
    step(dir); // fires once immediately — a tap always does exactly one step
    repeatCount.current = 0;
    const tick = () => {
      step(dir);
      repeatCount.current += 1;
      // Ramps from REPEAT_INTERVAL_START_MS down to REPEAT_INTERVAL_MIN_MS
      // over the first ~15 repeats, then holds there — a long hold covers
      // real ground without needing an unreadable instant blur of values.
      const interval = Math.max(
        REPEAT_INTERVAL_MIN_MS,
        REPEAT_INTERVAL_START_MS - repeatCount.current * 4
      );
      holdTimer.current = setTimeout(tick, interval);
    };
    holdTimer.current = setTimeout(tick, REPEAT_DELAY_MS);
  };

  // Stop repeating the moment the input becomes invalid to keep holding
  // (disabled mid-hold, or the component unmounts) — a plain cleanup on
  // unmount, same idea as any other interval/timeout in this codebase.
  React.useEffect(() => () => clearHold(), []);

  // Double-click selects the whole value — a native number input's default
  // double-click selection is inconsistent (a decimal point or minus sign
  // can split it into "words"), so typing right after doesn't reliably
  // replace the whole thing. Runs whatever onDoubleClick a call site passed
  // in first, so this only adds behavior, never silently drops one.
  const handleDoubleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    props.onDoubleClick?.(e);
    e.currentTarget.select();
  };
  return (
    <span className="num-field">
      <input {...props} type="number" ref={ref} onDoubleClick={handleDoubleClick} />
      <span className="num-field-spin">
        <button type="button" tabIndex={-1} disabled={props.disabled}
          onPointerDown={(e) => { e.preventDefault(); startHold(1); }}
          onPointerUp={clearHold} onPointerLeave={clearHold} onPointerCancel={clearHold}
          aria-label="Increase">
          <ChevronUpIcon />
        </button>
        <button type="button" tabIndex={-1} disabled={props.disabled}
          onPointerDown={(e) => { e.preventDefault(); startHold(-1); }}
          onPointerUp={clearHold} onPointerLeave={clearHold} onPointerCancel={clearHold}
          aria-label="Decrease">
          <ChevronDownIcon />
        </button>
      </span>
    </span>
  );
};
