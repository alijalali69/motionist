import React from "react";

// A guided tour that points at the REAL app — spotlight + tooltip anchored
// to actual DOM elements (marked with data-tour="...") — not a static
// slideshow. Runs once automatically on first launch (localStorage flag),
// replayable any time from the Dashboard's "Take the tour" button or the
// shortcuts cheatsheet's "Replay tutorial" link.
//
// How steps advance: a plain "Next" click for most steps. One step (start
// a project) is special — there's no single click to wait for (the user
// picks a size, then types a name, then confirms a modal), so instead of
// trying to intercept that whole flow, it just polls for the EDITOR's own
// anchor to appear and auto-advances once it does. Simpler and more robust
// than hooking into Dashboard's create-project logic at all.

type Step = {
  id: string;
  selector: string | null; // null = centered, no spotlight (the closing step)
  title: string;
  body: string;
  waitForSelector?: string; // if set, shown instead of Next; auto-advances once this appears
};

const STEPS: Step[] = [
  {
    id: "welcome",
    selector: '[data-tour="dash-header"]',
    title: "Welcome to Motionist",
    body: "This turns a layered design — a Photoshop poster, an Illustrator SVG, a plain photo, or nothing at all — into an animated vertical reel. Quick tour of how it works.",
  },
  {
    id: "start-project",
    selector: '[data-tour="size-preset-row"]',
    title: "Start a project",
    body: "Pick a size to begin — Reels/TikTok, YouTube Shorts, whatever fits. Click any card now to continue.",
    waitForSelector: '[data-tour="editor-canvas"]',
  },
  {
    id: "canvas",
    selector: '[data-tour="editor-canvas"]',
    title: "Your canvas",
    body: "Your reel takes shape here — drag, resize, and snap layers directly on it. Add as many pages as you need; each one strings into the final reel.",
  },
  {
    id: "add-page",
    selector: '[data-tour="addpage"]',
    title: "Add a page",
    body: "Each page becomes one segment of the reel, played in order. Click the + now to add your first one.",
    waitForSelector: '[data-tour="add-layer-tools"]',
  },
  {
    id: "add-layers",
    selector: '[data-tour="add-layer-tools"]',
    title: "Add content",
    body: "Add text, a photo/video, or a shape directly — or bring in a whole layered PSD/SVG design (Import, on the Dashboard) and it auto-splits into layers by name (logo, photo, title, and so on).",
  },
  {
    id: "layers-dock",
    selector: '[data-tour="layers-dock-btn"]',
    title: "Layers",
    body: "Every layer on the page lives here — reorder, rename, or select one to edit it. Select a layer to pick its motion: dozens of ready-made entrance/exit animations, no keyframing required (though real keyframes are there if you want them).",
  },
  {
    id: "render",
    selector: '[data-tour="render-button"]',
    title: "Render",
    body: "When you're happy, render straight to MP4 here — right on your own machine, no upload, no wait in a queue.",
  },
  {
    id: "done",
    selector: null,
    title: "That's it",
    body: "You're ready. Press “?” anytime for the full keyboard shortcuts list — this tour is in there too, if you ever want it again.",
  },
];

const SEEN_KEY = "motionist.tour.seen";

type TourContextValue = {
  active: boolean;
  start: () => void;
};

const TourContext = React.createContext<TourContextValue>({ active: false, start: () => {} });
export const useTour = () => React.useContext(TourContext);

export const TourProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [active, setActive] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);

  const start = React.useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const finish = React.useCallback(() => {
    setActive(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* best-effort */ }
  }, []);

  // Auto-start once, on first-ever launch. App.tsx's own top-level state
  // always starts on the Dashboard (activeId === null), so step 0's own
  // target is reliably there to find.
  React.useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* treat as seen — don't nag if storage is blocked */ }
    if (!seen) start();
  }, [start]);

  const next = React.useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= STEPS.length) { finish(); return i; }
      return i + 1;
    });
  }, [finish]);

  const back = React.useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  return (
    <TourContext.Provider value={{ active, start }}>
      {children}
      {active && (
        <TourOverlay
          step={STEPS[stepIndex]}
          stepNumber={stepIndex + 1}
          totalSteps={STEPS.length}
          onNext={next}
          onBack={stepIndex > 0 ? back : undefined}
          onSkip={finish}
        />
      )}
    </TourContext.Provider>
  );
};

// Re-measures on a rAF loop while showing, not just once — the target's
// position can shift under the tour for lots of reasons here (canvas zoom,
// panel resize, the page simply scrolling), and a stale rect would leave
// the spotlight pointing at empty space instead of tracking the real
// element. Cheap enough for a short-lived overlay.
function useTargetRect(selector: string | null): DOMRect | null {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useEffect(() => {
    if (!selector) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [selector]);
  return rect;
}

// Polls for waitSelector to appear (used by the one step that hands off to
// a real user action — picking a project size — instead of a Next click).
function useWaitForElement(selector: string | undefined, onFound: () => void) {
  React.useEffect(() => {
    if (!selector) return;
    if (document.querySelector(selector)) { onFound(); return; }
    const interval = setInterval(() => {
      if (document.querySelector(selector)) { clearInterval(interval); onFound(); }
    }, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector]);
}

const PAD = 8; // breathing room between the spotlight ring and the real element

const TourOverlay: React.FC<{
  step: Step;
  stepNumber: number;
  totalSteps: number;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
}> = ({ step, stepNumber, totalSteps, onNext, onBack, onSkip }) => {
  const rect = useTargetRect(step.selector);
  useWaitForElement(step.waitForSelector, onNext);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Tooltip placement: below the target if there's room, else above —
  // simple and correct for every real anchor this tour actually uses (all
  // sit in the upper portion of the screen, so "below" is the common case).
  let tooltipStyle: React.CSSProperties;
  if (rect) {
    const spaceBelow = vh - rect.bottom;
    const top = spaceBelow > 160 ? rect.bottom + PAD + 6 : Math.max(12, rect.top - PAD - 6 - 150);
    const left = Math.min(Math.max(12, rect.left), vw - 332);
    tooltipStyle = { position: "fixed", top, left, width: 320 };
  } else {
    tooltipStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 320 };
  }

  return (
    <div className="tour-root">
      {rect ? (
        <>
          {/* Four dark bands around the target instead of an SVG mask —
              same visual "spotlight" result, no mask-compositing edge cases. */}
          <div className="tour-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
          <div className="tour-dim" style={{ left: 0, top: Math.max(0, rect.bottom + PAD), right: 0, bottom: 0 }} />
          <div className="tour-dim" style={{ left: 0, top: Math.max(0, rect.top - PAD), width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
          <div className="tour-dim" style={{ left: rect.right + PAD, top: Math.max(0, rect.top - PAD), right: 0, height: rect.height + PAD * 2 }} />
          <div className="tour-ring" style={{
            left: rect.left - PAD, top: rect.top - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          }} />
        </>
      ) : (
        <div className="tour-dim" style={{ inset: 0 }} />
      )}
      <div className="tour-tooltip" style={tooltipStyle}>
        <div className="tour-step-count">{stepNumber} / {totalSteps}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="btn small" onClick={onSkip}>Skip tour</button>
          <div className="row" style={{ gap: 6 }}>
            {onBack && <button className="btn small" onClick={onBack}>Back</button>}
            {!step.waitForSelector && (
              <button className="btn small primary" onClick={onNext}>
                {stepNumber === totalSteps ? "Done" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
