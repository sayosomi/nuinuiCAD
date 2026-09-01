import { queryDslFixedColors, type DslFixedColorSemanticSnapshot } from "../../src/dsl/dslFixedColorQuery";
import type { SourceSnapshot } from "../../src/dsl/logicalStatementSourceMap";
import type { CanvasTheme } from "../../src/components/canvasTheme";
import {
  contrastRatio,
  parseCssColor
} from "../../src/vscode/vscodeCanvasTheme";
import type { VscodeCanvasThemePublication } from "../../src/vscode/vscodeCanvasThemeProtocol";

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

type CanvasThemeObservation = {
  sessionToken: CanvasSessionToken;
  documentUri: string;
  documentVersion: number;
  generation: number;
  theme: CanvasTheme;
};

export type CanvasThemeWarningFeature = {
  acceptCanvasThemePublication: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
    sessionIsCurrent: boolean;
    currentDocumentVersion: number;
  } & Omit<VscodeCanvasThemePublication, "type">) => boolean;
  invalidateCanvasThemeGeneration: (generation: number) => void;
  invalidateCanvasSession: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }) => void;
  removeCanvasSession: (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }) => void;
  currentCanvasTheme: () => CanvasTheme | null;
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
  currentThemeGeneration: () => number;
  onPreviewThemeChanged: () => void;
}): CanvasThemeWarningFeature => {
  const observations = new Map<string, CanvasThemeObservation>();
  let disposed = false;

  const themeKeys: readonly (keyof CanvasTheme)[] = [
    "foreground",
    "muted",
    "accent",
    "info",
    "warning",
    "error",
    "background",
    "minorGrid",
    "majorGrid",
    "axis",
    "bezierHandleLine",
    "bezierHandlePoint",
    "selection",
    "selectionOutline",
    "pickCandidate"
  ];

  const isCanvasTheme = (value: unknown): value is CanvasTheme => {
    if (!value || typeof value !== "object") return false;
    const theme = value as Partial<Record<keyof CanvasTheme, unknown>>;
    return themeKeys.every((key) => typeof theme[key] === "string") &&
      parseCssColor(theme.background as string) !== null;
  };

  const currentObservation = (): CanvasThemeObservation | undefined => {
    const generation = options.currentThemeGeneration();
    return [...observations.values()].find((observation) => observation.generation === generation);
  };

  const sameTheme = (left: CanvasTheme | null, right: CanvasTheme | null): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

  const notifyDiagnosticsChanged = (documentUri: string): void => {
    if (!disposed) options.onDiagnosticsChanged(documentUri);
  };

  const removeObservation = (input: {
    sessionToken: CanvasSessionToken;
    sessionDocumentUri: string;
  }): void => {
    const observation = observations.get(input.sessionDocumentUri);
    if (!observation || observation.sessionToken !== input.sessionToken) return;
    const previousTheme = currentObservation()?.theme ?? null;
    observations.delete(input.sessionDocumentUri);
    notifyDiagnosticsChanged(input.sessionDocumentUri);
    if (!sameTheme(previousTheme, currentObservation()?.theme ?? null)) {
      options.onPreviewThemeChanged();
    }
  };

  return {
    acceptCanvasThemePublication: (input) => {
      if (
        disposed ||
        !input.sessionIsCurrent ||
        !Number.isInteger(input.currentDocumentVersion) ||
        !Number.isInteger(input.documentVersion) ||
        !Number.isInteger(input.generation) ||
        input.documentVersion !== input.currentDocumentVersion ||
        input.generation !== options.currentThemeGeneration() ||
        !isCanvasTheme(input.theme)
      ) return false;

      const current = observations.get(input.sessionDocumentUri);
      if (current && current.sessionToken !== input.sessionToken) return false;
      if (current && current.documentVersion > input.documentVersion) return false;
      if (
        current &&
        current.documentVersion === input.documentVersion &&
        current.generation === input.generation &&
        sameTheme(current.theme, input.theme)
      ) return true;

      const previousTheme = currentObservation()?.theme ?? null;
      observations.set(input.sessionDocumentUri, {
        sessionToken: input.sessionToken,
        documentUri: input.sessionDocumentUri,
        documentVersion: input.documentVersion,
        generation: input.generation,
        theme: input.theme
      });
      notifyDiagnosticsChanged(input.sessionDocumentUri);
      if (!sameTheme(previousTheme, currentObservation()?.theme ?? null)) {
        options.onPreviewThemeChanged();
      }
      return true;
    },
    invalidateCanvasThemeGeneration: (generation) => {
      if (disposed || !Number.isInteger(generation)) return;
      const hadPreviewTheme = currentObservation() !== undefined || observations.size > 0;
      const documentUris = [...observations.keys()];
      observations.clear();
      for (const documentUri of documentUris) notifyDiagnosticsChanged(documentUri);
      if (hadPreviewTheme) options.onPreviewThemeChanged();
    },
    invalidateCanvasSession: removeObservation,
    removeCanvasSession: removeObservation,
    currentCanvasTheme: () => currentObservation()?.theme ?? null,
    warningsFor: (input) => {
      const observation = observations.get(input.documentUri);
      if (
        !observation ||
        observation.sessionToken !== input.sessionToken ||
        observation.documentUri !== input.documentUri ||
        observation.documentVersion !== input.documentVersion ||
        observation.generation !== options.currentThemeGeneration()
      ) return [];
      return fixedColorContrastWarningsFor({
        source: input.source,
        semantic: input.semantic,
        background: observation.theme.background
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      observations.clear();
    }
  };
};
