# Changelog

Versions follow [semver](https://semver.org): **major**.minor.patch —
major for a real reshape, minor for a new feature, patch for a fix.

## v1.0.0 — 2026-08-26

First tagged version. Everything up to here, in one place:

**Core pipeline**
- PSD/SVG layer extraction → auto-routed into logo/photo/title/subtitle/loader
  roles by naming convention, no manual tagging needed.
- Plain photo/video → an instant full-frame page (no PSD required).
- Blank page (color + text only) — no photo/PSD required at all.
- Multi-project dashboard: create, rename, delete, switch between reels.

**Editing**
- Live Farsi text layers: font upload (single or whole family at once, style
  auto-detected per file), size/color/align, word/line reveal + mask-wipe
  entrances (cursive-shaping-safe), flip in/out, and 15+ other entrance/exit
  presets.
- Exact timing control: pin an entrance or exit to an absolute second,
  independent of page length.
- Photo layer: upload/replace, pan/zoom crop, cover/contain fit toggle.
- Global logo/title/background assets, backdrop color (project- and
  page-level, with hex input), 4 loader styles + show/hide.
- Layer reordering (front-to-back, Photoshop-style), drag/resize/snap canvas
  handles with Illustrator-style guides.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z), asset cleanup on delete/replace, real
  upload validation (checked by file signature, not just extension).

**Delivery**
- Save projects locally, render to MP4.
- Auto-starts on Windows login; runs independently of any Claude session.
- Shared via GitHub — a second machine just needs `git clone` + `npm install`.

---

## v1.1.0 — 2026-08-27

**Storyboard**
- New storyboard strip above the player: live-content page thumbnails,
  click to select, drag to reorder (FLIP-animated).
- Carousel view (arrow buttons + mouse-wheel horizontal scroll) or one-button
  toggle to a show-all wrapped grid.
- Fixed three real causes of scroll/drag lag (unmemoized thumbnails re-running
  on every tick, an unguarded layout-reflow effect, and a full project
  deep-clone firing on every drag tick instead of once at drag-end).

**Project setup**
- Canvas-size presets on New Project: Instagram/TikTok Reels & Stories,
  YouTube Shorts, Instagram feed square/portrait, YouTube landscape, or
  custom — with server-side dimension clamping.

**Delivery**
- Alpha (transparent-background) export: a checkbox renders to a real
  transparent WebM (vp8 + yuva420p) instead of an opaque MP4, for
  compositing the reel over other footage.

---

## v1.2.0 — 2026-08-27

**DaVinci Resolve integration**
- New Workflow Integration Plugin (Resolve Studio only): loads Motionist
  inside Resolve itself (Workspace → Workflow Integrations → Motionist).
  Every finished render lands straight in a "Motionist" bin in the current
  project's Media Pool — no manual import, drag it onto the timeline
  directly. See `resolve-plugin/README.md`.

**New-machine setup**
- `bootstrap.bat`: one file, one double-click — installs Node.js, Git,
  Python, ffmpeg via winget, the required Python packages, clones the repo
  (or pulls if already cloned), runs `npm install`, and starts the app.

**Fixes**
- Global BG slot: was missing a drag/resize handle on the canvas (Logo and
  Title had one, BG didn't) and had no way to delete it once uploaded.
  Both fixed — BG now behaves the same as Logo/Title, and all three got a
  "Remove" (✕) button.

---

<!-- Add new entries above this line as versions ship. -->
