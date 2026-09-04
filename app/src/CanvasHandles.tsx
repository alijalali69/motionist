import React from "react";
import type { Box } from "../../src/types";

export type Handle = {
  id: string;
  label: string;
  color: string;
  box: Box;
  onChange: (box: Box) => void;
  // When true, this handle steps aside (pointer-events off) so whatever's
  // underneath — a photo's own pan-crop zone in PhotoPanHandles — gets the
  // drag instead. Used for the Alt-to-pan modifier on photo layers, whose
  // move/resize handle otherwise permanently sits on top of that same box.
  panPassthrough?: boolean;
  // True for anything PhotoPanHandles can actually pan — a real photo/video
  // layer, or a shape carrying a photo/video mask. Drives the Alt+drag hint
  // in this handle's own tooltip (used to sniff `id.startsWith("photo")`,
  // which silently dropped the hint — and the whole feature — for shapes).
  pannable?: boolean;
};

type Guide = { axis: "x" | "y"; pos: number }; // canvas-space position of an active alignment line

const SNAP_THRESHOLD = 6; // canvas px — how close before it snaps + shows a guide

// Draggable + resizable position handles overlaid directly on the live
// preview — for pixel-accurate placement without hand-typing X/Y/W/H.
// While dragging, shows Illustrator-style smart guides: thin lines appear
// when the dragged box's edges/center align with the canvas center/edges or
// another fixed element's edges/center, and it snaps to that exact position.
// Sits on top of the Player as a sibling (not a child): the wrapper has
// pointer-events:none so clicks pass through to the Player's own controls
// everywhere except the handle boxes themselves, which opt back in.
export const CanvasHandles: React.FC<{
  wrapperRef: React.RefObject<HTMLDivElement>;
  canvas: [number, number];
  handles: Handle[];
}> = ({ wrapperRef, canvas, handles }) => {
  const [cw, ch] = canvas;
  const [scale, setScale] = React.useState(0);
  const [guides, setGuides] = React.useState<Guide[]>([]);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setScale(el.getBoundingClientRect().width / cw);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapperRef, cw]);

  if (!scale || handles.length === 0) return null;

  // zIndex above PhotoPanHandles — a deliberately-placed text/logo/title/
  // loader handle should always be clickable, even where it overlaps a
  // photo's pan-drag zone (otherwise whichever overlay happens to mount
  // later in the DOM silently wins the click, which was the actual bug).
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}>
      {handles.map((h) => (
        <DragBox
          key={h.id}
          handle={h}
          scale={scale}
          canvas={canvas}
          otherBoxes={handles.filter((o) => o.id !== h.id).map((o) => o.box)}
          onGuides={setGuides}
        />
      ))}
      {/* Smart guide lines — full-span, drawn on top */}
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <div key={i} style={{ position: "absolute", left: g.pos * scale, top: 0, width: 1, height: "100%", background: "#ff3d9a", boxShadow: "0 0 4px #ff3d9a" }} />
        ) : (
          <div key={i} style={{ position: "absolute", top: g.pos * scale, left: 0, height: 1, width: "100%", background: "#ff3d9a", boxShadow: "0 0 4px #ff3d9a" }} />
        )
      )}
    </div>
  );
};

const MIN_SIZE = 16; // px in canvas space — a box can't be dragged/resized smaller than this

const DragBox: React.FC<{
  handle: Handle;
  scale: number;
  canvas: [number, number];
  otherBoxes: Box[];
  onGuides: (g: Guide[]) => void;
}> = ({ handle, scale, canvas, otherBoxes, onGuides }) => {
  const { box, onChange } = handle;
  const [cw, ch] = canvas;
  const dragRef = React.useRef<{ startX: number; startY: number; box: Box } | null>(null);
  const resizeRef = React.useRef<{ startX: number; startY: number; box: Box } | null>(null);
  const [busy, setBusy] = React.useState<"move" | "resize" | null>(null);
  const boxRef = React.useRef(box);
  boxRef.current = box;

  // Candidate alignment lines: canvas center/edges + every other fixed
  // element's left/center/right (x) and top/center/bottom (y).
  const candidatesX = React.useMemo(() => {
    const xs = [0, cw / 2, cw];
    otherBoxes.forEach((b) => xs.push(b.left, b.left + b.width / 2, b.left + b.width));
    return xs;
  }, [cw, otherBoxes]);
  const candidatesY = React.useMemo(() => {
    const ys = [0, ch / 2, ch];
    otherBoxes.forEach((b) => ys.push(b.top, b.top + b.height / 2, b.top + b.height));
    return ys;
  }, [ch, otherBoxes]);

  // Snap a proposed box position: check its left/center/right against every
  // X candidate (and top/center/bottom against Y candidates); if the closest
  // is within SNAP_THRESHOLD, lock that edge to it exactly and report the
  // guide line to draw. Returns the (possibly adjusted) left/top plus guides.
  function snap(proposedLeft: number, proposedTop: number, w: number, h: number) {
    const points = { left: proposedLeft, center: proposedLeft + w / 2, right: proposedLeft + w };
    let bestX: { delta: number; snapLeft: number; pos: number } | null = null;
    for (const cand of candidatesX) {
      for (const key of ["left", "center", "right"] as const) {
        const delta = cand - points[key];
        if (Math.abs(delta) <= SNAP_THRESHOLD && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, snapLeft: proposedLeft + delta, pos: cand };
        }
      }
    }
    const pointsY = { top: proposedTop, center: proposedTop + h / 2, bottom: proposedTop + h };
    let bestY: { delta: number; snapTop: number; pos: number } | null = null;
    for (const cand of candidatesY) {
      for (const key of ["top", "center", "bottom"] as const) {
        const delta = cand - pointsY[key];
        if (Math.abs(delta) <= SNAP_THRESHOLD && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, snapTop: proposedTop + delta, pos: cand };
        }
      }
    }
    const guides: Guide[] = [];
    if (bestX) guides.push({ axis: "x", pos: bestX.pos });
    if (bestY) guides.push({ axis: "y", pos: bestY.pos });
    return {
      left: bestX ? bestX.snapLeft : proposedLeft,
      top: bestY ? bestY.snapTop : proposedTop,
      guides,
    };
  }

  const onMoveDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, box };
    setBusy("move");
  };

  const onMoveMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    const raw = dragRef.current.box;
    const proposedLeft = Math.round(raw.left + dx);
    const proposedTop = Math.round(raw.top + dy);
    const snapped = snap(proposedLeft, proposedTop, raw.width, raw.height);
    onGuides(snapped.guides);
    onChange({ ...raw, left: Math.round(snapped.left), top: Math.round(snapped.top) });
  };

  const onMoveUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    setBusy(null);
    onGuides([]);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, box };
    setBusy("resize");
  };

  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const dx = (e.clientX - resizeRef.current.startX) / scale;
    const dy = (e.clientY - resizeRef.current.startY) / scale;
    onChange({
      ...resizeRef.current.box,
      width: Math.max(MIN_SIZE, Math.round(resizeRef.current.box.width + dx)),
      height: Math.max(MIN_SIZE, Math.round(resizeRef.current.box.height + dy)),
    });
  };

  const onResizeUp = (e: React.PointerEvent) => {
    resizeRef.current = null;
    setBusy(null);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  // Arrow keys nudge by 1px, Shift+arrow by 10px — pixel-accurate fine control
  // that a mouse alone can't reliably give you.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    const b = boxRef.current;
    onChange({ ...b, left: b.left + dx, top: b.top + dy });
  };

  const dragging = busy !== null;
  const [hovering, setHovering] = React.useState(false);
  // Outline, fill, AND label only show up on hover or while actively
  // dragging — at rest there's nothing drawn at all, so an inactive
  // text/logo/title box never sits on top of the actual reel content.
  const active = dragging || hovering;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onMoveDown}
      onPointerMove={onMoveMove}
      onPointerUp={onMoveUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onKeyDown={onKeyDown}
      title={
        handle.pannable
          ? "Drag to move/resize the frame — hold Alt and drag to reposition the photo/video inside it instead"
          : `Drag to move ${handle.label.toLowerCase()} — arrow keys to nudge (Shift = 10px)`
      }
      className="canvas-handle"
      style={{
        position: "absolute",
        left: box.left * scale,
        top: box.top * scale,
        width: box.width * scale,
        height: box.height * scale,
        border: active ? `2px ${dragging ? "solid" : "dashed"} ${handle.color}` : "2px solid transparent",
        background: dragging ? `${handle.color}22` : "transparent",
        cursor: "move",
        // Alt-to-pan: step aside so the pan-crop zone underneath (same box,
        // in PhotoPanHandles) gets the drag instead of this move/resize
        // handle permanently shadowing it.
        pointerEvents: handle.panPassthrough ? "none" : "auto",
        boxSizing: "border-box",
        outlineOffset: 2,
      }}
    >
      <span
        style={{
          position: "absolute", top: -20, left: -2,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          color: "#0e1013", background: handle.color,
          padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
          maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
          opacity: active ? 1 : 0,
        }}
      >
        {handle.label} · {Math.round(box.left)},{Math.round(box.top)}
      </span>
      {/* Resize grip — bottom-right corner, only worth showing once you're
          already interacting with this handle (hover/drag) */}
      {active && <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        title="Drag to resize"
        style={{
          position: "absolute",
          right: -6, bottom: -6,
          width: 12, height: 12,
          borderRadius: 3,
          background: handle.color,
          border: "1px solid #0e1013",
          cursor: "nwse-resize",
          pointerEvents: "auto",
        }}
      />}
    </div>
  );
};
