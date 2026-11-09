import type { CanvasLayerRow } from "../model/canvasLayerPresentation";

export const CanvasLayerPanel = ({
  layers,
  hiddenLayerIds,
  onToggle
}: {
  layers: readonly CanvasLayerRow[];
  hiddenLayerIds: ReadonlySet<string>;
  onToggle: (layerId: string) => void;
}) => (
  <fieldset
    className="canvas-layer-panel"
    aria-label="Canvas layer visibility"
    onPointerDown={(event) => event.stopPropagation()}
    onPointerMove={(event) => event.stopPropagation()}
    onPointerUp={(event) => event.stopPropagation()}
    onPointerCancel={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}
  >
    <legend>Layers</legend>
    <div className="canvas-layer-list">
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
