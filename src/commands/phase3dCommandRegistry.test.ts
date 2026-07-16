import { describe, expect, it } from "vitest";
import { commands, dispatchCommand } from "./commands";
import { shortcutBindings } from "../keyboard/shortcutDefaultBindings";
import { commandIdForKeyboardEvent, sourceEditorShortcutBindings } from "../keyboard/shortcuts";

const retiredCommandIds = [
  "enterParameterEditMode",
  "enterDependencyJumpMode",
  "selectParameterByKey",
  "incrementSelectedParameter",
  "toggleExpressionInsertTray"
];

describe("Phase 3d Inspector command registry", () => {
  it("keeps only the Inspector visibility command and no retired navigation commands", () => {
    expect(commands).toHaveProperty("toggleInspectorPanel");
    for (const id of [
      ...retiredCommandIds,
      "focusInspectorParameterRows",
      "focusInspectorDependencyRows",
      "selectNextInspectorRow",
      "selectPreviousInspectorRow",
      "activateInspectorRow",
      "exitInspector",
      "startInspectorParameterPick"
    ]) expect(commands).not.toHaveProperty(id);
  });

  it("retires Inspector bindings without assigning normal e, j, P, Enter, or Escape", () => {
    expect(shortcutBindings.map((binding) => binding.scope)).not.toContain("inspector");
    for (const key of ["e", "j", "p", "Enter", "Escape"]) {
      expect(commandIdForKeyboardEvent(new KeyboardEvent("keydown", { key }))).toBeNull();
    }
    expect(commandIdForKeyboardEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBe("selectPreviousElement");
    expect(commandIdForKeyboardEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe("selectNextElement");
    expect(dispatchCommand("enterParameterEditMode" as never)).toBe(false);
  });

  it("keeps the keyboard-first edit path in Source Editor scope", () => {
    const bindings = sourceEditorShortcutBindings();
    expect(bindings.find((binding) => binding.commandId === "stepSourceValueForward")?.chords)
      .toContainEqual({ key: "ArrowRight", mod: false, alt: true, shift: false });
    expect(bindings.find((binding) => binding.commandId === "stepSourceValueBackward")?.chords)
      .toContainEqual({ key: "ArrowLeft", mod: false, alt: true, shift: false });
    expect(bindings.find((binding) => binding.commandId === "startCanvasPickFromSourceSelection")?.chords)
      .toContainEqual({ key: "p", mod: true, alt: false, shift: true });
  });

  it("uses Mod+Enter to finish only a pick session while Enter keeps applying candidates", () => {
    expect(commandIdForKeyboardEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
      { isPickMode: true }
    )).toBe("finishLinePick");
    expect(commandIdForKeyboardEvent(
      new KeyboardEvent("keydown", { key: "Enter" }),
      { isPickMode: true }
    )).toBe("applySelectedPickCandidate");
  });
});
