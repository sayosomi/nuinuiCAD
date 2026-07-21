import { describe, expect, it } from "vitest";
import { commands } from "../commands/commands";
import { commandIdForKeyboardEvent } from "./shortcuts";
import { shortcutBindings } from "./shortcutDefaultBindings";

describe("activity command shortcuts", () => {
  it("assigns no default shortcut to any of the 5 activity commands", () => {
    for (const commandId of [
      "cycleElementActivity",
      "setElementActivity",
      "setSelectedElementsVisible",
      "setSelectedElementsHidden",
      "setSelectedElementsDisabled"
    ] as const) {
      expect(commands[commandId].shortcuts ?? []).toHaveLength(0);
    }
  });

  it("keeps the 3 selection commands individually configurable, but not the context-driven pair", () => {
    const bindingIds = shortcutBindings.map((binding) => binding.commandId);
    expect(bindingIds).toContain("setSelectedElementsVisible");
    expect(bindingIds).toContain("setSelectedElementsHidden");
    expect(bindingIds).toContain("setSelectedElementsDisabled");
    expect(bindingIds).not.toContain("cycleElementActivity");
    expect(bindingIds).not.toContain("setElementActivity");
  });

  it("no longer triggers anything for v or a now that the legacy toggle shortcuts are retired", () => {
    expect(commandIdForKeyboardEvent(new KeyboardEvent("keydown", { key: "v" }))).toBeNull();
    expect(commandIdForKeyboardEvent(new KeyboardEvent("keydown", { key: "a" }))).toBeNull();
  });

  it("retires the old toggle command ids entirely", () => {
    for (const retiredId of [
      "toggleElementVisibility",
      "toggleElementEnabled",
      "toggleSelectedElementVisibility",
      "toggleSelectedElementEnabled"
    ]) {
      expect(commands).not.toHaveProperty(retiredId);
    }
  });
});
