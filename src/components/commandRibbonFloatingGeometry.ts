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
  const itemLengths = ribbon.items.map((item) => {
    const labelLength = item.type === "command" && item.showLabel
      ? Math.min(120, Math.max(20, item.label.length * 7)) + 5
      : item.type === "value"
        ? Math.min(
            260,
            Math.max(
              48,
              item.fields.reduce(
                (total, field) => total + Math.max(field.label.length, field.value.length) * 7 + 8,
                Math.max(0, item.fields.length - 1) * 4
              )
            )
          ) + 5
        : 0;
    return item.type === "value"
      ? labelLength + 16
      : ribbon.iconSize + RIBBON_BUTTON_PADDING + labelLength;
  });
  const itemLength = itemLengths.reduce((total, length) => total + length, 0);
  const itemCount = ribbon.items.length;
  const thickness = ribbon.iconSize + RIBBON_BUTTON_PADDING + 2;
  if (ribbon.orientation === "vertical" && ribbon.verticalHandlePlacement === "side") {
    return {
      width: RIBBON_HANDLE_WIDTH + (itemLengths.length > 0 ? Math.max(...itemLengths) : 0),
      height: Math.max(30, thickness * itemCount)
    };
  }
  const length = RIBBON_HANDLE_WIDTH + (itemCount > 0 ? itemLength : 0);
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
