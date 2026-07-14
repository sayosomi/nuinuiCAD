import type { CommandContext } from "./commandTypes";

/** Schedules the Canvas focus handoff used by non-command-line creation flows. */
export const focusCanvasAfterCreation = (
  context?: Pick<CommandContext, "focusCanvas">
) => {
  if (!context?.focusCanvas) return;

  const focus = () => context.focusCanvas?.();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focus);
    return;
  }
  setTimeout(focus, 0);
};
