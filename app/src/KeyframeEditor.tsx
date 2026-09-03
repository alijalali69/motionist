import React from "react";
import type { ContentLayer as LayerT } from "../../src/types";
import { KEYFRAME_EASE_NAMES } from "../../src/presets";

// The "Keyframes" view of the Keyframes tab — a visual, draggable
// alternative to the 4 number fields in "Simple", nothing more. One row per
// chosen effect (FX1/FX2/FX3, IN and OUT), each row a chunky block spanning
// when that PHASE plays. Entrance rows all share layer.delay/inDuration —
// dragging any one of them moves/resizes that same shared window, so all
// entrance rows move together (they ARE the same timing, today's model,
// unchanged) — but each row keeps its OWN ease chip (entranceEasing/2/3),
// independently cyclable, so "FX1 lands hard, FX2 lands slower" is real.
// Exit rows work the same way against outDelay/outDuration.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const SLOT_COLOR = ["var(--accent)", "var(--warn)", "var(--good)"];

function cycleEase(current: string | undefined): string {
  const i = KEYFRAME_EASE_NAMES.indexOf((current ?? "") as any);
  return KEYFRAME_EASE_NAMES[(i + 1) % KEYFRAME_EASE_NAMES.length];
}

type Row = {
  key: string;
  label: string; // "FX1 slideRight · IN"
  color: string;
  t0: number;    // frame
  dur: number;   // frames
  ease: string;
  onMove: (deltaFrames: number) => void;
  onResize: (newDur: number) => void;
  onCycleEase: () => void;
};

export const KeyframeEditor: React.FC<{
  layer: LayerT;
  pageDuration: number; // frames
  onChange: (fn: (l: LayerT) => void) => void;
}> = ({ layer, pageDuration, onChange }) => {
  const inDuration = layer.inDuration ?? 26;
  const outDuration = layer.outDuration ?? 24;
  const outStart = layer.outDelay ?? (pageDuration - outDuration);

  const entranceSlots: [LayerT["entrance"] | undefined, string | undefined][] = [
    [layer.entrance, layer.entranceEasing],
    [layer.entrance2, layer.entranceEasing2],
    [layer.entrance3, layer.entranceEasing3],
  ];
  const exitSlots: [LayerT["exit"] | undefined, string | undefined][] = [
    [layer.exit, layer.exitEasing],
    [layer.exit2, layer.exitEasing2],
    [layer.exit3, layer.exitEasing3],
  ];

  const rows: Row[] = [];
  entranceSlots.forEach(([name, ease], i) => {
    if (!name || name === "none") return;
    rows.push({
      key: `in${i}`,
      label: `FX${i + 1} ${name} · IN`,
      color: SLOT_COLOR[i],
      t0: layer.delay, dur: inDuration, ease: ease ?? "auto",
      onMove: (dt) => onChange((l) => { l.delay = Math.max(0, l.delay + dt); }),
      onResize: (d) => onChange((l) => { l.inDuration = Math.max(1, d); }),
      onCycleEase: () => onChange((l) => {
        const next = cycleEase(ease) as any;
        if (i === 0) l.entranceEasing = next;
        else if (i === 1) l.entranceEasing2 = next;
        else l.entranceEasing3 = next;
      }),
    });
  });
  exitSlots.forEach(([name, ease], i) => {
    if (!name || name === "none") return;
    rows.push({
      key: `out${i}`,
      label: `FX${i + 1} ${name} · OUT`,
      color: SLOT_COLOR[i],
      t0: outStart, dur: outDuration, ease: ease ?? "auto",
      onMove: (dt) => onChange((l) => {
        const base = l.outDelay ?? outStart;
        l.outDelay = clamp(base + dt, 0, pageDuration - (l.outDuration ?? outDuration));
      }),
      onResize: (d) => onChange((l) => { l.outDuration = Math.max(1, d); }),
      onCycleEase: () => onChange((l) => {
        const next = cycleEase(ease) as any;
        if (i === 0) l.exitEasing = next;
        else if (i === 1) l.exitEasing2 = next;
        else l.exitEasing3 = next;
      }),
    });
  });

  const fps = 30;
  const durationSec = pageDuration / fps;
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
        Drag a block to move it, its right edge to resize · click the ease chip to cycle that effect's
        own curve. Entrance rows share one timing window (today's IN delay/duration); exit rows share
        the OUT window — dragging any row of the same phase moves them together.
      </p>
    </div>
  );
};

const TrackRow: React.FC<{ row: Row; pageDuration: number }> = ({ row, pageDuration }) => {
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ mode: "move" | "resize"; startX: number; startT0: number; startDur: number } | null>(null);

  const left = (row.t0 / pageDuration) * 100;
  const width = (row.dur / pageDuration) * 100;

  const onBodyDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "move", startX: e.clientX, startT0: row.t0, startDur: row.dur };
  };
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "resize", startX: e.clientX, startT0: row.t0, startDur: row.dur };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    const dt = Math.round(((e.clientX - d.startX) / rect.width) * pageDuration);
    if (d.mode === "move") row.onMove(dt);
    else row.onResize(clamp(d.startDur + dt, 1, pageDuration));
  };
  const onUp = () => { dragRef.current = null; };

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
          // transparent instead, so the fade-in gradient still tracks the
          // token if the palette ever changes.
          background: `linear-gradient(90deg, color-mix(in srgb, ${row.color} 15%, transparent), color-mix(in srgb, ${row.color} 55%, transparent))`,
        }}
          onPointerDown={onBodyDown} onPointerMove={onMove} onPointerUp={onUp}>
          <div className="kf-handle-r" onPointerDown={onHandleDown} onPointerMove={onMove} onPointerUp={onUp} />
          <div className="kf-chip"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); row.onCycleEase(); }}
            title="Click to cycle this effect's own easing">
            {row.ease}
          </div>
        </div>
      </div>
    </div>
  );
};
