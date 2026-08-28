import type { CommandRibbonPresentationValueItem } from "../components/CommandRibbonView";

export type VscodeViewportWorldPoint = { x: number; y: number };

export type VscodeViewportStatusViewport = { zoom: number };

// Approximate rendered pixels for the fixed 5ch/8ch/8ch status grid, its gaps, and padding.
export const VSCODE_VIEWPORT_STATUS_ESTIMATED_WIDTH = 188;

export const formatVscodeViewportZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;

export const formatVscodeViewportCoordinate = (coordinate: number | null): string =>
  coordinate === null ? "—" : coordinate.toFixed(1);

export const vscodeViewportStatusFields = (
  viewport: VscodeViewportStatusViewport,
  pointerWorldPoint: VscodeViewportWorldPoint | null
) => [
  { label: "ZOOM", value: formatVscodeViewportZoom(viewport.zoom) },
  { label: "X", value: formatVscodeViewportCoordinate(pointerWorldPoint?.x ?? null) },
  { label: "Y", value: formatVscodeViewportCoordinate(pointerWorldPoint?.y ?? null) }
];

export const vscodeViewportStatusPresentationFor = (
  id: string,
  viewport: VscodeViewportStatusViewport,
  pointerWorldPoint: VscodeViewportWorldPoint | null,
  label = "Viewport status",
  description = "Current viewport zoom and pointer position."
): CommandRibbonPresentationValueItem => ({
  id,
  type: "value",
  label,
  description,
  estimatedWidth: VSCODE_VIEWPORT_STATUS_ESTIMATED_WIDTH,
  fields: vscodeViewportStatusFields(viewport, pointerWorldPoint)
});
