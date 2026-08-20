import {
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs
} from "../document/documentFile";
import type { Command, CommandId } from "./commandTypes";

const runFileCommand = (operation: () => Promise<void>) => {
  void operation().catch((error: unknown) => {
    console.error("Document file command failed.", error);
    window.alert(error instanceof Error ? error.message : String(error));
  });
};

export const documentCommandDefinitions = {
  newDocument: {
    id: "newDocument",
    label: "新規ドキュメント",
    palette: { order: 29, keywords: ["new", "file", "document", "新規", "ファイル"] },
    shortcuts: [{ keys: "Mod+N" }],
    run: () => runFileCommand(newDocument)
  },
  openDocument: {
    id: "openDocument",
    label: "ドキュメントを開く",
    palette: { order: 30, keywords: ["open", "file", "document", "開く", "ファイル"] },
    shortcuts: [{ keys: "Mod+O" }],
    run: () => runFileCommand(openDocument)
  },
  saveDocument: {
    id: "saveDocument",
    label: "保存",
    palette: { order: 31, keywords: ["save", "file", "document", "保存", "ファイル"] },
    shortcuts: [{ keys: "Mod+S" }],
    run: () => runFileCommand(saveDocument)
  },
  saveDocumentAs: {
    id: "saveDocumentAs",
    label: "名前を付けて保存",
    palette: { order: 32, keywords: ["save as", "file", "document", "保存", "別名", "ファイル"] },
    shortcuts: [{ keys: "Mod+Shift+S" }],
    run: () => runFileCommand(saveDocumentAs)
  },
} satisfies Partial<Record<CommandId, Command>>;
