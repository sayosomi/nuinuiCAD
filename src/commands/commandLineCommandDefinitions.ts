import {
  cancelCommandLineSession,
  confirmCommandLineSession
} from "./commandLineSessionCommands";
import type { Command, CommandId } from "./commandTypes";

export const commandLineCommandDefinitions = {
  cancelCommandLineSession: {
    id: "cancelCommandLineSession",
    label: "コマンドライン作成をキャンセル",
    flushPolicy: "editor-owned",
    run: () => cancelCommandLineSession()
  },
  confirmCommandLineSession: {
    id: "confirmCommandLineSession",
    label: "コマンドライン作成を確定",
    flushPolicy: "editor-owned",
    run: (context) => confirmCommandLineSession(context)
  }
} satisfies Partial<Record<CommandId, Command>>;
