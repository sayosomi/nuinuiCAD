import type { CanvasLayerRow } from "../model/canvasLayerPresentation";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type CanvasLayerPanelPosition = { left: number; top: number };
type CanvasLayerPanelDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: CanvasLayerPanelPosition;
};

const INITIAL_POSITION: CanvasLayerPanelPosition = { left: 12, top: 12 };
const VIEWPORT_GUTTER = 4;

export const CanvasLayerPanel = ({
  layers,
  hiddenLayerIds,
  onToggle
}: {
  layers: readonly CanvasLayerRow[];
  hiddenLayerIds: ReadonlySet<string>;
  onToggle: (layerId: string) => void;
}) => {
  const panelRef = useRef<HTMLFieldSetElement>(null);
  const dragRef = useRef<CanvasLayerPanelDrag | null>(null);
  const [position, setPosition] = useState(INITIAL_POSITION);

  const clampPosition = useCallback((next: CanvasLayerPanelPosition): CanvasLayerPanelPosition => {
    const panel = panelRef.current;
    const viewport = panel?.closest<HTMLElement>(".canvas-viewport");
    if (!panel || !viewport) return next;
    const viewportRect = viewport.getBoundingClientRect();
    const width = viewport.clientWidth || viewportRect.width;
    const height = viewport.clientHeight || viewportRect.height;
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || panel.offsetWidth;
    const panelHeight = panelRect.height || panel.offsetHeight;
    return {
      left: Math.min(Math.max(VIEWPORT_GUTTER, next.left), Math.max(VIEWPORT_GUTTER, width - panelWidth - VIEWPORT_GUTTER)),
      top: Math.min(Math.max(VIEWPORT_GUTTER, next.top), Math.max(VIEWPORT_GUTTER, height - panelHeight - VIEWPORT_GUTTER))
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    const viewport = panel?.closest<HTMLElement>(".canvas-viewport");
    if (!panel || !viewport) return undefined;
    const reclamp = () => setPosition((current) => clampPosition(current));
    window.addEventListener("resize", reclamp);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reclamp);
    observer?.observe(viewport);
    observer?.observe(panel);
    return () => {
      window.removeEventListener("resize", reclamp);
      observer?.disconnect();
    };
  }, [clampPosition]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) return;
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
    setPosition(clampPosition({
      left: drag.startPosition.left + event.clientX - drag.startClientX,
      top: drag.startPosition.top + event.clientY - drag.startClientY
    }));
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
        className="canvas-layer-move-handle"
        aria-label="Move Layers panel"
        title="Drag to move Layers panel"
        onPointerDown={beginDrag}
        onClick={(event) => event.stopPropagation()}
      >
        <span aria-hidden="true">⠿</span>
        <span>Move</span>
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
