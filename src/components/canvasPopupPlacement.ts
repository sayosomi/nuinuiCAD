import type { ViewportSize } from "./canvasViewport";
import type { ScreenPoint } from "./DrawingCanvasHitTest";

export const CANVAS_POPUP_OFFSET_PX = 12;
export const CANVAS_POPUP_MARGIN_PX = 8;

export type CanvasPopupSize = {
  width: number;
  height: number;
};

export type CanvasPopupPlacement = {
  left: number;
  top: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

/** Place a Canvas popup from a pointer, flipping before clamping to the viewport. */
export const placeCanvasPopup = (
  pointer: ScreenPoint,
  popup: CanvasPopupSize,
  viewport: ViewportSize,
  offset = CANVAS_POPUP_OFFSET_PX,
  margin = CANVAS_POPUP_MARGIN_PX
): CanvasPopupPlacement => {
  const width = Math.max(0, Number.isFinite(popup.width) ? popup.width : 0);
  const height = Math.max(0, Number.isFinite(popup.height) ? popup.height : 0);
  const viewportWidth = Math.max(0, Number.isFinite(viewport.width) ? viewport.width : 0);
  const viewportHeight = Math.max(0, Number.isFinite(viewport.height) ? viewport.height : 0);
  const safePointer = {
    x: Number.isFinite(pointer.x) ? pointer.x : 0,
    y: Number.isFinite(pointer.y) ? pointer.y : 0
  };
  const right = safePointer.x + offset;
  const down = safePointer.y + offset;
  const leftFlipped = safePointer.x - offset - width;
  const topFlipped = safePointer.y - offset - height;
  const rightFits = right + width <= viewportWidth - margin;
  const downFits = down + height <= viewportHeight - margin;
  const preferredLeft = rightFits ? right : leftFlipped;
  const preferredTop = downFits ? down : topFlipped;
  const maxLeft = viewportWidth - width - margin;
  const maxTop = viewportHeight - height - margin;
  return {
    left: clamp(preferredLeft, margin, maxLeft),
    top: clamp(preferredTop, margin, maxTop)
  };
};
