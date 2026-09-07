import React from "react";
import type { Guide } from "../../src/types";

// Illustrator's own guide cyan — deliberately distinct from CanvasHandles'
// ephemeral smart-guide magenta (#ff3d9a), so a glance at the canvas never
// confuses "this is snapping to something right now" with "this is a guide
// I placed." Editor-only, purely visual + interactive — never rendered in
// export (only mounted here, in the Editor's live-preview tree, never in
// Reel.tsx/PageScene.tsx).
const GUIDE_COLOR = "#00aeef";

export const GuidesOverlay: React.FC<{
  wrapperRef: React.RefObject<HTMLDivElement>;
  canvas: [number, number];
  guides: Guide[];
  onChange: (id: string, pos: number) => void;
  onDelete: (id: string) => void;
}> = ({ wrapperRef, canvas, guides, onChange, onDelete }) => {
  const [cw] = canvas;
  const [scale, setScale] = React.useState(0);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setScale(el.getBoundingClientRect().width / cw);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapperRef, cw]);

  if (!scale || guides.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 }}>
      {guides.map((g) => (
        <GuideLine key={g.id} guide={g} scale={scale} canvas={canvas} onChange={onChange} onDelete={onDelete} />
      ))}
    </div>
  );
};

const GuideLine: React.FC<{
  guide: Guide;
  scale: number;
  canvas: [number, number];
  onChange: (id: string, pos: number) => void;
  onDelete: (id: string) => void;
}> = ({ guide, scale, canvas, onChange, onDelete }) => {
  const [cw, ch] = canvas;
  const dragRef = React.useRef<{ start: number; pos: number } | null>(null);
  // The LIVE position while dragging — not the `guide` prop. onChange fires
  // on every pointermove, but the resulting prop update lands through a
  // parent re-render that isn't guaranteed to have committed yet by the
  // time a later event's handler runs (same class of bug as the filmstrip
  // drag-reorder fix elsewhere in this app: a closure reading React state/
  // props set by an earlier event in a fast sequence can read a stale
  // value). Hit for real here: a quick drag-then-release read `guide.pos`
  // still at its PRE-drag value in onUp, so a genuine fling off the canvas
  // edge silently failed to delete. This ref is updated synchronously in
  // onMove, so onUp always sees the position it just actually dragged to.
  const livePosRef = React.useRef(guide.pos);
  const [dragging, setDragging] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { start: guide.axis === "x" ? e.clientX : e.clientY, pos: guide.pos };
    livePosRef.current = guide.pos;
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const client = guide.axis === "x" ? e.clientX : e.clientY;
    const delta = (client - dragRef.current.start) / scale;
    const next = Math.round(dragRef.current.pos + delta);
    livePosRef.current = next;
    onChange(guide.id, next);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    // Dragged well past either edge — matches Illustrator's own "drag a
    // guide back onto the ruler to delete it" convention. A little
    // overshoot (not just >cw/<0) so a guide placed right at the edge on
    // purpose doesn't delete itself on the next tiny nudge.
    const overshoot = 20; // canvas px
    const bound = guide.axis === "x" ? cw : ch;
    const finalPos = livePosRef.current;
    if (finalPos < -overshoot || finalPos > bound + overshoot) onDelete(guide.id);
    dragRef.current = null;
    setDragging(false);
  };

  const posPct = guide.axis === "x" ? (guide.pos / cw) * 100 : (guide.pos / ch) * 100;
  const lineStyle: React.CSSProperties = guide.axis === "x"
    ? { position: "absolute", left: `${posPct}%`, top: 0, width: 1, height: "100%" }
    : { position: "absolute", top: `${posPct}%`, left: 0, height: 1, width: "100%" };

  return (
    <div style={{ ...lineStyle, pointerEvents: "auto" }}>
      {/* Wider invisible hit-strip (the 1px line itself is a tiny target) —
          wide enough to also fully contain the delete button below (16px,
          centered on the line), so moving the mouse from the strip onto the
          button never crosses a hover gap that would hide it first. */}
      <div
        style={{
          position: "absolute",
          inset: guide.axis === "x" ? "0 -8px" : "-8px 0",
          cursor: guide.axis === "x" ? "ew-resize" : "ns-resize",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        title={`${guide.axis === "x" ? "Vertical" : "Horizontal"} guide at ${guide.pos}px — drag to move, drag off-canvas or click × to delete`}
      />
      <div style={{
        position: "absolute", inset: 0,
        background: GUIDE_COLOR,
        opacity: dragging ? 1 : 0.85,
        boxShadow: dragging ? `0 0 4px ${GUIDE_COLOR}` : "none",
      }} />
      {/* Hover-revealed delete button — dragging off-canvas works too (see
          the tooltip above) but isn't discoverable on its own; this is the
          same "hover reveals the delete action" convention as the filmstrip
          page cards and the dashboard's project cards elsewhere in the app.
          Pinned to one end of the line rather than following the cursor, so
          it's always in the same predictable spot. */}
      {(hovering || dragging) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(guide.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          title="Delete this guide"
          aria-label="Delete this guide"
          style={{
            position: "absolute",
            ...(guide.axis === "x" ? { top: 4, left: 0, transform: "translateX(-50%)" } : { left: 4, top: 0, transform: "translateY(-50%)" }),
            width: 16, height: 16, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: GUIDE_COLOR, color: "#0e1013",
            border: "1px solid rgba(0,0,0,0.35)", cursor: "pointer",
            fontSize: 10, lineHeight: 1, padding: 0,
          }}
        >✕</button>
      )}
    </div>
  );
};
