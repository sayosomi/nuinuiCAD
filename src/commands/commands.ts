import { filterCommandPaletteItems as filterPaletteItems } from "./commandPalette";
import { creationCommandDefinitions } from "./creationCommandDefinitions";
import { commandLineCommandDefinitions } from "./commandLineCommandDefinitions";
import { documentCommandDefinitions } from "./documentCommandDefinitions";
import { pickCommandDefinitions } from "./pickCommandDefinitions";
import { selectionCommandDefinitions } from "./selectionCommandDefinitions";
import { viewModeCommandDefinitions } from "./viewModeCommandDefinitions";
import { sourceEditorCommandDefinitions } from "./sourceEditorCommandDefinitions";
import type { Command, CommandContext, CommandId } from "./commandTypes";
import { sourceEditSession } from "../editor/sourceEditSession";
import { useCadUiStore } from "../state/cadUiStore";
export type { BezierHandleRole, Command, CommandContext, CommandId } from "./commandTypes";

export const commands: Record<CommandId, Command> = {
  ...documentCommandDefinitions,
  ...viewModeCommandDefinitions,
  ...selectionCommandDefinitions,
  ...pickCommandDefinitions,
  ...creationCommandDefinitions,
  ...commandLineCommandDefinitions,
  ...sourceEditorCommandDefinitions
};

export const dispatchCommand = (commandId: CommandId, context?: CommandContext) => {
  const command = commands[commandId];
  if (!command) return false;
  if (command.flushPolicy !== "editor-owned" &&
    context?.commitMode !== "preview" && sourceEditSession.flush("command") === "blocked-composition") {
    useCadUiStore.getState().setCommandErrorMessage(
      "日本語入力の確定中はコマンドを実行できません。入力を確定してから再操作してください。"
    );
    return false;
  }
  return command.run(context);
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
    keywords: command.palette?.keywords ?? [],
    isAvailable: command.palette?.isAvailable
  }));

export const filterCommandPaletteItems = (query: string, context?: CommandContext) =>
  filterPaletteItems(commandPaletteItems, query, context);
