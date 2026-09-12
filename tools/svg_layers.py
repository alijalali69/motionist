"""
Split an Illustrator-exported SVG into per-layer standalone SVGs + manifest.json.
Output shape matches psd_layers.py --export, so downstream (routing, reel) is identical.

Layers = the top-level <g> groups (Illustrator layers). Each is written as its own
self-contained SVG (viewBox cropped to the layer's bbox, shared <defs>/<style>
included) so it renders vector-crisp in Remotion. Routed by the group's id / name.

Usage:
    python tools/svg_layers.py in.svg                              # print layer tree
    python tools/svg_layers.py in.svg --export DIR --max-side 1920 # split + manifest
"""
import argparse
import copy
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from svgelements import SVG as SVGEl
try:
    from svgelements import Image as SVGImage
except ImportError:  # older svgelements — the image fallback below just won't engage
    SVGImage = ()

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
INK_NS = "http://www.inkscape.org/namespaces/inkscape"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


def local(tag):
    return tag.split("}")[-1]


# Whole-word match, same fix and same reasoning as psd_layers.py's
# route_hint — a bare substring check let "Unfixed Banner" or "Subtitled
# Draft" false-positive-match "fixed"/"sub" and silently misroute.
def _has_word(hay, word):
    return re.search(r"\b" + re.escape(word) + r"\b", hay) is not None


def route_hint(name):
    """Same convention as the PSD extractor (keyword anywhere in the name, as a whole word)."""
    h = (name or "").lower()
    if _has_word(h, "logo"):
        return "logo"
    if _has_word(h, "fixed"):
        return "fixed"
    if _has_word(h, "loader"):
        return "loader"
    if _has_word(h, "subtitle") or h.startswith("sub"):
        return "subtitle"
    return "content"


def get_canvas(root):
    vb = root.get("viewBox")
    if vb:
        p = [float(x) for x in vb.replace(",", " ").split()]
        return p[0], p[1], p[2], p[3]
    w = float((root.get("width") or "1080").replace("px", ""))
    h = float((root.get("height") or "1920").replace("px", ""))
    return 0.0, 0.0, w, h


def layer_name(g, i):
    return g.get("id") or g.get("{%s}label" % INK_NS) or g.get("data-name") or f"layer{i}"


DRAWABLE = {"g", "rect", "circle", "ellipse", "line", "polyline",
            "polygon", "path", "image", "text", "use", "svg"}


def top_layers(root):
    """Top-level drawable children of <svg> = Illustrator layers.
    Illustrator emits a single-object layer as a BARE element (rect/path/image/...)
    with the layer name as its id, not wrapped in <g>. So collect every drawable
    top-level child, not just <g>. If the whole artwork is wrapped in ONE outer <g>
    that itself holds multiple drawables, descend into it."""
    kids = [c for c in root if local(c.tag) in DRAWABLE]
    if len(kids) == 1 and local(kids[0].tag) == "g":
        inner = [c for c in kids[0] if local(c.tag) in DRAWABLE]
        if len(inner) > 1:
            return inner
    return kids


def shared_defs(root):
    return [c for c in root if local(c.tag) in ("defs", "style", "symbol")]


def build_sub_svg(root, group, viewbox):
    svg = ET.Element("{%s}svg" % SVG_NS)
    svg.set("viewBox", " ".join(str(round(v, 3)) for v in viewbox))
    svg.set("width", str(round(viewbox[2], 3)))
    svg.set("height", str(round(viewbox[3], 3)))
    for d in shared_defs(root):
        svg.append(copy.deepcopy(d))
    svg.append(copy.deepcopy(group))
    return ET.tostring(svg, encoding="unicode")


def image_bbox(e):
    """Bbox for a placed <image>, derived from its own width/height attributes.

    svgelements can only report a raster's real extent when it manages to LOAD
    the file, which needs PIL and a resolvable href — never true for us, since
    layers are measured from an in-memory SVG string and the image is usually a
    data: URI anyway. So Image.bbox() comes back as a zero-size point at the
    element's origin (measured: bbox=(20,20,20,20) for a 100x100 image), the
    union below inherits that, and the whole layer exports cropped to a 1x1
    speck. Every SVG layer that was a placed photo imported invisible.

    The width/height attributes are right there on the element, so use those and
    push the four corners through the element's own transform (which is where
    Illustrator puts the placement and scale).
    """
    try:
        w = float(e.width)
        h = float(e.height)
    except (TypeError, ValueError, AttributeError):
        return None
    if not (w > 0 and h > 0):
        return None
    try:
        x = float(getattr(e, "x", 0) or 0)
        y = float(getattr(e, "y", 0) or 0)
    except (TypeError, ValueError):
        x = y = 0.0
    corners = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
    m = getattr(e, "transform", None)
    if m is not None:
        try:
            corners = [(m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f) for cx, cy in corners]
        except AttributeError:
            pass
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_of_svg_string(s):
    """Union bbox (in root user units) of all drawable elements in an SVG string."""
    try:
        doc = SVGEl.parse(io.StringIO(s))
    except Exception:
        return None
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")
    for e in doc.elements():
        try:
            bb = e.bbox()
        except Exception:
            bb = None
        # A zero-size box means the element couldn't measure itself, not that
        # it's actually empty — that's exactly what a placed <image> reports.
        if (bb is None or bb[2] - bb[0] <= 0 or bb[3] - bb[1] <= 0) and SVGImage and isinstance(e, SVGImage):
            bb = image_bbox(e) or bb
        if not bb:
            continue
        xmin = min(xmin, bb[0]); ymin = min(ymin, bb[1])
        xmax = max(xmax, bb[2]); ymax = max(ymax, bb[3])
    if xmin == float("inf"):
        return None
    return xmin, ymin, xmax, ymax


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("--export", metavar="DIR")
    ap.add_argument("--max-side", type=int, default=0)
    args = ap.parse_args()

    tree = ET.parse(args.svg)
    root = tree.getroot()
    cx, cy, cw, ch = get_canvas(root)
    print(f"SVG: {args.svg}")
    print(f"canvas: {cw:.0f}x{ch:.0f} (viewBox origin {cx:.0f},{cy:.0f})")
    print("-" * 60)

    layers = top_layers(root)
    # Full-doc bbox pass once (per-group we re-derive from a cropped sub-svg).
    entries = []
    for i, g in enumerate(layers):
        name = layer_name(g, i)
        route = route_hint(name)
        # bbox: build a sub-svg with the group over the FULL canvas, measure it.
        probe = build_sub_svg(root, g, (cx, cy, cw, ch))
        bb = bbox_of_svg_string(probe)
        if not bb:
            bb = (cx, cy, cx + cw, cy + ch)
        left, top, right, bottom = bb
        w = max(1.0, right - left)
        h = max(1.0, bottom - top)
        print(f"[{i}] {name!r}  route={route}  pos=({left:.0f},{top:.0f}) size={w:.0f}x{h:.0f}")
        entries.append({"g": g, "name": name, "route": route,
                        "bb": (left, top, w, h)})

    if not args.export:
        return

    os.makedirs(args.export, exist_ok=True)
    scale = 1.0
    if args.max_side:
        scale = min(1.0, args.max_side / max(cw, ch))
    out_cw, out_ch = round(cw * scale), round(ch * scale)

    manifest = []
    for i, e in enumerate(entries):
        left, top, w, h = e["bb"]
        # Standalone SVG cropped to this layer's bbox → renders positioned & crisp.
        sub = build_sub_svg(root, e["g"], (left, top, w, h))
        fname = f"layer_{i:02d}.svg"
        with open(os.path.join(args.export, fname), "w", encoding="utf-8") as f:
            f.write(sub)
        manifest.append({
            "index": i,
            "file": fname,
            "name": e["name"],
            "kind": "vector",
            "left": round(left * scale), "top": round(top * scale),
            "width": round(w * scale), "height": round(h * scale),
            "opacity": 1.0,
            "text": None,
            "parents": [],
            "route": e["route"],
        })

    with open(os.path.join(args.export, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"canvas": [out_cw, out_ch], "layers": manifest}, f,
                  ensure_ascii=False, indent=2)
    print(f"\nexported {len(manifest)} vector layers ({out_cw}x{out_ch}) + manifest.json -> {args.export}")


if __name__ == "__main__":
    main()
