// ENTRANCE_NAMES/EXIT_NAMES used to be hand-copied here from src/presets.ts
// — that's exactly what silently drifted (24 effects added to presets.ts
// this session were never reachable from this panel, since nothing ever
// re-copied them). They're declared by effect-names.generated.js now,
// loaded as the <script> right before this one in index.html — regenerated
// from presets.ts's own arrays by tools/gen_resolve_effect_list.mjs
// (install_resolve_plugin.bat runs it automatically; `node
// tools/gen_resolve_effect_list.mjs` by hand any other time presets.ts's
// effect lists change).

const clipPicker = document.getElementById("clipPicker");
const clipMeta = document.getElementById("clipMeta");
const textEl = document.getElementById("text");
const statusEl = document.getElementById("status");
const renderBtn = document.getElementById("render");

let clips = [];

function fillSelect(el, names, defaultValue) {
  el.innerHTML = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    if (name === defaultValue) opt.selected = true;
    el.appendChild(opt);
  }
}
fillSelect(document.getElementById("entrance"), ENTRANCE_NAMES, "fade");
fillSelect(document.getElementById("exit"), EXIT_NAMES, "fadeOut");

function setStatus(kind, message) {
  statusEl.className = kind;
  statusEl.textContent = message;
}

function selectedClip() {
  const idx = clipPicker.selectedIndex;
  return idx >= 0 && clips[idx] ? clips[idx] : null;
}

function onClipChange() {
  const clip = selectedClip();
  if (!clip) { renderBtn.disabled = true; clipMeta.textContent = ""; return; }
  renderBtn.disabled = false;
  clipMeta.textContent = `frames ${clip.start}–${clip.end} (${clip.duration} frames)` +
    (clip.hasText ? " · native Text+ title, current text loaded below" : " · not a title — start with your own text");
  textEl.value = clip.hasText && clip.currentText ? clip.currentText : "";
}
clipPicker.addEventListener("change", onClipChange);

async function rescan() {
  setStatus("busy", "Scanning timeline…");
  clipPicker.innerHTML = "<option>Scanning…</option>";
  renderBtn.disabled = true;
  const res = await window.motionistTimeline.scanClips();
  if (!res.ok) {
    setStatus("err", res.error || "Could not scan the timeline.");
    clipPicker.innerHTML = "<option>—</option>";
    return;
  }
  clips = res.clips;
  clipPicker.innerHTML = "";
  if (!clips.length) {
    clipPicker.innerHTML = "<option>No clips found on this timeline</option>";
    statusEl.className = ""; statusEl.textContent = "";
    return;
  }
  for (const clip of clips) {
    const opt = document.createElement("option");
    opt.textContent = `V${clip.trackIndex} · ${clip.name} (${clip.duration}f)` + (clip.hasText ? " ✎" : "");
    clipPicker.appendChild(opt);
  }
  clipPicker.selectedIndex = 0;
  onClipChange();
  statusEl.className = ""; statusEl.textContent = "";
}
document.getElementById("rescan").addEventListener("click", rescan);

async function doRender() {
  const clip = selectedClip();
  if (!clip) return;
  renderBtn.disabled = true;
  setStatus("busy", "Rendering in Motionist…");
  const res = await window.motionistTimeline.renderAndPlace({
    start: clip.start,
    duration: clip.duration,
    text: textEl.value,
    fontFamily: document.getElementById("fontFamily").value,
    fontSize: document.getElementById("fontSize").value,
    textColor: document.getElementById("textColor").value,
    textAlign: document.getElementById("textAlign").value,
    entrance: document.getElementById("entrance").value,
    exit: document.getElementById("exit").value,
  });
  renderBtn.disabled = false;
  if (res.ok) setStatus("ok", "Added to the timeline on the \"Motionist Overlay\" track.");
  else setStatus("err", res.error || "Something went wrong.");
}
renderBtn.addEventListener("click", doRender);

rescan();
