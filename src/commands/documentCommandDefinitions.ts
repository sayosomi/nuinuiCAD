import {
  importLegacyDocument,
  newDocument,
  openDocument,
  saveDocument,
  saveDocumentAs
} from "../document/documentFile";
import { exportPrintPdf } from "../document/printPdfExport";
import { exportPrintSvg } from "../document/printSvgExport";
import { useCadDocumentStore } from "../state/cadDocumentStore";
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
  importLegacyDocument: {
    id: "importLegacyDocument",
    label: "旧形式(.nuinui.json)をインポート",
    palette: { order: 30.5, keywords: ["import", "legacy", "json", "旧形式", "インポート"] },
    run: () => runFileCommand(importLegacyDocument)
  },
  upgradeDocumentToNui3: {
    id: "upgradeDocumentToNui3",
    label: "文書を nui 3 へアップグレード",
    palette: { order: 30.6, keywords: ["nui 3", "upgrade", "version", "アップグレード", "バージョン"] },
    run: () => {
      useCadDocumentStore.getState().upgradeDslMajorVersion(3);
    }
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
  exportPrintSvg: {
    id: "exportPrintSvg",
    label: "SVGを書き出す",
    palette: { order: 32.5, keywords: ["svg", "export", "書き出し", "SVG", "Affinity", "Inkscape"] },
    run: (context) => runFileCommand(() => exportPrintSvg(context?.evaluation))
  },
  exportPrintPdf: {
    id: "exportPrintPdf",
    label: "印刷用PDFを書き出す",
    palette: { order: 33, keywords: ["pdf", "print", "export", "印刷", "書き出し", "PDF"] },
    run: (context) => runFileCommand(() => exportPrintPdf(context?.evaluation))
  }
} satisfies Partial<Record<CommandId, Command>>;
