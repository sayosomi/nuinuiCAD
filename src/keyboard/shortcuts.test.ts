import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { commandIdForKeyboardEvent, keyboardCommandForEvent, shortcutHelpItems } from "./shortcuts";

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

  it("shows only normal mode shortcuts outside parameter edit mode", () => {
    const shortcuts = shortcutHelpItems();
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("moveSelectedElementUp");
    expect(ids).toContain("addFreePoint");
    expect(ids).not.toContain("exitParameterEditMode");
    expect(ids).not.toContain("selectNextParameter");
  });

  it("hides normal mode shortcuts while editing parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[0],
      selectedParameterKey: "x"
    });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).not.toContain("moveSelectedElementUp");
    expect(ids).not.toContain("addFreePoint");
    expect(ids).toContain("exitParameterEditMode");
    expect(ids).toContain("selectNextParameter");
  });

  it("shows numeric parameter shortcuts only for numeric parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[0],
      selectedParameterKey: "x"
    });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("incrementSelectedParameter");
    expect(ids).toContain("decrementSelectedParameter");
    expect(ids).not.toContain("toggleSelectedBooleanParameter");
  });

  it("shows boolean parameter shortcuts only for boolean parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[0],
      selectedParameterKey: "visible"
    });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("toggleSelectedBooleanParameter");
    expect(ids).not.toContain("incrementSelectedParameter");
    expect(ids).not.toContain("decrementSelectedParameter");
  });

  it("shows reference parameter shortcuts only for reference parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[3],
      selectedParameterKey: "startPointId"
    });

    expect(shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cycleSelectedReferenceForward",
          commandId: "incrementSelectedParameter",
          keys: "ArrowRight"
        }),
        expect.objectContaining({
          id: "cycleSelectedReferenceBackward",
          commandId: "decrementSelectedParameter",
          keys: "ArrowLeft"
        })
      ])
    );
  });

  it("shows direct parameter keys for the selected element", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[3],
      selectedParameterKey: "startPointId"
    });
    const keyShortcut = shortcuts.find((shortcut) => shortcut.commandId === "selectParameterByKey");

    expect(keyShortcut?.keys).toBe("n / v / a / s / t");
  });
});
