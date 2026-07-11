import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import {
  commandIdForKeyboardEvent,
  isSourceEditorKeyboardTarget,
  keyboardCommandForEvent,
  keyChordMatchesSearch,
  shortcutConflicts,
  shortcutHelpItems,
  type ShortcutSettings
} from "./shortcuts";

const keyboardEvent = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, ...init });

const keyboardEventFrom = (key: string, target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = keyboardEvent(key, init);
  Object.defineProperty(event, "target", { value: target });
  return event;
};

describe("shortcuts", () => {
  const settingsWithOverrides = (
    overrides: ShortcutSettings["overrides"]
  ): ShortcutSettings => ({
    version: 1,
    overrides
  });

  it("recognizes CodeMirror descendants as an app-capture exclusion scope", () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-source-editor-scope", "true");
    const pane = document.createElement("div");
    pane.className = "source-editor-pane";
    const content = document.createElement("div");
    pane.appendChild(content);
    scope.appendChild(pane);
    document.body.appendChild(scope);
    expect(isSourceEditorKeyboardTarget(keyboardEventFrom("Escape", content))).toBe(true);
    scope.remove();
  });

  it("recognizes Source Editor UI siblings of the CodeMirror container as an app-capture exclusion scope", () => {
    const scope = document.createElement("div");
    scope.setAttribute("data-source-editor-scope", "true");
    const pane = document.createElement("div");
    pane.className = "source-editor-pane";
    const searchInput = document.createElement("input");
    scope.appendChild(pane);
    scope.appendChild(searchInput);
    document.body.appendChild(scope);
    expect(isSourceEditorKeyboardTarget(keyboardEventFrom("Escape", searchInput))).toBe(true);
    scope.remove();
  });

  it("does not treat elements outside the Source Editor scope as an app-capture exclusion", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isSourceEditorKeyboardTarget(keyboardEventFrom("Escape", input))).toBe(false);
    input.remove();
  });

  it("maps keys to commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp"))).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown"))).toBe("selectNextElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { metaKey: true }))).toBe(
      "moveSelectedElementUp"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("d"))).toBe("deleteSelectedElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("d", { metaKey: true }))).toBe(
      "duplicateSelectedElement"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Backspace"))).toBe("deleteSelectedElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("Delete"))).toBe("deleteSelectedElement");
    expect(commandIdForKeyboardEvent(keyboardEvent("v"))).toBe("toggleSelectedElementVisibility");
    expect(commandIdForKeyboardEvent(keyboardEvent("a"))).toBe("toggleSelectedElementEnabled");
    expect(commandIdForKeyboardEvent(keyboardEvent("i"))).toBe("toggleElementInfoPanel");
    expect(commandIdForKeyboardEvent(keyboardEvent("g"))).toBe("enterElementListMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("e"))).toBe("enterParameterEditMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("j"))).toBe("enterDependencyJumpMode");
    expect(commandIdForKeyboardEvent(keyboardEvent("/"))).toBe("openCommandPalette");
    expect(commandIdForKeyboardEvent(keyboardEvent("n", { metaKey: true }))).toBe("newDocument");
    expect(commandIdForKeyboardEvent(keyboardEvent("o", { metaKey: true }))).toBe("openDocument");
    expect(commandIdForKeyboardEvent(keyboardEvent("s", { metaKey: true }))).toBe("saveDocument");
    expect(commandIdForKeyboardEvent(keyboardEvent("s", { metaKey: true, shiftKey: true }))).toBe(
      "saveDocumentAs"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("f", { metaKey: true }))).toBe("focusElementSearch");
    expect(commandIdForKeyboardEvent(keyboardEvent("d", { metaKey: true, shiftKey: true }))).toBe(
      "openDslPanel"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("p"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("o"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("l"))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("x"))).toBe("addIntersectionPoint");
    expect(commandIdForKeyboardEvent(keyboardEvent("C", { shiftKey: true }))).toBe("addCopyLine");
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
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowDown", { shiftKey: true }))).toBe(
      "extendSelectionToNextElement"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { shiftKey: true }))).toBe(
      "extendSelectionToPreviousElement"
    );
  });

  it("uses user shortcut overrides", () => {
    const settings = settingsWithOverrides([
      {
        bindingId: "normal.toggleSelectedElementVisibility",
        chords: [{ key: "h", mod: false, alt: false, shift: false }]
      }
    ]);

    expect(commandIdForKeyboardEvent(keyboardEvent("h"), { settings })).toBe(
      "toggleSelectedElementVisibility"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("v"), { settings })).toBeNull();
  });

  it("adds shortcuts to executable commands without defaults", () => {
    const settings = settingsWithOverrides([
      {
        bindingId: "normal.addFreePoint",
        chords: [{ key: "p", mod: false, alt: false, shift: false }]
      }
    ]);

    expect(commandIdForKeyboardEvent(keyboardEvent("p"), { settings })).toBe("addFreePoint");
  });

  it("detects same-mode shortcut conflicts", () => {
    const settings = settingsWithOverrides([
      {
        bindingId: "normal.addFreePoint",
        chords: [{ key: "p", mod: false, alt: false, shift: false }]
      },
      {
        bindingId: "normal.addLine",
        chords: [{ key: "p", mod: false, alt: false, shift: false }]
      }
    ]);

    expect(shortcutConflicts(settings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "normal",
          bindingIds: expect.arrayContaining(["normal.addFreePoint", "normal.addLine"])
        })
      ])
    );
  });

  it("matches shortcut search keys with wildcard modifiers", () => {
    expect(
      keyChordMatchesSearch(
        { key: "?", mod: false, alt: false, shift: "any" },
        { key: "?", mod: false, alt: false, shift: true }
      )
    ).toBe(true);
    expect(
      keyChordMatchesSearch(
        { key: "?", mod: false, alt: false, shift: "any" },
        { key: "?", mod: false, alt: false, shift: false }
      )
    ).toBe(true);
    expect(
      keyChordMatchesSearch(
        { key: "s", mod: true, alt: false, shift: false },
        { key: "s", mod: false, alt: false, shift: false }
      )
    ).toBe(false);
    expect(
      keyChordMatchesSearch(
        { key: "s", mod: true, alt: false, shift: false },
        { key: "o", mod: true, alt: false, shift: false }
      )
    ).toBe(false);
  });

  it("ignores user shortcut overrides from inputs", () => {
    const input = document.createElement("input");
    const settings = settingsWithOverrides([
      {
        bindingId: "normal.addFreePoint",
        chords: [{ key: "p", mod: false, alt: false, shift: false }]
      }
    ]);

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", input), { settings })).toBeNull();
  });

  it("shows user shortcut overrides in help", () => {
    const settings = settingsWithOverrides([
      {
        bindingId: "normal.addFreePoint",
        chords: [{ key: "p", mod: false, alt: false, shift: false }]
      }
    ]);

    expect(shortcutHelpItems({ settings })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "addFreePoint",
          keys: "p"
        })
      ])
    );
  });

  it("maps edit mode keys to parameter commands", () => {
    expect(commandIdForKeyboardEvent(keyboardEvent("/"), { isParameterEditMode: true })).toBe(
      "openCommandPalette"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("i"), { isParameterEditMode: true })).toBe(
      "toggleElementInfoPanel"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("?"), { isParameterEditMode: true })).toBe(
      "toggleShortcutHelp"
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
    expect(commandIdForKeyboardEvent(keyboardEvent("Backspace"), { isParameterEditMode: true })).toBe(
      "deleteSelectedElement"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Delete"), { isParameterEditMode: true })).toBe(
      "deleteSelectedElement"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Tab"), { isParameterEditMode: true })).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEvent("Enter"), { isParameterEditMode: true })).toBe(
      "activateSelectedParameter"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent(" "), { isParameterEditMode: true })).toBe(
      "toggleSelectedParameterValue"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("v"), { isParameterEditMode: true })).toBe(
      "selectParameterByKey"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("a"), { isParameterEditMode: true })).toBe(
      "selectParameterByKey"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("x"), { isParameterEditMode: true })).toBe(
      "selectParameterByKey"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("1"), { isParameterEditMode: true })).toBe(
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
    expect(commandIdForKeyboardEvent(keyboardEvent("i"), { isDependencyJumpMode: true })).toBe(
      "toggleElementInfoPanel"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("?"), { isDependencyJumpMode: true })).toBe(
      "toggleShortcutHelp"
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

  it("prioritizes pick mode over parameter edit and dependency jump modes", () => {
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowDown"), {
        isParameterEditMode: true,
        isDependencyJumpMode: true,
        isPickMode: true
      })
    ).toBe("selectNextPickCandidate");
    expect(commandIdForKeyboardEvent(keyboardEvent("ArrowRight"), { isPickMode: true })).toBe(
      "selectNextPickOption"
    );
    expect(commandIdForKeyboardEvent(keyboardEvent("Enter"), { isPickMode: true })).toBe(
      "applySelectedPickCandidate"
    );
  });

  it("shows pick mode shortcuts while selecting from the construction list", () => {
    const ids = shortcutHelpItems({
      isParameterEditMode: true,
      isPickMode: true
    }).map((shortcut) => shortcut.commandId);

    expect(ids).toContain("selectNextPickCandidate");
    expect(ids).toContain("selectPreviousPickCandidate");
    expect(ids).toContain("selectNextPickOption");
    expect(ids).toContain("selectPreviousPickOption");
    expect(ids).toContain("applySelectedPickCandidate");
    expect(ids).not.toContain("selectNextParameter");
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
    expect(
      keyboardCommandForEvent(keyboardEvent("a"), { isParameterEditMode: true })
    ).toMatchObject({
      commandId: "selectParameterByKey",
      context: { parameterDirectKey: "a" }
    });
  });

  it("ignores events from inputs", () => {
    const input = document.createElement("input");

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("v", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("a", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("d", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("Backspace", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("Delete", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("/", input))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("f", input, { metaKey: true }))).toBe(
      "focusElementSearch"
    );
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("[", input), { isParameterEditMode: true })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Backspace", input), { isParameterEditMode: true })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Delete", input), { isParameterEditMode: true })
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

  it("keeps native text editing shortcuts available from inputs", () => {
    const input = document.createElement("input");

    for (const key of ["c", "v", "x", "a"]) {
      expect(commandIdForKeyboardEvent(keyboardEventFrom(key, input, { metaKey: true }))).toBeNull();
      expect(commandIdForKeyboardEvent(keyboardEventFrom(key, input, { ctrlKey: true }))).toBeNull();
    }
  });

  it("maps DSL panel shortcuts only when editable targets are explicitly allowed", () => {
    const textarea = document.createElement("textarea");
    const allowDslCommands = new Set([
      "exportDslSelection",
      "validateDslPanel",
      "applyDslPanel",
      "closeDslPanel"
    ] as const);

    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Enter", textarea, { metaKey: true }), {
        isDslPanelMode: true
      })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Enter", textarea, { metaKey: true }), {
        isDslPanelMode: true,
        allowEditableCommandIds: allowDslCommands
      })
    ).toBe("applyDslPanel");
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Enter", textarea, { metaKey: true, shiftKey: true }), {
        isDslPanelMode: true,
        allowEditableCommandIds: allowDslCommands
      })
    ).toBe("validateDslPanel");
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("Escape", textarea), {
        isDslPanelMode: true,
        allowEditableCommandIds: allowDslCommands
      })
    ).toBe("closeDslPanel");
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("a", textarea, { metaKey: true }), {
        isDslPanelMode: true,
        allowEditableCommandIds: allowDslCommands
      })
    ).toBeNull();
  });

  it("ignores events from editable form targets", () => {
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("v", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("a", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", textarea))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", select))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("v", select))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("a", select))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", editable))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", editable))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", editable))).toBeNull();
  });

  it("ignores info and help shortcuts from non-text form targets", () => {
    const numberInput = document.createElement("input");
    const checkbox = document.createElement("input");
    const select = document.createElement("select");
    numberInput.type = "number";
    checkbox.type = "checkbox";

    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", numberInput))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", numberInput))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", checkbox))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", checkbox))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("v", checkbox))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("a", checkbox))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("i", select))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("?", select))).toBeNull();
  });

  it("keeps other shortcuts ignored from non-text form targets", () => {
    const numberInput = document.createElement("input");
    numberInput.type = "number";

    expect(commandIdForKeyboardEvent(keyboardEventFrom("p", numberInput))).toBeNull();
    expect(commandIdForKeyboardEvent(keyboardEventFrom("/", numberInput))).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("z", numberInput, { metaKey: true }))
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", numberInput, { shiftKey: true }), {
        isParameterEditMode: true
      })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("i", numberInput), { isParameterEditMode: true })
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("?", numberInput), { isParameterEditMode: true })
    ).toBeNull();
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

  it("moves the evaluation divider with Shift+Alt+Arrow only from focused element list targets", () => {
    const list = document.createElement("div");
    const row = document.createElement("div");
    const input = document.createElement("input");
    list.dataset.elementList = "true";
    row.dataset.elementListRow = "true";
    row.append(input);
    list.append(row);

    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowUp", list, { altKey: true, shiftKey: true }))
    ).toBe("moveEvaluationDividerUp");
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", row, { altKey: true, shiftKey: true }))
    ).toBe("moveEvaluationDividerDown");
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("End", row, { altKey: true, shiftKey: true }))
    ).toBe("moveEvaluationDividerToEnd");
    expect(
      commandIdForKeyboardEvent(keyboardEvent("ArrowUp", { altKey: true, shiftKey: true }))
    ).toBeNull();
    expect(
      commandIdForKeyboardEvent(keyboardEventFrom("ArrowDown", input, { altKey: true, shiftKey: true }))
    ).toBeNull();
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
    expect(ids).toContain("toggleSelectedElementVisibility");
    expect(ids).toContain("toggleSelectedElementEnabled");
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

  it("shows DSL panel shortcuts in DSL mode help", () => {
    const shortcuts = shortcutHelpItems({ isDslPanelMode: true });

    expect(shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commandId: "exportDslSelection", keys: "Mod+Shift+e" }),
        expect.objectContaining({ commandId: "validateDslPanel", keys: "Mod+Shift+Enter" }),
        expect.objectContaining({ commandId: "applyDslPanel", keys: "Mod+Enter" }),
        expect.objectContaining({ commandId: "closeDslPanel", keys: "Escape" })
      ])
    );
    expect(shortcuts.map((shortcut) => shortcut.commandId)).not.toContain("selectNextElement");
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
    expect(ids).toContain("selectParameterByKey");
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
    expect(ids).not.toContain("toggleSelectedParameterValue");
  });

  it("shows boolean parameter shortcuts only for boolean parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[0],
      selectedParameterKey: "visible"
    });
    const ids = shortcuts.map((shortcut) => shortcut.commandId);

    expect(ids).toContain("toggleSelectedParameterValue");
    expect(ids).not.toContain("incrementSelectedParameter");
    expect(ids).not.toContain("decrementSelectedParameter");
    expect(ids).not.toContain("increaseSelectedParameterStep");
    expect(ids).not.toContain("decreaseSelectedParameterStep");
  });

  it("shows reference parameter shortcuts only for reference parameters", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[3],
      selectedParameterKey: "startPoint"
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
    expect(shortcuts.map((shortcut) => shortcut.commandId)).toContain("toggleSelectedParameterValue");
    expect(shortcuts.map((shortcut) => shortcut.commandId)).not.toEqual(
      expect.arrayContaining(["increaseSelectedParameterStep", "decreaseSelectedParameterStep"])
    );
  });

  it("hides coordinate toggle shortcut for point references that cannot use coordinates", () => {
    const shortcuts = shortcutHelpItems({
      isParameterEditMode: true,
      selectedElement: sampleElements[1],
      selectedParameterKey: "fromPoint"
    });

    expect(shortcuts.map((shortcut) => shortcut.commandId)).not.toContain("toggleSelectedParameterValue");
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
      selectedParameterKey: "startPoint"
    });
    const keyShortcut = shortcuts.find((shortcut) => shortcut.commandId === "selectParameterByKey");

    expect(keyShortcut?.keys).toBe("n / k / v / a / l / s / t");
  });
});
