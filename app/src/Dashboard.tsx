import React from "react";
import {
  listProjects, createProject, deleteProject, type ProjectSummary,
  listFonts, uploadFontToLibrary, deleteFont, type FontEntry,
  listSizePresets, saveSizePreset, deleteSizePreset, type SizePresetEntry,
} from "./api";
import { NumField } from "./NumField";

const FONT_STYLES = [
  "Regular", "Bold", "Italic", "Bold Italic",
  "Thin", "ExtraLight", "Light", "Medium", "SemiBold", "ExtraBold", "Black",
];

// Canvas-size presets for the "New project" dialog. Pixel dimensions match
// each platform's own published spec, not a guess. `short` is just for the
// dashboard's size-card row — `label` (the long form) is what the New
// project dialog's own <select> still shows.
const SIZE_PRESETS: { label: string; short: string; w: number; h: number }[] = [
  { label: "Instagram / TikTok Reels, Stories (9:16)", short: "Reels / TikTok", w: 1080, h: 1920 },
  { label: "YouTube Shorts (9:16)", short: "YouTube Shorts", w: 1080, h: 1920 },
  { label: "Instagram feed, square (1:1)", short: "Feed, square", w: 1080, h: 1080 },
  { label: "Instagram feed, portrait (4:5)", short: "Feed, portrait", w: 1080, h: 1350 },
  { label: "YouTube standard, landscape (16:9)", short: "YouTube landscape", w: 1920, h: 1080 },
];

// A small outline box in the preset's own aspect ratio — capped to a 40px
// bounding square so portrait/square/landscape presets read as visibly
// different shapes at a glance, not just different caption text.
const SizeShape: React.FC<{ w: number; h: number }> = ({ w, h }) => {
  const max = 40;
  const ratio = w / h;
  const boxW = ratio >= 1 ? max : Math.round(max * ratio);
  const boxH = ratio >= 1 ? Math.round(max / ratio) : max;
  return <div className="size-shape" style={{ width: boxW, height: boxH }} />;
};

// Guesses a variant's style from its filename — e.g. "Vazirmatn-Bold.ttf" ->
// "Bold" — so selecting a whole family's files at once (Regular + Bold +
// Italic + …) doesn't need one upload round-trip per file with the style
// picked by hand each time.
function guessStyleFromName(fileName: string): string {
  const n = fileName.toLowerCase();
  const has = (s: string) => n.includes(s);
  if (has("bold") && (has("italic") || has("oblique"))) return "Bold Italic";
  if (has("extrabold") || has("extra bold") || has("extra-bold")) return "ExtraBold";
  if (has("semibold") || has("semi bold") || has("semi-bold")) return "SemiBold";
  if (has("extralight") || has("extra light") || has("extra-light")) return "ExtraLight";
  if (has("black") || has("heavy")) return "Black";
  if (has("bold")) return "Bold";
  if (has("italic") || has("oblique")) return "Italic";
  if (has("light")) return "Light";
  if (has("medium")) return "Medium";
  if (has("thin") || has("hairline")) return "Thin";
  return "Regular";
}

// Strips recognized style words out of a filename to guess the shared family
// name for a batch, e.g. "Vazirmatn-Bold.ttf" -> "Vazirmatn".
function guessFamilyFromName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base
    .replace(/extra[\s-]?bold|semi[\s-]?bold|extra[\s-]?light|bold[\s-]?italic|regular|bold|italic|oblique|light|medium|black|heavy|thin|hairline/gi, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned || base;
}

// Uploaded once here, reusable by every project afterward — a text layer in
// the editor picks [family] then [style] from whatever's been added here,
// instead of re-uploading the same font file per project.
const FontManager: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [fonts, setFonts] = React.useState<FontEntry[] | null>(null);
  const [family, setFamily] = React.useState("");
  const [style, setStyle] = React.useState("Regular");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(() => {
    listFonts().then(setFonts).catch(() => setFonts([]));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const onPick = () => fileRef.current?.click();

  // One file -> uses the Style dropdown as-is (you're adding a single
  // variant). Multiple files at once -> treated as a whole family: every
  // file shares the same family name, and each one's style is guessed from
  // its own filename instead of the shared dropdown.
  const onFiles = async (files: FileList) => {
    const arr = Array.from(files);
    const isBatch = arr.length > 1;
    const fam = family.trim() || guessFamilyFromName(arr[0].name);
    setBusy(true); setErr(null);
    try {
      for (const file of arr) {
        const st = isBatch ? guessStyleFromName(file.name) : style;
        await uploadFontToLibrary(file, fam, st);
      }
      setFamily("");
      refresh();
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const grouped = React.useMemo(() => {
    const byFamily = new Map<string, FontEntry[]>();
    (fonts ?? []).forEach((f) => {
      if (!byFamily.has(f.family)) byFamily.set(f.family, []);
      byFamily.get(f.family)!.push(f);
    });
    return Array.from(byFamily.entries());
  }, [fonts]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Fonts</h2>
        <p className="sub" style={{ marginTop: -8 }}>
          Upload once here — every project can then pick it from a Font / Style dropdown.
        </p>

        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label>Family name</label>
            <input type="text" value={family} placeholder="e.g. Vazirmatn"
              onChange={(e) => setFamily(e.target.value)} />
          </div>
          <div>
            <label>Style</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {FONT_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>
          Style above is only used for a single file — select several files at once to upload a whole family, and each variant's style is guessed from its filename (e.g. "…-Bold.ttf").
        </p>
        <input ref={fileRef} className="hidden-file" type="file" accept=".ttf,.otf,.woff,.woff2" multiple
          onChange={(e) => e.target.files?.length && onFiles(e.target.files)} />
        <button className="btn upload" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={onPick}>
          {busy ? "Uploading…" : "+ Upload font file(s) (.ttf/.otf/.woff/.woff2)"}
        </button>
        {err && <p className="err">{err}</p>}

        <div style={{ marginTop: 16, maxHeight: 280, overflowY: "auto" }}>
          {grouped.length === 0 && <p className="sub">No fonts uploaded yet.</p>}
          {grouped.map(([fam, variants]) => (
            <div key={fam} className="card compact" style={{ marginBottom: 8 }}>
              <div className="tag">{fam}</div>
              {variants.map((v) => (
                <div key={v.id} className="row between" style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>{v.style}</span>
                  <button className="btn small danger" onClick={async () => { await deleteFont(v.id); refresh(); }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const Dashboard: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [managingFonts, setManagingFonts] = React.useState(false);
  const [sizeIdx, setSizeIdx] = React.useState(0); // index into SIZE_PRESETS, or -1 for custom (customW/customH)
  const [customW, setCustomW] = React.useState(1080);
  const [customH, setCustomH] = React.useState(1920);
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  // Custom size presets, saved once from the "+ Custom size" card, reusable
  // afterward as their own card — same reusable-library pattern as the
  // motion presets in the editor. Kept separate from the "creating" flow's
  // own customW/customH (which is just "whatever size is chosen right now,
  // preset or not") so defining a new one doesn't get tangled with picking
  // an existing one.
  const [customSizes, setCustomSizes] = React.useState<SizePresetEntry[] | null>(null);
  const [addingCustomSize, setAddingCustomSize] = React.useState(false);
  const [csW, setCsW] = React.useState(1080);
  const [csH, setCsH] = React.useState(1920);
  const [csName, setCsName] = React.useState("");
  const [csBusy, setCsBusy] = React.useState(false);
  const [csErr, setCsErr] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  const refreshSizes = React.useCallback(() => {
    listSizePresets().then(setCustomSizes).catch(() => setCustomSizes([]));
  }, []);

  React.useEffect(() => { refresh(); refreshSizes(); }, [refresh, refreshSizes]);
  React.useEffect(() => { if (creating) nameInputRef.current?.focus(); }, [creating]);

  // Chosen once (a card, or the custom-size form) → opens the name-only
  // "New project" dialog with the size already decided.
  const startCreate = (width: number, height: number, presetIdx: number) => {
    setSizeIdx(presetIdx);
    setCustomW(width);
    setCustomH(height);
    setCreating(true);
  };

  const submitCustomSize = async () => {
    const w = Math.max(16, Math.min(8192, Math.round(csW) || 1080));
    const h = Math.max(16, Math.min(8192, Math.round(csH) || 1920));
    setCsBusy(true); setCsErr(null);
    try {
      if (csName.trim()) {
        const entry = await saveSizePreset(csName.trim(), w, h);
        setCustomSizes((list) => [...(list ?? []), entry]);
      }
      setAddingCustomSize(false);
      setCsName("");
      startCreate(w, h, -1);
    } catch (e: any) {
      setCsErr(String(e.message || e));
    } finally {
      setCsBusy(false);
    }
  };

  const doDeleteSize = async (id: string) => {
    await deleteSizePreset(id);
    setCustomSizes((list) => (list ?? []).filter((s) => s.id !== id));
  };

  const submitCreate = async () => {
    const name = newName.trim() || "Untitled reel";
    const preset = SIZE_PRESETS[sizeIdx];
    const width = preset ? preset.w : customW;
    const height = preset ? preset.h : customH;
    setBusy(true); setErr(null);
    try {
      const project = await createProject(name, width, height);
      setCreating(false);
      setNewName("");
      onOpen(project.projectId);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    try { await deleteProject(id); setConfirmDelete(null); refresh(); }
    finally { setBusy(false); }
  };

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <div className="brand-lockup">
            <img src="/brand/motionist-icon.svg" alt="" className="brand-icon" />
            <h1 className="dash-title">Motionist</h1>
          </div>
          <p className="dash-sub">Motion with freedom &middot; your reel projects</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setManagingFonts(true)}>🔤 Fonts</button>
          <button className="btn primary" onClick={() => startCreate(SIZE_PRESETS[0].w, SIZE_PRESETS[0].h, 0)}>+ New project</button>
        </div>
      </div>

      {managingFonts && <FontManager onClose={() => setManagingFonts(false)} />}

      <div className="section-label">Start a new project</div>
      <div className="size-preset-row">
        {SIZE_PRESETS.map((s, i) => (
          <button key={s.short} className="size-preset-card"
            onClick={() => startCreate(s.w, s.h, i)}>
            <SizeShape w={s.w} h={s.h} />
            <span className="size-preset-name">{s.short}</span>
            <span className="size-preset-dims">{s.w} × {s.h}</span>
          </button>
        ))}
        {(customSizes ?? []).map((s) => (
          <button key={s.id} className="size-preset-card custom"
            onClick={() => startCreate(s.w, s.h, -1)}>
            <span className="size-preset-del" title={`Remove "${s.name}" preset`}
              onClick={(e) => { e.stopPropagation(); doDeleteSize(s.id); }}>✕</span>
            <SizeShape w={s.w} h={s.h} />
            <span className="size-preset-name">{s.name}</span>
            <span className="size-preset-dims">{s.w} × {s.h}</span>
          </button>
        ))}
        <button className="size-preset-card add" onClick={() => setAddingCustomSize(true)}>
          <span className="size-preset-add-icon">+</span>
          <span className="size-preset-name">Custom size</span>
        </button>
      </div>

      {addingCustomSize && (
        <div className="modal-backdrop" onClick={() => !csBusy && setAddingCustomSize(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Custom size</h2>
            <div className="grid2 mini">
              <div><label>Width</label>
                <NumField min={16} max={8192} value={csW} autoFocus
                  onChange={(e) => setCsW(Math.round(Number(e.target.value) || 1080))} /></div>
              <div><label>Height</label>
                <NumField min={16} max={8192} value={csH}
                  onChange={(e) => setCsH(Math.round(Number(e.target.value) || 1920))} /></div>
            </div>
            <label style={{ marginTop: 10 }}>Save as a preset (optional) — leave blank to just use it once</label>
            <input type="text" value={csName} placeholder="e.g. Podcast clip"
              onChange={(e) => setCsName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCustomSize(); if (e.key === "Escape") setAddingCustomSize(false); }} />
            {csErr && <p className="err">{csErr}</p>}
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn" disabled={csBusy} onClick={() => setAddingCustomSize(false)}>Cancel</button>
              <button className="btn primary" disabled={csBusy} onClick={submitCustomSize}>
                {csBusy ? "…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {projects === null && <p className="sub" style={{ padding: "40px 0" }}>Loading…</p>}

      {projects && projects.length === 0 && (
        <div className="dash-empty">
          <div className="dash-empty-icon">🎬</div>
          <h2>No projects yet</h2>
          <p className="sub">Create your first project to start turning a PSD/SVG design into a reel.</p>
          <button className="btn primary" onClick={() => startCreate(SIZE_PRESETS[0].w, SIZE_PRESETS[0].h, 0)}>+ New project</button>
        </div>
      )}

      {projects && projects.length > 0 && (
        <>
        <div className="section-label" style={{ marginTop: 32 }}>Your projects</div>
        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => confirmDelete !== p.id && onOpen(p.id)}>
              <div className="project-thumb">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" />
                ) : (
                  <div className="project-thumb-placeholder">{(p.name || "?").slice(0, 1).toUpperCase()}</div>
                )}
                {confirmDelete !== p.id ? (
                  <button
                    className="thumb-del"
                    title="Delete project"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.id); }}
                  >✕</button>
                ) : (
                  <div className="thumb-confirm" onClick={(e) => e.stopPropagation()}>
                    <span>Delete?</span>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn small danger" disabled={busy} onClick={() => doDelete(p.id)}>Delete</button>
                      <button className="btn small" disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="project-meta">
                <div className="project-name" title={p.name}>{p.name}</div>
                <div className="project-sub">
                  {p.pageCount} page{p.pageCount === 1 ? "" : "s"} · {p.width}×{p.height} · {timeAgo(p.updatedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {creating && (
        <div className="modal-backdrop" onClick={() => !busy && setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>New project</h2>
            <label>Project name</label>
            <input
              ref={nameInputRef}
              type="text"
              value={newName}
              placeholder="e.g. Abbas Mehrpouya reel"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setCreating(false); }}
            />
            {/* Size was already decided by whichever card opened this dialog
                — a read-only confirmation, not another control to fill in. */}
            <p className="sub" style={{ margin: "8px 0 0" }}>
              {(SIZE_PRESETS[sizeIdx]?.w ?? customW)} × {(SIZE_PRESETS[sizeIdx]?.h ?? customH)}
            </p>
            {err && <p className="err">{err}</p>}
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn" disabled={busy} onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={submitCreate}>
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
