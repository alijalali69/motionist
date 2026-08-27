// Runs in Motionist's own page (loaded via loadURL in main.js), with a
// Chrome-extension-style sandbox in front of it — this is the ONLY bridge
// between that page and Resolve. Exposes exactly one thing: a way to hand a
// freshly-rendered file over to be added to the Media Pool. Everywhere else
// (a normal browser tab, with no preload script), `window.motionistResolveBridge`
// is simply undefined — app/src/api.ts checks for it and no-ops when it's not
// there, so Motionist's own code runs unmodified in both places.
const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("motionistResolveBridge", {
  // absPath: absolute filesystem path to the just-finished render (mp4/webm).
  onRendered: (absPath) => ipcRenderer.invoke("motionist:onRendered", absPath),
});
