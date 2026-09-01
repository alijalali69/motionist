import React from "react";
import { Thumbnail } from "@remotion/player";
import { WebpageSectionThumb } from "../../src/WebpageSectionThumb";
import type { Project } from "../../src/types";
import { CanvasHandles, type Handle } from "./CanvasHandles";
import { PhotoPanHandles, type PhotoPanTarget } from "./PhotoPanHandles";
import { TextPlacementOverlay } from "./TextPlacementOverlay";

// Default section height for a newly-added webpage page — exported so
// App.tsx's page-creation handlers (Sequence/Page) can use the same number
// instead of a second hardcoded copy drifting out of sync with this one.
export const DEFAULT_SECTION_HEIGHT = 480;

// The webpage editor's canvas: every page stacked vertically as its own
// scrollable section (space slices), instead of a reel's one-frame-at-a-time
// Player (time slices). Only the SELECTED section is interactive — its own
// CanvasHandles/PhotoPanHandles/text-tool overlay mount inside its own
// wrapper div, reusing those components completely unchanged (they already
// only need a wrapperRef + a [width,height] canvas pair, which a section
// provides just as well as the old single-frame player did). Unselected
// sections are a plain static thumbnail — click one to select it, same as
// clicking it in the left page list.
export const WebpageCanvas: React.FC<{
  project: Project;
  selected: number;
  onSelect: (i: number) => void;
  handles: Handle[]; // built by the caller, already scoped to the SELECTED page's own layers
  photoPanTargets: PhotoPanTarget[]; // same — selected page only
  textTool: boolean;
  onPlaceText: (box: { left: number; top: number; width: number; height: number }) => void;
  onCancelTextTool: () => void;
}> = ({ project, selected, onSelect, handles, photoPanTargets, textTool, onPlaceText, onCancelTextTool }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const selectedWrapperRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = containerWidth ? containerWidth / project.width : 0;

  return (
    <div ref={containerRef} style={{ width: "100%", maxWidth: 720, maxHeight: "80vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {project.pages.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "60px 20px" }}>
          No sections yet — use Sequence or Page on the left to add one.
        </p>
      )}
      {project.pages.map((page, i) => {
        const heightPx = page.heightPx ?? DEFAULT_SECTION_HEIGHT;
        const isSelected = i === selected;
        return (
          <div
            key={page.id}
            ref={isSelected ? selectedWrapperRef : undefined}
            onClick={() => onSelect(i)}
            style={{
              position: "relative", flex: "none", width: "100%",
              height: scale ? heightPx * scale : heightPx,
              cursor: "pointer", borderRadius: 8, overflow: "hidden",
              outline: isSelected ? "2px solid var(--accent, #3ea6ff)" : "1px solid var(--line, #272c33)",
              outlineOffset: -1,
              boxShadow: isSelected ? "0 8px 30px rgba(0,0,0,0.4)" : undefined,
            }}
          >
            <Thumbnail
              component={WebpageSectionThumb}
              inputProps={{ page }}
              frameToDisplay={0}
              durationInFrames={1}
              compositionWidth={project.width}
              compositionHeight={heightPx}
              fps={project.fps}
              style={{ width: "100%", height: "100%" }}
            />
            {isSelected && (
              <>
                <CanvasHandles wrapperRef={selectedWrapperRef} canvas={[project.width, heightPx]} handles={handles} />
                <PhotoPanHandles wrapperRef={selectedWrapperRef} canvas={[project.width, heightPx]} targets={photoPanTargets} />
                {textTool && (
                  <TextPlacementOverlay
                    wrapperRef={selectedWrapperRef}
                    canvas={[project.width, heightPx]}
                    defaultSize={[Math.round(project.width * 0.5), 80]}
                    onPlace={onPlaceText}
                    onCancel={onCancelTextTool}
                  />
                )}
              </>
            )}
            {/* Which section this is, while scrolling a long stack — same
                idea as a CanvasHandles label, but for the section itself. */}
            <div style={{
              position: "absolute", top: 6, left: 6, pointerEvents: "none",
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: "#fff",
              background: isSelected ? "var(--accent, #3ea6ff)" : "rgba(0,0,0,0.5)",
              padding: "2px 7px", borderRadius: 4,
            }}>
              {i + 1}. {page.name ?? "Section"}
            </div>
          </div>
        );
      })}
    </div>
  );
};
