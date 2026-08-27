// Motionist's Workflow Integration Plugin for DaVinci Resolve Studio.
//
// This is deliberately thin: it opens a normal Electron window pointed at
// Motionist's own dev server (the same app you'd use in a regular browser
// tab), and adds exactly one extra capability on top — when a render
// finishes, the file gets added straight into a "Motionist" bin in the
// current project's Media Pool, so it's ready to drag onto the timeline
// without ever leaving Resolve.
//
// NOTE: follow Electron's security guide for any changes here:
// https://www.electronjs.org/docs/latest/tutorial/security
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const WorkflowIntegration = require("./WorkflowIntegration.node");

const PLUGIN_ID = "com.motionist.reelpanel";
const BIN_NAME = "Motionist";
// Motionist's own dev server — started separately (start.bat / autostart),
// same as when you open it in a regular browser tab. This plugin doesn't
// start or manage that server; it just points a window at it.
const MOTIONIST_URL = "http://localhost:5173";

let mainWindow = null;
let resolveObj = null;

async function getResolve() {
  if (resolveObj) return resolveObj;
  const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
  if (!ok) {
    console.error("Motionist plugin: failed to initialize Resolve interface");
    return null;
  }
  resolveObj = await WorkflowIntegration.GetResolve();
  if (!resolveObj) console.error("Motionist plugin: failed to get Resolve object");
  return resolveObj;
}

async function findSubFolder(parent, name) {
  const list = await parent.GetSubFolderList();
  if (!list) return null;
  for (const folder of list) {
    if ((await folder.GetName()) === name) return folder;
  }
  return null;
}

// Adds one freshly-rendered file to a dedicated "Motionist" bin, creating
// that bin on first use. Restores whatever bin the user had open before
// this ran, so it never disrupts their own Media Pool navigation.
async function addRenderToMediaPool(_event, absPath) {
  const resolve = await getResolve();
  if (!resolve) return { ok: false, error: "Resolve interface not available" };

  const projectManager = await resolve.GetProjectManager();
  const project = projectManager && (await projectManager.GetCurrentProject());
  if (!project) return { ok: false, error: "No project open in Resolve" };

  const mediaPool = await project.GetMediaPool();
  if (!mediaPool) return { ok: false, error: "Could not get Media Pool" };

  const mediaStorage = await resolve.GetMediaStorage();
  if (!mediaStorage) return { ok: false, error: "Could not get Media Storage" };

  const root = await mediaPool.GetRootFolder();
  const previousFolder = await mediaPool.GetCurrentFolder();

  let bin = await findSubFolder(root, BIN_NAME);
  if (!bin) bin = await mediaPool.AddSubFolder(root, BIN_NAME);
  if (!bin) return { ok: false, error: `Could not create "${BIN_NAME}" bin` };

  await mediaPool.SetCurrentFolder(bin);
  const added = await mediaStorage.AddItemListToMediaPool([absPath]);
  if (previousFolder) await mediaPool.SetCurrentFolder(previousFolder);

  if (!added || !added.length) {
    return { ok: false, error: "Resolve did not accept the file (unsupported format, or already in the pool)" };
  }
  return { ok: true };
}

function registerHandlers() {
  ipcMain.handle("motionist:onRendered", addRenderToMediaPool);
}

async function cleanupResolveInterface() {
  if (!resolveObj) return;
  WorkflowIntegration.CleanUp();
  resolveObj = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("close", () => app.quit());
  mainWindow.loadURL(MOTIONIST_URL);
}

app.whenReady().then(() => {
  registerHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  cleanupResolveInterface();
  if (process.platform !== "darwin") app.quit();
});
