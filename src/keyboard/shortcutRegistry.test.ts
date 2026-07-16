import { describe, expect, it } from "vitest";
import { commandIdForKeyboardEvent, keyboardCommandForEvent, shouldIgnoreKeyboardEvent, shortcutConflicts } from "./shortcuts";
import type { ShortcutSettings } from "./shortcutTypes";

const eventFor = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, bubbles: true, ...init });

const eventForTarget = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  const event = eventFor(key, init);
  target.dispatchEvent(event);
  return event;
};

describe("Source Editor shortcut policy", () => {
  it("keeps existing unmodified normal bindings on the Canvas", () => {
    expect(keyboardCommandForEvent(eventFor("c"))?.commandId).toBe("addBezierCurve");
  });

  it("keeps the effective normal bindings after removing the dead element-list matcher", () => {
    expect(commandIdForKeyboardEvent(eventFor("g"))).toBe("focusSourceEditor");
    expect(commandIdForKeyboardEvent(eventFor("ArrowUp", { ctrlKey: true }))).toBe("moveSelectedElementUp");
    expect(commandIdForKeyboardEvent(eventFor("ArrowDown", { ctrlKey: true }))).toBe("moveSelectedElementDown");
    expect(commandIdForKeyboardEvent(eventFor("ArrowUp", { altKey: true }))).toBeNull();
    expect(commandIdForKeyboardEvent(eventFor("ArrowUp", { altKey: true, shiftKey: true }))).toBeNull();
    expect(commandIdForKeyboardEvent(eventFor("["))).toBeNull();
    expect(commandIdForKeyboardEvent(eventFor("]"))).toBeNull();
  });

  it("keeps Enter and Space on ordinary buttons out of global commands", () => {
    const button = document.createElement("button");
    const input = document.createElement("input");
    document.body.append(button, input);

    expect(shouldIgnoreKeyboardEvent(eventForTarget(button, "Enter"))).toBe(true);
    expect(shouldIgnoreKeyboardEvent(eventForTarget(button, " "))).toBe(true);
    expect(commandIdForKeyboardEvent(eventForTarget(input, "g"))).toBeNull();
    expect(keyboardCommandForEvent(eventForTarget(input, "ArrowRight", { altKey: true }), {
      scopes: ["sourceEditor"]
    })).toBeNull();

    button.remove();
    input.remove();
  });

  it("rejects Shift-only Source Editor keys and the CodeMirror delete-line chord", () => {
    const settings: ShortcutSettings = {
      version: 1,
      overrides: [
        { bindingId: "sourceEditor.addBezierCurve", chords: [{ key: "c", shift: true }] },
        { bindingId: "sourceEditor.addFreePoint", chords: [{ key: "k", mod: true, shift: true }] }
      ]
    };

    expect(shortcutConflicts(settings)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bindingIds: ["sourceEditor.addBezierCurve"],
        kind: "sourceEditorModifier"
      }),
      expect.objectContaining({
        bindingIds: ["sourceEditor.addFreePoint"],
        kind: "codeMirrorOwnership"
      })
    ]));
  });

  it("allows a Mod-modified Source Editor creation binding without colliding with normal C", () => {
    const settings: ShortcutSettings = {
      version: 1,
      overrides: [
        { bindingId: "sourceEditor.addBezierCurve", chords: [{ key: "c", mod: true, shift: true }] }
      ]
    };

    expect(shortcutConflicts(settings)).toEqual([]);
    expect(keyboardCommandForEvent(eventFor("c"), { settings })?.commandId).toBe("addBezierCurve");
  });

  it("keeps Alt-only value stepping scoped to Source Editor while normal overrides still work on Canvas", () => {
    const settings: ShortcutSettings = {
      version: 1,
      overrides: [{
        bindingId: "normal.moveSelectedElementUp",
        chords: [{ key: "ArrowUp", alt: true }]
      }]
    };

    expect(shortcutConflicts()).toEqual([]);
    expect(keyboardCommandForEvent(eventFor("ArrowRight", { altKey: true }), {
      scopes: ["sourceEditor"]
    })?.commandId).toBe("stepSourceValueForward");
    expect(keyboardCommandForEvent(eventFor("ArrowLeft", { altKey: true }), {
      scopes: ["sourceEditor"]
    })?.commandId).toBe("stepSourceValueBackward");
    expect(keyboardCommandForEvent(eventFor("ArrowUp", { altKey: true }), { settings })?.commandId)
      .toBe("moveSelectedElementUp");
  });
});
