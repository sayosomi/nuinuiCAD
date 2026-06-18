import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import { commandIdForKeyboardEvent, keyboardCommandForEvent, shortcutHelpItems } from "./shortcuts";

const keyboardEvent = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, ...init });

const keyboardEventFrom = (key: string, target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = keyboardEvent(key, init);
  Object.defineProperty(event, "target", { value: target });
  return event;
};

describe("shortcuts", () => {
  it("maps keys to commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp"))).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown"))).toBe("selectNextElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { metaKey: true }))).toBe(
      "moveSelectedElementUp"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Backspace"))).toBe("deleteSelectedElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("v"))).toBe("toggleSelectedElementVisibility");
    expect(commandIdForKeyboardEvent(keyboardEvent("i"))).toBe("toggleElementInfoPanel");
    expect(commandIdForKeyboardEvent(keyboardEvent("g"))).toBe("enterElementListMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("e"))).toBe("enterParameterEditMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("j"))).toBe("enterDependencyJumpMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("/"))).toBe("openCommandPalette");
    expect(commandIdForKeyboardEvent(keyboardEvent("p"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("o"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("l"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("Enter"))).toBe("enterParameterEditMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("+"))).toBe("zoomInCanvas");
    expect(commandIdForKeyboardEvent(keyboardEvent("="))).toBe("zoomInCanvas");
    expect(commandIdForKeyboardEvent(keyboardEvent("-"))).toBe("zoomOutCanvas");
    expect(commandIdForKeyboardEvent(keyboardEvent("0"))).toBe("resetCanvasView");
    expect(commandIdForKeyboardEvent(keyboardEvent("?"))).toBe("toggleShortcutHelp");
    expect(commandIdForKeyboardEvent(keyboardEvent("["))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("]"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("z", { metaKey: true }))).toBe("undo");
    expect(commandIdForKeyboardEvent(keyboardEvent("y", { metaKey: true }))).toBe("redo");
  });

  it("maps edit mode keys to parameter commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("/"), { isParameterEditMode: true })).toBe(
      "openCommandPalette"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("g"), { isParameterEditMode: true })).toBe(
      "enterElementListMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("e"), { isParameterEditMode: true })).toBe(
      "enterParameterEditMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("j"), { isParameterEditMode: true })).toBe(
      "enterDependencyJumpMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown"), { isParameterEditMode: true })).toBe(
      "selectNextParameter"
    );
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowUp"), {
        isParameterEditMode: true
      })
    ).toBe("selectPreviousParameter");
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowDown", { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toBe("selectNextElement");
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("Tab"), { isParameterEditMode: true })).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("x"), { isParameterEditMode: true })).toBe(
      "selectParameterByKey"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Escape"), { isParameterEditMode: true })).toBe(
      "exitParameterEditMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("["), { isParameterEditMode: true })).toBe(
      "decreaseSelectedParameterStep"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("]"), { isParameterEditMode: true })).toBe(
      "increaseSelectedParameterStep"
    );
  });

  it("maps dependency jump mode keys to dependency jump commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("g"), { isDependencyJumpMode: true })).toBe(
      "enterElementListMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("e"), { isDependencyJumpMode: true })).toBe(
      "enterParameterEditMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("j"), { isDependencyJumpMode: true })).toBe(
      "enterDependencyJumpMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown"), { isDependencyJumpMode: true })).toBe(
      "selectNextDependencyJumpTarget"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp"), { isDependencyJumpMode: true })).toBe(
      "selectPreviousDependencyJumpTarget"
    );
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowDown", { shiftKey: true }), {
        isDependencyJumpMode: true
      })
    ).toBe("selectNextElement");
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { shiftKey: true }), {
        isDependencyJumpMode: true
      })
    ).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("Enter"), { isDependencyJumpMode: true })).toBe(
      "jumpToSelectedDependencyTarget"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Escape"), { isDependencyJumpMode: true })).toBe(
      "exitDependencyJumpMode"
    );
  });

  it("prioritizes parameter edit mode over dependency jump mode", () => {
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowDown"), {
        isParameterEditMode: true,
        isDependencyJumpMode: true
      })
    ).toBe("selectNextParameter");
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

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("/", input))).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("[", input), { isParameterEditMode: true })
    ).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("z", input, { metaKey: true }))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("y", input, { metaKey: true }))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("+", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("-", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("0", input))).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", input, { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowUp", input, { shiftKey: true }), {
        isDependencyJumpMode: true
      })
    ).toBeNull();
  });

  it("ignores events from editable form targets", () => {
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", select))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", editable))).toBeNull();
  });

  it("allows app shortcuts from focused buttons", () => {
    const button = document.createElement("button");

    expect(commandIdForKeyboardEvent(keyboardEventFrom("/", button))).toBe("openCommandPalette");
    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", button))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", button))).toBe(
      "selectNextElement"
    );
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", button))).toBe("toggleShortcutHelp");
  });

  it("keeps native activation keys for focused buttons", () => {
    const button = document.createElement("button");

    expect(commandIdForKeyboardEvent(keyboardEventFrom("Enter", button))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom(" ", button))).toBeNull();
  });

  it("uses Enter as edit mode from focused element list rows", () => {
    const button = document.createElement("button");
    button.dataset.elementListRow = "true";

    expect(commandIdForKeyboardEvent(keyboardEventFrom("Enter", button))).toBe(
      "enterParameterEditMode"
    );
    expect(commandIdForKeyboardEvent(keyboardEventFrom(" ", button))).toBeNull();
  });

  it("moves elements with Alt+Arrow only from focused element list targets", () => {
    const list = document.createElement("div");
    const row = document.createElement("button");
    const rowLabel = document.createElement("span");
    const button = document.createElement("button");
    list.dataset.elementList = "true";
    row.dataset.elementListRow = "true";
    row.append(rowLabel);
    list.append(row);

    expect(commandIdForKeyboardEvent(keyboardEventFrom("ArrowUp", list, { altKey: true }))).toBe(
      "moveSelectedElementUp"
    );
    expect(commandIdForKeyboardEvent(keyboardEventFrom("ArrowUp", row, { altKey: true }))).toBe(
      "moveSelectedElementUp"
    );
    expect(commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", rowLabel, { altKey: true }))).toBe(
      "moveSelectedElementDown"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { altKey: true }))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", button, { altKey: true }))).toBeNull();
  });

  it("does not use list Alt+Arrow reordering in parameter edit mode", () => {
    const row = document.createElement("button");
    row.dataset.elementListRow = "true";

    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowUp", row, { altKey: true }), {
        isParameterEditMode: true
      })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", row, { altKey: true }), {
        isParameterEditMode: true
      })
    ).toBeNull();
  });

  it("shows only normal mode shortcuts outside parameter edit mode", () => {
    const shortcuts = shortcutHelpItems();
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("moveSelectedElementUp");
    expect(ids).toContain("enterElementListMode");
    expect(ids).toContain("toggleElementInfoPanel");
    expect(ids).toContain("enterDependencyJumpMode");
    expect(ids).toContain("openCommandPalette");
    expect(ids).toContain("zoomInCanvas");
    expect(ids).toContain("zoomOutCanvas");
    expect(ids).toContain("resetCanvasView");
    expect(ids).not.toContain("addFreePoint");
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
    expect(ids).toContain("enterElementListMode");
    expect(ids).toContain("enterDependencyJumpMode");
    expect(ids).not.toContain("addFreePoint");
    expect(ids).toContain("openCommandPalette");
    expect(ids).toContain("exitParameterEditMode");
    expect(ids).toContain("selectNextParameter");
    expect(ids).toContain("selectNextElement");
    expect(ids).toContain("selectPreviousElement");
  });

  it("shows dependency jump shortcuts while dependency jump mode is active", () => {
    const shortcuts = shortcutHelpItems({ isDependencyJumpMode: true });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("selectNextDependencyJumpTarget");
    expect(ids).toContain("selectPreviousDependencyJumpTarget");
    expect(ids).toContain("jumpToSelectedDependencyTarget");
    expect(ids).toContain("exitDependencyJumpMode");
    expect(ids).toContain("selectNextElement");
    expect(ids).toContain("selectPreviousElement");
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
    expect(ids).toContain("increaseSelectedParameterStep");
    expect(ids).toContain("decreaseSelectedParameterStep");
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
    expect(ids).not.toContain("increaseSelectedParameterStep");
    expect(ids).not.toContain("decreaseSelectedParameterStep");
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
    expect(shortcuts.map((shortcut) => shortcut.commandId)).not.toEqual(
      expect.arrayContaining(["increaseSelectedParameterStep", "decreaseSelectedParameterStep"])
    );
  });

  it("does not show step shortcuts for text parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[0],
      selectedParameterKey: "name"
    });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).not.toContain("increaseSelectedParameterStep");
    expect(ids).not.toContain("decreaseSelectedParameterStep");
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
