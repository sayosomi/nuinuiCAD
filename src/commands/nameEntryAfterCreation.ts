import { useCadUiStore } from "../state/cadUiStore";

export type FocusSelectedParameterInput = (() => void) | undefined;

export const enterCreatedElementNameEntry = (
  focusSelectedParameterInput?: FocusSelectedParameterInput
) => {
  useCadUiStore.setState({
    isParameterEditMode: true,
    isDependencyJumpMode: false,
    selectedDependencyJumpIndex: 0
  });

  if (!focusSelectedParameterInput) return;

  const focus = () => focusSelectedParameterInput();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focus);
    return;
  }
  setTimeout(focus, 0);
};
