import React from "react";
import type { Box } from "../../src/types";

export type PhotoPanTarget = {
  id: string;
  box: Box; // the FIXED frame — never moves, only shown for reference
  natural: { width: number; height: number }; // uploaded asset's real pixel size
  panX: number; // 0-100, current object-position X
  panY: number; // 0-100, current object-position Y
  zoom: number; // >=1
  onChange: (panX: number, panY: number) => void;
};

// Lets the user drag the PHOTO within its locked frame to choose which part
// of the image shows — the frame (box) itself is part of the template design
// and never moves; this only changes the crop's object-position. Distinct
// visually (grab cursor, pink outline) from the logo/title move-handles so
// the two interactions don't get confused.
export const PhotoPanHandles: React.FC<{
  wrapperRef: React.RefObject<HTMLDivElement>;
  canvas: [number, number];
  targets: PhotoPanTarget[];
}> = ({ wrapperRef, canvas, targets }) => {
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

  if (!scale || targets.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {targets.map((t) => (
        <PanBox key={t.id} target={t} scale={scale} />
      ))}
    </div>
  );
};

// How much the cover-fit image overflows its frame in each axis (at zoom=1) —
// this is the real pannable range. An axis with zero overflow is locked
// (object-fit:cover already fits that axis exactly; nothing to reveal).
function overflowPx(box: Box, natural: { width: number; height: number }) {
  const frameAspect = box.width / box.height;
  const imgAspect = natural.width / natural.height;
  if (imgAspect > frameAspect) {
    // image relatively wider than the frame -> height matches exactly, width overflows
    const displayedWidth = box.height * imgAspect;
    return { x: Math.max(0, displayedWidth - box.width), y: 0 };
  }
  const displayedHeight = box.width / imgAspect;
  return { x: 0, y: Math.max(0, displayedHeight - box.height) };
}

const PanBox: React.FC<{ target: PhotoPanTarget; scale: number }> = ({ target, scale }) => {
  const { box, natural, panX, panY, onChange } = target;
  const dragRef = React.useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const overflow = overflowPx(box, natural);
  const lockedX = overflow.x === 0;
  const lockedY = overflow.y === 0;

  const onPointerDown = (e: React.PointerEvent) => {
    if (lockedX && lockedY) return; // nothing to pan — image already fits exactly
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dCanvasX = (e.clientX - dragRef.current.startX) / scale;
    const dCanvasY = (e.clientY - dragRef.current.startY) / scale;
    // Dragging the photo right/down should reveal more of its left/top side
    // (grab-and-slide feel) — so the object-position anchor moves opposite
    // to the drag direction.
    const dPanX = overflow.x > 0 ? -(dCanvasX / overflow.x) * 100 : 0;
    const dPanY = overflow.y > 0 ? -(dCanvasY / overflow.y) * 100 : 0;
    const newX = Math.min(100, Math.max(0, dragRef.current.panX + dPanX));
    const newY = Math.min(100, Math.max(0, dragRef.current.panY + dPanY));
    onChange(newX, newY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    setDragging(false);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const canPan = !(lockedX && lockedY);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={canPan ? "Drag to reposition the photo inside its frame" : "This photo already fills its frame exactly — nothing to pan"}
      style={{
        position: "absolute",
        left: box.left * scale,
        top: box.top * scale,
        width: box.width * scale,
        height: box.height * scale,
        border: `2px dashed ${dragging ? "#ff8fd1" : "rgba(255,143,209,0.55)"}`,
        cursor: canPan ? (dragging ? "grabbing" : "grab") : "default",
        pointerEvents: "auto",
        boxSizing: "border-box",
      }}
    >
      {canPan && (
        <span
          style={{
            position: "absolute", top: -20, left: -2,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            color: "#0e1013", background: "#ff8fd1",
            padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap",
          }}
        >
          DRAG PHOTO
        </span>
      )}
    </div>
  );
};
