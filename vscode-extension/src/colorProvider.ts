import * as vscode from "vscode";
import { queryDslFixedColors } from "../../src/dsl/dslFixedColorQuery";
import { queryDslThemeRoleColors } from "../../src/dsl/dslThemeRoleColorQuery";
import type { CanvasTheme } from "../../src/components/canvasTheme";
import type { DrawingModifierThemeRole } from "../../src/types/geometry";
import { parseCssColor } from "../../src/vscode/vscodeCanvasTheme";
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
export type NuiCanvasThemeFor = () => CanvasTheme | null;
export type NuiThemeRoleColorEditAttempt = (role: DrawingModifierThemeRole) => void;

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

const sameColor = (
  color: vscode.Color,
  effective: { red: number; green: number; blue: number; alpha: number }
): boolean => {
  const epsilon = 0.000001;
  return Math.abs(color.red - effective.red / 255) <= epsilon &&
    Math.abs(color.green - effective.green / 255) <= epsilon &&
    Math.abs(color.blue - effective.blue / 255) <= epsilon &&
    Math.abs(color.alpha - effective.alpha) <= epsilon;
};

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
  sessionFor: NuiColorSessionFor,
  canvasThemeFor: NuiCanvasThemeFor = () => null,
  onThemeRoleColorEditAttempt?: NuiThemeRoleColorEditAttempt
): vscode.DocumentColorProvider => {
  const rejectedThemeRoleEdits = new Set<string>();

  return {
    provideDocumentColors: (document) => {
      const exact = exactDocumentColorsFor(document, sessionFor);
      if (!exact) return [];
      const fixedSemantic = exact.session.fixedColorSemanticSnapshot(exact.source);
      const fixedColors = queryDslFixedColors({ source: exact.source, semantic: fixedSemantic }).map(({ color, range }) => new vscode.ColorInformation(
        vscodeRangeForNormalized(document, exact.rawSource, range),
        new vscode.Color(color.red, color.green, color.blue, color.alpha)
      ));
      const canvasTheme = canvasThemeFor();
      if (!canvasTheme) return fixedColors;
      const themeSemantic = exact.session.themeRoleColorSemanticSnapshot(exact.source);
      const themeRoleColors = queryDslThemeRoleColors({ source: exact.source, semantic: themeSemantic }).flatMap(({ role, range }) => {
        const color = parseCssColor(canvasTheme[role]);
        return color
          ? [new vscode.ColorInformation(
              vscodeRangeForNormalized(document, exact.rawSource, range),
              new vscode.Color(color.red / 255, color.green / 255, color.blue / 255, color.alpha)
            )]
          : [];
      });
      return [...fixedColors, ...themeRoleColors];
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
      const currentDocument = (): boolean =>
        document.uri.toString() === documentUri &&
        document.version === documentVersion &&
        document.getText() === exact.rawSource;

      const semantic = exact.session.fixedColorSemanticSnapshot(exact.source);
      const fixedColor = queryDslFixedColors({ source: exact.source, semantic }).find(({ range, hex }) =>
        range.from === normalizedRange.from &&
        range.to === normalizedRange.to &&
        exact.source.normalizedSource.slice(range.from, range.to) === hex
      );
      if (fixedColor) {
        if (!currentDocument()) return [];
        const presentation = new vscode.ColorPresentation(fixedColorTextFor(color));
        presentation.textEdit = vscode.TextEdit.replace(context.range, presentation.label);
        return [presentation];
      }

      const themeSemantic = exact.session.themeRoleColorSemanticSnapshot(exact.source);
      const themeRole = queryDslThemeRoleColors({ source: exact.source, semantic: themeSemantic }).find(({ range }) =>
        range.from === normalizedRange.from && range.to === normalizedRange.to
      );
      if (!themeRole || !currentDocument()) return [];

      const canvasTheme = canvasThemeFor();
      const effectiveColor = canvasTheme ? parseCssColor(canvasTheme[themeRole.role]) : null;
      if (!effectiveColor) return [];

      const currentThemeSemantic = exact.session.themeRoleColorSemanticSnapshot(exact.source);
      const currentThemeRole = queryDslThemeRoleColors({
        source: exact.source,
        semantic: currentThemeSemantic
      }).find(({ role, range }) =>
        role === themeRole.role &&
        range.from === normalizedRange.from &&
        range.to === normalizedRange.to
      );
      if (!currentThemeRole || !currentDocument()) return [];

      const presentation = new vscode.ColorPresentation(currentThemeRole.role);
      const rejectionKey = `${documentUri}:${documentVersion}:${normalizedRange.from}:${normalizedRange.to}:${currentThemeRole.role}`;
      if (sameColor(color, effectiveColor)) {
        rejectedThemeRoleEdits.delete(rejectionKey);
        return [presentation];
      }

      if (!rejectedThemeRoleEdits.has(rejectionKey)) {
        rejectedThemeRoleEdits.add(rejectionKey);
        onThemeRoleColorEditAttempt?.(currentThemeRole.role);
      }
      return [presentation];
    }
  };
};
