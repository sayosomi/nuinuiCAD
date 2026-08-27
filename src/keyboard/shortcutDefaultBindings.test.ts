import { describe, expect, it } from "vitest";
import { configurableShortcutBindings, shortcutBindings } from "./shortcutDefaultBindings";

const bindingFor = (id: string) => shortcutBindings.find((binding) => binding.id === id);

describe("default shortcut bindings", () => {
  it("keeps parent-group selection configurable with no default chord", () => {
    const binding = bindingFor("normal.selectParentGroup");

    expect(binding).toMatchObject({
      id: "normal.selectParentGroup",
      scope: "normal",
      commandId: "selectParentGroup",
      defaultChords: [],
      configurable: true
    });
    expect(configurableShortcutBindings).toContainEqual(binding);
  });

  it("does not assign ArrowLeft to parent-group selection", () => {
    expect(bindingFor("normal.selectParentGroup")?.defaultChords).not.toContainEqual({
      key: "ArrowLeft",
      mod: false,
      alt: false,
      shift: false
    });
  });

  it("preserves the pick-scope ArrowLeft mapping", () => {
    expect(shortcutBindings
      .filter(({ scope, defaultChords }) => scope === "pick" && defaultChords.some(({ key }) => key === "ArrowLeft"))
      .map(({ commandId, defaultChords }) => ({ commandId, defaultChords })))
      .toEqual([{
        commandId: "selectPreviousPickOption",
        defaultChords: [{ key: "ArrowLeft", mod: false, alt: false, shift: false }]
      }]);
  });
});
