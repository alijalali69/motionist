import React from "react";
import {
  listProjects, createProject, deleteProject, type ProjectSummary,
  listFonts, uploadFontToLibrary, deleteFont, type FontEntry,
} from "./api";

const FONT_STYLES = [
  "Regular", "Bold", "Italic", "Bold Italic",
  "Thin", "ExtraLight", "Light", "Medium", "SemiBold", "ExtraBold", "Black",
];

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

  const onFile = async (file: File) => {
    const guess = family.trim() || file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    setBusy(true); setErr(null);
    try {
      await uploadFontToLibrary(file, guess, style);
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
        <input ref={fileRef} className="hidden-file" type="file" accept=".ttf,.otf,.woff,.woff2"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn upload" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={onPick}>
          {busy ? "Uploading…" : "+ Upload font file (.ttf/.otf/.woff/.woff2)"}
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
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(() => {
    listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => { if (creating) nameInputRef.current?.focus(); }, [creating]);

  const submitCreate = async () => {
    const name = newName.trim() || "Untitled reel";
    setBusy(true); setErr(null);
    try {
      const project = await createProject(name);
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
          <h1 className="dash-title">Motionist</h1>
          <p className="dash-sub">Your reel projects</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setManagingFonts(true)}>🔤 Fonts</button>
          <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
        </div>
      </div>

      {managingFonts && <FontManager onClose={() => setManagingFonts(false)} />}

      {projects === null && <p className="sub" style={{ padding: "40px 0" }}>Loading…</p>}

      {projects && projects.length === 0 && (
        <div className="dash-empty">
          <div className="dash-empty-icon">🎬</div>
          <h2>No projects yet</h2>
          <p className="sub">Create your first project to start turning a PSD/SVG design into a reel.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
        </div>
      )}

      {projects && projects.length > 0 && (
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
