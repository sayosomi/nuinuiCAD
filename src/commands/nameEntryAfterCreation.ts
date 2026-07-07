import type { CommandContext } from "./commandTypes";
import type { CadElement } from "../types/geometry";
import {
  getFirstParameterKey,
  getParameterDefinitions
} from "../parameters/parameterDefinitions";
import { useCadUiStore } from "../state/cadUiStore";

const commonCreationParameterKeys = new Set(["name", "colorId", "visible", "enabled"]);

export const getInitialCreatedElementParameterKey = (element: CadElement) =>
  getParameterDefinitions(element).find((definition) => !commonCreationParameterKeys.has(definition.key))?.key ??
  getFirstParameterKey(element);

export const finishCreatedElementInteraction = (
  context?: Pick<CommandContext, "focusCanvas">
) => {
  useCadUiStore.setState({
    isParameterEditMode: false,
    isDependencyJumpMode: false,
    selectedDependencyJumpIndex: 0
  });

  if (!context?.focusCanvas) return;

  const focus = () => context.focusCanvas?.();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focus);
    return;
  }
  setTimeout(focus, 0);
};
