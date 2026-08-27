import React from "react";
import { Thumbnail } from "@remotion/player";
import { PageThumb } from "../../src/PageThumb";
import type { Project } from "../../src/types";

const CARD_W = 100; // fixed — this is what the carousel's horizontal math (VIEW_W, GAP, clamping) is built around
const GAP = 6;
const VIEW_W = 620; // scaled up with CARD_W so roughly the same number of cards stay visible at once

// One page's live-content thumbnail — a single static Remotion frame (not a
// running Player), cheap enough to have many on screen. Falls back to a
// plain placeholder if the page has no layers yet (Thumbnail still renders
// fine for that, this is just for a slightly nicer empty state).
// Memoized so a card only re-renders when ITS OWN props actually change —
// without this, every scroll tick (offset changing in the parent) re-runs
// every card's render, and each one holds a real Remotion composition
// (Thumbnail), not a cheap <img>. That was the single biggest source of the
// lag: N live compositions re-evaluating on every wheel tick instead of
// just having their container's transform slide underneath them.
const PageCard = React.memo<{
  project: Project;
  page: Project["pages"][number];
  index: number;
  cardH: number;
  selected: boolean;
  onSelect: (i: number) => void;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDragEnd: () => void;
}>(({ project, page, index, cardH, selected, onSelect, onDragStart, onDragOver, onDragEnd }) => {
  return (
    <div
      draggable
      onClick={() => onSelect(index)}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
      title={page.name ?? page.id}
      style={{
        width: CARD_W, height: cardH, flexShrink: 0, borderRadius: 4, cursor: "grab",
        border: `2px solid ${selected ? "#d9694f" : "transparent"}`,
        boxSizing: "border-box", overflow: "hidden", opacity: selected ? 1 : 0.75,
        transition: "opacity 0.15s",
      }}
    >
      <Thumbnail
        component={PageThumb}
        inputProps={{ project, page }}
        frameToDisplay={0}
        durationInFrames={Math.max(1, page.durationInFrames)}
        compositionWidth={project.width}
        compositionHeight={project.height}
        fps={project.fps}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
});

export const StoryboardStrip: React.FC<{
  project: Project;
  selected: number;
  onSelect: (i: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}> = ({ project, selected, onSelect, onReorder }) => {
  const [offset, setOffset] = React.useState(0);
  const [showAll, setShowAll] = React.useState(false);
  // Live drag state lives ENTIRELY in refs, never in project state — onReorder
  // (App.tsx's reorderPages) deep-clones the whole project and re-renders the
  // whole editor on every call, which is fine for one commit but was being
  // called on every dragover tick (dragover fires as fast as mousemove).
  // Local reordering during the drag is instant; the real project only gets
  // touched ONCE, at drag-end, with the net from -> to move.
  const draggedIdRef = React.useRef<string | null>(null);
  const dragStartIndexRef = React.useRef<number | null>(null);
  const localIdsRef = React.useRef<string[] | null>(null);
  const [, forceTick] = React.useReducer((c: number) => c + 1, 0);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const rectsRef = React.useRef<Map<string, DOMRect>>(new Map());
  const showAllRef = React.useRef(showAll);
  showAllRef.current = showAll;

  const pages = project.pages;
  // Display order — the real project order, unless a drag is actively
  // reordering things locally (see the drag handlers below). Plain
  // computation, not useMemo — a ref mutation wouldn't reliably invalidate a
  // memo anyway, and mapping a handful of ids is cheap enough not to matter.
  const localIds = localIdsRef.current;
  const displayPages = localIds
    ? (() => {
        const byId = new Map(pages.map((p) => [p.id, p]));
        return localIds.map((id) => byId.get(id)).filter((p): p is Project["pages"][number] => !!p);
      })()
    : pages;
  const selectedId = pages[selected]?.id;
  // Height follows the PROJECT's own aspect ratio — a landscape (16:9)
  // project gets short-wide cards, a square one gets square cards, etc.
  // Width stays fixed since that's what the horizontal carousel math below
  // is built around.
  const cardH = Math.round(CARD_W * (project.height / project.width));
  const maxOffset = Math.max(0, pages.length * (CARD_W + GAP) - GAP - VIEW_W);
  // Clamp AT the state update, not just at render — clamping only the
  // rendered value while letting `offset` itself drift past the bound means
  // one more scroll/click past the edge silently "spends" itself on nothing
  // visible, and the strip needs an equally oversized nudge back before it
  // visibly responds again. This keeps offset itself always in-range, so
  // every input responds immediately in both directions.
  const clampOffset = (v: number) => Math.max(0, Math.min(v, maxOffset));

  // FLIP animation: capture every card's position before a reorder commits,
  // then on the next paint animate from the old position to the new one —
  // so dragging visibly slides the other cards out of the way instead of
  // them just snapping into their new spot.
  const captureRects = () => {
    const map = new Map<string, DOMRect>();
    stripRef.current?.querySelectorAll<HTMLElement>("[data-page-id]").forEach((el) => {
      map.set(el.dataset.pageId!, el.getBoundingClientRect());
    });
    rectsRef.current = map;
  };

  React.useLayoutEffect(() => {
    // Fast path for the vast majority of renders (every scroll tick included)
    // — nothing was captured, so there's nothing to animate. Without this
    // guard this ran a querySelectorAll + getBoundingClientRect (a forced
    // synchronous layout reflow) for every card on EVERY render, which was
    // the other big source of the lag, on top of running inside
    // useLayoutEffect — which blocks paint until it's done.
    if (rectsRef.current.size === 0) return;
    const els = stripRef.current?.querySelectorAll<HTMLElement>("[data-page-id]");
    els?.forEach((el) => {
      const old = rectsRef.current.get(el.dataset.pageId!);
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left, dy = old.top - now.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.2s ease";
        el.style.transform = "translate(0, 0)";
      });
    });
    rectsRef.current = new Map(); // consumed — back to the fast path until the next reorder
  });

  // All three read/write only refs (never React state) so they stay 100%
  // stable references — required for PageCard's memoization to actually
  // hold during a drag, the same way it now holds during a scroll.
  const handleDragStart = React.useCallback((i: number) => {
    // Display order always equals the real page order at the moment a NEW
    // drag starts (handleDragEnd resets localIdsRef to null before this can
    // ever fire again) — reads `pages` directly, not `displayPages`, so this
    // stays stable across an active drag instead of changing identity on
    // every dragover-driven re-render.
    draggedIdRef.current = pages[i]?.id ?? null;
    dragStartIndexRef.current = i;
    localIdsRef.current = pages.map((p) => p.id);
  }, [pages]);

  const handleCardDragOver = React.useCallback((overIndex: number) => {
    const draggedId = draggedIdRef.current;
    const ids = localIdsRef.current;
    if (!draggedId || !ids) return;
    const from = ids.indexOf(draggedId);
    if (from === -1 || from === overIndex) return;
    captureRects();
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(overIndex, 0, moved);
    localIdsRef.current = next;
    forceTick();
  }, []);

  const handleDragEnd = React.useCallback(() => {
    const draggedId = draggedIdRef.current;
    const startIndex = dragStartIndexRef.current;
    const ids = localIdsRef.current;
    if (draggedId && startIndex !== null && ids) {
      const finalIndex = ids.indexOf(draggedId);
      // The ONE point this whole deferred approach exists for — the real
      // project only gets touched once per drag, with the net move, instead
      // of once per dragover tick.
      if (finalIndex !== -1 && finalIndex !== startIndex) onReorder(startIndex, finalIndex);
    }
    draggedIdRef.current = null;
    dragStartIndexRef.current = null;
    localIdsRef.current = null;
    forceTick();
  }, [onReorder]);

  // React's onWheel is attached passive by default, so e.preventDefault()
  // inside it silently no-ops (and logs a warning) — the page would scroll
  // along with the strip. A real addEventListener with {passive:false} is
  // the only way to actually claim the wheel gesture for the strip alone.
  // Also tracks whether a wheel gesture is actively in progress, so the
  // strip's CSS transition (meant for the arrow buttons' discrete jumps) gets
  // turned off during it — a 250ms eased transition re-targeted on every one
  // of a wheel gesture's many rapid ticks reads as the strip laggily
  // "catching up" rather than tracking the wheel directly.
  const [wheeling, setWheeling] = React.useState(false);
  const wheelTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (showAllRef.current) return;
      e.preventDefault();
      setWheeling(true);
      clearTimeout(wheelTimeoutRef.current);
      wheelTimeoutRef.current = setTimeout(() => setWheeling(false), 150);
      setOffset((o) => clampOffset(o + e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [maxOffset]);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <span className="hint" style={{ margin: 0 }}>Storyboard — drag to reorder, wheel or arrows to scroll</span>
        <button className="btn small" onClick={() => { setShowAll((s) => !s); setOffset(0); }}>
          {showAll ? "Carousel view" : "Show all pages"}
        </button>
      </div>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        {!showAll && (
          <button className="btn small" style={{ height: cardH, flexShrink: 0 }}
            onClick={() => setOffset((o) => clampOffset(o - VIEW_W * 0.7))}>‹</button>
        )}
        <div ref={viewportRef} style={{ width: VIEW_W, overflow: "hidden" }}>
          <div ref={stripRef} style={{
            display: "flex", gap: GAP,
            flexWrap: showAll ? "wrap" : "nowrap",
            maxHeight: showAll ? cardH * 2 + GAP : undefined, // ~2 rows before it scrolls, whatever the card height ends up being
            overflowY: showAll ? "auto" : "visible",
            transform: showAll ? "none" : `translateX(-${offset}px)`,
            transition: showAll || wheeling ? "none" : "transform 0.25s ease",
          }}>
            {displayPages.map((page, i) => (
              <div key={page.id} data-page-id={page.id}>
                <PageCard
                  project={project} page={page} index={i} cardH={cardH}
                  selected={page.id === selectedId}
                  onSelect={onSelect}
                  onDragStart={handleDragStart}
                  onDragOver={handleCardDragOver}
                  onDragEnd={handleDragEnd}
                />
              </div>
            ))}
          </div>
        </div>
        {!showAll && (
          <button className="btn small" style={{ height: cardH, flexShrink: 0 }}
            onClick={() => setOffset((o) => clampOffset(o + VIEW_W * 0.7))}>›</button>
        )}
      </div>
    </div>
  );
};
