import type { CanvasLayerRow } from "../model/canvasLayerPresentation";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";

type CanvasLayerPanelPosition = { left: number; top: number };
type CanvasLayerPanelSize = { width: number; height: number };
type CanvasLayerPanelRect = CanvasLayerPanelPosition & { right: number; bottom: number };
type CanvasLayerPanelDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: CanvasLayerPanelPosition;
};
type CanvasLayerPanelLayout = {
  viewport: CanvasLayerPanelSize;
  panel: CanvasLayerPanelSize;
  origin: CanvasLayerPanelPosition;
};

const INITIAL_POSITION: CanvasLayerPanelPosition = { left: 12, top: 12 };
const VIEWPORT_GUTTER = 4;
const RIBBON_CLEARANCE = 8;

const rectFor = (element: HTMLElement): DOMRect => element.getBoundingClientRect();

const layoutFor = (panel: HTMLFieldSetElement, viewport: HTMLElement): CanvasLayerPanelLayout => {
  const viewportRect = rectFor(viewport);
  const panelRect = rectFor(panel);
  return {
    viewport: {
      width: viewport.clientWidth || viewportRect.width,
      height: viewport.clientHeight || viewportRect.height
    },
    panel: {
      width: panelRect.width || panel.offsetWidth,
      height: panelRect.height || panel.offsetHeight
    },
    origin: {
      left: viewportRect.left + viewport.clientLeft,
      top: viewportRect.top + viewport.clientTop
    }
  };
};

const clampPosition = (
  next: CanvasLayerPanelPosition,
  layout: CanvasLayerPanelLayout,
  minimumTop = VIEWPORT_GUTTER
): CanvasLayerPanelPosition => {
  const minLeft = VIEWPORT_GUTTER;
  const maxLeft = Math.max(minLeft, layout.viewport.width - layout.panel.width - VIEWPORT_GUTTER);
  const maxTop = Math.max(VIEWPORT_GUTTER, layout.viewport.height - layout.panel.height - VIEWPORT_GUTTER);
  const minTop = Math.min(Math.max(VIEWPORT_GUTTER, minimumTop), maxTop);
  return {
    left: Math.min(Math.max(minLeft, next.left), maxLeft),
    top: Math.min(Math.max(minTop, next.top), maxTop)
  };
};

const visibleElement = (element: HTMLElement): boolean => {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0 ||
      current.hidden ||
      current.getAttribute("aria-hidden") === "true"
    ) return false;
    current = current.parentElement;
  }
  return true;
};

const ribbonRectsFor = (
  viewport: HTMLElement,
  origin: CanvasLayerPanelPosition
): CanvasLayerPanelRect[] => {
  const layer = viewport.querySelector<HTMLElement>(".command-ribbon-layer");
  if (!layer) return [];
  const rectangles: CanvasLayerPanelRect[] = [];
  for (const child of Array.from(layer.children)) {
    if (!(child instanceof HTMLElement) || child.tagName !== "DIV") continue;
    const ribbon = child.firstElementChild;
    if (!(ribbon instanceof HTMLElement) || !ribbon.classList.contains("command-ribbon") || ribbon.childElementCount === 0) continue;
    if (!visibleElement(child) || !visibleElement(ribbon)) continue;
    const rect = rectFor(child);
    const width = rect.width || rect.right - rect.left;
    const height = rect.height || rect.bottom - rect.top;
    if (!(Number.isFinite(width) && Number.isFinite(height)) || width <= 0 || height <= 0) continue;
    rectangles.push({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top
    });
  }
  return rectangles.sort((a, b) => a.top - b.top || a.left - b.left || a.bottom - b.bottom || a.right - b.right);
};

const intersectionArea = (panel: CanvasLayerPanelPosition, panelSize: CanvasLayerPanelSize, obstacle: CanvasLayerPanelRect): number => {
  const width = Math.max(0, Math.min(panel.left + panelSize.width, obstacle.right) - Math.max(panel.left, obstacle.left));
  const height = Math.max(0, Math.min(panel.top + panelSize.height, obstacle.bottom) - Math.max(panel.top, obstacle.top));
  return width * height;
};

const initialPositionFor = (
  layout: CanvasLayerPanelLayout,
  ribbonRects: CanvasLayerPanelRect[],
  topInset: number
): CanvasLayerPanelPosition => {
  const minimumTop = Math.max(VIEWPORT_GUTTER, topInset + VIEWPORT_GUTTER);
  const bounds = clampPosition({ left: 0, top: minimumTop }, layout, minimumTop);
  const maxLeft = Math.max(VIEWPORT_GUTTER, layout.viewport.width - layout.panel.width - VIEWPORT_GUTTER);
  const maxTop = Math.max(VIEWPORT_GUTTER, layout.viewport.height - layout.panel.height - VIEWPORT_GUTTER);
  const obstacles = ribbonRects.map((rect) => ({
    left: rect.left - RIBBON_CLEARANCE,
    top: rect.top - RIBBON_CLEARANCE,
    right: rect.right + RIBBON_CLEARANCE,
    bottom: rect.bottom + RIBBON_CLEARANCE
  }));
  const candidates: CanvasLayerPanelPosition[] = [];
  const addCandidate = (next: CanvasLayerPanelPosition) => {
    if (!(Number.isFinite(next.left) && Number.isFinite(next.top))) return;
    const bounded = clampPosition(next, layout, minimumTop);
    if (candidates.some((candidate) => candidate.left === bounded.left && candidate.top === bounded.top)) return;
    candidates.push(bounded);
  };

  // Keep a stable preference: upper-right first, then positions directly around
  // each measured ribbon, then the remaining critical viewport positions.
  addCandidate({ left: maxLeft, top: bounds.top });
  for (const obstacle of obstacles) {
    addCandidate({ left: obstacle.right - layout.panel.width, top: obstacle.bottom });
    addCandidate({ left: obstacle.right, top: obstacle.top });
    addCandidate({ left: obstacle.left - layout.panel.width, top: obstacle.top });
    addCandidate({ left: obstacle.right - layout.panel.width, top: obstacle.top - layout.panel.height });
  }
  addCandidate({ left: VIEWPORT_GUTTER, top: bounds.top });
  addCandidate({ left: maxLeft, top: maxTop });
  addCandidate({ left: VIEWPORT_GUTTER, top: maxTop });

  // These rectangle-edge combinations include the breakpoints of the overlap
  // area function, so the fallback can choose the true minimum among in-bounds
  // placements when no collision-free placement fits.
  const leftPositions = new Set([VIEWPORT_GUTTER, maxLeft]);
  const topPositions = new Set([bounds.top, maxTop]);
  for (const obstacle of obstacles) {
    leftPositions.add(clampPosition({ left: obstacle.left - layout.panel.width, top: bounds.top }, layout, minimumTop).left);
    leftPositions.add(clampPosition({ left: obstacle.right, top: bounds.top }, layout, minimumTop).left);
    topPositions.add(clampPosition({ left: VIEWPORT_GUTTER, top: obstacle.top - layout.panel.height }, layout, minimumTop).top);
    topPositions.add(clampPosition({ left: VIEWPORT_GUTTER, top: obstacle.bottom }, layout, minimumTop).top);
  }
  const gridCandidates = Array.from(topPositions)
    .sort((a, b) => a - b)
    .flatMap((top) => Array.from(leftPositions).sort((a, b) => b - a).map((left) => ({ left, top })));
  for (const candidate of gridCandidates) addCandidate(candidate);

  let best = candidates[0] ?? clampPosition(INITIAL_POSITION, layout, minimumTop);
  let bestOverlap = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const overlap = obstacles.reduce((total, obstacle) => total + intersectionArea(candidate, layout.panel, obstacle), 0);
    if (overlap === 0) return candidate;
    if (overlap < bestOverlap) {
      best = candidate;
      bestOverlap = overlap;
    }
  }
  return best;
};

export const CanvasLayerPanel = ({
  layers,
  hiddenLayerIds,
  onToggle,
  topInset = 0
}: {
  layers: readonly CanvasLayerRow[];
  hiddenLayerIds: ReadonlySet<string>;
  onToggle: (layerId: string) => void;
  topInset?: number;
}) => {
  const panelRef = useRef<HTMLFieldSetElement>(null);
  const dragRef = useRef<CanvasLayerPanelDrag | null>(null);
  const manuallyPositionedRef = useRef(false);
  const [position, setPosition] = useState(INITIAL_POSITION);
  const safeTopInset = Number.isFinite(topInset) ? Math.max(0, topInset) : 0;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const viewport = panel?.closest<HTMLElement>(".canvas-viewport");
    if (!panel || !viewport) return undefined;

    const measureAndPlace = () => {
      const layout = layoutFor(panel, viewport);
      const measuredRibbons = ribbonRectsFor(viewport, layout.origin);
      if (manuallyPositionedRef.current) {
        setPosition((current) => {
          const next = clampPosition(current, layout);
          return current.left === next.left && current.top === next.top ? current : next;
        });
        return;
      }
      const next = initialPositionFor(layout, measuredRibbons, safeTopInset);
      setPosition((current) => current.left === next.left && current.top === next.top ? current : next);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measureAndPlace);
    const layerObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      observeRibbonContainers();
      measureAndPlace();
    });
    const viewportObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      syncRibbonLayer();
      measureAndPlace();
    });
    let ribbonLayer: HTMLElement | null = null;
    const observedRibbonContainers = new Set<Element>();

    const observeRibbonContainers = () => {
      for (const observed of Array.from(observedRibbonContainers)) {
        if (observed.parentElement === ribbonLayer) continue;
        resizeObserver?.unobserve(observed);
        observedRibbonContainers.delete(observed);
      }
      for (const child of Array.from(ribbonLayer?.children ?? [])) {
        if (!(child instanceof HTMLElement) || child.tagName !== "DIV" || observedRibbonContainers.has(child)) continue;
        observedRibbonContainers.add(child);
        resizeObserver?.observe(child);
      }
    };

    const syncRibbonLayer = () => {
      const nextLayer = viewport.querySelector<HTMLElement>(".command-ribbon-layer");
      if (nextLayer !== ribbonLayer) {
        layerObserver?.disconnect();
        for (const observed of observedRibbonContainers) resizeObserver?.unobserve(observed);
        observedRibbonContainers.clear();
        ribbonLayer = nextLayer;
        if (ribbonLayer) {
          layerObserver?.observe(ribbonLayer, {
            attributes: true,
            attributeFilter: ["aria-hidden", "class", "hidden", "style"],
            childList: true,
            subtree: true
          });
        }
      }
      observeRibbonContainers();
    };

    resizeObserver?.observe(viewport);
    resizeObserver?.observe(panel);
    viewportObserver?.observe(viewport, { childList: true });
    syncRibbonLayer();
    window.addEventListener("resize", measureAndPlace);
    measureAndPlace();

    let initialFrame: number | null = null;
    if (typeof window.requestAnimationFrame === "function") {
      initialFrame = window.requestAnimationFrame(() => {
        initialFrame = null;
        measureAndPlace();
      });
    }

    return () => {
      window.removeEventListener("resize", measureAndPlace);
      resizeObserver?.disconnect();
      layerObserver?.disconnect();
      viewportObserver?.disconnect();
      if (initialFrame !== null) window.cancelAnimationFrame(initialFrame);
    };
  }, [safeTopInset]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) return;
    manuallyPositionedRef.current = true;
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: position
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePanel = (event: ReactPointerEvent<HTMLFieldSetElement>) => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = panelRef.current;
    const viewport = panel?.closest<HTMLElement>(".canvas-viewport");
    if (!panel || !viewport) return;
    setPosition(clampPosition({
      left: drag.startPosition.left + event.clientX - drag.startClientX,
      top: drag.startPosition.top + event.clientY - drag.startClientY
    }, layoutFor(panel, viewport)));
  };

  const endDrag = (event: ReactPointerEvent<HTMLFieldSetElement>) => {
    event.stopPropagation();
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <fieldset
      ref={panelRef}
      className="canvas-layer-panel"
      aria-label="Canvas layer visibility"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={movePanel}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onWheel={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <legend>Layers</legend>
      <button
        type="button"
        className="canvas-layer-move-handle command-ribbon-handle"
        aria-label="Move Layers panel"
        title="Drag to move Layers panel"
        onPointerDown={beginDrag}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="command-ribbon-grip" aria-hidden="true">⋮⋮</span>
      </button>
      <div className="canvas-layer-list" role="group" aria-label="Layer visibility list">
        {layers.map((layer) => (
          <label className="canvas-layer-row" key={layer.id} title={layer.label}>
            <input
              type="checkbox"
              aria-label={`Show layer ${layer.label}`}
              checked={!hiddenLayerIds.has(layer.id)}
              onChange={() => onToggle(layer.id)}
            />
            <span>{layer.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};
