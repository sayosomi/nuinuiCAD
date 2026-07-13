import type { CommandId } from "../commands/commands";
import type { DslValueStepDirection } from "../dsl/dslValueStep";

export type SourceEditorValueStepGesture = {
  direction: DslValueStepDirection;
  code: string;
  requiresAlt: boolean;
  requiresMod: boolean;
  requiresShift: boolean;
};

export const valueStepDirectionForCommand = (commandId: CommandId): DslValueStepDirection | null => {
  if (commandId === "stepSourceValueForward") return 1;
  if (commandId === "stepSourceValueBackward") return -1;
  return null;
};

export const valueStepGestureForKeyboardEvent = (
  direction: DslValueStepDirection,
  event: KeyboardEvent
): SourceEditorValueStepGesture => ({
  direction,
  code: event.code,
  requiresAlt: event.altKey,
  requiresMod: event.metaKey || event.ctrlKey,
  requiresShift: event.shiftKey
});

export const sameValueStepGesture = (
  gesture: SourceEditorValueStepGesture,
  candidate: SourceEditorValueStepGesture
) => gesture.direction === candidate.direction && gesture.code === candidate.code;

/** A shortcut may end when its trigger or a required modifier is released. */
export const valueStepGestureEndsOnKeyup = (
  gesture: SourceEditorValueStepGesture,
  event: KeyboardEvent
) => event.code === gesture.code ||
  (gesture.requiresAlt && event.key === "Alt") ||
  (gesture.requiresMod && (event.key === "Meta" || event.key === "Control")) ||
  (gesture.requiresShift && event.key === "Shift");
