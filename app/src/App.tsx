import React from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Reel } from "../../src/Reel";
import { reelDuration, pageStarts, type Project, type LogoConfig, type Box, type LoaderStyle } from "../../src/types";
import { ENTRANCE_NAMES, TEXT_ENTRANCE_NAMES, AMBIENT_NAMES, EXIT_NAMES, EASING_NAMES, TRANSITIONS } from "../../src/presets";
import {
  loadProject, saveProject, ingestPsd, uploadLogo, uploadAsset, renderReel,
  listFonts, uploadFontToLibrary, deleteProjectFiles, type IngestResult, type FontEntry,
  listMotionPresets, saveMotionPreset, deleteMotionPreset, type MotionPresetEntry,
} from "./api";
import { BUILT_IN_PRESETS } from "./builtinPresets";
import { Dashboard } from "./Dashboard";
import { StoryboardStrip } from "./StoryboardStrip";
import { CanvasHandles, type Handle } from "./CanvasHandles";
import { PhotoPanHandles, type PhotoPanTarget } from "./PhotoPanHandles";
import { SafeZoneOverlay } from "./SafeZoneOverlay";

const ENTRANCES = ENTRANCE_NAMES;
const AMBIENTS = AMBIENT_NAMES;
const EASINGS = EASING_NAMES;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

// A color swatch (native picker, for dragging around a color wheel) plus a
// hex text field (for pasting/typing an exact value) — the native <input
// type="color"> alone has no visible hex entry in most browsers. Local text
// state so a partial/invalid hex while typing doesn't get stomped on every
// keystroke; commits (and validates) on blur or Enter.
const ColorField: React.FC<{
  value: string;
  onChange: (hex: string) => void;
  swatchStyle?: React.CSSProperties;
  // Saved-palette swatches — all three optional so existing call sites keep
  // working untouched; a call site only shows the swatch row once it wires
  // these up. Lives on the PROJECT (see Project.swatches), not per-field —
  // one saved palette, offered next to every color picker in the app.
  swatches?: string[];
  onAddSwatch?: (hex: string) => void;
  onRemoveSwatch?: (hex: string) => void;
}> = ({ value, onChange, swatchStyle, swatches, onAddSwatch, onRemoveSwatch }) => {
  const [text, setText] = React.useState(value);
  React.useEffect(() => { setText(value); }, [value]);

  const commit = () => {
    let hex = text.trim();
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex);
    else setText(value); // invalid — snap back to the last real value
  };

  const alreadySaved = !!swatches?.some((s) => s.toLowerCase() === value.toLowerCase());

  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        <input type="color" value={value}
          style={{ width: 36, height: 28, ...swatchStyle }}
          onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={text} maxLength={7} placeholder="#rrggbb"
          style={{ width: 78, fontFamily: "var(--mono, monospace)", fontSize: 12, textTransform: "uppercase" }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        {onAddSwatch && (
          <button className="btn small" title={alreadySaved ? "Already saved" : "Save this color as a swatch"}
            disabled={alreadySaved} onClick={() => onAddSwatch(value)}>＋</button>
        )}
      </div>
      {swatches && swatches.length > 0 && (
        <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          {swatches.map((hex) => (
            <div key={hex} className="row" style={{ gap: 1, alignItems: "center" }}>
              <button title={hex} onClick={() => onChange(hex)}
                style={{
                  width: 16, height: 16, borderRadius: 3, padding: 0, cursor: "pointer", background: hex,
                  border: hex.toLowerCase() === value.toLowerCase() ? "2px solid var(--accent, #d9694f)" : "1px solid var(--line)",
                }} />
              {onRemoveSwatch && (
                <button title={`Remove ${hex}`} onClick={() => onRemoveSwatch(hex)}
                  style={{ fontSize: 8, width: 12, height: 12, padding: 0, lineHeight: 1, background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function niceName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, ""); // strip extension
}

// A plain photo (jpg/png/webp/gif) has no layer structure to extract, unlike
// a PSD/SVG template — so it becomes its own one-layer page instead of going
// through the server's PSD/SVG ingest pipeline: one full-bleed photo layer,
// sized to the reel canvas, ready for the user to drop a text layer on top of.
const IMAGE_PAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function pageFromImage(
  project: Project,
  name: string,
  upload: { file: string; kind: "image" | "video" | "gif" | "lottie"; width: number | null; height: number | null }
): Project["pages"][number] {
  const id = "p" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
  return {
    id,
    name: niceName(name),
    durationInFrames: 150, // 5s @ 30fps — matches the default template-page length
    // No preset motion — same "start at none" default as everywhere else;
    // the user opts into ambient/entrance/transition per element instead.
    ambient: "none",
    // durationInFrames must be >=1 — 0 crashes @remotion/transitions the
    // moment a second page exists (its interpolate() needs a strictly
    // increasing range; 0 collapses to [x,x]).
    transition: { type: "none" as any, durationInFrames: 1 },
    layers: [
      {
        index: -Date.now(),
        file: upload.file,
        role: "photo",
        left: 0, top: 0, width: project.width, height: project.height,
        opacity: 1,
        entrance: "none",
        delay: 0,
        assetKind: upload.kind === "video" || upload.kind === "gif" ? upload.kind : "image",
        fit: "cover",
        // Required for the pan/zoom drag handle to show up at all (it needs
        // the real pixel size to compute how far the crop can be dragged) —
        // this was missing before, which silently made a fresh photo page
        // un-repositionable.
        naturalWidth: upload.width,
        naturalHeight: upload.height,
      },
    ],
  };
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

function fmtTime(frame: number, fps: number): string {
  const totalSec = Math.max(0, frame / fps);
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Custom control bar rendered BELOW the player (never overlaid on top of it,
// so the canvas itself always stays clean — e.g. for screenshots/recording
// off the screen) — built on PlayerRef instead of the Player's own built-in
// `controls` overlay.
const PlayerControls: React.FC<{
  playerRef: React.RefObject<PlayerRef>;
  durationInFrames: number;
  fps: number;
}> = ({ playerRef, durationInFrames, fps }) => {
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);

  React.useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFs = (e: { detail: { isFullscreen: boolean } }) => setFullscreen(e.detail.isFullscreen);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("fullscreenchange", onFs);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("fullscreenchange", onFs);
    };
  }, [playerRef]);

  return (
    <div className="player-controls">
      <button className="btn small" onClick={() => playerRef.current?.toggle()} title={playing ? "Pause (space)" : "Play (space)"}>
        {playing ? "⏸" : "▶"}
      </button>
      <span className="pc-time">{fmtTime(frame, fps)} / {fmtTime(durationInFrames, fps)}</span>
      <input
        type="range" min={0} max={Math.max(0, durationInFrames - 1)} value={frame}
        className="pc-seek"
        onChange={(e) => playerRef.current?.seekTo(parseInt(e.target.value, 10))}
      />
      <button className="btn small" onClick={() => (fullscreen ? playerRef.current?.exitFullscreen() : playerRef.current?.requestFullscreen())} title="Fullscreen">
        ⛶
      </button>
    </div>
  );
};

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
  const [transparentExport, setTransparentExport] = React.useState(false);
  // Export file name — seeded once per project load from the project's own
  // name (so it's never blank by default), then left alone: a later project
  // rename shouldn't silently overwrite a name the user already typed here.
  const [exportName, setExportName] = React.useState("");
  const exportNameSeededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (project && exportNameSeededFor.current !== project.projectId) {
      setExportName(project.name || project.projectId);
      exportNameSeededFor.current = project.projectId;
    }
  }, [project?.projectId, project?.name]);
  // Left/right panel widths — draggable via the resizer bars between them and
  // the center preview, remembered across reloads (per-browser, not part of
  // the project). Center always takes whatever's left (min 320px so the
  // player never gets crushed to nothing by two over-widened side panels).
  const [leftW, setLeftW] = React.useState(() => {
    const v = Number(localStorage.getItem("motionist:leftW"));
    return v >= 200 && v <= 640 ? v : 280;
  });
  const [rightW, setRightW] = React.useState(() => {
    const v = Number(localStorage.getItem("motionist:rightW"));
    return v >= 280 && v <= 800 ? v : 440;
  });
  React.useEffect(() => { localStorage.setItem("motionist:leftW", String(leftW)); }, [leftW]);
  React.useEffect(() => { localStorage.setItem("motionist:rightW", String(rightW)); }, [rightW]);
  const startPanelDrag = (side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftW : rightW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (side === "left") setLeftW(Math.max(200, Math.min(640, startW + dx)));
      else setRightW(Math.max(280, Math.min(800, startW - dx)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [fonts, setFonts] = React.useState<FontEntry[]>([]);
  const refreshFonts = React.useCallback(() => { listFonts().then(setFonts).catch(() => {}); }, []);
  React.useEffect(() => { refreshFonts(); }, [refreshFonts]);
  const [motionPresets, setMotionPresets] = React.useState<MotionPresetEntry[]>([]);
  const refreshMotionPresets = React.useCallback(() => { listMotionPresets().then(setMotionPresets).catch(() => {}); }, []);
  React.useEffect(() => { refreshMotionPresets(); }, [refreshMotionPresets]);
  const onSaveMotionPreset = async (name: string, clip: MotionClip) => {
    try { await saveMotionPreset(name, clip); refreshMotionPresets(); }
    catch (e: any) { setErr(String(e.message || e)); }
  };
  const onDeleteMotionPreset = async (id: string) => {
    await deleteMotionPreset(id);
    refreshMotionPresets();
  };
  const psdInput = React.useRef<HTMLInputElement>(null);
  const logoInput = React.useRef<HTMLInputElement>(null);
  const bgInput = React.useRef<HTMLInputElement>(null);
  const titleInput = React.useRef<HTMLInputElement>(null);
  const playerRef = React.useRef<PlayerRef>(null);
  const playerWrapRef = React.useRef<HTMLDivElement>(null);

  // Undo/redo history. Kept as refs (not state) since they change on nearly
  // every edit and don't need to trigger a re-render themselves — forceTick
  // bumps a counter just so the Undo/Redo buttons' disabled state stays in
  // sync. Snapshots are coalesced: a burst of rapid updates (dragging a
  // handle, typing in a textarea) within 500ms of each other only pushes ONE
  // history entry (from before the burst started), so undo reverts a whole
  // drag/typing sweep at once instead of one pixel/keystroke at a time.
  const historyRef = React.useRef<Project[]>([]);
  const futureRef = React.useRef<Project[]>([]);
  const lastPushRef = React.useRef(0);
  const [, forceTick] = React.useReducer((c: number) => c + 1, 0);
  const HISTORY_LIMIT = 50;
  const COALESCE_MS = 500;

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
    // A fresh project (or reload of the same one) starts a clean slate —
    // undoing across a project switch into a DIFFERENT project's old state
    // would be a real correctness bug, not just a UX quirk.
    historyRef.current = [];
    futureRef.current = [];
    loadProject(projectId).then(setProject).catch(() => {});
  }, [projectId]);

  // Ref mutations happen HERE, in plain synchronous handler code — never
  // inside a setState updater function. React.StrictMode double-invokes
  // updater functions in dev to catch impure ones; a ref push/pop living
  // inside one runs twice per call and silently corrupts the stack. (This
  // bit me during testing — undo worked once, redo then landed on garbage.)
  const undo = () => {
    if (!project || historyRef.current.length === 0) return;
    const prior = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, project];
    lastPushRef.current = 0;
    setProject(prior);
    forceTick();
  };

  const redo = () => {
    if (!project || futureRef.current.length === 0) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, project];
    lastPushRef.current = 0;
    setProject(next);
    forceTick();
  };

  // Spacebar play/pause, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo —
  // all guarded the same way: skip while a text field/select has focus, so
  // this never hijacks normal typing (a textarea's OWN native undo should
  // win while you're actively editing text in it) or steals space from a
  // focused dropdown.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Re-attached whenever `project` changes so undo/redo always act on the
    // current project, not whatever was current when the listener was first
    // attached (playerRef itself is a stable ref, so the spacebar branch
    // doesn't actually need this — but the undo/redo branches do).
  }, [project]);

  const update = (fn: (p: Project) => void) => {
    if (project) {
      const now = Date.now();
      if (now - lastPushRef.current > COALESCE_MS) {
        historyRef.current = [...historyRef.current, project].slice(-HISTORY_LIMIT);
        futureRef.current = [];
        forceTick();
      }
      lastPushRef.current = now;
    }
    setProject((prev) => {
      if (!prev) return prev;
      const next = clone(prev);
      fn(next);
      return next;
    });
  };

  // The saved color palette lives on the project (Project.swatches), shared
  // by every color picker in the app — one list, not one per field.
  const addSwatch = (hex: string) => update((p) => {
    if (!(p.swatches ?? []).some((s) => s.toLowerCase() === hex.toLowerCase())) {
      p.swatches = [...(p.swatches ?? []), hex];
    }
  });
  const removeSwatch = (hex: string) => update((p) => {
    p.swatches = (p.swatches ?? []).filter((s) => s.toLowerCase() !== hex.toLowerCase());
  });

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
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const isImage = IMAGE_PAGE_EXTS.includes(ext);
      setBusy(files.length > 1
        ? `${isImage ? "Uploading" : "Extracting"} ${i + 1}/${files.length}: ${file.name}…`
        : `${isImage ? "Uploading" : "Extracting"} ${file.name}…`);
      try {
        if (isImage) {
          const upload = await uploadAsset(file, `page_${Date.now()}`, projectId);
          setProject((prev) => {
            if (!prev) return prev;
            const next = clone(prev);
            next.pages.push(pageFromImage(next, file.name, upload));
            return next;
          });
        } else {
          const res = await ingestPsd(file, projectId);
          setProject((prev) => (prev ? mergeIngestedPage(prev, res, res.sourceName) : prev));
        }
      } catch (e: any) {
        failures.push(`${file.name}: ${String(e.message || e)}`);
      }
    }

    setBusy(null);
    if (failures.length) setErr(`${failures.length} file(s) failed:\n` + failures.join("\n"));
  };

  const onSlotUpload = async (slotKey: "logo" | "bg" | "title", file: File) => {
    setBusy(`Uploading ${slotKey}…`); setErr(null);
    const oldFile = project?.[slotKey]?.file ?? null;
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
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(null); }
  };

  // Clears a global slot (BG/Title/Logo) entirely — back to "Upload …" with
  // nothing in it, cleaning up its uploaded file the same way a replace does.
  const onRemoveSlot = (slotKey: "logo" | "bg" | "title") => {
    if (!project) return;
    const oldFile = project[slotKey]?.file ?? null;
    update((p) => { p[slotKey] = null; });
    if (oldFile) deleteProjectFiles(projectId, [oldFile]);
  };

  // Upload a real photo/video into a placeholder box on the CURRENT page.
  // Replaces the file + kind; the box (left/top/width/height) is left as-is
  // — cover-fit auto-crops it in, and the user can drag/resize on the canvas
  // to refine the crop if the photo's shape doesn't quite match the box.
  const onUploadPhoto = async (pageIndex: number, layerIndex: number, file: File) => {
    if (!project) return;
    const pageId = project.pages[pageIndex].id;
    const oldFile = project.pages[pageIndex].layers[layerIndex]?.file || null;
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
      if (oldFile) deleteProjectFiles(projectId, [oldFile]);
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
      // push (not unshift) — layers later in the array paint on top in
      // PageScene, so a freshly added text layer defaults to sitting ON TOP
      // of whatever's already on the page (e.g. a photo), not hidden behind it.
      page.layers.push({
        index: -Date.now(),
        file: "", role: "text",
        left: Math.round((p.width - w) / 2), top: Math.round(p.height * 0.4),
        width: w, height: h, opacity: 1,
        entrance: "none", delay: 0, inDuration: 26,
        assetKind: "text", text: "", fontSize: 48, textColor: "#1a1a1a", textAlign: "right",
      } as any);
    });
  };

  // A page with no photo/PSD at all — just a solid color (defaults to the
  // project's own backdrop color so it's visible immediately) to drop text
  // onto. Covers the "I just want text on a color" case that otherwise
  // requires a photo to create a page in the first place.
  const onAddBlankPage = () => {
    if (!project) return;
    update((p) => {
      const id = "p" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
      p.pages.push({
        id,
        name: "Text page",
        durationInFrames: 150,
        ambient: "none",
        // durationInFrames must be >=1 — 0 crashes @remotion/transitions the
        // moment a second page exists (its interpolate() needs a strictly
        // increasing range; 0 collapses to [x,x]).
        transition: { type: "none" as any, durationInFrames: 1 },
        layers: [],
        // No bgColor here on purpose — undefined means "follow the
        // project's", same promise the picker's own label makes. Setting an
        // explicit color at creation (the old behavior) permanently shadowed
        // the project-level "Backdrop color" picker for this page, since the
        // page's own fill is opaque and sits on top — so changing the
        // project color visibly did nothing, which is exactly the bug
        // report this fixes.
      });
    });
  };

  // Adds an empty photo slot to ANY page — including one that started blank
  // (text/color only) or has never had a photo — instead of a photo being
  // something only a fresh page can start with. Placed at the BACK of the
  // stack (unlike text, which defaults to front): a photo is usually meant
  // as the backdrop for whatever's already on the page, not covering it.
  // No file yet — the layer's own "Upload photo/video" button (already
  // shown for any role:"photo" layer) is how it actually gets filled in.
  const onAddPhotoLayer = (pageIndex: number) => {
    if (!project) return;
    update((p) => {
      const page = p.pages[pageIndex];
      page.layers.unshift({
        index: -Date.now(),
        file: "", role: "photo",
        left: 0, top: 0, width: p.width, height: p.height,
        opacity: 1, entrance: "none", delay: 0, fit: "cover",
      });
    });
  };

  const onDeleteLayer = (pageIndex: number, layerIndex: number) => {
    if (!project) return;
    const file = project.pages[pageIndex]?.layers[layerIndex]?.file;
    update((p) => { p.pages[pageIndex].layers.splice(layerIndex, 1); });
    if (file) deleteProjectFiles(projectId, [file]);
  };

  // Assigns an already-uploaded library font (or clears back to the system
  // default when entry is null) to one text layer.
  const onSelectFont = (pageIndex: number, layerIndex: number, entry: FontEntry | null) => {
    update((p) => {
      const layer = p.pages[pageIndex].layers[layerIndex];
      layer.fontFamily = entry?.cssFamily;
      layer.fontFile = entry?.file;
    });
  };

  // Uploads a NEW font straight into the shared library (same one the
  // Dashboard's Font manager writes to) and immediately applies it to this
  // layer — so a first-time font doesn't require a trip back to the Dashboard.
  const onUploadNewFont = async (pageIndex: number, layerIndex: number, file: File, family: string, style: string) => {
    if (!project) return;
    setBusy("Uploading font…"); setErr(null);
    try {
      const entry = await uploadFontToLibrary(file, family, style);
      setFonts((prev) => [...prev, entry]);
      onSelectFont(pageIndex, layerIndex, entry);
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
      const url = await renderReel(project, transparentExport, exportName);
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

  // General move-to-any-position (the storyboard strip's drag-reorder) —
  // movePage above only swaps adjacent neighbors, which is fine for the ↑/↓
  // buttons but not for dropping a page directly at an arbitrary spot.
  const reorderPages = (from: number, to: number) => {
    if (from === to) return;
    update((p) => {
      const [moved] = p.pages.splice(from, 1);
      p.pages.splice(to, 0, moved);
    });
    // Keep tracking the SAME page across the move, not just the same index —
    // standard array-move index math (only shifts what sits between the two
    // positions, everything else stays put).
    setSel((s) => {
      if (s === from) return to;
      if (from < s && s <= to) return s - 1;
      if (to <= s && s < from) return s + 1;
      return s;
    });
  };

  const delPage = (i: number) => {
    const page = project?.pages[i];
    update((p) => { p.pages.splice(i, 1); });
    setSel((s) => Math.max(0, s - (i <= s ? 1 : 0)));
    if (page) {
      // Every layer's own uploaded file (photo/blank pages), PLUS the whole
      // extracted folder for a PSD/SVG-sourced page (manifest.json + its raw
      // layer exports) — passing both is harmless, whichever doesn't apply
      // to this page just no-ops server-side.
      const files = page.layers.map((l) => l.file).filter(Boolean);
      deleteProjectFiles(projectId, [...files, `projects/${projectId}/${page.id}`]);
    }
  };

  // Draggable/resizable canvas handles: global bg/logo/title + every
  // photo-role layer on the CURRENT page (auto-detected placeholder slots —
  // no naming convention needed). Rebuilt whenever the project or selected
  // page changes. The global bg/logo/title are repositionable — they're
  // standalone global elements, uploaded the same way, not part of any
  // page's template. (Don't confuse this with a page's own template-derived
  // photo/bg LAYER, which stays fixed — what's adjustable there is the
  // photo's crop position INSIDE its locked frame, see PhotoPanHandles
  // below, not the frame itself.) BG goes first so its handle renders
  // underneath logo/title's — it's usually the biggest box on screen, and
  // shouldn't steal clicks meant for the smaller ones sitting on top of it.
  const canvasHandles: Handle[] = React.useMemo(() => {
    if (!project) return [];
    const list: Handle[] = [];
    if (project.bg) list.push({
      id: "bg", label: "BG", color: "#7ed6a5", box: project.bg.box,
      onChange: (b) => update((p) => { if (p.bg) p.bg.box = b; }),
    });
    if (project.logo) list.push({
      id: "logo", label: "LOGO", color: "#5aa9ff", box: project.logo.box,
      onChange: (b) => update((p) => { if (p.logo) p.logo.box = b; }),
    });
    if (project.title) list.push({
      id: "title", label: "TITLE", color: "#f2b84b", box: project.title.box,
      onChange: (b) => update((p) => { if (p.title) p.title.box = b; }),
    });
    if (project.loaderVisible ?? true) list.push({
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
      <div className="col" style={{ width: leftW, flex: `0 0 ${leftW}px` }}>
        <div className="editor-header">
          <button className="btn back-btn" onClick={onBack}>← Dashboard</button>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn small" title="Undo (Ctrl+Z)" disabled={historyRef.current.length === 0} onClick={undo}>↶</button>
            <button className="btn small" title="Redo (Ctrl+Shift+Z)" disabled={futureRef.current.length === 0} onClick={redo}>↷</button>
          </div>
        </div>
        <input
          className="project-name-input"
          value={project?.name ?? ""}
          placeholder="Loading…"
          disabled={!project}
          onChange={(e) => update((p) => { p.name = e.target.value; })}
        />
        <p className="sub">PSD → animated reel</p>

        <button className="btn primary" onClick={() => psdInput.current?.click()}>+ Add pages (PSD / SVG / photo)</button>
        <input ref={psdInput} className="hidden-file" type="file" accept=".psd,.svg,.png,.jpg,.jpeg,.webp,.gif" multiple
          onChange={(e) => { if (e.target.files) onAddPages(e.target.files); e.target.value = ""; }} />
        <p className="hint">PSD/SVG extract their layers; a plain photo becomes a simple full-frame page. Select multiple at once, or drop below — added in filename order.</p>
        <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={onAddBlankPage}>+ Add blank page (color + text only)</button>

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
            <div className="card compact">
              <button className={"btn upload" + (project.bg?.file ? " filled" : "")} onClick={() => bgInput.current?.click()}>
                {project.bg?.file ? "Replace Background" : "Upload Background"}
              </button>
              <input ref={bgInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif"
                onChange={(e) => e.target.files?.[0] && onSlotUpload("bg", e.target.files[0])} />
              {project.bg && (
                <AssetControls slot={project.bg} label="BG" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.bg) fn(p.bg); })}
                  onRemove={() => onRemoveSlot("bg")} />
              )}
              <div style={{ marginTop: 8 }}>
                {/* Stacked, not side-by-side with the label — a long label
                    next to the color swatch+hex+swatch-row combo had no room
                    to breathe and pushed the control past the card's edge. */}
                <span className="hint" style={{ margin: "0 0 4px", display: "block" }}>Backdrop color (shows through gaps/transparency)</span>
                <ColorField value={project.bgColor ?? "#e8e4dd"}
                  onChange={(hex) => update((p) => { p.bgColor = hex; })}
                  swatches={project.swatches ?? []} onAddSwatch={addSwatch} onRemoveSwatch={removeSwatch} />
              </div>
            </div>

            {/* TITLE */}
            <div className="card compact">
              <button className={"btn upload" + (project.title?.file ? " filled" : "")} onClick={() => titleInput.current?.click()}>
                {project.title?.file ? "Replace Title" : "Upload Title"}
              </button>
              <input ref={titleInput} className="hidden-file" type="file" accept=".png,.jpg,.jpeg,.svg,.webm,.mov,.mp4,.gif,.json"
                onChange={(e) => e.target.files?.[0] && onSlotUpload("title", e.target.files[0])} />
              {project.title && (
                <AssetControls slot={project.title} label="Title" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.title) fn(p.title); })}
                  onRemove={() => onRemoveSlot("title")} />
              )}
            </div>

            {/* LOGO */}
            <div className="card compact">
              <button className={"btn upload" + (project.logo?.file ? " filled" : "")} onClick={() => logoInput.current?.click()}>
                {project.logo?.file ? "Replace Logo" : "Upload Logo (top-right)"}
              </button>
              <input ref={logoInput} className="hidden-file" type="file" accept=".json,.webm,.mov,.mp4,.gif,.png,.svg"
                onChange={(e) => e.target.files?.[0] && onSlotUpload("logo", e.target.files[0])} />
              {project.logo && (
                <AssetControls slot={project.logo} label="Logo" canvas={[project.width, project.height]}
                  onChange={(fn) => update((p) => { if (p.logo) fn(p.logo); })}
                  onRemove={() => onRemoveSlot("logo")} />
              )}
            </div>

            {/* LOADER */}
            <h2>Loader</h2>
            <LoaderControls loader={project.loader} style={project.loaderStyle ?? "bar"}
              visible={project.loaderVisible ?? true}
              canvas={[project.width, project.height]}
              onChangeBox={(fn) => update((p) => fn(p.loader))}
              onChangeStyle={(s) => update((p) => { p.loaderStyle = s; })}
              onChangeVisible={(v) => update((p) => { p.loaderVisible = v; })} />
          </>
        )}

        <h2>Export</h2>
        <div className="card compact">
          <label style={{ margin: "0 0 4px" }}>File name</label>
          <input type="text" value={exportName} placeholder={project?.name || project?.projectId || "reel"}
            style={{ marginBottom: 8 }}
            onChange={(e) => setExportName(e.target.value)} />
          <label className="row" style={{ gap: 6, alignItems: "center", marginBottom: 8 }}>
            <input type="checkbox" checked={transparentExport}
              onChange={(e) => setTransparentExport(e.target.checked)} />
            Transparent background (alpha export, ProRes .mov — for Resolve/editors)
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={onSave} disabled={!project}>Save</button>
            <button className="btn primary" onClick={onRender} disabled={!project}>
              {transparentExport ? "Render ProRes (alpha)" : "Render MP4"}
            </button>
          </div>
          {renderUrl && <p className="hint">Done → <a className="dl" href={renderUrl} target="_blank" rel="noreferrer">download reel</a></p>}
          {busy && <p className="spin">{busy}</p>}
          {err && (
            <p className="err row between" style={{ alignItems: "center", gap: 8 }}>
              <span>{err}</span>
              <button className="btn small" title="Dismiss" onClick={() => setErr(null)}>✕</button>
            </p>
          )}
        </div>
      </div>

      <div className="panel-resizer" onMouseDown={startPanelDrag("left")} title="Drag to resize" />

      {/* CENTER: live preview */}
      <div className="center" style={{ flex: "1 1 auto", minWidth: 320 }}>
        {/* A strip showing 1-2 thumbnails isn't a storyboard, it's noise —
            only earns its space once there's an actual sequence to scan. */}
        {project && project.pages.length > 2 && (
          <StoryboardStrip
            project={project}
            selected={sel}
            onSelect={selectPage}
            onReorder={reorderPages}
          />
        )}
        {project ? (
          <div
            ref={playerWrapRef}
            style={{
              position: "relative",
              // Matches the storyboard's own >2 threshold above — otherwise
              // hiding the strip at 1-2 pages just leaves dead space instead
              // of giving it back to the player.
              height: project.pages.length > 2 ? "66vh" : "80vh",
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
            {showSafeZone && project.height > project.width && <SafeZoneOverlay canvas={[project.width, project.height]} />}
          </div>
        ) : <p className="sub">Loading…</p>}
        {project && (
          <PlayerControls playerRef={playerRef} durationInFrames={reelDuration(project)} fps={project.fps} />
        )}
        {/* Meta's published Reels/Stories safe margins only mean anything on
            a portrait canvas — showing them over a landscape/square project
            would just be wrong, not merely irrelevant. */}
        {/* One grouped box instead of 2-3 loose paragraphs floating under the
            player — same tips, just an actual section instead of stray text. */}
        {project && (canvasHandles.length > 0 || photoPanTargets.length > 0 || project.height > project.width) && (
          <div className="card compact" style={{ maxWidth: 420, width: "100%" }}>
            {project.height > project.width && (
              <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={showSafeZone}
                  onChange={(e) => setShowSafeZone(e.target.checked)}
                  style={{ width: "auto" }} />
                Show Instagram Reels safe zone (guide only — never rendered in export)
              </label>
            )}
            {canvasHandles.length > 0 && (
              <p className="hint" style={{ margin: project.height > project.width ? "6px 0 0" : 0, textAlign: "center" }}>
                BG/Logo/Title — drag to reposition, corner grip to resize · arrow keys to nudge (Shift = 10px)
              </p>
            )}
            {photoPanTargets.length > 0 && (
              <p className="hint" style={{ margin: "6px 0 0", textAlign: "center" }}>
                Pink boxes — drag the photo to reposition its crop (the frame itself is fixed by the design)
              </p>
            )}
          </div>
        )}
      </div>

      <div className="panel-resizer" onMouseDown={startPanelDrag("right")} title="Drag to resize" />

      {/* RIGHT: page inspector */}
      <div className="col" style={{ width: rightW, flex: `0 0 ${rightW}px` }}>
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
            onAddPhoto={() => onAddPhotoLayer(sel)}
            onDeleteLayer={(li) => onDeleteLayer(sel, li)}
            fonts={fonts}
            onSelectFont={(li, entry) => onSelectFont(sel, li, entry)}
            onUploadNewFont={(li, file, family, style) => onUploadNewFont(sel, li, file, family, style)}
            swatches={project.swatches ?? []} onAddSwatch={addSwatch} onRemoveSwatch={removeSwatch}
            motionPresets={motionPresets} onSaveMotionPreset={onSaveMotionPreset} onDeleteMotionPreset={onDeleteMotionPreset}
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
  onRemove: () => void;
}> = ({ slot, label, canvas, onChange, onRemove }) => {
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
          <button className="btn small" title={`Remove ${label}`} onClick={onRemove}>✕</button>
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
  { value: "folio", label: "folio (page count, e.g. 03 — 12)" },
];

const LoaderControls: React.FC<{
  loader: Box;
  style: LoaderStyle;
  visible: boolean;
  canvas: [number, number];
  onChangeBox: (fn: (b: Box) => void) => void;
  onChangeStyle: (s: LoaderStyle) => void;
  onChangeVisible: (v: boolean) => void;
}> = ({ loader, style, visible, canvas, onChangeBox, onChangeStyle, onChangeVisible }) => {
  const [cw, ch] = canvas;
  const num = (v: string) => Math.round(parseFloat(v || "0"));
  const centerX = () => onChangeBox((b) => { b.left = Math.round((cw - b.width) / 2); });

  return (
    <div className="card compact">
      <div className="row between">
        <span className="tag">Loader box</span>
        <label className="row" style={{ gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={visible} style={{ width: "auto" }}
            onChange={(e) => onChangeVisible(e.target.checked)} />
          Show loader
        </label>
      </div>
      <div className="mini" style={{ marginTop: 6 }}>
        <label>Style</label>
        <select value={style} disabled={!visible} onChange={(e) => onChangeStyle(e.target.value as LoaderStyle)}>
          {LOADER_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {style !== "folio" && (
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn small" disabled={!visible} onClick={centerX}>Center X</button>
        </div>
      )}
      <div className="grid2 mini" style={{ marginTop: 6 }}>
        <div><label>X</label><input type="number" value={loader.left}
          onChange={(e) => onChangeBox((b) => { b.left = num(e.target.value); })} /></div>
        <div><label>Y</label><input type="number" value={loader.top}
          onChange={(e) => onChangeBox((b) => { b.top = num(e.target.value); })} /></div>
        {style !== "folio" && (
          <>
            <div><label>Width</label><input type="number" value={loader.width}
              onChange={(e) => onChangeBox((b) => { b.width = num(e.target.value); })} /></div>
            <div><label>Height</label><input type="number" value={loader.height}
              onChange={(e) => onChangeBox((b) => { b.height = num(e.target.value); })} /></div>
          </>
        )}
      </div>
      {style === "folio" && (
        <p className="hint" style={{ marginTop: 6 }}>Folio is a fixed-size numeral — X/Y position it, drag the handle on canvas to place the corner.</p>
      )}
    </div>
  );
};

type PageT = Project["pages"][number];
type LayerT = PageT["layers"][number];

// Everything about a layer that's worth copying to another layer — motion,
// timing AND style (font/size/color/align/direction/photo crop) — except the
// literal `text` string and structural fields (box, role, file, asset kind),
// which stay tied to the layer they came from. Also doubles as the shape
// saved server-side by motion presets.
export type MotionClip = {
  entrance: LayerT["entrance"];
  entrance2?: LayerT["entrance2"];
  entrance3?: LayerT["entrance3"];
  delay: number;
  inDuration?: number;
  entranceEasing?: LayerT["entranceEasing"];
  exit?: LayerT["exit"];
  exit2?: LayerT["exit2"];
  exit3?: LayerT["exit3"];
  outDuration?: number;
  exitEasing?: LayerT["exitEasing"];
  // Text style — never the `text` content itself.
  fontFamily?: LayerT["fontFamily"];
  fontFile?: LayerT["fontFile"];
  fontSize?: LayerT["fontSize"];
  textColor?: LayerT["textColor"];
  textAlign?: LayerT["textAlign"];
  direction?: LayerT["direction"];
  // Photo/video crop + in-frame motion.
  fit?: LayerT["fit"];
  photoMotion?: LayerT["photoMotion"];
  photoPanX?: LayerT["photoPanX"];
  photoPanY?: LayerT["photoPanY"];
  photoZoom?: LayerT["photoZoom"];
};

function clipFromLayer(l: LayerT): MotionClip {
  return {
    entrance: l.entrance, entrance2: l.entrance2, entrance3: l.entrance3,
    delay: l.delay, inDuration: l.inDuration, entranceEasing: l.entranceEasing,
    exit: l.exit, exit2: l.exit2, exit3: l.exit3,
    outDuration: l.outDuration, exitEasing: l.exitEasing,
    fontFamily: l.fontFamily, fontFile: l.fontFile, fontSize: l.fontSize,
    textColor: l.textColor, textAlign: l.textAlign, direction: l.direction,
    fit: l.fit, photoMotion: l.photoMotion,
    photoPanX: l.photoPanX, photoPanY: l.photoPanY, photoZoom: l.photoZoom,
  };
}

function applyClip(l: LayerT, clip: MotionClip) {
  l.entrance = clip.entrance;
  l.entrance2 = clip.entrance2;
  l.entrance3 = clip.entrance3;
  l.delay = clip.delay;
  l.inDuration = clip.inDuration;
  l.entranceEasing = clip.entranceEasing;
  l.exit = clip.exit;
  l.exit2 = clip.exit2;
  l.exit3 = clip.exit3;
  l.outDuration = clip.outDuration;
  l.exitEasing = clip.exitEasing;
  // Style — skipped entirely for a field the clip never set (undefined),
  // so pasting an older clip that predates these fields is a no-op for them
  // instead of wiping the target layer's existing style back to defaults.
  if (clip.fontFamily !== undefined) l.fontFamily = clip.fontFamily;
  if (clip.fontFile !== undefined) l.fontFile = clip.fontFile;
  if (clip.fontSize !== undefined) l.fontSize = clip.fontSize;
  if (clip.textColor !== undefined) l.textColor = clip.textColor;
  if (clip.textAlign !== undefined) l.textAlign = clip.textAlign;
  if (clip.direction !== undefined) l.direction = clip.direction;
  if (clip.fit !== undefined) l.fit = clip.fit;
  if (clip.photoMotion !== undefined) l.photoMotion = clip.photoMotion;
  if (clip.photoPanX !== undefined) l.photoPanX = clip.photoPanX;
  if (clip.photoPanY !== undefined) l.photoPanY = clip.photoPanY;
  if (clip.photoZoom !== undefined) l.photoZoom = clip.photoZoom;
}

// Small inline icon set for the icon-only alignment/direction controls below
// — plain SVG (not emoji) so each stays crisp at any size and themes via
// currentColor, same as the button text/active color around it.

// Paragraph-style: 3 bars mimicking actual aligned text — this is TEXT
// alignment (CSS text-align inside the box), not the box's own position.
const AlignTextIcon: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => {
  const bars =
    align === "left" ? [{ x: 1, w: 13 }, { x: 1, w: 8 }, { x: 1, w: 11 }] :
    align === "right" ? [{ x: 1, w: 13 }, { x: 6, w: 8 }, { x: 3, w: 11 }] :
    [{ x: 1, w: 13 }, { x: 3.5, w: 8 }, { x: 2, w: 11 }];
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      {bars.map((b, i) => <rect key={i} x={b.x} y={2 + i * 4.5} width={b.w} height={1.6} rx={0.6} fill="currentColor" />)}
    </svg>
  );
};

// Illustrator-style "align to artboard": a dashed guide at the target edge
// plus a small box snapped to it — this is the BOX's position on the frame,
// deliberately drawn nothing like AlignTextIcon so the two are never
// mistaken for each other.
const AlignBoxIcon: React.FC<{ align: "left" | "center" | "right" }> = ({ align }) => {
  const guideX = align === "left" ? 1.5 : align === "right" ? 13.5 : 7.5;
  const boxX = align === "left" ? 1.5 : align === "right" ? 6.5 : 4;
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <line x1={guideX} y1="1" x2={guideX} y2="14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6,1.4" opacity="0.6" />
      <rect x={boxX} y="4.5" width="7" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" rx="0.5" />
    </svg>
  );
};

// Same idea, rotated: guide runs horizontally at the top/middle/bottom edge
// instead of vertically at left/center/right.
const AlignBoxIconV: React.FC<{ align: "top" | "middle" | "bottom" }> = ({ align }) => {
  const guideY = align === "top" ? 1.5 : align === "bottom" ? 13.5 : 7.5;
  const boxY = align === "top" ? 1.5 : align === "bottom" ? 6.5 : 4;
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <line x1="1" y1={guideY} x2="14" y2={guideY} stroke="currentColor" strokeWidth="1" strokeDasharray="1.6,1.4" opacity="0.6" />
      <rect x="4.5" y={boxY} width="6" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" rx="0.5" />
    </svg>
  );
};

// RTL is just the LTR glyph mirrored — same bars/arrow, flipped, so the pair
// reads as one flow-direction control rather than two unrelated icons.
const DirectionIcon: React.FC<{ dir: "ltr" | "rtl" }> = ({ dir }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"
    style={dir === "rtl" ? { transform: "scaleX(-1)" } : undefined}>
    <rect x="1" y="3" width="9" height="1.6" rx="0.6" fill="currentColor" />
    <rect x="1" y="10" width="6" height="1.6" rx="0.6" fill="currentColor" />
    <path d="M10 10.8 H14 M12 8.8 L14 10.8 L12 12.8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Up to 3 combined effects on one IN or OUT direction — FX1 is always shown,
// a "+" reveals FX2 then FX3 (capped there), each removable with its own ✕
// (removing one also clears anything after it, so there's never a gap).
// values/onChange/onAdd/onRemove all address slots by 0/1/2 (FX1/FX2/FX3).
const FxSlots: React.FC<{
  label: string;
  options: readonly string[];
  values: [string, string | undefined, string | undefined];
  onChangeSlot: (index: 0 | 1 | 2, value: string) => void;
  onAdd: () => void;
  onRemove: (index: 1 | 2) => void;
  disabled?: boolean;
}> = ({ label, options, values, onChangeSlot, onAdd, onRemove, disabled }) => {
  const shown = values[2] !== undefined ? 3 : values[1] !== undefined ? 2 : 1;
  return (
    <div className="mini">
      <label>{label}</label>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {([0, 1, 2] as const).slice(0, shown).map((i) => (
          <div key={i} className="row" style={{ gap: 2, alignItems: "center" }}>
            <span className="tag" style={{ fontSize: 10, padding: "1px 4px" }}>FX{i + 1}</span>
            {/* `disabled` means "can't combine more effects yet" (e.g. OUT's
                FX1 is still "none") — it must never lock FX1 itself, or
                there'd be no way to ever set it away from "none" at all. */}
            <select value={values[i]} disabled={i > 0 && disabled}
              onChange={(e) => onChangeSlot(i, e.target.value)}>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {i > 0 && (
              <button className="btn small" title={`Remove FX${i + 1}`} aria-label={`Remove FX${i + 1} effect`} disabled={disabled}
                onClick={() => onRemove(i as 1 | 2)}>✕</button>
            )}
          </div>
        ))}
        {shown < 3 && (
          <button className="btn small" title="Combine another effect" aria-label="Combine another effect" disabled={disabled} onClick={onAdd}>＋</button>
        )}
      </div>
    </div>
  );
};

// Quick-pick timings alongside "Auto" and an exact custom value — before
// this, in/out duration only had a raw number field with no way back to
// "auto" once touched at all (the easing pickers already had a working
// "(auto)" option; these two fields never did).
const DURATION_PRESETS: { label: string; frames: number }[] = [
  { label: "Fast (0.3s)", frames: 9 },
  { label: "Normal (0.6s)", frames: 18 },
  { label: "Slow (1.2s)", frames: 36 },
];

const DurationPresetField: React.FC<{
  value: number | undefined;
  fallback: number; // frames used when value is unset ("auto") — matches the app's own built-in default
  disabled?: boolean;
  onChange: (frames: number | undefined) => void;
}> = ({ value, fallback, disabled, onChange }) => {
  const matched = DURATION_PRESETS.find((p) => p.frames === value);
  const selectValue = value === undefined ? "auto" : matched ? String(matched.frames) : "custom";
  const secVal = +(((value ?? fallback) / 30)).toFixed(2);
  return (
    <div className="row" style={{ gap: 4 }}>
      <select value={selectValue} disabled={disabled} style={{ flex: 1 }}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") onChange(undefined);
          else if (v !== "custom") onChange(Number(v));
        }}>
        <option value="auto">Auto</option>
        {DURATION_PRESETS.map((p) => <option key={p.frames} value={p.frames}>{p.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      <input type="number" step={0.1} min={0.1} value={secVal} disabled={disabled} style={{ width: 64 }}
        onChange={(e) => onChange(Math.max(1, Math.round(parseFloat(e.target.value || "0") * 30)))} />
    </div>
  );
};

const ElementMotion: React.FC<{
  layer: LayerT;
  clip: MotionClip | null;
  onCopy: (clip: MotionClip) => void;
  onChange: (fn: (l: LayerT) => void) => void;
  onUploadPhoto?: (file: File) => void;
  fonts?: FontEntry[];
  onSelectFont?: (entry: FontEntry | null) => void;
  onUploadNewFont?: (file: File, family: string, style: string) => void;
  onDelete: () => void;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  swatches?: string[];
  onAddSwatch?: (hex: string) => void;
  onRemoveSwatch?: (hex: string) => void;
  motionPresets?: MotionPresetEntry[];
  onSaveMotionPreset?: (name: string, clip: MotionClip) => void;
  onDeleteMotionPreset?: (id: string) => void;
  canvas: [number, number];
}> = ({ layer, clip, onCopy, onChange, onUploadPhoto, fonts, onSelectFont, onUploadNewFont, onDelete, onMove, canMoveUp, canMoveDown, swatches, onAddSwatch, onRemoveSwatch, motionPresets, onSaveMotionPreset, onDeleteMotionPreset, canvas }) => {
  const sec = (frames?: number, dflt = 0) => +(((frames ?? dflt) / 30)).toFixed(2);
  const toFr = (s: string) => Math.max(0, Math.round(parseFloat(s || "0") * 30));
  const photoInput = React.useRef<HTMLInputElement>(null);
  const newFontInput = React.useRef<HTMLInputElement>(null);
  const [addingFont, setAddingFont] = React.useState(false);
  const [newFamily, setNewFamily] = React.useState("");
  const [newStyle, setNewStyle] = React.useState("Regular");
  const [savingPreset, setSavingPreset] = React.useState(false);
  const [presetName, setPresetName] = React.useState("");
  const commitSavePreset = () => {
    const name = presetName.trim();
    if (!name || !onSaveMotionPreset) return;
    onSaveMotionPreset(name, clipFromLayer(layer));
    setSavingPreset(false);
    setPresetName("");
  };
  // Collapsed by default is a trap (fields silently hidden on load, easy to
  // think they vanished) — starts expanded, same as before this existed;
  // collapsing is something the user opts into per layer.
  const [expanded, setExpanded] = React.useState(true);
  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState(layer.name ?? "");
  const commitRename = () => {
    setRenaming(false);
    const trimmed = draftName.trim();
    if (trimmed !== (layer.name ?? "")) onChange((l) => { l.name = trimmed || undefined; });
  };
  const isPhotoSlot = layer.role === "photo";
  const isTextLayer = layer.assetKind === "text";
  const inOptions = isTextLayer ? [...ENTRANCES, ...TEXT_ENTRANCE_NAMES] : ENTRANCES;

  // Group the shared library by family name, for the two-step Font -> Style pickers.
  const families = React.useMemo(() => {
    const byFamily = new Map<string, FontEntry[]>();
    (fonts ?? []).forEach((f) => {
      if (!byFamily.has(f.family)) byFamily.set(f.family, []);
      byFamily.get(f.family)!.push(f);
    });
    return byFamily;
  }, [fonts]);
  const currentEntry = (fonts ?? []).find((f) => f.cssFamily === layer.fontFamily) ?? null;
  const currentFamilyVariants = currentEntry ? families.get(currentEntry.family) ?? [] : [];

  return (
    <div className="card compact">
      <div className={"row between collapsible-header" + (expanded ? " expanded" : "")}
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Click to collapse" : "Click to expand"}
        role="button" tabIndex={0} aria-expanded={expanded}
        aria-label={`${layer.name || layer.role} layer, ${expanded ? "expanded" : "collapsed"}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); }
        }}>
        <span className="lname" style={{ minWidth: 0, overflow: "hidden" }}>
          <span className="chevron">▸</span>
          {renaming ? (
            <input
              className="lname-input"
              autoFocus
              value={draftName}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setDraftName(layer.name ?? ""); setRenaming(false); }
              }}
            />
          ) : (
            <span title={(layer.name || layer.role) + " — double-click to rename"}
              onDoubleClick={(e) => { e.stopPropagation(); setDraftName(layer.name ?? ""); setRenaming(true); }}>
              {layer.name ? layer.name : layer.role} <span className="tag">({layer.role})</span>
            </span>
          )}
        </span>
        <div className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn small" title="Bring forward (on top of the layer above)"
            disabled={!canMoveUp} onClick={() => onMove?.(1)}>↑</button>
          <button className="btn small" title="Send backward (behind the layer below)"
            disabled={!canMoveDown} onClick={() => onMove?.(-1)}>↓</button>
          <button className="btn small" title="Copy this element's motion + style (not its text)"
            onClick={() => onCopy(clipFromLayer(layer))}>Copy</button>
          <button className="btn small" title="Paste copied motion + style onto this element (its text is untouched)"
            disabled={!clip} onClick={() => clip && onChange((l) => applyClip(l, clip))}>Paste</button>
          <button className="btn small" title="Delete this layer" onClick={onDelete}>✕</button>
        </div>
      </div>

      {!expanded && (
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {layer.entrance !== "none" || (layer.exit && layer.exit !== "none")
            ? `${layer.entrance}${layer.exit && layer.exit !== "none" ? ` → ${layer.exit}` : ""}`
            : "no motion set"}
        </p>
      )}

      {expanded && (
      <>
      {isPhotoSlot && onUploadPhoto && (
        <div className="card compact group" style={{ marginTop: 8 }}>
          <div className="subhead">Photo</div>
          <button className={"btn upload small" + (layer.assetKind ? " filled" : "")} style={{ width: "100%" }}
            onClick={() => photoInput.current?.click()}>
            {layer.assetKind ? "Replace photo/video" : "Upload photo/video"}
          </button>
          <input ref={photoInput} className="hidden-file" type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.webm,.mov,.mp4"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.target.value = ""; }} />
          {layer.assetKind && (
            <>
              <div className="row between mini" style={{ marginTop: 6 }}>
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
              <div className="row between mini" style={{ marginTop: 4, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }} title="Cover fills the frame (crops mismatched aspect ratios); contain shows the whole photo (may letterbox).">Fit</span>
                <select value={layer.fit ?? "cover"} style={{ width: "auto" }}
                  onChange={(e) => onChange((l) => { l.fit = e.target.value as any; })}>
                  <option value="cover">cover (fill, may crop)</option>
                  <option value="contain">contain (whole photo, may letterbox)</option>
                </select>
              </div>
            </>
          )}
          <div className="mini" style={{ marginTop: 4 }}>
            <label>Photo motion (inside the frame)</label>
            <select value={layer.photoMotion ?? "none"}
              onChange={(e) => onChange((l) => { l.photoMotion = e.target.value as any; })}>
              {AMBIENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      )}

      {isTextLayer && (
        <div className="card compact group" style={{ marginTop: 8 }}>
          <div className="subhead">Text</div>
          <textarea dir={layer.direction ?? "rtl"}
            placeholder={(layer.direction ?? "rtl") === "ltr" ? "Text…" : "متن فارسی…"}
            value={layer.text ?? ""}
            onChange={(e) => onChange((l) => { l.text = e.target.value; })} />
          <div className="grid2 mini" style={{ marginTop: 6 }}>
            <div><label>Font</label>
              <select value={currentEntry?.family ?? ""}
                onChange={(e) => {
                  const fam = e.target.value;
                  if (!fam) { onSelectFont?.(null); return; }
                  const first = families.get(fam)?.[0] ?? null;
                  onSelectFont?.(first);
                }}>
                <option value="">System default</option>
                {Array.from(families.keys()).map((fam) => <option key={fam} value={fam}>{fam}</option>)}
              </select></div>
            <div><label>Style</label>
              <select value={currentEntry?.id ?? ""} disabled={!currentEntry}
                onChange={(e) => {
                  const entry = currentFamilyVariants.find((v) => v.id === e.target.value) ?? null;
                  onSelectFont?.(entry);
                }}>
                {currentFamilyVariants.map((v) => <option key={v.id} value={v.id}>{v.style}</option>)}
              </select></div>
          </div>
          {!addingFont ? (
            <button className="btn small" style={{ width: "100%", marginTop: 6 }} onClick={() => setAddingFont(true)}>
              + Upload a new font
            </button>
          ) : (
            <div className="card compact" style={{ marginTop: 6 }}>
              <div className="grid2 mini">
                <div><label>Family name</label>
                  <input type="text" value={newFamily} placeholder="e.g. Vazirmatn"
                    onChange={(e) => setNewFamily(e.target.value)} /></div>
                <div><label>Style</label>
                  <select value={newStyle} onChange={(e) => setNewStyle(e.target.value)}>
                    {["Regular", "Bold", "Italic", "Bold Italic", "Light", "Medium", "SemiBold", "Black"].map((s) =>
                      <option key={s} value={s}>{s}</option>)}
                  </select></div>
              </div>
              <input ref={newFontInput} className="hidden-file" type="file" accept=".ttf,.otf,.woff,.woff2"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && onUploadNewFont && newFamily.trim()) onUploadNewFont(f, newFamily.trim(), newStyle);
                  e.target.value = "";
                  setAddingFont(false); setNewFamily("");
                }} />
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <button className="btn small primary" disabled={!newFamily.trim()}
                  onClick={() => newFontInput.current?.click()}>Choose file…</button>
                <button className="btn small" onClick={() => setAddingFont(false)}>Cancel</button>
              </div>
            </div>
          )}
          <div className="grid3 mini" style={{ marginTop: 4 }}>
            <div><label>Size</label>
              <input type="number" min={8} value={layer.fontSize ?? 48}
                onChange={(e) => onChange((l) => { l.fontSize = Math.max(8, Math.round(parseFloat(e.target.value || "48"))); })} /></div>
            <div style={{ gridColumn: "span 2" }}><label>Color</label>
              <ColorField value={layer.textColor ?? "#1a1a1a"}
                onChange={(hex) => onChange((l) => { l.textColor = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} /></div>
          </div>
          <div className="grid3 mini" style={{ marginTop: 4 }}>
            {/* Text align: where the TEXT sits inside its own box (CSS
                text-align). Not the same as Box align below — deliberately
                different icon style so the two are never confused. */}
            <div><label>Text align</label>
              <div className="segmented">
                {(["left", "center", "right"] as const).map((a) => {
                  const active = (layer.textAlign ?? "right") === a;
                  return (
                    <button key={a} className={"btn small icon" + (active ? " active" : "")}
                      title={`Align text ${a}`} aria-label={`Align text ${a}`} aria-pressed={active}
                      onClick={() => onChange((l) => { l.textAlign = a; })}>
                      <AlignTextIcon align={a} />
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Box align: snaps the text box itself to the frame (like
                Illustrator's align-to-artboard) — a one-off action, not a
                stored state, so no button stays "pressed". */}
            <div><label title="Snaps this text box to the frame — not the text alignment on the left">Box align</label>
              {/* Horizontal (left/center/right, against canvas width) */}
              <div className="row" style={{ gap: 4 }}>
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} className="btn small icon"
                    title={`Align box to the ${a} of the frame`} aria-label={`Align text box to the ${a} of the frame`}
                    onClick={() => onChange((l) => {
                      l.left = a === "left" ? 0 : a === "right" ? canvas[0] - l.width : Math.round((canvas[0] - l.width) / 2);
                    })}>
                    <AlignBoxIcon align={a} />
                  </button>
                ))}
              </div>
              {/* Vertical (top/middle/bottom, against canvas height) — same
                  one-off "snap it there" behavior, just the other axis. */}
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                {(["top", "middle", "bottom"] as const).map((a) => (
                  <button key={a} className="btn small icon"
                    title={`Align box to the ${a} of the frame`} aria-label={`Align text box to the ${a} of the frame`}
                    onClick={() => onChange((l) => {
                      l.top = a === "top" ? 0 : a === "bottom" ? canvas[1] - l.height : Math.round((canvas[1] - l.height) / 2);
                    })}>
                    <AlignBoxIconV align={a} />
                  </button>
                ))}
              </div>
            </div>
            <div><label>Direction</label>
              <div className="segmented">
                {(["rtl", "ltr"] as const).map((d) => {
                  const active = (layer.direction ?? "rtl") === d;
                  return (
                    <button key={d} className={"btn small icon" + (active ? " active" : "")}
                      title={d === "rtl" ? "RTL (Farsi/Arabic)" : "LTR (English/Latin)"}
                      aria-label={d === "rtl" ? "Right-to-left direction (Farsi/Arabic)" : "Left-to-right direction (English/Latin)"}
                      aria-pressed={active}
                      onClick={() => onChange((l) => { l.direction = d; })}>
                      <DirectionIcon dir={d} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card compact group" style={{ marginTop: 8 }}>
        <div className="subhead">Effects</div>

        {/* Motion presets — same MotionClip shape as Copy/Paste above, but
            named and saved server-side, so it's reusable in OTHER projects
            too, not just pasted around within this one session. An inline
            name field (not window.prompt, which is easy to mistake for
            "nothing happened") and a visible named list (not a hidden
            dropdown) so it's obvious where a saved preset lives and how to
            reuse it. */}
        {onSaveMotionPreset && (
          <div className="mini" style={{ marginBottom: 8 }}>
            <label>Motion presets (reusable across projects)</label>
            {!savingPreset ? (
              <button className="btn small" onClick={() => setSavingPreset(true)}>Save current as preset…</button>
            ) : (
              <div className="row" style={{ gap: 4 }}>
                <input type="text" autoFocus placeholder="Preset name" value={presetName} style={{ flex: 1 }}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSavePreset();
                    if (e.key === "Escape") { setSavingPreset(false); setPresetName(""); }
                  }} />
                <button className="btn small primary" disabled={!presetName.trim()} onClick={commitSavePreset}>Save</button>
                <button className="btn small" onClick={() => { setSavingPreset(false); setPresetName(""); }}>Cancel</button>
              </div>
            )}
            {/* Built-ins always show up first, ahead of whatever's saved to
                this machine — they ship in source (not the gitignored
                presets data file), so no delete button on them. */}
            <div className="preset-list">
              {[...BUILT_IN_PRESETS, ...(motionPresets ?? [])].map((p) => {
                const builtin = p.id.startsWith("builtin-");
                return (
                  <div key={p.id} className="row between preset-row">
                    <span className="preset-name" title={p.name}>
                      {p.name}{builtin && <span className="tag" style={{ marginLeft: 4 }}>built-in</span>}
                    </span>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn small" title={`Apply "${p.name}" to this element`}
                        onClick={() => onChange((l) => applyClip(l, p.clip))}>Apply</button>
                      {!builtin && onDeleteMotionPreset && (
                        <button className="btn small" title={`Delete "${p.name}"`}
                          onClick={() => onDeleteMotionPreset(p.id)}>✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <FxSlots
          label="IN effect (combine up to 3)"
          options={inOptions}
          values={[layer.entrance, layer.entrance2, layer.entrance3]}
          disabled={layer.entrance === "wordReveal" || layer.entrance === "lineReveal"}
          onChangeSlot={(i, v) => onChange((l) => {
            if (i === 0) l.entrance = v as any;
            else if (i === 1) l.entrance2 = v as any;
            else l.entrance3 = v as any;
          })}
          onAdd={() => onChange((l) => {
            if (!l.entrance2) l.entrance2 = inOptions[0] as any;
            else l.entrance3 = inOptions[0] as any;
          })}
          onRemove={(i) => onChange((l) => {
            if (i === 1) { l.entrance2 = undefined; l.entrance3 = undefined; }
            else l.entrance3 = undefined;
          })}
        />
        <FxSlots
          label="OUT effect (combine up to 3)"
          options={EXIT_NAMES}
          values={[layer.exit ?? "none", layer.exit2, layer.exit3]}
          disabled={(layer.exit ?? "none") === "none"}
          onChangeSlot={(i, v) => onChange((l) => {
            if (i === 0) l.exit = v as any;
            else if (i === 1) l.exit2 = v as any;
            else l.exit3 = v as any;
          })}
          onAdd={() => onChange((l) => {
            if (!l.exit2) l.exit2 = EXIT_NAMES[0] as any;
            else l.exit3 = EXIT_NAMES[0] as any;
          })}
          onRemove={(i) => onChange((l) => {
            if (i === 1) { l.exit2 = undefined; l.exit3 = undefined; }
            else l.exit3 = undefined;
          })}
        />
        <div className="grid2 mini" style={{ marginTop: 4 }}>
          <div><label>IN easing</label>
            <select value={layer.entranceEasing ?? ""} title="Auto = a curve chosen to fit the IN effect"
              onChange={(e) => onChange((l) => { l.entranceEasing = e.target.value === "" ? undefined : e.target.value as any; })}>
              <option value="">(auto)</option>
              {EASINGS.map((en) => <option key={en} value={en}>{en}</option>)}
            </select></div>
          <div><label>OUT easing</label>
            <select value={layer.exitEasing ?? ""} title="Auto = a curve chosen to fit the OUT effect"
              disabled={(layer.exit ?? "none") === "none"}
              onChange={(e) => onChange((l) => { l.exitEasing = e.target.value === "" ? undefined : e.target.value as any; })}>
              <option value="">(auto)</option>
              {EASINGS.map((en) => <option key={en} value={en}>{en}</option>)}
            </select></div>
        </div>
      </div>

      <div className="card compact group" style={{ marginTop: 8 }}>
        <div className="subhead">Keyframes</div>
        <div className="grid2 mini">
          <div><label>in delay (s) &mdash; when it starts</label>
            <input type="number" step={0.1} min={0} value={sec(layer.delay)}
              onChange={(e) => onChange((l) => { l.delay = toFr(e.target.value); })} /></div>
          <div><label>in dur (s)</label>
            {/* spring() throws outright at durationInFrames 0 (unlike delay/out
                dur, which are safe at 0) — DurationPresetField already floors
                at 1 frame so this can't crash the player. */}
            <DurationPresetField value={layer.inDuration} fallback={26}
              onChange={(frames) => onChange((l) => { l.inDuration = frames; })} /></div>
        </div>
        <div className="grid2 mini" style={{ marginTop: 4 }}>
          <div><label>out at (s) &mdash; blank = end of page</label>
            {/* A bare number input relying on the user backspacing it fully
                empty is unreliable in practice (selecting-all + deleting a
                <input type="number"> doesn't always land on "" the way it
                does for text inputs) — this ✕ is a guaranteed one-click way
                back to "auto" instead of fighting the field's own text
                selection. */}
            <div className="row" style={{ gap: 4 }}>
              <input type="number" step={0.1} min={0} value={layer.outDelay != null ? sec(layer.outDelay) : ""}
                placeholder="auto"
                disabled={(layer.exit ?? "none") === "none"}
                style={{ flex: 1 }}
                onChange={(e) => onChange((l) => {
                  l.outDelay = e.target.value === "" ? undefined : toFr(e.target.value);
                })} />
              <button className="btn small" title="Reset to auto (end of page)"
                disabled={(layer.exit ?? "none") === "none" || layer.outDelay == null}
                onClick={() => onChange((l) => { l.outDelay = undefined; })}>✕</button>
            </div></div>
          <div><label>out dur (s)</label>
            {/* Same interpolate()-needs-a-real-range crash as in dur — with an
                explicit out delay this boundary is now always reachable
                mid-page, not just coincidentally safe at 0 like before.
                DurationPresetField already floors at 1 frame. */}
            <DurationPresetField value={layer.outDuration} fallback={24}
              disabled={(layer.exit ?? "none") === "none"}
              onChange={(frames) => onChange((l) => { l.outDuration = frames; })} /></div>
        </div>
        <div className="mini" style={{ marginTop: 4 }}>
          <label title="How much of the PAGE's own ambient motion (set on the Page tab, e.g. kenburns/sway) this layer follows. 1 = moves with it normally, 0 = stays still while everything else drifts, below 1 = drifts slower (background feel), above 1 = drifts more (foreground feel). No effect if the page's ambient is “none”.">
            Parallax depth (page ambient)
          </label>
          <input type="number" step={0.1} min={0} value={layer.parallaxDepth ?? 1}
            onChange={(e) => onChange((l) => { l.parallaxDepth = Math.max(0, parseFloat(e.target.value || "1")); })} />
        </div>
      </div>
      </>
      )}
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
  onAddPhoto: () => void;
  onDeleteLayer: (layerIndex: number) => void;
  fonts: FontEntry[];
  onSelectFont: (layerIndex: number, entry: FontEntry | null) => void;
  onUploadNewFont: (layerIndex: number, file: File, family: string, style: string) => void;
  swatches: string[];
  onAddSwatch: (hex: string) => void;
  onRemoveSwatch: (hex: string) => void;
  motionPresets: MotionPresetEntry[];
  onSaveMotionPreset: (name: string, clip: MotionClip) => void;
  onDeleteMotionPreset: (id: string) => void;
}> = ({ page, canvas, clip, onCopyClip, onChange, onUploadPhoto, onAddText, onAddPhoto, onDeleteLayer, fonts, onSelectFont, onUploadNewFont, swatches, onAddSwatch, onRemoveSwatch, motionPresets, onSaveMotionPreset, onDeleteMotionPreset }) => {
  // Duration/bg/ambient/transition/subtitle vs. the layer list were one long
  // stacked scroll before — split so each is reachable without scrolling
  // past the other. Resets to "Page" on every page switch (this component
  // remounts per page.id at its call site), which is the more useful default
  // — you land on a newly-selected page's own settings, not wherever the
  // last page's tab happened to be.
  const [tab, setTab] = React.useState<"page" | "elements">("page");
  return (
    <div>
      <h1 title={page.id}>Page: {page.name ?? page.id}</h1>

      <div className="tabs">
        <button className={"tab" + (tab === "page" ? " active" : "")} onClick={() => setTab("page")}>Page</button>
        <button className={"tab" + (tab === "elements" ? " active" : "")} onClick={() => setTab("elements")}>
          Elements{page.layers.length > 0 ? ` (${page.layers.length})` : ""}
        </button>
      </div>

      {tab === "page" && (
        <>
          <label>Duration (seconds)</label>
          <input type="number" min={1} step={0.5}
            value={+(page.durationInFrames / 30).toFixed(2)}
            onChange={(e) => onChange((pg) => {
              // Remotion's <TransitionSeries.Sequence> throws outright at 0 (and
              // presumably chokes on negative) — clamp to at least 1 frame so a
              // stray "0" in this field can't crash the whole player.
              pg.durationInFrames = Math.max(1, Math.round(parseFloat(e.target.value || "1") * 30));
            })} />

          <div>
            <label style={{ margin: "10px 0 4px" }}>Background color (this page only — empty follows the project's)</label>
            <div className="row" style={{ gap: 4 }}>
              <ColorField value={page.bgColor ?? "#e8e4dd"}
                onChange={(hex) => onChange((pg) => { pg.bgColor = hex; })}
                swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch} />
              {page.bgColor && (
                <button className="btn small" title="Clear — follow the project's backdrop color instead"
                  onClick={() => onChange((pg) => { pg.bgColor = undefined; })}>✕</button>
              )}
            </div>
          </div>

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
        </>
      )}

      {tab === "elements" && (
        <>
          <div className="row between" style={{ alignItems: "center" }}>
            <h2 style={{ margin: 0, border: "none", padding: 0 }}>Element motion (in / out)</h2>
            <button className="btn small" disabled={!clip}
              title="Paste the copied motion + style onto every element on this page (text untouched)"
              onClick={() => onChange((pg) => { pg.layers.forEach((l) => applyClip(l, clip!)); })}>
              Paste to all
            </button>
          </div>
          <div className="row" style={{ gap: 6, marginTop: 10, marginBottom: 8 }}>
            <button className="btn small" style={{ flex: 1 }} onClick={onAddPhoto}>+ Add photo</button>
            <button className="btn small" style={{ flex: 1 }} onClick={onAddText}>+ Add text</button>
          </div>
          {/* Rendered top-to-bottom = front-to-back (Photoshop/Figma convention)
              — reverses the DISPLAY order only; `li` stays the real array index
              so every callback still targets the right layer regardless of
              where it's drawn in this list. */}
          {page.layers.map((l, li) => (
            <ElementMotion key={l.index} layer={l} clip={clip} onCopy={onCopyClip}
              onChange={(fn) => onChange((pg) => fn(pg.layers[li]))}
              onMove={(dir) => onChange((pg) => {
                const j = li + dir;
                if (j < 0 || j >= pg.layers.length) return;
                [pg.layers[li], pg.layers[j]] = [pg.layers[j], pg.layers[li]];
              })}
              canMoveUp={li < page.layers.length - 1}
              canMoveDown={li > 0}
              onUploadPhoto={(file) => onUploadPhoto(li, file)}
              fonts={fonts}
              onSelectFont={(entry) => onSelectFont(li, entry)}
              onUploadNewFont={(file, family, style) => onUploadNewFont(li, file, family, style)}
              swatches={swatches} onAddSwatch={onAddSwatch} onRemoveSwatch={onRemoveSwatch}
              motionPresets={motionPresets} onSaveMotionPreset={onSaveMotionPreset} onDeleteMotionPreset={onDeleteMotionPreset}
              canvas={canvas}
              onDelete={() => onDeleteLayer(li)} />
          )).reverse()}
          <p className="hint">Fixed chrome, logo, loader and the subtitle zone are not listed — they are handled separately and don't get page motion.</p>
        </>
      )}
    </div>
  );
};
