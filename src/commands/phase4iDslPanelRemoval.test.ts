import { describe, expect, it } from "vitest";
import { commands, dispatchCommand, paletteCommandIds, type CommandId } from "./commands";
import { configurableShortcutBindings, shortcutBindings } from "../keyboard/shortcutDefaultBindings";
import { retiredCommandIds } from "../keyboard/shortcutSettingsStorage";
import { useCadUiStore } from "../state/cadUiStore";

type RetiredCommandId = (typeof retiredCommandIds)[number];
const retiredIdsAreNotCommandIds: Extract<CommandId, RetiredCommandId> extends never ? true : false = true;
const migratedElementListCommandIds = ["focusElementList", "enterElementListMode"] as const;
type MigratedElementListCommandId = (typeof migratedElementListCommandIds)[number];
const migratedIdsAreNotCommandIds: Extract<CommandId, MigratedElementListCommandId> extends never ? true : false = true;
const retiredColorAccentCommandId = `toggleElementList${"ColorAccents"}` as const;
const retiredColorAccentStateKey = `showElementList${"ColorAccents"}` as const;
const retiredColorAccentSetterKey = `setShowElementList${"ColorAccents"}` as const;
const retiredColorAccentCommandIsNotInCommandId: Extract<CommandId, typeof retiredColorAccentCommandId> extends never ? true : false = true;

describe("retired command enforcement", () => {
  it("removes retired commands from the registry, palette, and shortcut bindings", () => {
    expect(retiredIdsAreNotCommandIds).toBe(true);
    for (const commandId of retiredCommandIds) {
      expect(commands).not.toHaveProperty(commandId);
      expect(paletteCommandIds).not.toContain(commandId);
      expect(shortcutBindings.map((binding) => binding.commandId)).not.toContain(commandId);
      expect(configurableShortcutBindings.map((binding) => binding.commandId)).not.toContain(commandId);
      expect(dispatchCommand(commandId as never)).toBe(false);
    }
  });

  it("keeps only the unified Source Editor focus command active", () => {
    expect(migratedIdsAreNotCommandIds).toBe(true);
    expect(commands).toHaveProperty("focusSourceEditor");
    expect(paletteCommandIds).toContain("focusSourceEditor");
    expect(shortcutBindings).toContainEqual(expect.objectContaining({
      id: "normal.focusSourceEditor",
      commandId: "focusSourceEditor"
    }));
    for (const commandId of migratedElementListCommandIds) {
      expect(commands).not.toHaveProperty(commandId);
      expect(paletteCommandIds).not.toContain(commandId);
      expect(shortcutBindings.map((binding) => binding.commandId)).not.toContain(commandId);
      expect(dispatchCommand(commandId as never)).toBe(false);
    }
  });

  it("removes the dead Element List color control while keeping Pick shortcuts valid", () => {
    expect(retiredColorAccentCommandIsNotInCommandId).toBe(true);
    expect(commands).not.toHaveProperty(retiredColorAccentCommandId);
    expect(paletteCommandIds).not.toContain(retiredColorAccentCommandId);
    expect(dispatchCommand(retiredColorAccentCommandId as never)).toBe(false);
    expect(useCadUiStore.getState()).not.toHaveProperty(retiredColorAccentStateKey);
    expect(useCadUiStore.getState()).not.toHaveProperty(retiredColorAccentSetterKey);
    expect(configurableShortcutBindings).toContainEqual(expect.objectContaining({ scope: "pick" }));
  });
});
