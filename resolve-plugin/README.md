# Motionist — DaVinci Resolve plugins

Two separate Workflow Integration Plugins, both requiring **DaVinci Resolve
Studio** (the free version doesn't support Workflow Integration Plugins at
all) and Motionist's own server/app already running (`start.bat`, or the
autostart setup — neither plugin starts that server itself, they just talk
to it, same as a regular browser tab would).

## Install

Double-click **`install_resolve_plugin.bat`** (repo root) — copies both
plugin folders into Resolve's plugin directory for you:

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\
```

Restart Resolve. Both show up under **Workspace → Workflow Integrations**.
Re-run the .bat any time either plugin folder changes (an update just
overwrites them).

## com.motionist.reelpanel — "Motionist"

Loads the full Motionist app inside a Resolve window (same UI as a browser
tab at `http://localhost:5173`), for building a whole reel. Every finished
render is added straight into a **"Motionist"** bin in the current
project's Media Pool — no manual import, drag it onto the timeline
yourself.

`preload.js` exposes `window.motionistResolveBridge` to Motionist's own
page — the ONLY integration point. `app/src/api.ts`'s `renderReel()` checks
for it after a successful render and fires-and-forgets the file's absolute
path if present; plain `undefined` (no-op) in a normal browser tab, so the
same Motionist frontend code runs unmodified in both places.

## com.motionist.timelinepanel — "Motionist Timeline Text"

A separate, much smaller plugin — its own focused panel (`index.html`), not
the Motionist app at all. Built for staying inside Resolve's real timeline
end to end:

1. Scans the current timeline's video tracks for clips. Native Fusion
   Text+/Text3D titles get their current text read out of the Fusion node
   graph (`GetFusionCompByIndex` → find the TextPlus/Text3D tool → its
   `StyledText` input) and pre-filled; anything else (a pre-rendered
   title clip, plain video, whatever) just contributes its name/timing —
   you type the text fresh.
2. Pick a clip, edit the text and a subset of Motionist's entrance/exit
   presets, hit render.
3. That single page gets built into an ephemeral one-page Motionist
   project (matching the real `Project`/`Page` schema in `src/types.ts`)
   and POSTed straight to Motionist's own **already-existing**
   `/api/render` with `transparent: true` — the exact same alpha-export
   path the app's own "Transparent background" checkbox uses. Motionist's
   own code is not touched by any of this.
4. The rendered WebM is added to the same "Motionist" bin, then placed
   on a dedicated **"Motionist Overlay"** video track (created once,
   reused after) at the exact frame the source clip starts — non-
   destructive, the original clip is never modified or removed.

**Known limits, by design (v1):** the Resolve scripting API has no
"currently selected timeline item" concept for the Edit-page timeline, so
this can't auto-target whatever you have selected — you pick the clip from
the panel's own list instead. Text always renders full-frame with a
left/center/right alignment choice, not a draggable box — reposition/resize
the resulting clip afterward with Resolve's own Transform if needed.

## Updating

`WorkflowIntegration.node` is Resolve-version-specific — if Resolve updates
its bundled Electron and a plugin stops loading, grab the current one from
Resolve's own installed sample and drop it in over both plugins' copies:

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node
```
