import { describe, expect, it } from "vitest";
import { commands, dispatchCommand, paletteCommandIds } from "./commands";
import { configurableShortcutBindings, shortcutBindings } from "../keyboard/shortcutDefaultBindings";

const retiredDslPanelCommandIds = [
  "openDslPanel",
  "exportDslSelection",
  "validateDslPanel",
  "applyDslPanel",
  "closeDslPanel"
] as const;

describe("Phase 4i DslPanel removal", () => {
  it("removes retired commands from the registry, palette, and shortcut bindings", () => {
    for (const commandId of retiredDslPanelCommandIds) {
      expect(commands).not.toHaveProperty(commandId);
      expect(paletteCommandIds).not.toContain(commandId);
      expect(shortcutBindings.map((binding) => binding.commandId)).not.toContain(commandId);
      expect(configurableShortcutBindings.map((binding) => binding.commandId)).not.toContain(commandId);
      expect(dispatchCommand(commandId as never)).toBe(false);
    }
  });
});
