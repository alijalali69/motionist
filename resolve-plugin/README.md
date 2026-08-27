# Motionist — DaVinci Resolve plugin

Loads the Motionist reel editor inside DaVinci Resolve Studio (Workspace →
Workflow Integrations), and adds every finished render straight into a
**"Motionist"** bin in the current project's Media Pool — no manual import,
just drag it onto the timeline.

Requires **DaVinci Resolve Studio** (the free version doesn't support
Workflow Integration Plugins) and Motionist's own server/app already running
(`start.bat`, or the autostart setup — this plugin just points a window at
`http://localhost:5173`, it doesn't start that server itself).

## Install

Double-click **`install_resolve_plugin.bat`** (repo root) — copies this
folder into Resolve's plugin directory for you:

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\
```

Restart Resolve. It'll show up under **Workspace → Workflow Integrations →
Motionist**. Re-run the .bat any time this plugin folder changes (an update
just overwrites it).

## How the Media Pool hand-off works

`main.js` loads Motionist's page with `preload.js` attached, which exposes
`window.motionistResolveBridge` to it. Motionist's own frontend
(`app/src/api.ts`) checks for that bridge after every render and, if
present, hands it the rendered file's absolute path — that's the ONLY place
Motionist's code knows or cares that it might be running inside Resolve; in
a normal browser tab the bridge is just `undefined` and nothing happens
differently.

`main.js` then creates (or reuses) a "Motionist" bin at the root of the
Media Pool, adds the file there via `MediaStorage.AddItemListToMediaPool`,
and restores whichever bin/folder was open before — it never disrupts your
own Media Pool navigation.

## Updating

`WorkflowIntegration.node` is Resolve-version-specific — if Resolve updates
its bundled Electron and this plugin stops loading, grab the current one
from Resolve's own installed sample:

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node
```

and drop it in over the one here.
