import React from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel } from "../../src/Reel";
import { reelDuration, pageStarts, type Project, type LogoConfig, type Box, type LoaderStyle } from "../../src/types";
import { ENTRANCE_NAMES, TEXT_ENTRANCE_NAMES, AMBIENT_NAMES, EXIT_NAMES, TRANSITIONS } from "../../src/presets";
import {
  loadProject, saveProject, ingestPsd, uploadLogo, uploadAsset, renderReel,
  type IngestResult,
} from "./api";
import { Dashboard } from "./Dashboard";
import { CanvasHandles, type Handle } from "./CanvasHandles";
import { PhotoPanHandles, type PhotoPanTarget } from "./PhotoPanHandles";
import { SafeZoneOverlay } from "./SafeZoneOverlay";

const ENTRANCES = ENTRANCE_NAMES;
const AMBIENTS = AMBIENT_NAMES;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function niceName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, ""); // strip extension
}

// Box for a slot's asset. BG always goes full-bleed (it's a backdrop — native
// size is irrelevant). Logo/Title use the asset's REAL exported pixel size,
// scaled down only if it would be unreasonably large for its spot on the
// canvas — never force-fit into an arbitrary preset box.
function boxForSlot(
  slotKey: "logo" | "bg" | "title", cw: number, ch: number,
  nativeW: number | null, nativeH: number | null
) {
  if (slotKey === "bg") return { left: 0, top: 0, width: cw, height: ch };

  const caps = slotKey === "logo"
    ? { maxW: cw * 0.35, maxH: ch * 0.15, margin: 40 }
    : { maxW: cw * 0.85, maxH: ch * 0.25, margin: 0 };

  // Fallback size when dimensions couldn't be detected (rare: exotic format).
  let w = nativeW ?? (slotKey === "logo" ? 340 : Math.round(cw * 0.8));
  let h = nativeH ?? (slotKey === "logo" ? 190 : Math.round(ch * 0.14));

  const scale = Math.min(1, caps.maxW / w, caps.maxH / h);
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const left = slotKey === "logo" ? cw - w - caps.margin : Math.round((cw - w) / 2);
  const top = slotKey === "logo" ? caps.margin : Math.round(ch * 0.12);
  return { left, top, width: w, height: h };
}

function defaultSlot(
  slotKey: "logo" | "bg" | "title", w: number, h: number,
  file: string, kind: LogoConfig["kind"],
  nativeW: number | null = null, nativeH: number | null = null
): LogoConfig {
  return {
    box: boxForSlot(slotKey, w, h, nativeW, nativeH),
    kind, file, fallback: null, opacity: 1,
    fit: slotKey === "bg" ? "cover" : "contain",
  };
}

function mergeIngestedPage(prev: Project, res: IngestResult, sourceName: string): Project {
  const next = clone(prev);
  next.pages.push({ ...res.page, name: niceName(sourceName) });
  // merge chrome only if not already set
  if (!next.template.layers.length && res.fixed.length) next.template.layers = res.fixed;
  if (!next.logo && res.logo) next.logo = res.logo;
  if (res.loaderBox) next.loader = res.loaderBox;
  if (res.subtitleBox) next.subtitle = res.subtitleBox;
  return next;
}

// --- Top-level app shell: switches between the project Dashboard and the Editor.
export const App: React.FC = () => {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  if (!activeId) {
    return <Dashboard onOpen={setActiveId} />;
  }
  return <Editor projectId={activeId} onBack={() => setActiveId(null)} />;
};

const Editor: React.FC<{ projectId: string; onBack: () => void }> = ({ projectId, onBack }) => {
  const [project, setProject] = React.useState<Project | null>(null);
  const [sel, setSel] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [renderUrl, setRenderUrl] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [motionClip, setMotionClip] = React.useState<MotionClip | null>(null);
  const [showSafeZone, setShowSafeZone] = React.useState(false);
  const psdInput = React.useRef<HTMLInputElement>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);
  const bgInput = React.useRef<HTMLInputElement>(null);
  const titleInput = React.useRef<HTMLInputElement>(null);
  const playerRef = React.useRef<PlayerRef>(null);
  const playerWrapRef = React.useRef<HTMLDivElement>(null);

  // Click a page -> show its inspector AND jump the player to that page's start.
  const selectPage = (i: number) => {
    setSel(i);
    if (project) {
      const starts = pageStarts(project);
      playerRef.current?.pause();
      playerRef.current?.seekTo(starts[i] ?? 0);
    }
  };

  React.useEffect(() => {
    setProject(null);
    setSel(0);
    setRenderUrl(null);
    loadProject(projectId).then(setProject).catch(() => {});
  }, [projectId]);

  const update = (fn: (p: Project) => void) => {
    setProject((prev) => { if (!prev) return prev; const next = clone(prev); fn(next); return next; });
  };

  // Accepts one or many files (batch upload). Server ingests one PSD/SVG at a
  // time, so files are processed sequentially, in filename order, and each
  // page is appended as its own ingest completes — errors on one file don't
  // stop the rest.
  const onAddPages = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
    if (!files.length) return;
    setErr(null);
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBusy(files.length > 1
        ? `Extracting ${i + 1}/${files.length}: ${file.name}…`
        : `Extracting ${file.name}…`);
      try {
        const res = await ingestPsd(file, projectId);
        setProject((prev) => (prev ? mergeIngestedPage(prev, res, res.sourceName) : prev));
      } catch (e: any) {
        failures.push(`${file.name}: ${String(e.message || e)}`);
      }
    }

    setBusy(null);
    if (failures.length) setErr(`${failures.length} file(s) failed:\n` + failures.join("\n"));
  };

  const onSlotUpload = async (slotKey: "logo" | "bg" | "title", file: File) => {
    setBusy(`Uploading ${slotKey}…`); setErr(null);
    try {
      const { file: f, kind, width, height } = slotKey === "logo"
        ? await uploadLogo(file, projectId)
        : await uploadAsset(file, slotKey, projectId);
      update((p) => {
        // Size to the asset's real exported dimensions every time — on first
        // upload AND on replace, since a differently-shaped replacement
        // shouldn't be force-fit into the old box.
        p[slotKey] = defaultSlot(slotKey, p.width, p.height, f, kind, width, height);
      });
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Upload a real photo/video into a placeholder box on the CURRENT page.
  // Replaces the file + kind; the box (left/top/width/height) is left as-is
  // — cover-fit auto-crops it in, and the user can drag/resize on the canvas
  // to refine the crop if the photo's shape doesn't quite match the box.
  const onUploadPhoto = async (pageIndex: number, layerIndex: number, file: File) => {
    if (!project) return;
    const pageId = project.pages[pageIndex].id;
    setBusy("Uploading photo…"); setErr(null);
    try {
      const { file: f, kind, width, height } = await uploadAsset(file, `photo_${pageId}_${layerIndex}`, projectId);
      update((p) => {
        const layer = p.pages[pageIndex].layers[layerIndex];
        layer.file = f;
        layer.assetKind = kind;
        layer.fit = "cover";
        layer.naturalWidth = width;
        layer.naturalHeight = height;
        // Reset crop to centered default — an old pan/zoom offset was tuned
        // for the previous image's shape and won't mean the same thing here.
        layer.photoPanX = 50;
        layer.photoPanY = 50;
        layer.photoZoom = 1;
      });
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Text layers are created directly in the app (not extracted from a PSD/SVG)
  // — a live Farsi (or any) text box with a sensible default box + fade-in.
  const onAddTextLayer = (pageIndex: number) => {
    if (!project) return;
    update((p) => {
      const page = p.pages[pageIndex];
      const w = Math.round(p.width * 0.8);
      const h = Math.round(p.height * 0.14);
      page.layers.unshift({
        index: -Date.now(),
        file: "", role: "text",
        left: Math.round((p.width - w) / 2), top: Math.round(p.height * 0.4),
        width: w, height: h, opacity: 1,
        entrance: "fade", delay: 0, inDuration: 26,
        assetKind: "text", text: "", fontSize: 48, textColor: "#1a1a1a", textAlign: "right",
      } as any);
    });
  };

  const onUploadFont = async (pageIndex: number, layerIndex: number, file: File) => {
    if (!project) return;
    setBusy("Uploading font…"); setErr(null);
    try {
      const { file: f } = await uploadAsset(file, `font_${layerIndex}_${Date.now()}`, projectId);
      const family = "CustomFont_" + layerIndex + "_" + Date.now().toString(36);
      update((p) => {
        const layer = p.pages[pageIndex].layers[layerIndex];
        layer.fontFile = f;
        layer.fontFamily = family;
      });
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  const onSave = async () => {
    if (!project) return;
    setBusy("Saving…"); setErr(null);
    try { await saveProject(project); } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  const onRender = async () => {
    if (!project) return;
    setBusy("Rendering… (this can take a while)"); setErr(null); setRenderUrl(null);
    try {
      await saveProject(project); // keep the saved copy in sync with what's rendered
      const url = await renderReel(project);
      setRenderUrl(url);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  const movePage = (i: number, dir: -1 | 1) => {
    update((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.pages.length) return;
      [p.pages[i], p.pages[j]] = [p.pages[j], p.pages[i]];
    });
    setSel((s) => Math.min(Math.max(s + dir, 0), (project?.pages.length ?? 1) - 1));
  };

  const delPage = (i: number) => {
    update((p) => { p.pages.splice(i, 1); });
    setSel((s) => Math.max(0, s - (i <= s ? 1 : 0)));
  };

  // Draggable/resizable canvas handles: global logo/title + every photo-role
  // layer on the CURRENT page (auto-detected placeholder slots — no naming
  // convention needed). Rebuilt whenever the project or selected page changes.
  // Only the logo/title are repositionable — they're standalone global
  // elements. Photo/BG boxes are part of the template's fixed design and must
  // NOT move; what's adjustable there is the photo's crop position INSIDE its
  // locked frame (see PhotoPanHandles below), not the frame itself.
  const canvasHandles: Handle[] = React.useMemo(() => {
    if (!project) return [];
    const list: Handle[] = [];
    if (project.logo) list.push({
      id: "logo", label: "LOGO", color: "#5aa9ff", box: project.logo.box,
      onChange: (b) => update((p) => { if (p.logo) p.logo.box = b; }),
    });
    if (project.title) list.push({
      id: "title", label: "TITLE", color: "#f2b84b", box: project.title.box,
      onChange: (b) => update((p) => { if (p.title) p.title.box = b; }),
    });
    list.push({
      id: "loader", label: "LOADER", color: "#c9a53b", box: project.loader,
      onChange: (b) => update((p) => { p.loader = b; }),
    });
    // Text layers are user-created (not part of a template), so — unlike
    // photo placeholder boxes — they're freely draggable/resizable too.
    const page = project.pages[sel];
    page?.layers.forEach((l, li) => {
      if (l.assetKind !== "text") return;
      list.push({
        id: `text-${li}`, label: l.text ? l.text.slice(0, 18) : "TEXT", color: "#c46be0",
        box: { left: l.left, top: l.top, width: l.width, height: l.height },
        onChange: (b) => update((p) => {
          const layer = p.pages[sel].layers[li];
          layer.left = b.left; layer.top = b.top; layer.width = b.width; layer.height = b.height;
        }),
      });
    });
    return list;
  }, [project, sel]);

  // Photo pan targets: every photo-role layer on the current page that has a
  // real uploaded asset (with known natural size, needed to compute correct
  // drag-to-percent pan math). Placeholder art (not yet replaced) has nothing
  // to pan, so it's excluded.
  const photoPanTargets: PhotoPanTarget[] = React.useMemo(() => {
    if (!project) return [];
    const page = project.pages[sel];
    if (!page) return [];
    const list: PhotoPanTarget[] = [];
    page.layers.forEach((l, li) => {
      if (l.role !== "photo" || !l.assetKind || !l.naturalWidth || !l.naturalHeight) return;
      list.push({
        id: `photo-${li}`,
        box: { left: l.left, top: l.top, width: l.width, height: l.height },
        natural: { width: l.naturalWidth, height: l.naturalHeight },
        panX: l.photoPanX ?? 50,
        panY: l.photoPanY ?? 50,
        zoom: l.photoZoom ?? 1,
        onChange: (panX, panY) => update((p) => {
          const layer = p.pages[sel].layers[li];
          layer.photoPanX = panX; layer.photoPanY = panY;
        }),
      });
    });
    return list;
  }, [project, sel]);

  return (
    <div className="app">
      {/* LEFT: project + pages */}
      <div className="col">
        <div className="editor-header">
          <button className="btn back-btn" onClick={onBack}>← Dashboard</button>
        </div>
        <input
          className="project-name-input"
          value={project?.name ?? ""}
          placeholder="Loading…"
          disabled={!project}
          onChange={(e) => update((p) => { p.name = e.target.value; })}
        />
        <p className="sub">PSD → animated reel</p>

        <button className="btn primary" onClick={() => psdInput.current?.click()}>+ Add pages (PSD / SVG)</button>
        <input ref={psdInput} className="hidden-file" type="file" accept=".psd,.svg" multiple
          onChange={(e) => { if (e.target.files) onAddPages(e.target.files); e.target.value = ""; }} />
        <p className="hint">Select multiple files at once, or drop them below. Added in filename order.</p>

        <h2>Pages</h2>
        <div
          className={"dropzone" + (dragOver ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            if (e.dataTransfer.files?.length) onAddPages(e.dataTransfer.files);
          }}
        >
          {!project?.pages.length && <p className="hint">No pages yet. Add PSDs/SVGs, or drag them here.</p>}
          {project?.pages.map((pg, i) => (
          <div key={pg.id} className={"card page-item row between" + (i === sel ? " active" : "")}
            onClick={() => selectPage(i)}>
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <span className="thumbnum">{i + 1}</span>
              <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={pg.name ?? pg.id}>{pg.name ?? pg.id}</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn small" onClick={(e) => { e.stopPropagation(); movePage(i, -1); }}>↑</button>
              <button className="btn small" onClick={(e) => { e.stopPropagation(); movePage(i, 1); }}>↓</button>
              <button className="btn small" onClick={(e) => { e.stopPropagation(); delPage(i); }}>✕</button>
            </div>
          </div>
          ))}
        </div>

        {project && (
          <>
            <h2>Global assets (all pages)</h2>

            {/* BG */}
            <button className={"btn upload" + (project.bg?.file ? " filled" : "")} onClick={() => bgInput.current?.click()}>
              {project.bg?.file ? "Replace Background" : "Upload Background"}
            </button>
            <input ref={bgInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif"
              onChange={(e) => e.target.files?.[0] && onSlotUpload("bg", e.target.files[0])} />
            {project.bg && (
              <AssetControls slot={project.bg} label="BG" canvas={[project.width, project.height]}
                onChange={(fn) => update((p) => { if (p.bg) fn(p.bg); })} />
            )}

            {/* TITLE */}
            <button className={"btn upload" + (project.title?.file ? " filled" : "")} style={{ marginTop: 8 }} onClick={() => titleInput.current?.click()}>
              {project.title?.file ? "Replace Title" : "Upload Title"}
            </button>
            <input ref={titleInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif,.json"
              onChange={(e) => e.target.files?.[0] && onSlotUpload("title", e.target.files[0])} />
            {project.title && (
              <AssetControls slot={project.title} label="Title" canvas={[project.width, project.height]}
                onChange={(fn) => update((p) => { if (p.title) fn(p.title); })} />
            )}

            {/* LOGO */}
            <button className={"btn upload" + (project.logo?.file ? " filled" : "")} style={{ marginTop: 8 }} onClick={() => logoInput.current?.click()}>
              {project.logo?.file ? "Replace Logo" : "Upload Logo (top-right)"}
            </button>
            <input ref={logoInput} className="hidden-file" type="file" accept=".json,.webm,.mov,.mp4,.gif,.png,.svg"
              onChange={(e) => e.target.files?.[0] && onSlotUpload("logo", e.target.files[0])} />
            {project.logo && (
              <AssetControls slot={project.logo} label="Logo" canvas={[project.width, project.height]}
                onChange={(fn) => update((p) => { if (p.logo) fn(p.logo); })} />
            )}

            {/* LOADER */}
            <h2>Loader</h2>
            <LoaderControls loader={project.loader} style={project.loaderStyle ?? "bar"}
              canvas={[project.width, project.height]}
              onChangeBox={(fn) => update((p) => fn(p.loader))}
              onChangeStyle={(s) => update((p) => { p.loaderStyle = s; })} />
          </>
        )}

        <h2>Export</h2>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={onSave} disabled={!project}>Save</button>
          <button className="btn primary" onClick={onRender} disabled={!project}>Render MP4</button>
        </div>
        {renderUrl && <p className="hint">Done → <a className="dl" href={renderUrl} target="_blank" rel="noreferrer">download reel</a></p>}
        {busy && <p className="spin">{busy}</p>}
        {err && <p className="err">{err}</p>}
      </div>

      {/* CENTER: live preview */}
      <div className="center">
        {project ? (
          <div
            ref={playerWrapRef}
            style={{
              position: "relative",
              height: "80vh",
              aspectRatio: `${project.width} / ${project.height}`,
            }}
          >
            <Player
              ref={playerRef}
              component={Reel as any}
              inputProps={{ project, debugZones: false }}
              durationInFrames={reelDuration(project)}
              fps={project.fps}
              compositionWidth={project.width}
              compositionHeight={project.height}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: 10,
                boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
              }}
              acknowledgeRemotionLicense
              controls
              loop
            />
            <CanvasHandles
              wrapperRef={playerWrapRef}
              canvas={[project.width, project.height]}
              handles={canvasHandles}
            />
            <PhotoPanHandles
              wrapperRef={playerWrapRef}
              canvas={[project.width, project.height]}
              targets={photoPanTargets}
            />
            {showSafeZone && <SafeZoneOverlay canvas={[project.width, project.height]} />}
          </div>
        ) : <p className="sub">Loading…</p>}
        {project && (
          <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={showSafeZone}
              onChange={(e) => setShowSafeZone(e.target.checked)}
              style={{ width: "auto" }} />
            Show Instagram Reels safe zone (guide only — never rendered in export)
          </label>
        )}
        {canvasHandles.length > 0 && (
          <p className="hint" style={{ maxWidth: 320, textAlign: "center" }}>
            Logo/Title — drag to reposition, corner grip to resize · arrow keys to nudge (Shift = 10px)
          </p>
        )}
        {photoPanTargets.length > 0 && (
          <p className="hint" style={{ maxWidth: 320, textAlign: "center" }}>
            Pink boxes — drag the photo to reposition its crop (the frame itself is fixed by the design)
          </p>
        )}
      </div>

      {/* RIGHT: page inspector */}
      <div className="col">
        {project && project.pages[sel] ? (
          <PageInspector
            key={project.pages[sel].id}
            page={project.pages[sel]}
            canvas={[project.width, project.height]}
            clip={motionClip}
            onCopyClip={setMotionClip}
            onChange={(fn) => update((p) => fn(p.pages[sel]))}
            onUploadPhoto={(li, file) => onUploadPhoto(sel, li, file)}
            onAddText={() => onAddTextLayer(sel)}
            onUploadFont={(li, file) => onUploadFont(sel, li, file)}
          />
        ) : <p className="sub">Select a page.</p>}
      </div>
    </div>
  );
};

const AssetControls: React.FC<{
  slot: LogoConfig;
  label: string;
  canvas: [number, number];
  onChange: (fn: (s: LogoConfig) => void) => void;
}> = ({ slot, label, canvas, onChange }) => {
  const [cw, ch] = canvas;
  const num = (v: string) => Math.round(parseFloat(v || "0"));

  // Scale the box around its own center so "bigger/smaller" feels natural.
  const scale = (factor: number) =>
    onChange((s) => {
      const cx = s.box.left + s.box.width / 2;
      const cy = s.box.top + s.box.height / 2;
      s.box.width = Math.round(s.box.width * factor);
      s.box.height = Math.round(s.box.height * factor);
      s.box.left = Math.round(cx - s.box.width / 2);
      s.box.top = Math.round(cy - s.box.height / 2);
    });

  const centerX = () =>
    onChange((s) => { s.box.left = Math.round((cw - s.box.width) / 2); });
  const fullBleed = () =>
    onChange((s) => { s.box = { left: 0, top: 0, width: cw, height: ch }; });

  return (
    <div className="card compact" style={{ marginTop: 8 }}>
      <div className="row between">
        <span className="tag">{label} box</span>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small" onClick={() => scale(0.8)}>−</button>
          <button className="btn small" onClick={() => scale(1.25)}>＋</button>
        </div>
      </div>
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>X</label><input type="number" value={slot.box.left}
          onChange={(e) => onChange((s) => { s.box.left = num(e.target.value); })} /></div>
        <div><label>Y</label><input type="number" value={slot.box.top}
          onChange={(e) => onChange((s) => { s.box.top = num(e.target.value); })} /></div>
        <div><label>Width</label><input type="number" value={slot.box.width}
          onChange={(e) => onChange((s) => { s.box.width = num(e.target.value); })} /></div>
        <div><label>Height</label><input type="number" value={slot.box.height}
          onChange={(e) => onChange((s) => { s.box.height = num(e.target.value); })} /></div>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn small" onClick={centerX}>Center X</button>
        <button className="btn small" onClick={fullBleed}>Full-bleed</button>
      </div>
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>Fit</label>
          <select value={slot.fit ?? "contain"}
            onChange={(e) => onChange((s) => { s.fit = e.target.value as any; })}>
            <option value="contain">contain</option>
            <option value="cover">cover</option>
          </select></div>
        <div><label>Opacity {Math.round(slot.opacity * 100)}%</label>
          <input type="range" min={0} max={1} step={0.05} value={slot.opacity}
            onChange={(e) => onChange((s) => { s.opacity = parseFloat(e.target.value); })} /></div>
      </div>
    </div>
  );
};

const LOADER_STYLES: { value: LoaderStyle; label: string }[] = [
  { value: "bar", label: "bar (single, whole reel)" },
  { value: "segmented", label: "segmented (one per page)" },
  { value: "dots", label: "dots (one per page)" },
];

const LoaderControls: React.FC<{
  loader: Box;
  style: LoaderStyle;
  canvas: [number, number];
  onChangeBox: (fn: (b: Box) => void) => void;
  onChangeStyle: (s: LoaderStyle) => void;
}> = ({ loader, style, canvas, onChangeBox, onChangeStyle }) => {
  const [cw, ch] = canvas;
  const num = (v: string) => Math.round(parseFloat(v || "0"));
  const centerX = () => onChangeBox((b) => { b.left = Math.round((cw - b.width) / 2); });

  return (
    <div className="card compact">
      <div className="row between">
        <span className="tag">Loader box</span>
        <button className="btn small" onClick={centerX}>Center X</button>
      </div>
      <div className="mini" style={{ marginTop: 6 }}>
        <label>Style</label>
        <select value={style} onChange={(e) => onChangeStyle(e.target.value as LoaderStyle)}>
          {LOADER_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>X</label><input type="number" value={loader.left}
          onChange={(e) => onChangeBox((b) => { b.left = num(e.target.value); })} /></div>
        <div><label>Y</label><input type="number" value={loader.top}
          onChange={(e) => onChangeBox((b) => { b.top = num(e.target.value); })} /></div>
        <div><label>Width</label><input type="number" value={loader.width}
          onChange={(e) => onChangeBox((b) => { b.width = num(e.target.value); })} /></div>
        <div><label>Height</label><input type="number" value={loader.height}
          onChange={(e) => onChangeBox((b) => { b.height = num(e.target.value); })} /></div>
      </div>
    </div>
  );
};

type PageT = Project["pages"][number];
type LayerT = PageT["layers"][number];

type MotionClip = {
  entrance: LayerT["entrance"];
  delay: number;
  inDuration?: number;
  exit?: LayerT["exit"];
  outDuration?: number;
};

function clipFromLayer(l: LayerT): MotionClip {
  return { entrance: l.entrance, delay: l.delay, inDuration: l.inDuration, exit: l.exit, outDuration: l.outDuration };
}

function applyClip(l: LayerT, clip: MotionClip) {
  l.entrance = clip.entrance;
  l.delay = clip.delay;
  l.inDuration = clip.inDuration;
  l.exit = clip.exit;
  l.outDuration = clip.outDuration;
}

const ElementMotion: React.FC<{
  layer: LayerT;
  clip: MotionClip | null;
  onCopy: (clip: MotionClip) => void;
  onChange: (fn: (l: LayerT) => void) => void;
  onUploadPhoto?: (file: File) => void;
  onUploadFont?: (file: File) => void;
  onDelete: () => void;
}> = ({ layer, clip, onCopy, onChange, onUploadPhoto, onUploadFont, onDelete }) => {
  const sec = (frames?: number, dflt = 0) => +(((frames ?? dflt) / 30)).toFixed(2);
  const toFr = (s: string) => Math.max(0, Math.round(parseFloat(s || "0") * 30));
  const photoInput = React.useRef<HTMLInputElement>(null);
  const fontInput = React.useRef<HTMLInputElement>(null);
  const isPhotoSlot = layer.role === "photo";
  const isTextLayer = layer.assetKind === "text";
  const inOptions = isTextLayer ? [...ENTRANCES, ...TEXT_ENTRANCE_NAMES] : ENTRANCES;

  return (
    <div className="card compact">
      <div className="row between">
        <span className="lname" title={layer.name || undefined}>
          {layer.name ? layer.name : layer.role} <span className="tag">({layer.role})</span>
        </span>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small" title="Copy this element's motion"
            onClick={() => onCopy(clipFromLayer(layer))}>Copy</button>
          <button className="btn small" title="Paste copied motion onto this element"
            disabled={!clip} onClick={() => clip && onChange((l) => applyClip(l, clip))}>Paste</button>
          <button className="btn small" title="Delete this layer" onClick={onDelete}>✕</button>
        </div>
      </div>

      {isTextLayer && (
        <>
          <textarea dir="rtl" placeholder="متن فارسی…" style={{ marginTop: 6 }}
            value={layer.text ?? ""}
            onChange={(e) => onChange((l) => { l.text = e.target.value; })} />
          <button className={"btn upload small" + (layer.fontFile ? " filled" : "")} style={{ width: "100%", marginTop: 6 }}
            onClick={() => fontInput.current?.click()}>
            {layer.fontFile ? "Replace font" : "Upload font (.ttf/.otf/.woff)"}
          </button>
          <input ref={fontInput} className="hidden-file" type="file" accept=".ttf,.otf,.woff,.woff2"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && onUploadFont) onUploadFont(f); e.target.value = ""; }} />
          <div className="grid3 mini" style={{ marginTop: 4 }}>
            <div><label>Size</label>
              <input type="number" min={8} value={layer.fontSize ?? 48}
                onChange={(e) => onChange((l) => { l.fontSize = Math.max(8, Math.round(parseFloat(e.target.value || "48"))); })} /></div>
            <div><label>Color</label>
              <input type="color" value={layer.textColor ?? "#1a1a1a"} style={{ padding: 2, height: 30 }}
                onChange={(e) => onChange((l) => { l.textColor = e.target.value; })} /></div>
            <div><label>Align</label>
              <select value={layer.textAlign ?? "right"}
                onChange={(e) => onChange((l) => { l.textAlign = e.target.value as any; })}>
                <option value="right">right</option>
                <option value="center">center</option>
                <option value="left">left</option>
              </select></div>
          </div>
        </>
      )}

      {isPhotoSlot && onUploadPhoto && (
        <>
          <button className={"btn upload small" + (layer.assetKind ? " filled" : "")} style={{ width: "100%", marginTop: 6 }}
            onClick={() => photoInput.current?.click()}>
            {layer.assetKind ? "Replace photo/video" : "Upload photo/video"}
          </button>
          <input ref={photoInput} className="hidden-file" type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.webm,.mov,.mp4"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ""; }} />
          {layer.assetKind && (
            <div className="row between mini" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--muted)" }}>Zoom {(layer.photoZoom ?? 1).toFixed(2)}×</span>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn small" title="Zoom out"
                  onClick={() => onChange((l) => { l.photoZoom = Math.max(1, +((l.photoZoom ?? 1) - 0.1).toFixed(2)); })}>−</button>
                <button className="btn small" title="Zoom in"
                  onClick={() => onChange((l) => { l.photoZoom = Math.min(3, +((l.photoZoom ?? 1) + 0.1).toFixed(2)); })}>＋</button>
                <button className="btn small" title="Reset crop to centered"
                  onClick={() => onChange((l) => { l.photoZoom = 1; l.photoPanX = 50; l.photoPanY = 50; })}>Reset</button>
              </div>
            </div>
          )}
          <div className="mini" style={{ marginTop: 4 }}>
            <label>Photo motion (inside the frame)</label>
            <select value={layer.photoMotion ?? "none"}
              onChange={(e) => onChange((l) => { l.photoMotion = e.target.value as any; })}>
              {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </>
      )}

      <div className="grid2 mini" style={{ marginTop: 4 }}>
        <div><label>IN effect</label>
          <select value={layer.entrance}
            onChange={(e) => onChange((l) => { l.entrance = e.target.value as any; })}>
            {inOptions.map((en) => <option key={en} value={en}>{en}</option>)}
          </select></div>
        <div><label>OUT effect</label>
          <select value={layer.exit ?? "none"}
            onChange={(e) => onChange((l) => { l.exit = e.target.value as any; })}>
            {EXIT_NAMES.map((en) => <option key={en} value={en}>{en}</option>)}
          </select></div>
      </div>
      <div className="grid3 mini" style={{ marginTop: 4 }}>
        <div><label>in delay (s)</label>
          <input type="number" step={0.1} min={0} value={sec(layer.delay)}
            onChange={(e) => onChange((l) => { l.delay = toFr(e.target.value); })} /></div>
        <div><label>in dur (s)</label>
          <input type="number" step={0.1} min={0.1} value={sec(layer.inDuration, 26)}
            onChange={(e) => onChange((l) => { l.inDuration = toFr(e.target.value); })} /></div>
        <div><label>out dur (s)</label>
          <input type="number" step={0.1} min={0.1} value={sec(layer.outDuration, 24)}
            disabled={(layer.exit ?? "none") === "none"}
            onChange={(e) => onChange((l) => { l.outDuration = toFr(e.target.value); })} /></div>
      </div>
    </div>
  );
};

const PageInspector: React.FC<{
  page: PageT;
  canvas: [number, number];
  clip: MotionClip | null;
  onCopyClip: (clip: MotionClip) => void;
  onChange: (fn: (pg: PageT) => void) => void;
  onUploadPhoto: (layerIndex: number, file: File) => void;
  onAddText: () => void;
  onUploadFont: (layerIndex: number, file: File) => void;
}> = ({ page, canvas, clip, onCopyClip, onChange, onUploadPhoto, onAddText, onUploadFont }) => {
  return (
    <div>
      <h1 title={page.id}>Page: {page.name ?? page.id}</h1>

      <label>Duration (seconds)</label>
      <input type="number" min={1} step={0.5}
        value={+(page.durationInFrames / 30).toFixed(2)}
        onChange={(e) => onChange((pg) => { pg.durationInFrames = Math.round(parseFloat(e.target.value || "1") * 30); })} />

      <label>Ambient motion</label>
      <select value={page.ambient} onChange={(e) => onChange((pg) => { pg.ambient = e.target.value as any; })}>
        {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      <label>Transition to next page</label>
      <select value={page.transition.type} onChange={(e) => onChange((pg) => { pg.transition.type = e.target.value as any; })}>
        {TRANSITIONS.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
      </select>

      <label>Subtitle (English) — empty = nothing shows</label>
      <textarea value={page.subtitle ?? ""} placeholder="Caption for this page…"
        onChange={(e) => onChange((pg) => { pg.subtitle = e.target.value; })} />

      <div className="row between" style={{ alignItems: "center", marginTop: 18 }}>
        <h2 style={{ margin: 0 }}>Element motion (in / out)</h2>
        <button className="btn small" disabled={!clip}
          title="Paste the copied motion onto every element on this page"
          onClick={() => onChange((pg) => { pg.layers.forEach((l) => applyClip(l, clip!)); })}>
          Paste to all
        </button>
      </div>
      <button className="btn small" style={{ width: "100%", marginBottom: 8 }} onClick={onAddText}>
        + Add Farsi text
      </button>
      {page.layers.map((l, li) => (
        <ElementMotion key={l.index} layer={l} clip={clip} onCopy={onCopyClip}
          onChange={(fn) => onChange((pg) => fn(pg.layers[li]))}
          onUploadPhoto={(file) => onUploadPhoto(li, file)}
          onUploadFont={(file) => onUploadFont(li, file)}
          onDelete={() => onChange((pg) => { pg.layers.splice(li, 1); })} />
      ))}
      <p className="hint">Fixed chrome, logo, loader and the subtitle zone are not listed — they are handled separately and don't get page motion.</p>
    </div>
  );
};
