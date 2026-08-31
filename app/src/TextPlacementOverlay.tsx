import React from "react";

// The text tool's "click or drag on the canvas to place it" surface — sits
// on top of the Player (and above CanvasHandles/PhotoPanHandles, which is
// the whole point: while this is up, it owns every click on the preview,
// same as any real design tool's armed placement tool). Same
// wrapperRef->scale math as CanvasHandles, since it needs to convert real
// screen coordinates into canvas-space ones the same way.
const MIN_SIZE = 16; // canvas px — matches CanvasHandles' own resize floor
const CLICK_THRESHOLD = 5; // screen px of movement below which this counts as a click, not a drag

export const TextPlacementOverlay: React.FC<{
  wrapperRef: React.RefObject<HTMLDivElement>;
  canvas: [number, number];
  defaultSize: [number, number]; // canvas px — the box a plain click (no drag) produces
  onPlace: (box: { left: number; top: number; width: number; height: number }) => void;
  onCancel: () => void;
}> = ({ wrapperRef, canvas, defaultSize, onPlace, onCancel }) => {
  const [cw, ch] = canvas;
  const [defaultW, defaultH] = defaultSize;
  const [scale, setScale] = React.useState(0);
  const [preview, setPreview] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const dragRef = React.useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setScale(el.getBoundingClientRect().width / cw);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapperRef, cw]);

  // Esc backs out of the tool without placing anything — same convention as
  // closing a modal or cancelling an in-progress rename elsewhere in the app.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const toCanvasPoint = (clientX: number, clientY: number) => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    const s = rect.width / cw;
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e.clientX, e.clientY);
    dragRef.current = { startClientX: e.clientX, startClientY: e.clientY, startX: p.x, startY: p.y };
    setPreview({ left: p.x, top: p.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const p = toCanvasPoint(e.clientX, e.clientY);
    const { startX, startY } = dragRef.current;
    setPreview({
      left: Math.min(startX, p.x),
      top: Math.min(startY, p.y),
      width: Math.abs(p.x - startX),
      height: Math.abs(p.y - startY),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const movedScreenPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
    if (movedScreenPx < CLICK_THRESHOLD) {
      // A plain click — default-sized box centered on where they clicked,
      // clamped so it never hangs off the edge of the canvas.
      const p = toCanvasPoint(e.clientX, e.clientY);
      const left = Math.max(0, Math.min(cw - defaultW, Math.round(p.x - defaultW / 2)));
      const top = Math.max(0, Math.min(ch - defaultH, Math.round(p.y - defaultH / 2)));
      onPlace({ left, top, width: defaultW, height: defaultH });
    } else if (preview) {
      onPlace({
        left: Math.round(preview.left),
        top: Math.round(preview.top),
        width: Math.max(MIN_SIZE, Math.round(preview.width)),
        height: Math.max(MIN_SIZE, Math.round(preview.height)),
      });
    }
    dragRef.current = null;
    setPreview(null);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ position: "absolute", inset: 0, zIndex: 3, cursor: "crosshair" }}
      title="Click for a text box, or drag to draw one — Esc to cancel"
    >
      {preview && scale > 0 && (
        <div style={{
          position: "absolute",
          left: preview.left * scale, top: preview.top * scale,
          width: preview.width * scale, height: preview.height * scale,
          border: "2px dashed var(--accent, #3ea6ff)",
          background: "rgba(62, 166, 255, 0.12)",
          pointerEvents: "none",
        }} />
      )}
    </div>
  );
};
