import type { CommandRibbonPresentationValueItem } from "../components/CommandRibbonView";
import type { CanvasViewport } from "../state/cadUiStore";

export type VscodeCanvasWorldPoint = { x: number; y: number };

// Approximate rendered pixels for the fixed 5ch/8ch/8ch status grid, its gaps, and padding.
export const VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH = 188;

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

export const vscodeCanvasStatusPresentationFor = (
  id: string,
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null
): CommandRibbonPresentationValueItem => ({
  id,
  type: "value",
  label: "Canvas status",
  description: "Current Canvas zoom and pointer position.",
  estimatedWidth: VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH,
  fields: vscodeCanvasStatusFields(canvasViewport, pointerWorldPoint)
});
