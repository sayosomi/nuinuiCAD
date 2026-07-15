import { describe, expect, it } from "vitest";
import { keyboardCommandForEvent, shortcutConflicts } from "./shortcuts";
import type { ShortcutSettings } from "./shortcutTypes";

const eventFor = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, bubbles: true, ...init });

describe("Source Editor shortcut policy", () => {
  it("keeps existing unmodified normal bindings on the Canvas", () => {
    expect(keyboardCommandForEvent(eventFor("c"))?.commandId).toBe("addBezierCurve");
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
});
