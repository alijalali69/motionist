// Motionist Timeline Text — a second, separate Workflow Integration Plugin
// from com.motionist.reelpanel. That one loads the full Motionist app inside
// Resolve; THIS one has no such window and never touches Motionist's own
// code — it's a small focused panel (index.html) that reads/writes Resolve's
// timeline directly via the Resolve scripting API, and only reaches out to
// Motionist as an HTTP client of its already-existing /api/render, exactly
// the way a normal browser tab would. Motionist itself needs zero changes.
//
// Flow: scan the timeline for text clips -> pick one (or start blank) ->
// edit text/entrance/exit in this panel -> render -> the finished transparent
// WebM gets imported into the Media Pool and placed on a dedicated overlay
// track at the SAME frame the source clip starts at. The source clip is
// never modified or removed.
//
// NOTE: follow Electron's security guide for any changes here:
// https://www.electronjs.org/docs/latest/tutorial/security
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const WorkflowIntegration = require("./WorkflowIntegration.node");

const PLUGIN_ID = "com.motionist.timelinepanel";
const OVERLAY_TRACK_NAME = "Motionist Overlay";
const BIN_NAME = "Motionist";
// Motionist's own server — started separately (start.bat / autostart). This
// plugin only calls its existing render API, the same one a browser tab
// calls; it doesn't start or manage that server.
const MOTIONIST_SERVER = "http://localhost:3001";

let mainWindow = null;
let resolveObj = null;

async function getResolve() {
  if (resolveObj) return resolveObj;
  const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
  if (!ok) {
    console.error("Motionist Timeline plugin: failed to initialize Resolve interface");
    return null;
  }
  resolveObj = await WorkflowIntegration.GetResolve();
  if (!resolveObj) console.error("Motionist Timeline plugin: failed to get Resolve object");
  return resolveObj;
}

async function getCurrentProjectAndTimeline() {
  const resolve = await getResolve();
  if (!resolve) return { error: "Resolve interface not available" };
  const projectManager = await resolve.GetProjectManager();
  const project = projectManager && (await projectManager.GetCurrentProject());
  if (!project) return { error: "No project open in Resolve" };
  const timeline = await project.GetCurrentTimeline();
  if (!timeline) return { error: "No timeline open — open one in the Edit page first" };
  return { resolve, project, timeline };
}

// Finds the TextPlus/Text3D tool inside a timeline item's Fusion comp (if
// any) and reads its current string. Title text lives INSIDE the Fusion
// node graph, not on the timeline item's own properties — there's no
// simpler scriptable path than walking the comp's tools.
//
// Two real bugs fixed here after live testing against actual title clips:
// 1. GetAttrs() takes NO arguments and returns the tool's whole attribute
//    table — it was being called as GetAttrs("TOOLS_RegID") expecting it to
//    filter to one key, which isn't how it works. That silently returned
//    something that could never equal the string "TextPlus"/"Text3D", so
//    this never matched ANY title, ever — the actual root cause of "came
//    back empty" (an empty title text got submitted for every render).
// 2. Resolve's built-in title templates aren't all the same tool type: a
//    3D title uses a flat "TextPlus"/"Text3D" tool with a top-level
//    "StyledText" input, but a MultiText-based title (also common, and
//    also just called "Text" in the UI) nests its content instead, under
//    "Text1.StyledText" — verified live on a real default title.
async function readTitleText(item) {
  const compCount = await item.GetFusionCompCount();
  if (!compCount) return null;
  const comp = await item.GetFusionCompByIndex(1);
  if (!comp) return null;
  const tools = await comp.GetToolList(false);
  if (!tools) return null;
  for (const key of Object.keys(tools)) {
    const tool = tools[key];
    const attrs = tool.GetAttrs ? await tool.GetAttrs() : null;
    const toolType = attrs ? attrs.TOOLS_RegID : null;
    if (toolType !== "TextPlus" && toolType !== "Text3D" && toolType !== "MultiText") continue;
    if (!tool.GetInput) continue;
    let text = await tool.GetInput("StyledText");
    if (typeof text !== "string" || !text) text = await tool.GetInput("Text1.StyledText");
    if (typeof text === "string" && text) return { text, toolName: attrs.TOOLS_Name };
  }
  return null;
}

// Scans every video track's clips, flagging which are native text titles
// (with their current text) vs. everything else (timing only).
async function scanClips() {
  const ctx = await getCurrentProjectAndTimeline();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { timeline } = ctx;

  const trackCount = await timeline.GetTrackCount("video");
  const clips = [];
  for (let trackIndex = 1; trackIndex <= trackCount; trackIndex++) {
    const items = await timeline.GetItemListInTrack("video", trackIndex);
    if (!items) continue;
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const name = await item.GetName();
      const start = await item.GetStart();
      const end = await item.GetEnd();
      let titleInfo = null;
      try { titleInfo = await readTitleText(item); } catch { /* not a title clip, or an odd one — just skip title-reading for it */ }
      clips.push({
        trackIndex, itemIndex, name,
        start, end, duration: end - start,
        hasText: !!titleInfo,
        currentText: titleInfo ? titleInfo.text : null,
      });
    }
  }
  return { ok: true, clips };
}

async function findOrCreateOverlayTrack(timeline) {
  const trackCount = await timeline.GetTrackCount("video");
  for (let i = 1; i <= trackCount; i++) {
    const name = await timeline.GetTrackName("video", i);
    if (name === OVERLAY_TRACK_NAME) return i;
  }
  const added = await timeline.AddTrack("video");
  if (!added) return null;
  const newIndex = await timeline.GetTrackCount("video");
  await timeline.SetTrackName("video", newIndex, OVERLAY_TRACK_NAME);
  return newIndex;
}

// Adds the rendered file to a "Motionist" bin (same convention as the
// com.motionist.reelpanel plugin's bridge) and returns the resulting
// MediaPoolItem, needed to place it on the timeline.
async function importToMotionistBin(resolve, project, absPath) {
  const mediaPool = await project.GetMediaPool();
  const mediaStorage = await resolve.GetMediaStorage();
  if (!mediaPool || !mediaStorage) return null;

  const root = await mediaPool.GetRootFolder();
  const previousFolder = await mediaPool.GetCurrentFolder();

  const list = await root.GetSubFolderList();
  let bin = null;
  if (list) {
    for (const folder of list) {
      if ((await folder.GetName()) === BIN_NAME) { bin = folder; break; }
    }
  }
  if (!bin) bin = await mediaPool.AddSubFolder(root, BIN_NAME);
  if (!bin) return null;

  await mediaPool.SetCurrentFolder(bin);
  const added = await mediaStorage.AddItemListToMediaPool([absPath]);
  if (previousFolder) await mediaPool.SetCurrentFolder(previousFolder);

  return added && added.length ? added[0] : null;
}

function buildEphemeralProject({ text, fontFamily, fontSize, textColor, textAlign, entrance, exit, durationInFrames, fps, width, height }) {
  return {
    fps, width, height,
    projectId: "resolve-timeline-bridge",
    name: "Resolve timeline text",
    template: { layers: [] },
    logo: null,
    bg: null,
    title: null,
    loader: { left: 0, top: 0, width: 0, height: 0 },
    loaderVisible: false,
    subtitle: { left: 0, top: 0, width: 0, height: 0 },
    // The transparent flag Reel.tsx checks for — see src/Reel.tsx and
    // server/index.mjs's /api/render. Same mechanism the app's own
    // "Transparent background" export checkbox uses.
    transparent: true,
    pages: [
      {
        id: "resolve-timeline-page",
        durationInFrames,
        ambient: "none",
        transition: { type: "none", durationInFrames: 0 },
        layers: [
          {
            index: 0,
            file: "",
            role: "text",
            left: 0, top: 0, width, height,
            opacity: 1,
            entrance, delay: 0, inDuration: 26,
            exit, outDuration: 24,
            assetKind: "text",
            text, fontFamily, fontSize, textColor, textAlign,
          },
        ],
      },
    ],
  };
}

function postRender(projectJson) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(projectJson);
    const req = http.request(
      `${MOTIONIST_SERVER}/api/render`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`Motionist render failed (${res.statusCode}): ${data}`));
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function renderAndPlace(_event, params) {
  const ctx = await getCurrentProjectAndTimeline();
  if (ctx.error) return { ok: false, error: ctx.error };
  const { resolve, project, timeline } = ctx;

  const fps = Number(await project.GetSetting("timelineFrameRate")) || 30;
  const width = Number(await project.GetSetting("timelineResolutionWidth")) || 1920;
  const height = Number(await project.GetSetting("timelineResolutionHeight")) || 1080;

  const projectJson = buildEphemeralProject({
    text: params.text ?? "",
    fontFamily: params.fontFamily || "Arial, sans-serif",
    fontSize: Number(params.fontSize) || 64,
    textColor: params.textColor || "#ffffff",
    textAlign: params.textAlign || "left",
    entrance: params.entrance || "fade",
    exit: params.exit || "fadeOut",
    durationInFrames: Math.max(1, Math.round(params.duration)),
    fps, width, height,
  });

  let rendered;
  try {
    rendered = await postRender(projectJson);
  } catch (e) {
    return { ok: false, error: `Render failed: ${e.message || e}` };
  }
  if (!rendered.path) return { ok: false, error: "Render succeeded but returned no file path" };

  const mediaPoolItem = await importToMotionistBin(resolve, project, rendered.path);
  if (!mediaPoolItem) return { ok: false, error: "Rendered, but Resolve rejected adding it to the Media Pool" };

  const overlayTrack = await findOrCreateOverlayTrack(timeline);
  if (!overlayTrack) return { ok: false, error: "Rendered and added to Media Pool, but couldn't create/find the overlay track" };

  const mediaPool = await project.GetMediaPool();
  const appended = await mediaPool.AppendToTimeline([
    {
      mediaPoolItem,
      startFrame: 0,
      endFrame: Math.max(1, Math.round(params.duration)) - 1,
      trackIndex: overlayTrack,
      recordFrame: Math.round(params.start),
    },
  ]);
  if (!appended || !appended.length) {
    return { ok: false, error: "Rendered and added to Media Pool, but placing it on the timeline failed (that spot may already be occupied on the overlay track)" };
  }

  return { ok: true };
}

function registerHandlers() {
  ipcMain.handle("timeline:scanClips", scanClips);
  ipcMain.handle("timeline:renderAndPlace", renderAndPlace);
}

async function cleanupResolveInterface() {
  if (!resolveObj) return;
  WorkflowIntegration.CleanUp();
  resolveObj = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 780,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", () => app.quit());
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  cleanupResolveInterface();
  if (process.platform !== "darwin") app.quit();
});
