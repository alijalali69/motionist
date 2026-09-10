import React from "react";
import {
  ENTRANCE_CATEGORIES, EXIT_CATEGORIES, AMBIENT_NAMES,
  TEXT_ENTRANCE_NAMES, TEXT_EXIT_NAMES, LATIN_TEXT_ENTRANCE_NAMES, EASING_NAMES,
  type EasingName,
} from "../../src/presets";
import { MotionFilterDefs } from "../../src/MotionFx";
import {
  EffectStage, useLoopFrame, drivenFields, TILE, REST, HOLD, AMBIENT_CYCLE, FPS,
  type Tab, type Sample,
} from "./EffectPreview";

// The whole motion library on one page, every effect playing at once next to
// its own name — the surface for judging which effects are good, weak,
// redundant or broken, which a dropdown of names can't do. The actual
// "render one effect for real" work lives in EffectPreview.tsx, shared with
// the compact picker in the Effects panel so the two can never diverge.

const EffectTile: React.FC<{
  name: string;
  tab: Tab;
  sample: Sample;
  frame: number;
  easing: EasingName | undefined;
  duration: number;
  onOpen: () => void;
}> = ({ name, tab, sample, frame, easing, duration, onOpen }) => {
  const fields = tab === "ambient" ? [] : drivenFields(tab, name);
  return (
    <button type="button" className="fxg-tile" onClick={onOpen} title={`${name} — click to enlarge`}>
      <EffectStage name={name} tab={tab} sample={sample} frame={frame} easing={easing} duration={duration} />
      <div className="fxg-name">{name}</div>
      {fields.length > 0 && <div className="fxg-fields">{fields.join(" · ")}</div>}
    </button>
  );
};

export const EffectsGallery: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = React.useState<Tab>("in");
  const [sample, setSample] = React.useState<Sample>("text");
  const [easing, setEasing] = React.useState<EasingName | "">("");
  const [duration, setDuration] = React.useState(26);
  const [playing, setPlaying] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [zoomed, setZoomed] = React.useState<string | null>(null);

  const cycle = tab === "ambient" ? AMBIENT_CYCLE : REST + duration + HOLD;
  const frame = useLoopFrame(cycle, playing);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomed) setZoomed(null); else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomed]);

  // Text-only effects join the list only when a text sample is showing —
  // they have nothing to split on a photo or a shape.
  const groups: { label: string; names: string[] }[] = React.useMemo(() => {
    if (tab === "ambient") return [{ label: "Ambient (plays the whole time a layer is visible)", names: AMBIENT_NAMES.filter((n) => n !== "none") }];
    const base = (tab === "in" ? ENTRANCE_CATEGORIES : EXIT_CATEGORIES).map((c) => ({ label: c.label, names: [...c.names] as string[] }));
    if (sample !== "text") return base;
    const textOnly = tab === "in"
      ? [...TEXT_ENTRANCE_NAMES, ...LATIN_TEXT_ENTRANCE_NAMES] as string[]
      : [...TEXT_EXIT_NAMES] as string[];
    return [...base, { label: "Text only", names: textOnly }];
  }, [tab, sample]);

  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, names: q ? g.names.filter((n) => n.toLowerCase().includes(q)) : g.names }))
    .filter((g) => g.names.length > 0);
  const total = shown.reduce((sum, g) => sum + g.names.length, 0);

  return (
    <div className="fxg">
      {/* glitchIn's channel-split and liquidIn's warp reference these by id;
          without them mounted, both render as plain untinted copies. */}
      <MotionFilterDefs frame={frame} />

      <div className="fxg-header">
        <div className="fxg-titleblock">
          <h1>Effects</h1>
          <p>{total} playing live — the real motion, not a preview approximation. Click any tile to enlarge.</p>
        </div>
        <button className="btn" onClick={onClose}>← Back</button>
      </div>

      <div className="fxg-controls">
        <div className="fxg-seg" role="group" aria-label="Effect direction">
          {(["in", "out", "ambient"] as Tab[]).map((t) => (
            <button key={t} className={"fxg-segbtn" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
              {t === "in" ? "In" : t === "out" ? "Out" : "Ambient"}
            </button>
          ))}
        </div>

        <div className="fxg-seg" role="group" aria-label="Sample content">
          {(["text", "photo", "shape"] as Sample[]).map((s) => (
            <button key={s} className={"fxg-segbtn" + (sample === s ? " on" : "")} onClick={() => setSample(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <label className="fxg-ctl">
          Easing
          <select value={easing} disabled={tab === "ambient"}
            title="Overrides each effect's own curated curve — the same (auto) default the Effects panel uses"
            onChange={(e) => setEasing(e.target.value as EasingName | "")}>
            <option value="">(auto)</option>
            {EASING_NAMES.map((en) => <option key={en} value={en}>{en}</option>)}
          </select>
        </label>

        <label className="fxg-ctl">
          Duration {tab === "ambient" ? "—" : `${(duration / FPS).toFixed(2)}s`}
          <input type="range" min={6} max={60} step={1} value={duration} disabled={tab === "ambient"}
            onChange={(e) => setDuration(Number(e.target.value))} />
        </label>

        <button className="btn" onClick={() => setPlaying((v) => !v)}>{playing ? "⏸ Pause" : "▶ Play"}</button>

        <input type="text" className="fxg-search" value={query} placeholder="Filter by name…"
          onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="fxg-body">
        {shown.map((g) => (
          <section key={g.label} className="fxg-group">
            <h2 className="fxg-grouphead">{g.label} <span>{g.names.length}</span></h2>
            <div className="fxg-grid">
              {g.names.map((n) => (
                <EffectTile key={n} name={n} tab={tab} sample={sample} frame={frame}
                  easing={easing || undefined} duration={duration} onOpen={() => setZoomed(n)} />
              ))}
            </div>
          </section>
        ))}
        {total === 0 && <p className="fxg-empty">No effect matches “{query}”.</p>}
      </div>

      {zoomed && (
        <div className="fxg-zoom" onClick={() => setZoomed(null)}>
          <div className="fxg-zoomcard" onClick={(e) => e.stopPropagation()}>
            <EffectStage name={zoomed} tab={tab} sample={sample} frame={frame}
              easing={easing || undefined} duration={duration} scale={SCALE * 3} />
            <div className="fxg-zoommeta">
              <h3>{zoomed}</h3>
              {tab !== "ambient" && <p>{drivenFields(tab, zoomed).join(" · ") || "no motion"}</p>}
              <button className="btn" onClick={() => setZoomed(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
