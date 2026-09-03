import React from "react";
import type { ContentLayer as LayerT, MotionKeyframe, MotionFxTrack } from "../../src/types";
import { KEYFRAME_EASE_NAMES, easingFn, KF_PROP_META, isProgressOnlyEffect } from "../../src/presets";

// The "Keyframes" mode of the Keyframes tab — one track group per chosen FX,
// each in that effect's OWN real units (slideRight in px, rotateIn in degrees
// + a scale track, etc). Two combined FX are two independent, separately-
// editable tracks. Opacity is one shared track. Non-scalar effects (wipes,
// shine, card-flip) get a single 0..1 Progress track instead. Seeded from the
// layer's current Simple-mode motion via deriveKeyframesFromSimple (see the
// Keyframes toggle in App.tsx), so switching modes reproduces what you had,
// now editable. Diamonds only (no blocks) — the point of real-value mode is
// that the diamond's HEIGHT is the value, which a flat block would hide.

const PAD = 0.1; // top/bottom inset so diamonds never clip at the track edge
const SLOT_COLOR: Record<1 | 2 | 3, string> = {
  1: "var(--accent)",
  2: "var(--warn)",
  3: "var(--good)",
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type TrackDesc = {
  id: string;
  effectLabel: string;   // "slideRight", or "Opacity" for the shared track
  paramLabel: string;    // "X offset · px", "Progress · %"
  tag?: string;          // "FX1 · IN" (absent for the shared opacity track)
  color: string;
  min: number;
  max: number;
  displayScale: number;  // 100 for 0..1 tracks shown as %, else 1
  points: MotionKeyframe[];
  onSet: (pts: MotionKeyframe[]) => void;
};

// Where a track with no seeded points opens, per dimension — a sane visible
// range so the first click lands somewhere meaningful.
function emptyRange(prop: MotionFxTrack["prop"]): [number, number] {
  switch (prop) {
    case "tx": case "ty": return [-100, 100];
    case "rotate": return [-45, 45];
    case "rotateY": return [-120, 120];
    case "scale": return [0, 2];
    case "blur": return [0, 20];
    default: return [0, 1]; // progress
  }
}

function rangeFor(prop: MotionFxTrack["prop"] | "opacity", pts: MotionKeyframe[]): [number, number] {
  if (prop === "opacity" || prop === "progress") return [0, 1];
  if (pts.length === 0) return emptyRange(prop);
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  // Include the effect's resting anchor so the "arrived" value reads as home:
  // 0 for offsets/rotation, 1 for scale, 0 for blur.
  const anchor = prop === "scale" ? 1 : 0;
  lo = Math.min(lo, anchor); hi = Math.max(hi, anchor);
  if (Math.abs(hi - lo) < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.18;
  return [lo - pad, hi + pad];
}

export const KeyframeEditor: React.FC<{
  layer: LayerT;
  pageDuration: number; // frames
  onChange: (fn: (l: LayerT) => void) => void;
}> = ({ layer, pageDuration, onChange }) => {
  const mk = layer.motionKeyframes ?? {};
  const fx = mk.fx ?? [];

  const setOpacity = (pts: MotionKeyframe[]) => {
    const sorted = [...pts].sort((a, b) => a.t - b.t);
    onChange((l) => { l.motionKeyframes = { ...(l.motionKeyframes ?? {}), opacity: sorted }; });
  };
  const setFxPoints = (idx: number, pts: MotionKeyframe[]) => {
    const sorted = [...pts].sort((a, b) => a.t - b.t);
    onChange((l) => {
      const cur = l.motionKeyframes ?? {};
      const nextFx = (cur.fx ?? []).map((f, i) => (i === idx ? { ...f, points: sorted } : f));
      l.motionKeyframes = { ...cur, fx: nextFx };
    });
  };

  const tracks: TrackDesc[] = [];
  // Shared opacity first — always offered, even empty, so a fade can be
  // shaped or added; empty just means "stays fully visible."
  tracks.push({
    id: "opacity",
    effectLabel: "Opacity",
    paramLabel: `${KF_PROP_META.opacity.label} · ${KF_PROP_META.opacity.unit}`,
    color: "var(--muted)",
    min: 0, max: 1, displayScale: 100,
    points: mk.opacity ?? [],
    onSet: setOpacity,
  });
  fx.forEach((f, idx) => {
    const meta = KF_PROP_META[f.prop];
    const [min, max] = rangeFor(f.prop, f.points);
    tracks.push({
      id: `fx${idx}`,
      effectLabel: f.effect,
      paramLabel: `${meta.label} · ${meta.unit}`,
      tag: `FX${f.slot} · ${f.phase.toUpperCase()}`,
      color: SLOT_COLOR[f.slot],
      min, max,
      displayScale: f.prop === "progress" ? 100 : 1,
      points: f.points,
      onSet: (pts) => setFxPoints(idx, pts),
    });
  });

  const fps = 30;
  const durationSec = pageDuration / fps;
  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(durationSec); s++) ticks.push(s);

  return (
    <div className="kf-editor">
      <div className="kf-ruler">
        {ticks.map((s) => (
          <span key={s} className="kf-ruler-tick" style={{ left: `${(s / durationSec) * 100}%` }}>{s}s</span>
        ))}
      </div>
      <div className="kf-stack">
        {tracks.map((t) => (
          <TrackRow key={t.id} track={t} pageDuration={pageDuration} />
        ))}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Each effect you picked shows here in its own real units. Drag a diamond to retime/reshape ·
        click empty space to add one · double-click to remove · click an ease chip to change that
        segment's curve.
      </p>
    </div>
  );
};

const TrackRow: React.FC<{ track: TrackDesc; pageDuration: number }> = ({ track, pageDuration }) => {
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const { min, max, points, onSet, color, displayScale } = track;

  const valToTopPct = (v: number) => {
    const frac = clamp((v - min) / (max - min || 1), 0, 1);
    return ((1 - frac) * (1 - 2 * PAD) + PAD) * 100;
  };
  const yFracToVal = (yFrac: number) => {
    const inner = (clamp(yFrac, PAD, 1 - PAD) - PAD) / (1 - 2 * PAD);
    return min + (1 - inner) * (max - min);
  };
  const tToPct = (t: number) => (t / pageDuration) * 100;

  const addPointAt = (clientX: number, clientY: number) => {
    const rect = areaRef.current!.getBoundingClientRect();
    const t = Math.round(clamp(((clientX - rect.left) / rect.width) * pageDuration, 0, pageDuration));
    const v = yFracToVal((clientY - rect.top) / rect.height);
    onSet([...points, { t, v, ease: "linear" }]);
  };
  const onAreaPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".kf-dot, .kf-chip")) return;
    addPointAt(e.clientX, e.clientY);
  };

  const cycleEase = (kf: MotionKeyframe) => {
    const i = KEYFRAME_EASE_NAMES.indexOf(kf.ease);
    const next = KEYFRAME_EASE_NAMES[(i + 1) % KEYFRAME_EASE_NAMES.length];
    onSet(points.map((p) => (p === kf ? { ...p, ease: next } : p)));
  };
  const removePoint = (kf: MotionKeyframe) => onSet(points.filter((p) => p !== kf));

  const fmt = (v: number) => {
    const n = v * displayScale;
    return Math.abs(n) >= 10 || n % 1 === 0 ? Math.round(n).toString() : n.toFixed(1);
  };

  const curveD = React.useMemo(() => {
    if (points.length < 2) return "";
    const steps = 22;
    const pts: string[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let s = 0; s <= steps; s++) {
        const p = s / steps;
        const v = a.v + (b.v - a.v) * easingFn(a.ease)(p);
        const t = a.t + (b.t - a.t) * p;
        pts.push(`${tToPct(t)},${valToTopPct(v)}`);
      }
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, min, max, pageDuration]);

  const sorted = [...points].sort((a, b) => a.t - b.t);

  return (
    <div className="kf-track">
      <div className="kf-track-label">
        {track.tag && <span className="kf-fxtag" style={{ color }}>{track.tag}</span>}
        <span className="kf-fxname" style={{ color }}>{track.effectLabel}</span>
        <span className="kf-fxparam">{track.paramLabel}</span>
      </div>
      <div className="kf-track-area" ref={areaRef} onPointerDown={onAreaPointerDown}>
        {curveD && (
          <svg className="kf-line" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={curveD} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.85" />
          </svg>
        )}
        {sorted.map((kf, i) => {
          const b = sorted[i + 1];
          return (
            <React.Fragment key={i}>
              <Diamond kf={kf} color={color} left={tToPct(kf.t)} top={valToTopPct(kf.v)} label={fmt(kf.v)}
                onMove={(clientX, clientY) => {
                  const rect = areaRef.current!.getBoundingClientRect();
                  const t = Math.round(clamp(((clientX - rect.left) / rect.width) * pageDuration, 0, pageDuration));
                  const v = yFracToVal((clientY - rect.top) / rect.height);
                  onSet(points.map((p) => (p === kf ? { ...p, t, v } : p)));
                }}
                onDelete={() => removePoint(kf)} />
              {b && (
                <div className="kf-chip" style={{ left: `${(tToPct(kf.t) + tToPct(b.t)) / 2}%` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); cycleEase(kf); }}
                  title="Click to change this segment's easing">
                  {kf.ease}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

const Diamond: React.FC<{
  kf: MotionKeyframe;
  color: string;
  left: number;
  top: number;
  label: string;
  onMove: (clientX: number, clientY: number) => void;
  onDelete: () => void;
}> = ({ kf, color, left, top, label, onMove, onDelete }) => {
  const [dragging, setDragging] = React.useState(false);
  return (
    <div className="kf-dot-wrap" style={{ left: `${left}%`, top: `${top}%` }}>
      <span className="kf-dot-val">{label}</span>
      <div
        className={"kf-dot" + (dragging ? " dragging" : "")}
        style={{ background: color }}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => { if (dragging) onMove(e.clientX, e.clientY); }}
        onPointerUp={() => setDragging(false)}
        onDoubleClick={(e) => { e.stopPropagation(); onDelete(); }}
      />
    </div>
  );
};
