# Motionist — PSD preparation spec

How to name layers in Photoshop so the app routes them automatically.
Do this once per design system; every page that follows the convention just works.

## The 4 routes

Each layer in a page PSD falls into one of four buckets, decided by its **name**
or the **group** it lives in:

Matching is by keyword **anywhere** in the layer name (case-insensitive), or in
any group the layer sits inside. So `Logo Fixed`, `fixed`, `header fixed`, or a
group named `Fixed` all count as fixed.

| Route | How to mark it | What the app does |
|---|---|---|
| **fixed** | put **`fixed`** anywhere in the layer name, or inside a group named **`fixed`** | ingested once → rendered as a locked overlay on every page. No motion, no transition. For logo, artist-name lockup, frames. |
| **loader** | put **`loader`** in the layer name | its box (position + size) becomes the progress bar. The pixels are ignored — the bar is drawn by code, filling 0→100% across the whole reel. |
| **subtitle** | put **`subtitle`** in the name (or a name starting `sub`) | its box becomes the English-caption safe zone. Reserved now; captions render here later with the audio. Pixels ignored. |
| **content** | anything else | the unique per-page art. Gets the motion presets + page transitions. |

## Rules

1. **`fixed` must be identical across pages** — same position, same content. The
   app takes it from the first page it appears on and reuses it everywhere. If it
   differs page to page, it is not fixed — leave it as content.
2. **`loader` and `subtitle` are position markers.** Draw a rectangle where the
   bar / caption box should sit and name it. Its fill/stroke don't matter; only
   the bounding box is read. You can hide the layer in Photoshop — the box still
   counts.
3. **Everything ungrouped and unnamed = content.** No need to tag content layers;
   the app auto-detects their role (bg / photo / title / subtitle-text) for motion.
4. Group nesting is fine — a layer anywhere inside a `fixed` group is routed fixed.
5. Keep one design = one PSD = one page. Order pages when building the reel.

## Example layer stack (top → bottom in Photoshop)

```
▸ fixed                  ← group  (routes everything inside as chrome)
    MOMKEN logo
    عباس مهرپویا (name lockup)
    frame border
  loader                 ← rectangle marking the progress-bar strip
  subtitle               ← rectangle marking the caption safe zone
  title text             ← content (auto motion)
  photo 1                ← content
  photo 2                ← content
  background             ← content
```

## Build commands

```bash
# 1. extract each page PSD -> layers + manifest (routes captured automatically)
python tools/psd_layers.py PSDs/page1.psd --export public/projects/<id>/p1 --max-side 1920
python tools/psd_layers.py PSDs/page2.psd --export public/projects/<id>/p2 --max-side 1920

# 2. compose the reel spec (routes fixed/loader/subtitle/content)
node tools/build_project.mjs <id> p1 p2 [p3 ...]

# 3. preview live, or render
npm run dev
npm run render
```

If no `fixed` / `loader` / `subtitle` layers are named, the app falls back to:
no template chrome, a default progress bar near the bottom, and a default caption
safe zone — so it still runs, just without the design-specific placements.
