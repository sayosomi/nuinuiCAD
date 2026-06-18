import { describe, expect, it } from "vitest";
import { commandIdForKeyboardEvent, keyboardCommandForEvent } from "./shortcuts";

const keyboardEvent = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, ...init });

describe("shortcuts", () => {
  it("maps keys to commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp"))).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown"))).toBe("selectNextElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { metaKey: true }))).toBe(
      "moveSelectedElementUp"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Backspace"))).toBe("deleteSelectedElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("v"))).toBe("toggleSelectedElementVisibility");
    expect(commandIdForKeyboardEvent(keyboardEvent("Enter"))).toBe("enterParameterEditMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("?"))).toBe("toggleShortcutHelp");
  });

  it("maps edit mode keys to parameter commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("Tab"), { isParameterEditMode: true })).toBe(
      "selectNextParameter"
    );
    expect(
      commandIdForKeyboardEvent(keyboardEvent("Tab", { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toBe("selectPreviousParameter");
    expect(commandIdForKeyboardEvent(keyboardEvent("x"), { isParameterEditMode: true })).toBe(
      "selectParameterByKey"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Escape"), { isParameterEditMode: true })).toBe(
      "exitParameterEditMode"
    );
  });

  it("passes edit mode command context", () => {
    expect(
      keyboardCommandForEvent(keyboardEvent("ArrowRight", { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toMatchObject({
      commandId: "incrementSelectedParameter",
      context: { stepMultiplier: 10 }
    });
    expect(
      keyboardCommandForEvent(keyboardEvent("y"), { isParameterEditMode: true })
    ).toMatchObject({
      commandId: "selectParameterByKey",
      context: { parameterDirectKey: "y" }
    });
  });

  it("ignores events from inputs", () => {
    const input = document.createElement("input");
    const event = keyboardEvent("p");
    Object.defineProperty(event, "target", { value: input });

    expect(commandIdForKeyboardEvent(event)).toBeNull();
  });
});
