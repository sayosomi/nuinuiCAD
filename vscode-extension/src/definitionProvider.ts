import * as vscode from "vscode";
import { queryDslDefinition, type DslDefinitionRange } from "../../src/dsl/dslDefinitionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";

export const nuiDefinitionSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const normalizedSourceFor = (sourceText: string): string => sourceText.replace(/\r\n/g, "\n");

const normalizedOffsetFromRaw = (rawSource: string, rawOffset: number): number => {
  let removedCarriageReturns = 0;
  for (let index = 0; index < rawOffset; index += 1) {
    if (rawSource[index] === "\r" && rawSource[index + 1] === "\n") removedCarriageReturns += 1;
  }
  return rawOffset - removedCarriageReturns;
};

const rawOffsetFromNormalized = (rawSource: string, normalizedOffset: number): number => {
  let rawOffset = 0;
  let normalizedPosition = 0;
  while (rawOffset < rawSource.length && normalizedPosition < normalizedOffset) {
    if (rawSource[rawOffset] === "\r" && rawSource[rawOffset + 1] === "\n") rawOffset += 1;
    rawOffset += 1;
    normalizedPosition += 1;
  }
  return rawOffset;
};

const vscodeRangeFor = (
  document: vscode.TextDocument,
  rawSource: string,
  range: DslDefinitionRange
): vscode.Range => new vscode.Range(
  document.positionAt(rawOffsetFromNormalized(rawSource, range.from)),
  document.positionAt(rawOffsetFromNormalized(rawSource, range.to))
);

export type NuiDefinitionSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

export const createNuiDefinitionProvider = (
  sessionFor: NuiDefinitionSessionFor
): vscode.DefinitionProvider => ({
  provideDefinition: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const rawSource = document.getText();
    const session = sessionFor(document);
    if (session.getSource() !== rawSource) session.replaceSource(rawSource);

    const normalizedSource = normalizedSourceFor(rawSource);
    const source: SourceSnapshot = {
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    };
    const semantic = session.definitionSemanticSnapshot(source);
    if (!semantic) return undefined;

    const normalizedOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(position));
    const result = queryDslDefinition({
      source,
      position: normalizedOffset,
      semantic
    });
    if (!result) return undefined;

    const originSelectionRange = vscodeRangeFor(document, rawSource, result.referenceRange);
    const targetSelectionRange = vscodeRangeFor(document, rawSource, result.declarationRange);
    const targetRange = document.lineAt(targetSelectionRange.start.line).range;
    return [{
      originSelectionRange,
      targetUri: document.uri,
      targetRange,
      targetSelectionRange
    }];
  }
});
