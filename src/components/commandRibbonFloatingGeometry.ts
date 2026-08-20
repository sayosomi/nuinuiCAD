import type { ViewportSize } from "./canvasViewport";
import {
  RIBBON_BUTTON_PADDING,
  RIBBON_HANDLE_WIDTH,
  type CommandRibbonPresentation
} from "./CommandRibbonView";

export const FLOATING_RIBBON_MARGIN = 8;

export type RibbonPosition = { x: number; y: number };
export type RibbonRenderedSize = { width: number; height: number };

export const estimatedRibbonSize = (
  ribbon: CommandRibbonPresentation
): RibbonRenderedSize => {
  const itemLength = ribbon.items.reduce((total, item) => {
    const labelLength = item.type === "command" && item.showLabel
      ? Math.min(120, Math.max(20, item.label.length * 7)) + 5
      : item.type === "value"
        ? Math.min(140, Math.max(32, item.value.length * 7)) + 5
        : 0;
    return total + ribbon.iconSize + RIBBON_BUTTON_PADDING + labelLength;
  }, 0);
  const itemCount = ribbon.items.length;
  const length = RIBBON_HANDLE_WIDTH + (itemCount > 0 ? itemLength : 0);
  const thickness = ribbon.iconSize + RIBBON_BUTTON_PADDING + 2;
  return ribbon.orientation === "vertical"
    ? { width: thickness, height: length }
    : { width: length, height: thickness };
};

export const clampRibbonPosition = (
  x: number,
  y: number,
  viewportSize: ViewportSize,
  renderedSize: RibbonRenderedSize,
  margin = FLOATING_RIBBON_MARGIN
): RibbonPosition => {
  const maxX = Math.max(0, viewportSize.width - renderedSize.width);
  const maxY = Math.max(0, viewportSize.height - renderedSize.height);
  const minX = maxX >= margin * 2 ? margin : 0;
  const minY = maxY >= margin * 2 ? margin : 0;
  return {
    x: Math.min(Math.max(Math.round(x), minX), Math.max(minX, maxX - margin)),
    y: Math.min(Math.max(Math.round(y), minY), Math.max(minY, maxY - margin))
  };
};

export const defaultRibbonX = (
  viewportSize: ViewportSize,
  ribbon: CommandRibbonPresentation,
  renderedSize = estimatedRibbonSize(ribbon)
): number => Math.max(
  FLOATING_RIBBON_MARGIN,
  Math.round((viewportSize.width - renderedSize.width) / 2)
);
