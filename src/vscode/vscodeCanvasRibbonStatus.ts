import type { CommandRibbonPresentationValueItem } from "../components/CommandRibbonView";
import type { CanvasViewport } from "../state/cadUiStore";
import {
  formatVscodeViewportCoordinate,
  formatVscodeViewportZoom,
  VSCODE_VIEWPORT_STATUS_ESTIMATED_WIDTH,
  vscodeViewportStatusFields,
  type VscodeViewportWorldPoint
} from "./vscodeViewportStatus";

export type VscodeCanvasWorldPoint = VscodeViewportWorldPoint;

export const VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH = VSCODE_VIEWPORT_STATUS_ESTIMATED_WIDTH;

export const formatVscodeCanvasZoom = formatVscodeViewportZoom;

export const formatVscodeCanvasCoordinate = formatVscodeViewportCoordinate;

export const vscodeCanvasStatusFields = (
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null
) => vscodeViewportStatusFields(canvasViewport, pointerWorldPoint);

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
  fields: vscodeViewportStatusFields(canvasViewport, pointerWorldPoint)
});
