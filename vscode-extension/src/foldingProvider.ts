import * as vscode from "vscode";
import { queryDslFolding } from "../../src/dsl/dslFoldingQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

export const nuiFoldingSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

export type NuiFoldingSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

export const createNuiFoldingProvider = (
  sessionFor: NuiFoldingSessionFor
): vscode.FoldingRangeProvider => ({
  provideFoldingRanges: (document) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return [];

    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    const normalizedSource = normalizedSourceFor(rawSource);
    const source: SourceSnapshot = {
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    };
    const snapshot = session.foldingSyntaxSnapshot(source);
    if (!snapshot || snapshot.sourceText !== normalizedSource || snapshot.sourceRevision !== source.sourceRevision) return [];

    return queryDslFolding({
      source,
      statements: snapshot.statements,
      sourceMap: snapshot.sourceMap
    }).map((range) =>
      range.kind === "comment"
        ? new vscode.FoldingRange(range.startLine - 1, range.endLine - 1, vscode.FoldingRangeKind.Comment)
        : new vscode.FoldingRange(range.startLine - 1, range.endLine - 1)
    );
  }
});
