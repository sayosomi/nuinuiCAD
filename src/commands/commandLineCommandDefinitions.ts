import {
  cancelCommandLineSession,
  confirmCommandLineSession,
  startCommandLineCreation
} from "./commandLineSessionCommands";
import type { Command, CommandId } from "./commandTypes";

export const commandLineCommandDefinitions = {
  /** @deprecated Temporary Phase 4c ID. Phase 4g absorbs this into addFreePoint. */
  commandLineAddFreePoint: {
    id: "commandLineAddFreePoint",
    label: "コマンドラインで free point を作成",
    palette: { order: 1.1, keywords: ["command line", "free point", "点", "コマンドライン"] },
    flushPolicy: "editor-owned",
    run: (context) => startCommandLineCreation("freePoint", context)
  },
  /** @deprecated Temporary Phase 4c ID. Phase 4g absorbs this into addVariable. */
  commandLineAddVariable: {
    id: "commandLineAddVariable",
    label: "コマンドラインで変数を作成",
    palette: { order: 21.6, keywords: ["command line", "variable", "変数", "コマンドライン"] },
    flushPolicy: "editor-owned",
    run: (context) => startCommandLineCreation("variable", context)
  },
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
