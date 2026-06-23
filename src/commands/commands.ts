import { filterCommandPaletteItems as filterPaletteItems } from "./commandPalette";
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

export type { CommandPaletteItem } from "./commandPalette";

export const paletteCommandIds = Object.values(commands)
  .filter((command) => command.palette)
  .sort((a, b) => (a.palette?.order ?? Number.MAX_SAFE_INTEGER) - (b.palette?.order ?? Number.MAX_SAFE_INTEGER))
  .map((command) => command.id);

export const paletteKeywords = Object.fromEntries(
  Object.values(commands)
    .filter((command) => command.palette?.keywords)
    .map((command) => [command.id, command.palette?.keywords ?? []])
) as Partial<Record<CommandId, string[]>>;

export const commandPaletteItems = Object.values(commands)
  .filter((command) => command.palette)
  .sort((a, b) => (a.palette?.order ?? Number.MAX_SAFE_INTEGER) - (b.palette?.order ?? Number.MAX_SAFE_INTEGER))
  .map((command) => ({
    commandId: command.id,
    label: command.label,
    keywords: command.palette?.keywords ?? []
  }));

export const filterCommandPaletteItems = (query: string) => filterPaletteItems(commandPaletteItems, query);
