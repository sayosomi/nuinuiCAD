import * as vscode from "vscode";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";

export const nuiFoldingSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiFoldingSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

export const createNuiFoldingProvider = (
  sessionFor: NuiFoldingSessionFor
): vscode.FoldingRangeProvider => ({
  provideFoldingRanges: (document) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return [];

    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    return session.foldingRanges().map((range) =>
      range.kind === "comment"
        ? new vscode.FoldingRange(range.startLine - 1, range.endLine - 1, vscode.FoldingRangeKind.Comment)
        : new vscode.FoldingRange(range.startLine - 1, range.endLine - 1)
    );
  }
});
