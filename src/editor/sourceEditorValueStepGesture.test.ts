import { describe, expect, it } from "vitest";
import {
  sameValueStepGesture,
  valueStepDirectionForCommand,
  valueStepGestureEndsOnKeyup,
  valueStepGestureForKeyboardEvent
} from "./sourceEditorValueStepGesture";

const keyboardEvent = (overrides: Partial<KeyboardEvent> = {}) => ({
  code: "ArrowRight",
  key: "ArrowRight",
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...overrides
}) as KeyboardEvent;

describe("Source Editor value-step gesture boundaries", () => {
  it("maps only the two editor-native step commands", () => {
    expect(valueStepDirectionForCommand("stepSourceValueForward")).toBe(1);
    expect(valueStepDirectionForCommand("stepSourceValueBackward")).toBe(-1);
    expect(valueStepDirectionForCommand("saveDocument")).toBeNull();
  });

  it("groups repeats by physical trigger and closes on trigger or required modifier release", () => {
    const gesture = valueStepGestureForKeyboardEvent(1, keyboardEvent());
    expect(sameValueStepGesture(gesture, valueStepGestureForKeyboardEvent(1, keyboardEvent()))).toBe(true);
    expect(sameValueStepGesture(gesture, valueStepGestureForKeyboardEvent(-1, keyboardEvent()))).toBe(false);
    expect(valueStepGestureEndsOnKeyup(gesture, keyboardEvent())).toBe(true);
    expect(valueStepGestureEndsOnKeyup(gesture, keyboardEvent({ code: "AltLeft", key: "Alt" }))).toBe(true);
    expect(valueStepGestureEndsOnKeyup(gesture, keyboardEvent({ code: "KeyA", key: "a" }))).toBe(false);
  });
});
