import type { CanvasViewport } from "../state/cadUiStore";

export type VscodeCanvasWorldPoint = { x: number; y: number };

export const formatVscodeCanvasZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;

export const formatVscodeCanvasCoordinate = (coordinate: number | null): string =>
  coordinate === null ? "—" : coordinate.toFixed(1);

export const vscodeCanvasStatusFields = (
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null
) => [
  { label: "ZOOM", value: formatVscodeCanvasZoom(canvasViewport.zoom) },
  { label: "X", value: formatVscodeCanvasCoordinate(pointerWorldPoint?.x ?? null) },
  { label: "Y", value: formatVscodeCanvasCoordinate(pointerWorldPoint?.y ?? null) }
];
