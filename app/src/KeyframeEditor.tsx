import React from "react";
import type { ContentLayer as LayerT } from "../../src/types";
import { KEYFRAME_EASE_NAMES, easingFn, resolvedEntranceEasing, resolvedExitEasing } from "../../src/presets";

// The "Keyframes" view of the Keyframes tab — a visual, draggable
// alternative to the 4 number fields in "Simple", nothing more. One row per
// chosen effect (FX1/FX2/FX3, IN and OUT), each row a chunky block with its
// own timing (delay/duration), own easing, and a live curve showing that
// easing's real shape. FX slots move fully independently of each other —
// FX2's own delay2/inDuration2 fall back to FX1's delay/inDuration only
// until FX2 is dragged for the first time, same idea for FX3 and for exit's
// outDelay2/3 / outDuration2/3.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const SLOT_COLOR = ["var(--accent)", "var(--warn)", "var(--good)"];

// Two-tier snap: a strong pull to the nearest whole SECOND when already
// close (magnetic, not velocity-based — a fast drag blows straight past
// the window in one jump so it barely feels it, a slow drag lingers
// inside it, which reads as "only snaps when dragging slowly"); everywhere
// else, a soft snap to the nearest 0.1s (3 frames) so the block still
// lands on tidy round values instead of raw single-frame pixel jitter.
const FPS = 30;
const SEC_FRAMES = FPS;
const SUBSEC_FRAMES = 3; // 0.1s
const SNAP_WINDOW_FRAMES = 5;
function snapFrame(frame: number): number {
  const nearestSec = Math.round(frame / SEC_FRAMES) * SEC_FRAMES;
  if (Math.abs(frame - nearestSec) <= SNAP_WINDOW_FRAMES) return nearestSec;
  return Math.round(frame / SUBSEC_FRAMES) * SUBSEC_FRAMES;
}
const fmtSec = (frames: number) => (frames / FPS).toFixed(2) + "s";

function cycleEase(current: string | undefined): string {
  const i = KEYFRAME_EASE_NAMES.indexOf((current ?? "") as any);
  return KEYFRAME_EASE_NAMES[(i + 1) % KEYFRAME_EASE_NAMES.length];
}

type Row = {
  key: string;
  label: string;        // "FX1 slideRight · IN"
  color: string;
  t0: number;            // frame
  dur: number;            // frames
  ease: string;           // display label — "auto" when unset
  curveEase: string;      // the REAL curve to draw ("auto" resolved to its actual default; spring mapped to easeOutBack)
  onMove: (newT0: number) => void;   // ABSOLUTE new start frame, not a delta to add
  onResize: (newDur: number) => void; // ABSOLUTE new duration
  onCycleEase: () => void;
};

const DELAY_KEYS = ["delay", "delay2", "delay3"] as const;
const IN_DUR_KEYS = ["inDuration", "inDuration2", "inDuration3"] as const;
const IN_EASE_KEYS = ["entranceEasing", "entranceEasing2", "entranceEasing3"] as const;
const OUT_DELAY_KEYS = ["outDelay", "outDelay2", "outDelay3"] as const;
const OUT_DUR_KEYS = ["outDuration", "outDuration2", "outDuration3"] as const;
const OUT_EASE_KEYS = ["exitEasing", "exitEasing2", "exitEasing3"] as const;

export const KeyframeEditor: React.FC<{
  layer: LayerT;
  pageDuration: number; // frames
  onChange: (fn: (l: LayerT) => void) => void;
}> = ({ layer, pageDuration, onChange }) => {
  const l = layer as any;
  const baseDelay = l.delay as number;
  const baseInDur = (l.inDuration ?? 26) as number;
  const baseOutDur = (l.outDuration ?? 24) as number;
  const baseOutStart = (l.outDelay ?? (pageDuration - baseOutDur)) as number;

  const entranceNames = [layer.entrance, layer.entrance2, layer.entrance3];
  const exitNames = [layer.exit, layer.exit2, layer.exit3];

  // FX2/FX3's OWN timing was falling back to FX1's live value on every
  // render — so dragging FX1 dragged them along too, even though nothing
  // of theirs had actually changed (reported as "FX1 and FX2 move
  // together"). Seed a concrete value into any active slot that's still
  // relying on that fallback, once, so every row is independently
  // draggable from the moment you open this view — not just after you've
  // touched it once yourself.
  // Was `[]` (mount-only) — fixed the "FX1 and FX2 move together" bug for a
  // layer that already had FX2/3 active when the Keyframes panel first
  // opened, but missed the same bug for FX2/3 added WHILE the panel stays
  // mounted (adding "+FX2" doesn't remount this component, so a mount-only
  // effect never re-seeds it — the newly-active slot keeps live-falling-
  // back to FX1 exactly like before, just for a narrower trigger). Keying
  // off the actual entrance/exit NAME sets (by value, not array identity —
  // the arrays themselves are rebuilt fresh every render) makes this re-run
  // exactly when a slot goes from inactive to active, and stay a no-op
  // otherwise: dragging a block changes timing fields, never these names,
  // so this doesn't re-fire on every drag tick, and every write inside is
  // already `undefined`-guarded, so an extra run changes nothing.
  const entranceKey = entranceNames.join("|");
  const exitKey = exitNames.join("|");
  React.useEffect(() => {
    onChange((ll: any) => {
      for (let i = 1; i <= 2; i++) {
        if (entranceNames[i] && entranceNames[i] !== "none") {
          if (ll[DELAY_KEYS[i]] === undefined) ll[DELAY_KEYS[i]] = ll.delay;
          if (ll[IN_DUR_KEYS[i]] === undefined) ll[IN_DUR_KEYS[i]] = ll.inDuration ?? 26;
        }
        if (exitNames[i] && exitNames[i] !== "none") {
          if (ll[OUT_DELAY_KEYS[i]] === undefined) {
            ll[OUT_DELAY_KEYS[i]] = ll.outDelay ?? (pageDuration - (ll.outDuration ?? 24));
          }
          if (ll[OUT_DUR_KEYS[i]] === undefined) ll[OUT_DUR_KEYS[i]] = ll.outDuration ?? 24;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entranceKey, exitKey]);

  const rows: Row[] = [];
  entranceNames.forEach((name, i) => {
    if (!name || name === "none") return;
    const t0 = i === 0 ? baseDelay : (l[DELAY_KEYS[i]] ?? baseDelay);
    const dur = i === 0 ? baseInDur : (l[IN_DUR_KEYS[i]] ?? baseInDur);
    const override = l[IN_EASE_KEYS[i]];
    rows.push({
      key: `in${i}`,
      label: `FX${i + 1} ${name} · IN`,
      color: SLOT_COLOR[i],
      t0, dur, ease: override ?? "auto",
      curveEase: resolvedEntranceEasing(name, override),
      onMove: (newT0) => onChange((ll: any) => { ll[DELAY_KEYS[i]] = Math.max(0, newT0); }),
      onResize: (d) => onChange((ll: any) => { ll[IN_DUR_KEYS[i]] = Math.max(1, d); }),
      onCycleEase: () => onChange((ll: any) => { ll[IN_EASE_KEYS[i]] = cycleEase(override); }),
    });
  });
  exitNames.forEach((name, i) => {
    if (!name || name === "none") return;
    const t0 = i === 0 ? baseOutStart : (l[OUT_DELAY_KEYS[i]] ?? baseOutStart);
    const dur = i === 0 ? baseOutDur : (l[OUT_DUR_KEYS[i]] ?? baseOutDur);
    const override = l[OUT_EASE_KEYS[i]];
    rows.push({
      key: `out${i}`,
      label: `FX${i + 1} ${name} · OUT`,
      color: SLOT_COLOR[i],
      t0, dur, ease: override ?? "auto",
      curveEase: resolvedExitEasing(name, override),
      onMove: (newT0) => onChange((ll: any) => {
        const dCur = (i === 0 ? ll.outDuration : ll[OUT_DUR_KEYS[i]]) ?? dur;
        ll[OUT_DELAY_KEYS[i]] = clamp(newT0, 0, pageDuration - dCur);
      }),
      onResize: (d) => onChange((ll: any) => { ll[OUT_DUR_KEYS[i]] = Math.max(1, d); }),
      onCycleEase: () => onChange((ll: any) => { ll[OUT_EASE_KEYS[i]] = cycleEase(override); }),
    });
  });

  const durationSec = pageDuration / FPS;
  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(durationSec); s++) ticks.push(s);

  if (rows.length === 0) {
    return (
      <p className="hint" style={{ marginTop: 8 }}>
        No IN/OUT effects chosen yet — pick one above and it'll show up here as a draggable row.
      </p>
    );
  }

  return (
    <div className="kf-editor">
      <div className="kf-ruler">
        {ticks.map((s) => (
          <span key={s} className="kf-ruler-tick" style={{ left: `${(s / durationSec) * 100}%` }}>{s}s</span>
        ))}
      </div>
      <div className="kf-stack">
        {rows.map((r) => (
          <TrackRow key={r.key} row={r} pageDuration={pageDuration} />
        ))}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Each FX row moves independently — drag a block to move it, its right edge to resize (a live
        readout shows the exact time; snaps hard to whole seconds, softly to 0.1s steps otherwise),
        click the ease chip to cycle that effect's own curve. The line on the block is that curve, live.
      </p>
    </div>
  );
};

// Each row.onMove/onResize commit goes through onChange -> update(), which
// clones the WHOLE project and re-renders the entire Player (every layer's
// entrance/exit motion recomputed, every glitch/liquid/particle overlay
// re-rendered) — fine once, expensive at raw pointermove frequency (well
// past 60/sec on a real mouse). Throttling the COMMIT while leaving the
// visual readout (dragLive) unthrottled keeps the block feeling perfectly
// responsive while cutting the actual expensive work by roughly this ratio.
const DRAG_COMMIT_MS = 50; // ~20 commits/sec — plenty for a live-updating block

const TrackRow: React.FC<{ row: Row; pageDuration: number }> = ({ row, pageDuration }) => {
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ mode: "move" | "resize"; startX: number; startT0: number; startDur: number } | null>(null);
  // Mirrors dragRef into real state ONLY so the live seconds readout can
  // render/update during a drag — dragRef alone doesn't trigger a render.
  const [dragLive, setDragLive] = React.useState<{ mode: "move" | "resize"; frames: number } | null>(null);
  // The single source of truth for "what's the latest computed value,
  // right now" — read by onUp to guarantee the FINAL position always
  // commits even if it landed inside a throttled window above and never
  // reached row.onMove/onResize. A ref, not dragLive (React state): onUp
  // needs this synchronously the instant it fires, not whichever value
  // happened to have made it through React's own render timing by then.
  const latestRef = React.useRef<{ mode: "move" | "resize"; frames: number } | null>(null);
  const lastCommitRef = React.useRef(0);

  const left = (row.t0 / pageDuration) * 100;
  const width = (row.dur / pageDuration) * 100;

  const onBodyDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "move", startX: e.clientX, startT0: row.t0, startDur: row.dur };
    lastCommitRef.current = 0; // next onMove always commits immediately — no stale throttle window carried over from a previous drag
    setDragLive({ mode: "move", frames: row.t0 });
  };
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "resize", startX: e.clientX, startT0: row.t0, startDur: row.dur };
    lastCommitRef.current = 0;
    setDragLive({ mode: "resize", frames: row.dur });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    // Always computed from the fixed snapshot taken at pointerdown, never
    // from the row's current (already-updated-mid-drag) position — see the
    // "jumps while dragging" fix.
    const dt = Math.round(((e.clientX - d.startX) / rect.width) * pageDuration);
    const v = d.mode === "move"
      ? snapFrame(Math.max(0, d.startT0 + dt))
      : snapFrame(clamp(d.startDur + dt, 1, pageDuration));
    latestRef.current = { mode: d.mode, frames: v };
    setDragLive({ mode: d.mode, frames: v }); // every event — cheap, purely local, keeps the block/readout feeling instant
    const now = performance.now();
    if (now - lastCommitRef.current < DRAG_COMMIT_MS) return; // the expensive path (full project clone + re-render) — throttled
    lastCommitRef.current = now;
    if (d.mode === "move") row.onMove(v); else row.onResize(v);
  };
  const onUp = () => {
    const last = latestRef.current;
    if (last) { last.mode === "move" ? row.onMove(last.frames) : row.onResize(last.frames); }
    dragRef.current = null; latestRef.current = null; setDragLive(null);
  };

  // The real eased shape (sampled), redrawn whenever the ease actually
  // changes — this is the literal answer to "when easing is changed the
  // graph should show the change."
  const curveD = React.useMemo(() => {
    const fn = easingFn(row.curveEase === "spring" ? "easeOutBack" : (row.curveEase as any));
    const steps = 20;
    const pts: string[] = [];
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      pts.push(`${p * 100},${100 - fn(p) * 100}`);
    }
    return pts.join(" ");
  }, [row.curveEase]);

  return (
    <div className="kf-track">
      <div className="kf-track-label">
        <span className="kf-fxname" style={{ color: row.color }}>{row.label}</span>
      </div>
      <div className="kf-track-area" ref={areaRef}>
        <div className="kf-seg" style={{
          left: `${left}%`, width: `${width}%`,
          // Can't just append a hex-alpha suffix onto a var(...) reference
          // (var(--accent)22 isn't valid CSS — the whole background rule
          // gets silently dropped) — color-mix() blends the CSS var with
          // transparent instead, so the fill still tracks the token if the
          // palette ever changes.
          background: `linear-gradient(90deg, color-mix(in srgb, ${row.color} 15%, transparent), color-mix(in srgb, ${row.color} 55%, transparent))`,
        }}
          onPointerDown={onBodyDown} onPointerMove={onMove} onPointerUp={onUp}>
          <svg className="kf-block-curve" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={curveD} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="kf-handle-r" onPointerDown={onHandleDown} onPointerMove={onMove} onPointerUp={onUp} />
          {/* Floating ABOVE the block (like a real tooltip) got silently
              clipped invisible by .kf-stack's own overflow:hidden — never
              caught it because the earlier check only confirmed the
              element existed in the DOM, not that it actually painted
              on screen. Showing it in the ease chip's own spot instead
              (swapped in during the drag) guarantees it's inside bounds
              that are already proven to render, on every row including
              the first/last. */}
          {dragLive ? (
            <div className="kf-drag-readout">
              {dragLive.mode === "move" ? "start " : "dur "}{fmtSec(dragLive.frames)}
            </div>
          ) : (
            <div className="kf-chip"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); row.onCycleEase(); }}
              title="Click to cycle this effect's own easing">
              {row.ease}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
