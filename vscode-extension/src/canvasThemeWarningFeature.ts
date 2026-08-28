import { queryDslFixedColors, type DslFixedColorSemanticSnapshot } from "../../src/dsl/dslFixedColorQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import {
  contrastRatio,
  parseCssColor
} from "../../src/vscode/vscodeCanvasTheme";
import type { VscodeCanvasBackgroundPublication } from "../../src/vscode/vscodeCanvasThemeProtocol";

export const LOW_CONTRAST_FIXED_COLOR_RATIO = 3;

export type CanvasThemeWarning = {
  severity: "warning";
  message: string;
  code: "modifier-fixed-color-low-contrast";
  source: "nuinuiCAD";
  range: { from: number; to: number };
};

export type CanvasSessionToken = object;

export type FixedColorContrastWarningsInput = {
  source: SourceSnapshot;
  semantic?: DslFixedColorSemanticSnapshot;
  background: string;
};

/** Produces Source warnings from exact-current fixed modifier colors only. */
export const fixedColorContrastWarningsFor = ({
  source,
  semantic,
  background
}: FixedColorContrastWarningsInput): readonly CanvasThemeWarning[] => {
  const backgroundColor = parseCssColor(background);
  if (!backgroundColor) return [];

  return queryDslFixedColors({ source, semantic }).flatMap((fixedColor) => {
    const fixedColorValue = parseCssColor(fixedColor.hex);
    if (!fixedColorValue || contrastRatio(fixedColorValue, backgroundColor) >= LOW_CONTRAST_FIXED_COLOR_RATIO) {
      return [];
    }
    return [{
      severity: "warning",
      message: `Fixed modifier color ${fixedColor.hex} has low contrast against the current Canvas background.`,
      code: "modifier-fixed-color-low-contrast",
      source: "nuinuiCAD",
      range: fixedColor.range
    }];
  });
};

type CanvasBackgroundObservation = {
  sessionToken: CanvasSessionToken;
  documentUri: string;
  documentVersion: number;
  background: string;
};

export type CanvasThemeWarningFeature = {
  acceptCanvasBackgroundPublication: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
    sessionIsCurrent: boolean;
    currentDocumentVersion: number;
  } & Omit<VscodeCanvasBackgroundPublication, "type">) => boolean;
  invalidateCanvasSession: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }) => void;
  removeCanvasSession: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }) => void;
  warningsFor: (input: {
    sessionToken: CanvasSessionToken;
    documentUri: string;
    documentVersion: number;
    source: SourceSnapshot;
    semantic?: DslFixedColorSemanticSnapshot;
  }) => readonly CanvasThemeWarning[];
  dispose: () => void;
};

export const createCanvasThemeWarningFeature = (options: {
  onDiagnosticsChanged: (documentUri: string) => void;
}): CanvasThemeWarningFeature => {
  const observations = new Map<string, CanvasBackgroundObservation>();
  let disposed = false;

  const notifyDiagnosticsChanged = (documentUri: string): void => {
    if (!disposed) options.onDiagnosticsChanged(documentUri);
  };

  const removeObservation = (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }): void => {
    const observation = observations.get(input.sessionDocumentUri);
    if (!observation || observation.sessionToken !== input.sessionToken) return;
    observations.delete(input.sessionDocumentUri);
    notifyDiagnosticsChanged(input.sessionDocumentUri);
  };

  return {
    acceptCanvasBackgroundPublication: (input) => {
      if (
        disposed ||
        !input.sessionIsCurrent ||
        !Number.isInteger(input.currentDocumentVersion) ||
        !Number.isInteger(input.documentVersion) ||
        input.documentVersion !== input.currentDocumentVersion ||
        !parseCssColor(input.background)
      ) return false;

      const current = observations.get(input.sessionDocumentUri);
      if (current && current.sessionToken !== input.sessionToken) return false;
      if (current && current.documentVersion > input.documentVersion) return false;
      if (
        current &&
        current.documentVersion === input.documentVersion &&
        current.background === input.background
      ) return true;

      observations.set(input.sessionDocumentUri, {
        sessionToken: input.sessionToken,
        documentUri: input.sessionDocumentUri,
        documentVersion: input.documentVersion,
        background: input.background
      });
      notifyDiagnosticsChanged(input.sessionDocumentUri);
      return true;
    },
    invalidateCanvasSession: removeObservation,
    removeCanvasSession: removeObservation,
    warningsFor: (input) => {
      const observation = observations.get(input.documentUri);
      if (
        !observation ||
        observation.sessionToken !== input.sessionToken ||
        observation.documentUri !== input.documentUri ||
        observation.documentVersion !== input.documentVersion
      ) return [];
      return fixedColorContrastWarningsFor({
        source: input.source,
        semantic: input.semantic,
        background: observation.background
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      observations.clear();
    }
  };
};
