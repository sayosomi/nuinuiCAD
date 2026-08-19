import * as vscode from "vscode";
import { queryDslDefinition, type DslDefinitionRange } from "../../src/dsl/dslDefinitionQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiDefinitionSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const vscodeRangeFor = (
  document: vscode.TextDocument,
  rawSource: string,
  range: DslDefinitionRange
): vscode.Range => vscodeRangeForNormalized(document, rawSource, range);

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
