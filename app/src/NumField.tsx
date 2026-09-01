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
export const NumField: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const ref = React.useRef<HTMLInputElement>(null);
  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el || props.disabled) return;
    dir === 1 ? el.stepUp() : el.stepDown();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
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
          onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)} aria-label="Increase">
          <ChevronUpIcon />
        </button>
        <button type="button" tabIndex={-1} disabled={props.disabled}
          onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)} aria-label="Decrease">
          <ChevronDownIcon />
        </button>
      </span>
    </span>
  );
};
