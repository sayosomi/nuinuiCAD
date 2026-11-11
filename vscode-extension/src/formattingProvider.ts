import * as vscode from "vscode";
import { queryDslFormatting } from "@nuinuicad/nui-language";
import {
  normalizedOffsetAt,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiFormattingSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

const isSupportedDocument = (document: vscode.TextDocument): boolean =>
  document.uri.scheme === "file" && document.fileName.endsWith(".nui");

const nativeEditsFor = (
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
  selectionRange?: vscode.Range
): vscode.TextEdit[] => {
  if (!isSupportedDocument(document)) return [];
  const rawSource = document.getText();
  const normalizedSource = normalizedSourceFor(rawSource);
  const normalizedRange = selectionRange
    ? {
        from: normalizedOffsetAt(normalizedSource, selectionRange.start),
        to: normalizedOffsetAt(normalizedSource, selectionRange.end)
      }
    : undefined;
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  return queryDslFormatting({
    normalizedSource,
    options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
    ...(normalizedRange ? { selectionRange: normalizedRange } : {})
  }).map((edit) => vscode.TextEdit.replace(
    vscodeRangeForNormalized(document, rawSource, edit.range),
    eol === "\n" ? edit.newText : edit.newText.replace(/\n/g, eol)
  ));
};

export const createNuiDocumentFormattingProvider = (): vscode.DocumentFormattingEditProvider => ({
  provideDocumentFormattingEdits: (document, options) => nativeEditsFor(document, options)
});

export const createNuiDocumentRangeFormattingProvider = (): vscode.DocumentRangeFormattingEditProvider => ({
  provideDocumentRangeFormattingEdits: (document, range, options) => nativeEditsFor(document, options, range)
});

/** Register the native document and range providers under extension lifecycle disposal. */
export const registerNuiFormattingProviders = (): vscode.Disposable[] => {
  const registerDocument = vscode.languages.registerDocumentFormattingEditProvider;
  const registerRange = vscode.languages.registerDocumentRangeFormattingEditProvider;
  if (typeof registerDocument !== "function" || typeof registerRange !== "function") return [];

  return [
    registerDocument.call(
      vscode.languages,
      nuiFormattingSelector,
      createNuiDocumentFormattingProvider()
    ),
    registerRange.call(
      vscode.languages,
      nuiFormattingSelector,
      createNuiDocumentRangeFormattingProvider()
    )
  ];
};
