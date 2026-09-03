import React from "react";
import type { ContentLayer as LayerT, MotionKeyframe } from "../../src/types";
import { KEYFRAME_EASE_NAMES, easingFn } from "../../src/presets";

// The "Keyframes" mode of the Keyframes tab — per-property tracks, an
// alternative to the delay/duration preset system above it in ElementMotion.
// A track with exactly two points renders as a chunky draggable block (body
// drag = move both points together, right-edge drag = resize the second) —
// the SAME shape today's simple in/out fields already are, just two
// keyframes on one property. Click empty space on a track to add another
// point and it unfolds into plain draggable diamonds instead; double-click a
// diamond to remove it (drop back to 2 points and it's a block again).
//
// This mirrors a prototype the user reviewed and approved (three directions
// compared live, "Option C" chosen) before this was built — see that
// artifact's own JS for the interaction this was translated from.

type TrackKey = "opacity" | "scale" | "tx" | "ty" | "rotate";
type TrackConfig = { key: TrackKey; label: string; min: number; max: number };

function tracksFor(canvas: [number, number]): TrackConfig[] {
  return [
    { key: "opacity", label: "Opacity", min: 0, max: 1 },
    { key: "scale", label: "Scale", min: 0.2, max: 2.5 },
    { key: "tx", label: "Position X", min: -canvas[0] / 2, max: canvas[0] / 2 },
    { key: "ty", label: "Position Y", min: -canvas[1] / 2, max: canvas[1] / 2 },
    { key: "rotate", label: "Rotation", min: -180, max: 180 },
  ];
}

let uidSeed = 1;
const nextId = () => `kf${Date.now().toString(36)}${uidSeed++}`;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export const KeyframeEditor: React.FC<{
  layer: LayerT;
  pageDuration: number; // frames
  canvas: [number, number];
  onChange: (fn: (l: LayerT) => void) => void;
}> = ({ layer, pageDuration, canvas, onChange }) => {
  const tracks = tracksFor(canvas);
  const mk = layer.motionKeyframes ?? {};

  const setTrack = (key: TrackKey, arr: MotionKeyframe[]) => {
    const sorted = [...arr].sort((a, b) => a.t - b.t);
    onChange((l) => {
      const next = { ...(l.motionKeyframes ?? {}) };
      (next as any)[key] = sorted;
      l.motionKeyframes = next;
    });
  };

  const fps = 30; // matches ElementMotion's own sec()/toFr() convention above
  const durationSec = pageDuration / fps;
  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(durationSec); s++) ticks.push(s);

  return (
    <div className="kf-editor">
      <div className="kf-ruler">
        {ticks.map((s) => (
          <span key={s} className="kf-ruler-tick" style={{ left: `${(s / durationSec) * 100}%` }}>
            {s}s
          </span>
        ))}
      </div>
      <div className="kf-stack">
        {tracks.map((t) => (
          <TrackRow
            key={t.key}
            cfg={t}
            pageDuration={pageDuration}
            points={(mk as any)[t.key] ?? []}
            onSet={(arr) => setTrack(t.key, arr)}
          />
        ))}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Click empty space on a track to add a point · drag a block to move it, its right edge to
        resize · drag a diamond to retime/reshape · double-click a diamond to remove it.
      </p>
    </div>
  );
};

const TrackRow: React.FC<{
  cfg: TrackConfig;
  pageDuration: number;
  points: MotionKeyframe[];
  onSet: (arr: MotionKeyframe[]) => void;
}> = ({ cfg, pageDuration, points, onSet }) => {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const valueToPct = (v: number) => clamp(((v - cfg.min) / (cfg.max - cfg.min || 1)) * 90 + 5, 0, 100);
  const pctToValue = (topFrac: number) => clamp(cfg.min + (1 - topFrac) * (cfg.max - cfg.min), cfg.min, cfg.max);
  const tToPct = (t: number) => (t / pageDuration) * 100;

  const withId = (arr: MotionKeyframe[]) => arr as (MotionKeyframe & { id?: string })[];

  // Ids only exist client-side (for React keys / drag tracking) — never
  // persisted; assigned once per point object identity via a WeakMap so a
  // point keeps its id across re-renders without needing to store one in
  // project data.
  const idMap = React.useRef(new WeakMap<MotionKeyframe, string>());
  const idFor = (kf: MotionKeyframe) => {
    let id = idMap.current.get(kf);
    if (!id) { id = nextId(); idMap.current.set(kf, id); }
    return id;
  };

  const addPointAt = (clientX: number, clientY: number) => {
    const rect = areaRef.current!.getBoundingClientRect();
    const t = Math.round(clamp(((clientX - rect.left) / rect.width) * pageDuration, 0, pageDuration));
    const v = pctToValue((clientY - rect.top) / rect.height);
    onSet([...points, { t, v, ease: "linear" }]);
  };

  const onAreaPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".kf-dot, .kf-seg, .kf-chip")) return;
    addPointAt(e.clientX, e.clientY);
  };

  const cycleEase = (kf: MotionKeyframe) => {
    const i = KEYFRAME_EASE_NAMES.indexOf(kf.ease);
    const next = KEYFRAME_EASE_NAMES[(i + 1) % KEYFRAME_EASE_NAMES.length];
    onSet(points.map((p) => (p === kf ? { ...p, ease: next } : p)));
  };

  const removePoint = (kf: MotionKeyframe) => {
    onSet(points.filter((p) => p !== kf));
  };

  // Curve overlay — the real eased shape (sampled), same source of truth
  // (easingFn) the render pipeline uses, not a decorative straight line.
  const curveD = React.useMemo(() => {
    if (points.length < 2) return "";
    const steps = 24;
    const pts: string[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let s = 0; s <= steps; s++) {
        const p = s / steps;
        const ep = easingFn(a.ease)(p);
        const v = a.v + (b.v - a.v) * ep;
        const t = a.t + (b.t - a.t) * p;
        pts.push(`${tToPct(t)},${100 - valueToPct(v)}`);
      }
    }
    return pts.join(" ");
  }, [points, cfg.min, cfg.max, pageDuration]);

  const isBlock = points.length === 2;

  return (
    <div className="kf-track">
      <div className="kf-track-label">{cfg.label}</div>
      <div className="kf-track-area" ref={areaRef} onPointerDown={onAreaPointerDown}>
        {curveD && (
          <svg className="kf-line" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={curveD} fill="none" stroke="var(--accent2)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.85" />
          </svg>
        )}
        {isBlock ? (
          <BlockSeg points={points} onSet={onSet} pageDuration={pageDuration}
            areaRef={areaRef} cycleEase={cycleEase} />
        ) : (
          points.map((kf) => (
            <Diamond key={idFor(kf)} kf={kf} cfg={cfg} pageDuration={pageDuration}
              areaRef={areaRef} dragging={dragId === idFor(kf)}
              onDragStart={() => setDragId(idFor(kf))}
              onDragEnd={() => setDragId(null)}
              onMove={(t, v) => onSet(points.map((p) => (p === kf ? { ...p, t, v } : p)))}
              onDelete={() => removePoint(kf)}
            />
          ))
        )}
        {!isBlock && points.length >= 2 && points.slice(0, -1).map((kf, i) => (
          <EaseChip key={idFor(kf) + "-chip"} left={(tToPct(kf.t) + tToPct(points[i + 1].t)) / 2}
            ease={kf.ease} onClick={() => cycleEase(kf)} />
        ))}
      </div>
    </div>
  );
};

// Exactly Option A's block — body drag moves both endpoints together
// (shifts the whole window), the right-edge handle resizes (moves only the
// second point). This is the SAME two numbers today's simple delay/duration
// fields edit; a block is just what a 2-point track looks like.
const BlockSeg: React.FC<{
  points: MotionKeyframe[];
  onSet: (arr: MotionKeyframe[]) => void;
  pageDuration: number;
  areaRef: React.RefObject<HTMLDivElement | null>;
  cycleEase: (kf: MotionKeyframe) => void;
}> = ({ points, onSet, pageDuration, areaRef, cycleEase }) => {
  const [a, b] = points;
  const dragRef = React.useRef<{ mode: "move" | "resize"; startX: number; aT: number; bT: number } | null>(null);

  const onBodyDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "move", startX: e.clientX, aT: a.t, bT: b.t };
  };
  const onHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: "resize", startX: e.clientX, aT: a.t, bT: b.t };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    const dt = Math.round(((e.clientX - d.startX) / rect.width) * pageDuration);
    if (d.mode === "move") {
      const shift = clamp(dt, -d.aT, pageDuration - d.bT);
      onSet([{ ...a, t: d.aT + shift }, { ...b, t: d.bT + shift }]);
    } else {
      const newBT = clamp(d.bT + dt, d.aT + 1, pageDuration);
      onSet([a, { ...b, t: newBT }]);
    }
  };
  const onUp = () => { dragRef.current = null; };

  const left = (a.t / pageDuration) * 100;
  const width = ((b.t - a.t) / pageDuration) * 100;

  return (
    <div className="kf-seg" style={{ left: `${left}%`, width: `${width}%` }}
      onPointerDown={onBodyDown} onPointerMove={onMove} onPointerUp={onUp}>
      <div className="kf-handle-r" onPointerDown={onHandleDown} onPointerMove={onMove} onPointerUp={onUp} />
      <EaseChip left={50} ease={a.ease} onClick={() => cycleEase(a)} inBlock />
    </div>
  );
};

const Diamond: React.FC<{
  kf: MotionKeyframe;
  cfg: TrackConfig;
  pageDuration: number;
  areaRef: React.RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (t: number, v: number) => void;
  onDelete: () => void;
}> = ({ kf, cfg, pageDuration, areaRef, dragging, onDragStart, onDragEnd, onMove, onDelete }) => {
  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onDragStart();
  };
  const onMovePointer = (e: React.PointerEvent) => {
    if (!dragging || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    const t = Math.round(clamp(((e.clientX - rect.left) / rect.width) * pageDuration, 0, pageDuration));
    const topFrac = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const v = clamp(cfg.min + (1 - topFrac) * (cfg.max - cfg.min), cfg.min, cfg.max);
    onMove(t, v);
  };
  const leftPct = (kf.t / pageDuration) * 100;
  const topPct = 100 - clamp(((kf.v - cfg.min) / (cfg.max - cfg.min || 1)) * 90 + 5, 0, 100);
  return (
    <div
      className={"kf-dot" + (dragging ? " dragging" : "")}
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      onPointerDown={onDown}
      onPointerMove={onMovePointer}
      onPointerUp={onDragEnd}
      onDoubleClick={(e) => { e.stopPropagation(); onDelete(); }}
    />
  );
};

const EaseChip: React.FC<{ left: number; ease: string; onClick: () => void; inBlock?: boolean }> = ({ left, ease, onClick, inBlock }) => (
  <div className={"kf-chip" + (inBlock ? " kf-chip-block" : "")} style={{ left: `${left}%` }}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    title="Click to cycle the curve for this segment">
    {ease}
  </div>
);
