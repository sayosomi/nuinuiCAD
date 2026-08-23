import * as vscode from "vscode";
import { queryDslReferences } from "../../src/dsl/dslReferencesQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import { activeVscodeMultiDocumentHost } from "./multiDocumentHost";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiReferenceSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiReferenceSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

export const createNuiReferenceProvider = (
  sessionFor: NuiReferenceSessionFor
): vscode.ReferenceProvider => ({
  provideReferences: (document, position, context) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return [];

    const provideSingleDocument = (): vscode.Location[] => {
      const rawSource = document.getText();
      const session = sessionFor(document);
      if (session.getSource() !== rawSource) session.replaceSource(rawSource);

      const normalizedSource = normalizedSourceFor(rawSource);
      const source: SourceSnapshot = {
        normalizedSource,
        sourceRevision: session.getSourceRevision()
      };
      const semantic = session.referencesSemanticSnapshot(source);
      if (!semantic) return [];

      const result = queryDslReferences({
        source,
        position: normalizedOffsetFromRaw(rawSource, document.offsetAt(position)),
        semantic
      });
      if (!result) return [];

      const ranges = context.includeDeclaration
        ? [result.declarationRange, ...result.referenceRanges]
        : result.referenceRanges;
      return ranges.map((range) => new vscode.Location(
        document.uri,
        vscodeRangeForNormalized(document, rawSource, range)
      ));
    };

    const multiDocument = activeVscodeMultiDocumentHost();
    return multiDocument
      ? multiDocument.provideReferences(document, position, context.includeDeclaration).then((handled) =>
          handled.handled ? handled.value : provideSingleDocument()
        )
      : provideSingleDocument();
  }
});
