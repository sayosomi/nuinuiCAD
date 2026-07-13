import type { CommandContext } from "./commandTypes";
export const finishCreatedElementInteraction = (
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
