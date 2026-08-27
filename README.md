# Motionist

Turns a layered PSD/SVG poster design (or a plain photo, or nothing at all) into an
animated vertical (1080×1920) Instagram Reel / YouTube Short — a local dashboard
app for building multiple reel projects, built on Remotion.

## Setting it up on a new machine

Send that person just **`bootstrap.bat`** (nothing else — it clones the rest
itself). Double-click it: it installs Node.js, Git, Python, ffmpeg (via
`winget`), the required Python packages, clones this repo, runs
`npm install`, and starts the app. Needs a GitHub account already invited as
a collaborator on this repo — it'll prompt a login if not already signed in.
Safe to re-run any time (e.g. to update: it'll `git pull` instead of
re-cloning).

## Running it

Double-click **`start.bat`** — starts the server (port 3001) and the app
(port 5173), then open `http://localhost:5173`.

To have it start automatically every time you log into Windows, run
**`setup_autostart.bat`** once (creates a Startup-folder shortcut, silent/no
window). **`stop.bat`** kills both if a port ever gets stuck.

Requires: Node.js, Python 3 (with `psd-tools`, `svgelements`, `aggdraw`), and
ffmpeg/ffprobe on PATH.

## Layout

```
app/            The dashboard + editor (Vite + React). This is the UI.
server/         Local Express server — project storage, PSD/SVG ingest,
                asset uploads, rendering. Talks to app/ over localhost:3001.
src/            Remotion side: the actual reel composition (Reel.tsx,
                PageScene.tsx, Loader.tsx, presets.ts, etc). Shared between
                the live preview (app/) and the real render (server/).
tools/          PSD/SVG layer extraction (Python) + shared page-routing
                logic (compose.mjs) used by both the server and the CLI.
data/           One JSON file per project — NOT in git (your real work).
public/         Static files Vite/Remotion serve.
  brand/          Real app assets (logo, favicon) — tracked in git.
  projects/       Per-project uploaded media — NOT in git (your real work).
  fonts/          Global uploaded font library — NOT in git (your real work).
Fixed Assets/   Source design files for the fixed chrome (logo/title/bg).
Templates/      Source PSD/SVG/exported templates you drag into the app.
docs/           Reference docs (PSD_SPEC.md — the naming convention PSD/SVG
                layers need for auto-routing into logo/photo/title/etc).
out/            Rendered MP4 output — not in git, safe to clear anytime.
```

## Data isn't in git

`data/` and `public/projects/` (your actual projects — media, layers, text)
are gitignored on purpose: they're this machine's real work, not app code.
Only `public/brand/` inside `public/` is tracked. If you need to move a
project between machines, that's a manual copy of its `data/projects/<id>.json`
plus `public/projects/<id>/`, not something `git pull` will ever carry.

## Updating

```bash
git pull
npm install   # only if package.json changed
```
Then relaunch via `start.bat` (or it already restarted itself if it auto-starts).
