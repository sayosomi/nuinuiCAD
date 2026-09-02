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
  pointerWorldPoint: VscodeCanvasWorldPoint | null,
  labels?: { zoom: string; x: string; y: string }
) => vscodeViewportStatusFields(canvasViewport, pointerWorldPoint, labels);

export const vscodeCanvasStatusPresentationFor = (
  id: string,
  canvasViewport: CanvasViewport,
  pointerWorldPoint: VscodeCanvasWorldPoint | null,
  label = "Canvas status",
  description = "Current Canvas zoom and pointer position.",
  labels?: { zoom: string; x: string; y: string }
): CommandRibbonPresentationValueItem => ({
  id,
  type: "value",
  label,
  description,
  estimatedWidth: VSCODE_CANVAS_STATUS_ESTIMATED_WIDTH,
  fields: vscodeViewportStatusFields(canvasViewport, pointerWorldPoint, labels)
});
