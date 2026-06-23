import { filterCommandPaletteItems as filterPaletteItems, paletteCommandIds, paletteKeywords } from "./commandPalette";
import { creationCommandDefinitions } from "./creationCommandDefinitions";
import { parameterCommandDefinitions } from "./parameterCommandDefinitions";
import { pickCommandDefinitions } from "./pickCommandDefinitions";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";
import { viewModeCommandDefinitions } from "./viewModeCommandDefinitions";
import type { Command, CommandContext, CommandId } from "./commandTypes";
export type { BezierHandleRole, Command, CommandContext, CommandId } from "./commandTypes";

export const commands: Record<CommandId, Command> = {
  ...viewModeCommandDefinitions,
  ...selectionCommandDefinitions,
  ...pickCommandDefinitions,
  ...creationCommandDefinitions,
  ...parameterCommandDefinitions
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  commands[commandId].run(context);
};

export { paletteCommandIds, paletteKeywords } from "./commandPalette";
export type { CommandPaletteItem } from "./commandPalette";

export const commandPaletteItems = paletteCommandIds.map((commandId) => ({
  commandId,
  label: commands[commandId].label,
  keywords: paletteKeywords[commandId] ?? []
}));

export const filterCommandPaletteItems = (query: string) => filterPaletteItems(commandPaletteItems, query);
