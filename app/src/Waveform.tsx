import React from "react";

// Decoded peaks are cached per source URL (module-level, outside React) —
// decoding is the expensive part (fetch + Web Audio decode of the whole
// file), and this component's own src prop doesn't change on every
// keystroke/drag the way the surrounding panel's other fields do, but
// caching still means switching tabs and back, or any parent re-render,
// never re-decodes the same file twice.
const peaksCache = new Map<string, Promise<Float32Array>>();

// One entry per pixel column: the sample range's min AND max (not just an
// average) — averaging a waveform flattens exactly the transient peaks that
// make it readable at a glance. Float32Array packs [min0,max0,min1,max1,...].
async function decodePeaks(src: string, columns: number): Promise<Float32Array> {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await fetch(src).then((r) => r.arrayBuffer());
    const audio = await ctx.decodeAudioData(buf);
    // Mixed down across channels (a stereo track's two channels averaged) —
    // a music bed's left/right content is usually near-identical anyway,
    // and this is a glance-at-the-shape waveform, not a channel-accurate one.
    const channels = audio.numberOfChannels;
    const length = audio.length;
    const data = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const chan = audio.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] += chan[i] / channels;
    }
    const peaks = new Float32Array(columns * 2);
    const perColumn = Math.max(1, Math.floor(length / columns));
    for (let col = 0; col < columns; col++) {
      const start = col * perColumn;
      const end = Math.min(length, start + perColumn);
      let min = 0, max = 0;
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[col * 2] = min;
      peaks[col * 2 + 1] = max;
    }
    return peaks;
  } finally {
    ctx.close();
  }
}

// Static waveform strip for the uploaded audio track — decoded once
// (cached by src), redrawn to fit whatever width the card actually has via
// ResizeObserver, same "derive scale from the real rendered size" pattern
// CanvasHandles already uses for the canvas overlays.
export const Waveform: React.FC<{ src: string; height?: number }> = ({ src, height = 36 }) => {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = React.useState(0);
  const [peaks, setPeaks] = React.useState<Float32Array | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // One column of peaks per ~2 real (not CSS) pixels — redecoding at a
  // slightly different width whenever the panel gets resized would be
  // wasteful; a fixed column count sampled at a reasonable density and
  // stretched to fit is visually identical for a glance-at-the-shape strip.
  const columns = 260;
  React.useEffect(() => {
    setPeaks(null); setError(false);
    if (!src) return;
    let cached = peaksCache.get(src);
    if (!cached) {
      cached = decodePeaks(src, columns);
      peaksCache.set(src, cached);
    }
    let cancelled = false;
    cached
      .then((p) => { if (!cancelled) setPeaks(p); })
      .catch((e) => {
        peaksCache.delete(src); // don't poison the cache with a failed decode
        if (!cancelled) { setError(true); console.warn("Waveform decode failed:", e); }
      });
    return () => { cancelled = true; };
  }, [src]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const mid = height / 2;
    const barGap = width / columns;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent2").trim() || "#63bbff";
    ctx.fillStyle = accent;
    for (let col = 0; col < columns; col++) {
      const min = peaks[col * 2];
      const max = peaks[col * 2 + 1];
      const x = col * barGap;
      const yTop = mid - max * mid;
      const barHeight = Math.max(1, (max - min) * mid);
      ctx.fillRect(x, yTop, Math.max(1, barGap - 0.5), barHeight);
    }
  }, [peaks, width, height, columns]);

  return (
    <div ref={wrapRef} className="waveform" style={{ height }}>
      {error ? (
        <span className="hint" style={{ margin: 0 }}>Couldn't read the waveform (file may still be processing).</span>
      ) : !peaks ? (
        <span className="hint" style={{ margin: 0 }}>Loading waveform…</span>
      ) : (
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      )}
    </div>
  );
};
