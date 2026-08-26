"""
Dump the layer structure of a PSD file.

Usage:
    python tools/psd_layers.py path/to/file.psd            # print layer tree
    python tools/psd_layers.py file.psd --preview out.png  # also export flat composite
    python tools/psd_layers.py file.psd --export layers/    # also export each layer as PNG
"""
import argparse
import sys
from psd_tools import PSDImage

# Windows console defaults to cp1252; force UTF-8 so Farsi/Arabic layer names print.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
from psd_tools.api.layers import Group, TypeLayer


def to_rgba(img):
    """PSD may be CMYK; web/Remotion needs RGB. Convert, keep alpha if present."""
    if img is None:
        return None
    if img.mode in ("RGBA", "RGB"):
        return img.convert("RGBA")
    return img.convert("RGBA")


def downscale(img, max_side):
    from PIL import Image
    if max(img.width, img.height) <= max_side:
        return img
    scale = max_side / max(img.width, img.height)
    size = (round(img.width * scale), round(img.height * scale))
    return img.resize(size, Image.LANCZOS)


def ancestor_names(layer):
    """List of parent GROUP names, outermost first (excludes the PSD root)."""
    names = []
    parent = layer.parent
    while parent is not None and getattr(parent, "name", None) is not None:
        # PSDImage (root) has no useful name; Group parents do.
        if isinstance(parent, Group):
            names.append(parent.name)
        parent = getattr(parent, "parent", None)
    names.reverse()
    return names


def route_hint(layer):
    """Classify a layer for the reel by naming convention. The keyword may appear
    anywhere in the layer name OR in any ancestor group name (case-insensitive):
    - 'fixed'    -> 'fixed'    (template chrome: 'Logo Fixed', a group named 'fixed', ...)
    - 'loader'   -> 'loader'   (position marker for the progress bar)
    - 'sub'/'subtitle' -> 'subtitle' (position marker for the caption safe-zone)
    - otherwise  -> 'content'
    """
    name = (layer.name or "").strip().lower()
    parents = [p.strip().lower() for p in ancestor_names(layer)]
    hay = " ".join([name, *parents])
    # 'logo' wins over 'fixed' so the branded logo gets its own animated slot
    # (e.g. a layer named "Logo Fixed" routes to logo, not static chrome).
    if "logo" in hay:
        return "logo"
    if "fixed" in hay:
        return "fixed"
    if "loader" in hay:
        return "loader"
    if "subtitle" in hay or "subzone" in hay or name.startswith("sub"):
        return "subtitle"
    return "content"


def fmt_layer(layer, depth):
    indent = "  " * depth
    vis = "o" if layer.visible else "x"
    kind = layer.kind
    box = layer.bbox  # (left, top, right, bottom)
    w = box[2] - box[0]
    h = box[3] - box[1]
    line = (
        f"{indent}[{vis}] {layer.name!r}  "
        f"kind={kind} blend={layer.blend_mode.name.lower()} "
        f"opacity={round(layer.opacity / 255 * 100)}% "
        f"pos=({box[0]},{box[1]}) size={w}x{h}"
    )
    print(line)

    if isinstance(layer, TypeLayer):
        text = layer.text.replace("\n", " / ") if layer.text else ""
        print(f"{indent}    text: {text!r}")


def walk(layer, depth=0):
    fmt_layer(layer, depth)
    if isinstance(layer, Group):
        for child in layer:
            walk(child, depth + 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("psd")
    ap.add_argument("--preview", metavar="PNG", help="export flattened composite to PNG")
    ap.add_argument("--export", metavar="DIR", help="export each layer as its own PNG + manifest.json")
    ap.add_argument("--max-side", type=int, default=0, help="downscale preview longest side to N px")
    args = ap.parse_args()

    psd = PSDImage.open(args.psd)
    print(f"PSD: {args.psd}")
    print(f"canvas: {psd.width}x{psd.height}  color_mode={psd.color_mode.name}")
    print("-" * 60)
    for layer in psd:
        walk(layer)

    if args.preview:
        img = to_rgba(psd.composite())
        if args.max_side:
            img = downscale(img, args.max_side)
        img.save(args.preview)
        print(f"\ncomposite -> {args.preview}  ({img.width}x{img.height})")

    if args.export:
        import json
        import os
        os.makedirs(args.export, exist_ok=True)
        # Scale the whole layer set (and coords) so the canvas long side == max_side.
        scale = 1.0
        if args.max_side:
            scale = min(1.0, args.max_side / max(psd.width, psd.height))
        cw, ch = round(psd.width * scale), round(psd.height * scale)
        manifest = []
        n = 0
        for layer in psd.descendants():
            if isinstance(layer, Group):
                continue
            img = layer.composite()
            if img is None:
                continue
            img = to_rgba(img)
            box = layer.bbox
            left, top = round(box[0] * scale), round(box[1] * scale)
            w, h = round((box[2] - box[0]) * scale), round((box[3] - box[1]) * scale)
            if scale < 1.0 and w > 0 and h > 0:
                from PIL import Image
                img = img.resize((w, h), Image.LANCZOS)
            fname = f"layer_{n:02d}.png"  # ASCII-only: real name kept in manifest
            img.save(os.path.join(args.export, fname))
            manifest.append({
                "index": n,
                "file": fname,
                "name": layer.name,
                "kind": layer.kind,
                "left": left, "top": top, "width": w, "height": h,
                "opacity": round(layer.opacity / 255, 3),
                "text": layer.text if isinstance(layer, TypeLayer) else None,
                "parents": ancestor_names(layer),
                "route": route_hint(layer),
            })
            n += 1
        with open(os.path.join(args.export, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump({"canvas": [cw, ch], "layers": manifest}, f,
                      ensure_ascii=False, indent=2)
        print(f"\nexported {n} layers ({cw}x{ch}) + manifest.json -> {args.export}")


if __name__ == "__main__":
    main()
