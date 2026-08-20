export type CommandRibbonTooltipRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CommandRibbonTooltipSize = {
  width: number;
  height: number;
};

export type CommandRibbonTooltipPlacement = {
  left: number;
  top: number;
  side: "above" | "below";
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const calculateCommandRibbonTooltipPlacement = (
  triggerRect: CommandRibbonTooltipRect,
  tooltipSize: CommandRibbonTooltipSize,
  boundaryRect: CommandRibbonTooltipRect,
  gap = 6,
  inset = 6
): CommandRibbonTooltipPlacement => {
  const boundaryLeft = boundaryRect.left + inset;
  const boundaryRight = boundaryRect.right - inset;
  const boundaryTop = boundaryRect.top + inset;
  const boundaryBottom = boundaryRect.bottom - inset;
  const centeredLeft = triggerRect.left + (triggerRect.right - triggerRect.left - tooltipSize.width) / 2;
  const maxLeft = Math.max(boundaryLeft, boundaryRight - tooltipSize.width);
  const left = clamp(centeredLeft, boundaryLeft, maxLeft);
  const belowTop = triggerRect.bottom + gap;
  const aboveTop = triggerRect.top - gap - tooltipSize.height;
  const belowFits = belowTop >= boundaryTop && belowTop + tooltipSize.height <= boundaryBottom;
  const aboveFits = aboveTop >= boundaryTop && aboveTop + tooltipSize.height <= boundaryBottom;

  if (belowFits) return { left, top: belowTop, side: "below" };
  if (aboveFits) return { left, top: aboveTop, side: "above" };

  const belowAvailable = Math.max(0, boundaryBottom - belowTop);
  const aboveAvailable = Math.max(0, aboveTop - boundaryTop + tooltipSize.height);
  const side = belowAvailable >= aboveAvailable ? "below" : "above";
  const unclampedTop = side === "below" ? belowTop : aboveTop;
  const maxTop = Math.max(boundaryTop, boundaryBottom - tooltipSize.height);

  return {
    left,
    top: clamp(unclampedTop, boundaryTop, maxTop),
    side
  };
};
