import * as vscode from "vscode";
import type { DslDefinitionRange } from "../../src/dsl/dslDefinitionQuery";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import { activeVscodeMultiDocumentHost } from "./multiDocumentHost";
import {
  normalizedOffsetFromRaw,
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

export type NuiDefinitionSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

export const createNuiDefinitionProvider = (
  sessionFor: NuiDefinitionSessionFor
): vscode.DefinitionProvider => ({
  provideDefinition: (document, position) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return undefined;

    const provideSingleDocument = (): vscode.DefinitionLink[] | undefined => {
      const rawSource = document.getText();
      const session = sessionFor(document);
      if (session.getSource() !== rawSource) session.replaceSource(rawSource);

      const normalizedOffset = normalizedOffsetFromRaw(rawSource, document.offsetAt(position));
      const result = session.definition(normalizedOffset);
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
    };

    const multiDocument = activeVscodeMultiDocumentHost();
    return multiDocument
      ? multiDocument.provideDefinition(document, position).then((handled) =>
          handled.handled ? handled.value : provideSingleDocument()
        )
      : provideSingleDocument();
  }
});
