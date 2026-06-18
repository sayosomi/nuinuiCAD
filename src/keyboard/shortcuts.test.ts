import { describe, expect, it } from "vitest";
import { commandIdForKeyboardEvent } from "./shortcuts";

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
    expect(commandIdForKeyboardEvent(keyboardEvent("?"))).toBe("toggleShortcutHelp");
  });

  it("ignores events from inputs", () => {
    const input = document.createElement("input");
    const event = keyboardEvent("p");
    Object.defineProperty(event, "target", { value: input });

    expect(commandIdForKeyboardEvent(event)).toBeNull();
  });
});
