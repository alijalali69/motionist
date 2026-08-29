// Runs in this plugin's own index.html (a small purpose-built panel — NOT
// Motionist's own app UI, which stays completely untouched by this plugin).
const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("motionistTimeline", {
  // Scans the current timeline's video tracks for clips, flagging which ones
  // are native Fusion Text+/Text3D titles (with their current text pulled
  // out) vs. everything else (name/timing only, text starts blank).
  scanClips: () => ipcRenderer.invoke("timeline:scanClips"),
  // Renders one page of text through Motionist's own render pipeline
  // (unmodified — this just calls its existing /api/render), then drops the
  // result onto a dedicated overlay track at the source clip's exact frame.
  renderAndPlace: (params) => ipcRenderer.invoke("timeline:renderAndPlace", params),
});
