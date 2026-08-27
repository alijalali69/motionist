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
const PageCard: React.FC<{
  project: Project;
  page: Project["pages"][number];
  cardH: number;
  selected: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
}> = ({ project, page, cardH, selected, onClick, onDragStart, onDragOver, onDragEnd }) => {
  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
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
};

export const StoryboardStrip: React.FC<{
  project: Project;
  selected: number;
  onSelect: (i: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}> = ({ project, selected, onSelect, onReorder }) => {
  const [offset, setOffset] = React.useState(0);
  const [showAll, setShowAll] = React.useState(false);
  const dragFromRef = React.useRef<number | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const rectsRef = React.useRef<Map<string, DOMRect>>(new Map());
  const showAllRef = React.useRef(showAll);
  showAllRef.current = showAll;

  const pages = project.pages;
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
  });

  const onCardDragOver = (overIndex: number) => {
    const from = dragFromRef.current;
    if (from === null || from === overIndex) return;
    captureRects();
    onReorder(from, overIndex);
    dragFromRef.current = overIndex;
  };

  // React's onWheel is attached passive by default, so e.preventDefault()
  // inside it silently no-ops (and logs a warning) — the page would scroll
  // along with the strip. A real addEventListener with {passive:false} is
  // the only way to actually claim the wheel gesture for the strip alone.
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (showAllRef.current) return;
      e.preventDefault();
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
            transition: showAll ? undefined : "transform 0.25s ease",
          }}>
            {pages.map((page, i) => (
              <div key={page.id} data-page-id={page.id}>
                <PageCard
                  project={project} page={page} cardH={cardH} selected={i === selected}
                  onClick={() => onSelect(i)}
                  onDragStart={() => { dragFromRef.current = i; }}
                  onDragOver={() => onCardDragOver(i)}
                  onDragEnd={() => { dragFromRef.current = null; }}
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
