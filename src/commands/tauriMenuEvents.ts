import { isTauriRuntime } from "../geometry/evaluationEngine";
import {
  commands,
  dispatchCommand,
  type CommandContext,
  type CommandId
} from "./commands";

export const TAURI_MENU_COMMAND_EVENT = "nuinuicad://menu-command";

const isCommandId = (value: unknown): value is CommandId =>
  typeof value === "string" && Object.hasOwn(commands, value);

export const registerTauriMenuCommandListener = (commandContext: CommandContext) => {
  if (!isTauriRuntime()) return () => undefined;

  let cancelled = false;
  let unlisten: (() => void) | null = null;

  void import("@tauri-apps/api/event")
    .then(({ listen }) =>
      listen<unknown>(TAURI_MENU_COMMAND_EVENT, (event) => {
        if (!isCommandId(event.payload)) return;
        dispatchCommand(event.payload, commandContext);
      })
    )
    .then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    })
    .catch((error: unknown) => {
      console.error("Failed to register Tauri menu command listener.", error);
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
};
