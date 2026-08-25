import * as vscode from "vscode";
import { queryDslFixedColors } from "../../src/dsl/dslFixedColorQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  normalizedOffsetFromRaw,
  normalizedSourceFor,
  vscodeRangeForNormalized
} from "./sourceOffsetAdapter";

export const nuiColorSelector: vscode.DocumentSelector = {
  language: "nui",
  scheme: "file"
};

export type NuiColorSessionFor = (document: vscode.TextDocument) => NuiLanguageAnalysisSession;

type ExactDocumentColors = {
  rawSource: string;
  source: SourceSnapshot;
  session: NuiLanguageAnalysisSession;
};

const hexComponent = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)
  .toString(16)
  .padStart(2, "0");

const fixedColorTextFor = (color: vscode.Color) =>
  `#${hexComponent(color.red)}${hexComponent(color.green)}${hexComponent(color.blue)}`;

const exactDocumentColorsFor = (
  document: vscode.TextDocument,
  sessionFor: NuiColorSessionFor
): ExactDocumentColors | null => {
  if (document.uri.scheme !== "file" || !document.fileName.endsWith(".nui")) return null;

  const rawSource = document.getText();
  const normalizedSource = normalizedSourceFor(rawSource);
  const session = sessionFor(document);
  if (session.getSource() !== rawSource) session.replaceSource(rawSource);
  return {
    rawSource,
    source: {
      normalizedSource,
      sourceRevision: session.getSourceRevision()
    },
    session
  };
};

export const createNuiColorProvider = (
  sessionFor: NuiColorSessionFor
): vscode.DocumentColorProvider => ({
  provideDocumentColors: (document) => {
    const exact = exactDocumentColorsFor(document, sessionFor);
    if (!exact) return [];
    const semantic = exact.session.fixedColorSemanticSnapshot(exact.source);
    return queryDslFixedColors({ source: exact.source, semantic }).map(({ color, range }) => new vscode.ColorInformation(
      vscodeRangeForNormalized(document, exact.rawSource, range),
      new vscode.Color(color.red, color.green, color.blue, color.alpha)
    ));
  },
  provideColorPresentations: (color, context) => {
    const document = context.document;
    const documentUri = document.uri.toString();
    const documentVersion = document.version;
    const exact = exactDocumentColorsFor(document, sessionFor);
    if (!exact) return [];

    const normalizedRange = {
      from: normalizedOffsetFromRaw(exact.rawSource, document.offsetAt(context.range.start)),
      to: normalizedOffsetFromRaw(exact.rawSource, document.offsetAt(context.range.end))
    };
    const semantic = exact.session.fixedColorSemanticSnapshot(exact.source);
    const fixedColor = queryDslFixedColors({ source: exact.source, semantic }).find(({ range, hex }) =>
      range.from === normalizedRange.from &&
      range.to === normalizedRange.to &&
      exact.source.normalizedSource.slice(range.from, range.to) === hex
    );
    if (
      !fixedColor ||
      document.uri.toString() !== documentUri ||
      document.version !== documentVersion ||
      document.getText() !== exact.rawSource
    ) return [];

    const presentation = new vscode.ColorPresentation(fixedColorTextFor(color));
    presentation.textEdit = vscode.TextEdit.replace(context.range, presentation.label);
    return [presentation];
  }
});
