import * as vscode from "vscode";
import type { NuiLanguageSession } from "@nuinuicad/nui-language";
import { activeVscodeMultiDocumentHost } from "./multiDocumentHost";
import {
  normalizedOffsetFromRaw,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiReferenceSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiReferenceSessionFor = (document: vscode.TextDocument) => NuiLanguageSession;

export const createNuiReferenceProvider = (
  sessionFor: NuiReferenceSessionFor
): vscode.ReferenceProvider => ({
  provideReferences: (document, position, context) => {
    if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return [];

    const provideSingleDocument = (): vscode.Location[] => {
      const rawSource = document.getText();
      const session = sessionFor(document);
      if (session.getSource() !== rawSource) session.replaceSource(rawSource);

      const result = session.references(normalizedOffsetFromRaw(rawSource, document.offsetAt(position)));
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
