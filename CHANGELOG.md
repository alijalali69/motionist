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

## v1.3.0 — 2026-08-30

**DaVinci Resolve integration**
- New "Motionist Timeline Text" panel: a focused text-animation editor for
  existing Text+/Text3D/MultiText clips already on the Resolve timeline —
  edit/animate, render, drop back in place, non-destructive.
- `install_resolve_plugin.bat`: one-click install for either Resolve plugin.
- Fixed a real title-readback bug in that panel (`GetAttrs()` was called
  with an argument the API doesn't take, and MultiText titles weren't
  checked under their actual nested input) — a real title always came back
  empty instead of pre-filling the field.
- Alpha export switched from VP8/WebM to ProRes 4444 (.mov) — WebM alpha
  decodes badly in Resolve, showing as a colored glow/halo around soft
  edges; ProRes is what NLEs actually expect for alpha.

**Motion**
- Professional easing: curated default curves per entrance/exit effect
  (no more dead-zone-then-snap defaults), plus a per-layer IN/OUT easing
  picker with 12 named curves and an explicit "(auto)" option.
- Combine up to 3 entrance and 3 exit effects on one layer (FX1/FX2/FX3,
  "+" to add, capped at 3) — opacity/scale/position/blur layer together
  without compounding fades.
- Duration fields got a real "Auto" option (Fast/Normal/Slow presets + exact
  seconds), instead of only resetting to auto via the easing pickers.
- Per-layer text direction (RTL for Farsi/Arabic, LTR for English/Latin) —
  no more hardcoded RTL-only rendering.
- Saveable, named motion presets — save a layer's full motion + style as a
  reusable preset, apply it to any layer in any project, inline name field
  and a visible list (not a hidden dropdown).
- Copy/Paste (and presets) now carry font/size/color/align/direction and
  photo fit/motion/pan/zoom along with entrance/exit motion — previously
  motion-only, silently dropping the rest of a layer's style.

**Editor UI**
- Saved color swatches, shared across every color picker in a project.
- Layer cards collapse/expand (click header) and rename inline
  (double-click the name).
- Page inspector split into Page / Elements tabs; selected-element panel
  grouped into Text / Effects / Keyframes boxes.
- Section titles + separators made visibly distinct; Global Assets and
  Export boxed to match the Loader section's style.
- Storyboard strip only shows once a project has more than 2 pages.
- Left/right panels are resizable (drag the bars next to the preview).
- Dark themed scrollbars everywhere, replacing the browser's stock white one.
- Loader now defaults to off on new projects (still opt-in, per project).
- "out at" gets an explicit reset-to-auto button (clearing a number field
  by hand wasn't reliable).

**Fixes**
- OUT effect's FX1 was permanently locked at "none" — a real bug (the
  "disable while combining" flag was wrongly applied to FX1 itself too).
- `zoomOut`/`shrinkOut` exits looked frozen — their default easing held
  nearly still for ~85% of the duration then snapped; re-tuned.
- Element handle outlines/labels now fully hide when inactive instead of
  lingering faintly.

---

## v1.4.0 – v2.4.0 — 2026-08-30 to 2026-09-07

This changelog fell behind for eleven tagged versions — the work still
happened and is fully in `git log`/each tag, just not written up here
one-by-one. The major pieces, at a glance:

- **Shape layers** — rectangle/ellipse/line, with photo/video masking
  (upload media clipped to the shape's outline).
- **60+ motion effects** across three "FX tiers" — glitch, data-mosh,
  liquid, scramble, cube-flip, morph, burst, stroke-draw, letter-pop, and
  more, each with matching in/out pairs.
- **Real per-property keyframes** (the Keyframes tab) alongside the preset
  system, for when a canned effect isn't enough.
- **Background style system** — 24 treatments (gradients, textures, grain),
  adjustable per-project or per-page.
- **Layer groups** (color-coded, move together on canvas), a **page-layout
  template library**, and **project duplicate** (full independent copy).
- **Background music/sound-bed** track for the whole reel.
- **DaVinci Resolve Studio integration arrived**: two Workflow Integration
  plugins (the full app inside a Resolve panel, and a focused
  "Timeline Text" panel that animates an existing timeline clip in place) —
  see [resolve-plugin/README.md](resolve-plugin/README.md).
- **Editor redesign** ("Precision Console") — icon rail, safe-zone +
  Instagram-UI preview overlays, custom size-preset cards, resizable
  panels, and a large batch of smaller interaction/visual fixes.

## v3.0.0 — 2026-09-07

**First public release.** Repo went public on GitHub — this version is
mostly about making that safe and usable by someone who isn't sitting next
to the machine it was built on:

- Rewrote `README.md` for a public audience: what Motionist is, how the
  PSD/SVG → animated-reel pipeline actually works, a quick-start (including
  the one-file `bootstrap.bat` installer), and an honest Motionist-vs-
  Canva/CapCut/After Effects comparison.
- `bootstrap.bat` no longer assumes a private repo — dropped the
  "ask for a collaborator invite" messaging now that anyone can clone it.
- Scrubbed two directories of real client design files
  (`Templates/SVG`, `Templates/Final Templates`) out of the git history
  entirely, not just off the tip — they'd been tracked since v1.0.0 and the
  repo only just went public. Rewrote history with `git-filter-repo`,
  which also shrank `.git` from ~960 MB to ~7 MB as a side effect.
- No LICENSE yet — noted explicitly in the README (defaults to all rights
  reserved) rather than silently leaving it ambiguous.

**Feature backlog, shipped this version** (see individual commits for
detail — `3596a3e`, `d583cfd`, `feee445`, `21e81cb`, `b335914`, `38b0e24`):
- Duplicate page (filmstrip hover pill).
- Multi-select layers on the canvas — shift/ctrl/cmd+click, group move,
  bulk delete, align-to-selection.
- Cross-project brand kit — saved colors available in every color field.
- Keyboard shortcuts cheatsheet ("?" in the topbar).
- Dashboard search/filter, centered in the header.
- Project export/import — one file, for backup or moving machines.

**Fixes**
- A text layer's drag box is now always locked to its own rendered text
  size — previously it could end up much bigger than the text inside it
  (left over from a resize, or pasted from another layer) with no way to
  shrink it back except dragging by eye.

---

## v3.1.0 — 2026-09-11

**Effects**
- Effects gallery — a new "Effects" button on the Dashboard plays every
  entrance, exit and ambient motion at once, side by side, each with its
  name. Switch the sample between text, photo and shape, change easing and
  duration, filter by name, click any tile for a bigger view. It runs the
  exact same motion code as a real render, overlays included — not an
  approximation.
- Live effect picker — each In/Out effect dropdown is now a small chip
  showing the chosen effect playing, which opens a grid of tiles that all
  play at once. Takes less panel room than the dropdown it replaced.
- Four new glitch-family effects, each with an in and an out: rgbSplit
  (a clean chromatic aberration that converges), static (TV static that
  dissolves away), crtOn / crtOff (collapses to a bright scanline, then
  snaps open), signalDrop (a bad-signal stutter that locks on).
- Removed glowPulse and cube (in and out).

**Fixes**
- glitchIn, dataMoshIn, liquidIn, vhsIn, morphIn and strokeIn never
  finished: the layer arrived and then stayed glitched / warped /
  scanlined / blobbed / outlined for the rest of the page. They now clear
  completely by the time the layer lands. vhsOut and strokeOut had the
  mirror-image bug, jumping to full strength the moment the exit began.
- shineIn / shineOut: the highlight was 90% as wide as the layer and
  lasted the whole entrance, so it read as the layer washing white. It's
  now a narrow stripe that sweeps across and is gone before the layer
  settles.
- Overlay effects (glitch, static, liquid, shine and the rest) did nothing
  at all on the global Logo / Title / BG slots. They render there now.

**Also**
- Guided tour — a spotlight-and-tooltip walkthrough of the real UI on
  first launch, replayable from the Dashboard's "Tour" button or from the
  "?" shortcuts sheet.
- Box align (left / center / right, top / middle / bottom) for photo and
  shape layers, not just text.

---

<!-- Add new entries above this line as versions ship. -->
