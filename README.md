# Kadr

Turn a layered design — a Photoshop poster, an Illustrator SVG, a plain
photo, or just a blank page — into an animated vertical (1080×1920) Instagram
Reel / YouTube Short. Runs entirely on your own machine, built on
[Remotion](https://www.remotion.dev/).

## What it is

Kadr (کادر, Persian for "frame" — formerly Motionist) is a local dashboard app for a studio or freelancer who already
designs in Photoshop/Illustrator and wants those designs turned into short
animated videos without hand-keyframing every layer in After Effects, and
without uploading a client's unreleased artwork to somebody else's cloud
template tool.

You bring the design. Kadr splits it into layers, animates each one
with a motion preset (fade/slide/glitch/liquid/burst and 60+ others, in and
out), strings pages into a reel with transitions between them, and renders
straight to MP4 — previewed live the whole time so nothing is a guess.

It's built around real production needs from day one: multi-project
dashboard, brand kit (colors/fonts shared across projects), saved motion
presets, keyboard shortcuts, and native **RTL/Farsi text** (this started
life as a tool for Farsi music-artist posters, so right-to-left shaping,
reveal-by-word, and direction-per-layer aren't an afterthought).

## How it works

1. **Bring a design.** A layered PSD, an Illustrator-exported SVG, a plain
   photo/video (instant full-frame page, no PSD needed), or a blank
   color+text page.
2. **Name a few layers.** Photoshop/Illustrator layers get auto-routed by a
   simple naming convention — put `fixed` in a layer/group name for chrome
   that repeats on every page (logo, artist lockup), `loader` for the
   progress-bar box, `subtitle` for the caption safe zone, and leave
   everything else alone — it's content automatically. Full spec:
   [docs/PSD_SPEC.md](docs/PSD_SPEC.md).
3. **One PSD/SVG = one page.** Import as many as you need, reorder them
   freely, string them into one reel.
4. **Edit live.** Per-layer entrance/exit/ambient motion, page transitions,
   fonts, colors, drag-and-snap canvas handles with Illustrator-style
   guides, real per-property keyframes when a preset isn't enough — all in
   an embedded Remotion player, so every change previews instantly instead
   of waiting on a render.
5. **Render.** Straight to MP4 locally, or a transparent ProRes/WebM overlay
   for compositing elsewhere. No upload, no render queue, no watermark.

## Quick start

### Windows — one file, nothing pre-installed

Download **[bootstrap.bat](https://raw.githubusercontent.com/alijalali69/motionist/main/bootstrap.bat)**
(right-click the link → *Save link as…*) and double-click it. It installs
Node.js, Git, Python, and ffmpeg (via `winget`), installs the Python
packages Kadr needs, clones this repo to `%USERPROFILE%\motionist`,
runs `npm install`, and starts the app at `http://localhost:5173`. Safe to
re-run any time — it'll update instead of re-cloning.

### Already have Node.js, Python, Git, and ffmpeg

```bash
git clone https://github.com/alijalali69/motionist.git
cd motionist
npm install
npm run app
```

Then open `http://localhost:5173`.

### macOS / Linux

There's no one-click installer yet — `bootstrap.bat`, the autostart
scripts, and the in-app render-cancel button are all Windows-only right
now (see **What's not here yet** below). Install manually, then follow the
step above:

```bash
# macOS
brew install node python ffmpeg
python3 -m pip install psd-tools svgelements aggdraw

# Debian/Ubuntu
sudo apt install nodejs npm python3 python3-pip ffmpeg
python3 -m pip install psd-tools svgelements aggdraw
```

**Requires either way:** Node.js 18+, Python 3 (with `psd-tools`,
`svgelements`, `aggdraw`), and `ffmpeg`/`ffprobe` on `PATH`.

## Running it day to day

- **`start.bat`** — starts the server (port 3001) and the app (port 5173)
  in one window; closing the window stops both.
- **`stop.bat`** — kills whatever's on ports 3001/5173, if one ever gets
  stuck.
- **`setup_autostart.bat`** (run once) — starts Kadr automatically
  every time you log into Windows, silently, no window.

## Inside DaVinci Resolve

Run **`install_resolve_plugin.bat`** once (needs **Resolve Studio** — the
free version doesn't support Workflow Integration Plugins) to add two
panels under *Workspace → Workflow Integrations*:

- **Motionist** — the full app, loaded inside a Resolve window. Every
  render lands straight in a "Motionist" Media Pool bin, ready to drag onto
  a timeline.
- **Motionist Timeline Text** — pick a clip on your current timeline
  (reads existing text straight out of a Fusion Text+/Text3D node if it has
  one), animate it with a Kadr preset, and the rendered transparent
  overlay is dropped back onto the timeline at the exact same frame — no
  export/import round trip.

Details: [resolve-plugin/README.md](resolve-plugin/README.md).

## Kadr vs. the usual options

| | **Kadr** | Canva / CapCut / Kapwing / VEED | After Effects |
|---|---|---|---|
| Animates | **your own** PSD/SVG layers | a template you drop content into | your own layers |
| Where it runs | your machine | their cloud | your machine |
| Your design leaves your PC? | never | uploaded to their servers | never |
| Cost | free, self-hosted | subscription | subscription |
| RTL / Farsi text | native (shaping-safe reveals, per-layer direction) | usually broken or unsupported | manual, no built-in convention |
| Goes straight into an NLE | ✅ DaVinci Resolve panel + Media Pool | ❌ | export/import by hand |
| Auto layer routing (logo/loader/subtitle) | ✅ naming convention | n/a (template-based) | ❌ manual every time |
| Learning curve | pick presets, no keyframing required (real keyframes optional) | lowest | steep |

The honest trade-off: a template tool is faster for a single generic post,
and After Effects goes further if you're willing to hand-keyframe. Kadr
sits in between — real animation of your *own* design files, at
template-tool speed, without sending anything to a server.

## What's not here yet

Being upfront about the gaps, since this just went public:

- **No LICENSE file.** That legally defaults to "all rights reserved" —
  you can read and fork the code on GitHub, but there's no license granting
  the right to reuse or redistribute it. Ask if you want to use this
  commercially.
- **Windows-first.** The one-click installer, autostart, and clean
  render-cancel (it shells out to `taskkill`) are Windows-only. macOS/Linux
  work with manual setup (above) but haven't been tested as thoroughly.
- **No audio track editing, captions, or auto-transcription from audio** —
  a subtitle *zone* is reserved per page, but nothing generates the text
  for you yet.
- **No automated tests or CI.** Changes are verified by hand against a
  running instance before each release.
- **Single machine, no cloud sync.** Moving a project to another computer
  is a manual step — export it from the Dashboard (bundles the project +
  every asset into one file) and import it on the other machine.

## Project layout

```
app/            The dashboard + editor (Vite + React). This is the UI.
server/         Local Express server — project storage, PSD/SVG ingest,
                asset uploads, rendering. Talks to app/ over localhost:3001.
src/            Remotion side: the actual reel composition (Reel.tsx,
                PageScene.tsx, Loader.tsx, presets.ts, etc). Shared between
                the live preview (app/) and the real render (server/).
tools/          PSD/SVG layer extraction (Python) + shared page-routing
                logic (compose.mjs) used by both the server and the CLI.
resolve-plugin/ DaVinci Resolve Studio plugin — loads the app inside Resolve
                and adds finished renders straight to the Media Pool. See
                resolve-plugin/README.md.
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
project between machines, use the Dashboard's own **Export**/**Import**
buttons (one file, project + assets bundled) — not something `git pull`
will ever carry.

## Updating

```bash
git pull
npm install   # only if package.json changed
```
Then relaunch via `start.bat` (or it already restarted itself if it
auto-starts).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for what shipped in each tagged version.
