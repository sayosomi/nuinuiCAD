import { describe, expect, it, vi } from "vitest";
import { compileDslDocument } from "../../src/dsl/dslDocument";
import { parseDslSnapshot } from "../../src/dsl/dslParser";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";
import {
  createCanvasThemeWarningFeature,
  fixedColorContrastWarningsFor
} from "./canvasThemeWarningFeature";
import { contrastRatio, parseCssColor } from "../../src/vscode/vscodeCanvasTheme";
import { LEGACY_CANVAS_THEME } from "../../src/components/canvasTheme";

const sourceSnapshotFor = (source: string, sourceRevision = 1) => ({
  normalizedSource: source.replace(/\r\n/g, "\n"),
  sourceRevision
});

const warningsFor = (source: string, background: string, displayLanguage = "en") => {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  const snapshot = sourceSnapshotFor(normalizedSource);
  const parsed = parseDslSnapshot(snapshot);
  return fixedColorContrastWarningsFor({
    source: snapshot,
    semantic: {
      sourceRevision: snapshot.sourceRevision,
      compiled: compileDslDocument(normalizedSource, {
        preparsed: parsed,
        assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `warning-test:${index}`]))
      })
    },
    background,
    displayLanguage
  });
};

const modifierSource = (colors: readonly string[]): string => [
  "nui 1",
  ...colors.flatMap((color, index) => [
    `modifier M${index} {`,
    `  color: ${color},`,
    "}"
  ])
].join("\n");

describe("fixed-color Canvas contrast warnings", () => {
  it("localizes the warning presentation without changing its range or severity", () => {
    const source = modifierSource(["#999999"]);
    const english = warningsFor(source, "#ffffff", "en")[0];
    const japanese = warningsFor(source, "#ffffff", "ja-JP")[0];

    expect(english?.message).toBe("Fixed modifier color #999999 has low contrast against the current Canvas background.");
    expect(japanese?.message).toBe("固定modifier色 #999999 は現在のCanvas背景とのコントラストが低くなっています。");
    expect(japanese).toMatchObject({
      severity: "warning",
      code: "modifier-fixed-color-low-contrast",
      range: english?.range
    });
  });

  it("uses the existing contrast formula and warns strictly below 3:1", () => {
    const foreground = parseCssColor("#ffffff");
    const background = parseCssColor("#000000");
    if (!foreground || !background) throw new Error("Expected test colors to parse");
    expect(contrastRatio(foreground, background)).toBe(21);

    expect(warningsFor(modifierSource(["#999999"]), "#ffffff")).toHaveLength(1);
    const thresholdBackgroundValue = "rgb(148.87702996536567, 148.87702996536567, 148.87702996536567)";
    const thresholdBackground = parseCssColor(thresholdBackgroundValue);
    if (!thresholdBackground) throw new Error("Expected threshold background to parse");
    expect(contrastRatio(foreground, thresholdBackground)).toBeCloseTo(3, 12);
    expect(warningsFor(modifierSource(["#ffffff"]), thresholdBackgroundValue)).toEqual([]);
    expect(warningsFor(modifierSource(["#000000"]), "#ffffff")).toEqual([]);
  });

  it("evaluates fixed colors independently and excludes roles, lookalikes, malformed values, and comments", () => {
    const source = [
      "nui 1",
      "// color: #999999",
      "modifier Low {",
      "  color: #999999,",
      "}",
      "modifier High {",
      "  color: #0000ff,",
      "}",
      "modifier Role {",
      "  color: accent,",
      "}",
      'modifier "#999999" {',
      "  color: #12345,",
      "}",
      "modifier Medium {",
      "  color: #aaaaaa,",
      "}"
    ].join("\n");

    const warnings = warningsFor(source, "#ffffff");
    expect(warnings).toHaveLength(2);
    const lowColorStart = source.indexOf("#999999", source.indexOf("modifier Low"));
    expect(warnings.map((warning) => warning.range)).toEqual([
      { from: lowColorStart, to: lowColorStart + "#999999".length },
      { from: source.indexOf("#aaaaaa"), to: source.indexOf("#aaaaaa") + "#aaaaaa".length }
    ]);
    expect(warnings.every((warning) => warning.severity === "warning")).toBe(true);
    expect(warnings.every((warning) => warning.code === "modifier-fixed-color-low-contrast")).toBe(true);
    expect(warnings.every((warning) => warning.source === "nuinuiCAD")).toBe(true);
  });

  it("fails closed for stale semantic snapshots and unparseable backgrounds", () => {
    const source = modifierSource(["#999999"]);
    const session = createLanguageAnalysisSession(source);
    const current = sourceSnapshotFor(source, session.getSourceRevision());
    const semantic = session.fixedColorSemanticSnapshot(current);
    expect(fixedColorContrastWarningsFor({
      source: { ...current, sourceRevision: current.sourceRevision + 1 },
      semantic,
      background: "#ffffff"
    })).toEqual([]);
    expect(fixedColorContrastWarningsFor({
      source: current,
      semantic,
      background: "var(--vscode-editor-background)"
    })).toEqual([]);
  });
});

describe("Canvas theme warning observation lifecycle", () => {
  it("accepts only fresh current-session observations and reevaluates on invalidation", () => {
    const onDiagnosticsChanged = vi.fn();
    const onPreviewThemeChanged = vi.fn();
    let currentGeneration = 4;
    const feature = createCanvasThemeWarningFeature({
      onDiagnosticsChanged,
      currentThemeGeneration: () => currentGeneration,
      onPreviewThemeChanged
    });
    const sessionToken = {};
    const otherSessionToken = {};
    const source = modifierSource(["#999999"]);
    const session = createLanguageAnalysisSession(source);
    const snapshot = sourceSnapshotFor(source, session.getSourceRevision());
    const semantic = session.fixedColorSemanticSnapshot(snapshot);
    const publication = {
      sessionToken,
      sessionDocumentUri: "file:///tmp/pattern.nui",
      sessionIsCurrent: true,
      currentDocumentVersion: 4,
      documentVersion: 4,
      generation: 4,
      theme: { ...LEGACY_CANVAS_THEME, background: "#ffffff" }
    };

    expect(feature.acceptCanvasThemePublication(publication)).toBe(true);
    expect(onDiagnosticsChanged).toHaveBeenCalledWith(publication.sessionDocumentUri);
    expect(feature.currentCanvasTheme()).toEqual(publication.theme);
    expect(feature.warningsFor({
      sessionToken,
      documentUri: publication.sessionDocumentUri,
      documentVersion: 4,
      source: snapshot,
      semantic
    })).toHaveLength(1);
    expect(feature.acceptCanvasThemePublication({
      ...publication,
      documentVersion: 3,
      currentDocumentVersion: 3
    })).toBe(false);
    expect(feature.acceptCanvasThemePublication({
      ...publication,
      sessionToken: otherSessionToken
    })).toBe(false);
    expect(feature.acceptCanvasThemePublication({
      ...publication,
      sessionIsCurrent: false
    })).toBe(false);

    currentGeneration = 5;
    feature.invalidateCanvasThemeGeneration(currentGeneration);
    expect(feature.currentCanvasTheme()).toBeNull();
    expect(onPreviewThemeChanged).toHaveBeenCalledTimes(2);
    expect(onDiagnosticsChanged).toHaveBeenLastCalledWith(publication.sessionDocumentUri);

    expect(feature.acceptCanvasThemePublication({
      ...publication,
      generation: 4
    })).toBe(false);
    expect(feature.acceptCanvasThemePublication({
      ...publication,
      generation: 5,
      theme: { ...publication.theme, accent: "#123456" }
    })).toBe(true);
    expect(feature.currentCanvasTheme()).toEqual({ ...publication.theme, accent: "#123456" });

    feature.invalidateCanvasSession({
      sessionToken,
      sessionDocumentUri: publication.sessionDocumentUri
    });
    expect(feature.currentCanvasTheme()).toBeNull();
    expect(onPreviewThemeChanged).toHaveBeenCalledTimes(4);
    expect(JSON.parse(JSON.stringify(publication))).toEqual(publication);
    feature.dispose();
  });

  it("leaves no preview theme after the last current Canvas observation is removed", () => {
    const currentGeneration = 1;
    const feature = createCanvasThemeWarningFeature({
      onDiagnosticsChanged: vi.fn(),
      currentThemeGeneration: () => currentGeneration,
      onPreviewThemeChanged: vi.fn()
    });
    const firstToken = {};
    const secondToken = {};
    const theme = { ...LEGACY_CANVAS_THEME, background: "#ffffff" };
    const publication = (sessionToken: object, documentUri: string) => ({
      sessionToken,
      sessionDocumentUri: documentUri,
      sessionIsCurrent: true,
      currentDocumentVersion: 1,
      documentVersion: 1,
      generation: currentGeneration,
      theme
    });

    expect(feature.acceptCanvasThemePublication(publication(firstToken, "file:///first.nui"))).toBe(true);
    expect(feature.acceptCanvasThemePublication(publication(secondToken, "file:///second.nui"))).toBe(true);
    feature.removeCanvasSession({ sessionToken: firstToken, sessionDocumentUri: "file:///first.nui" });
    expect(feature.currentCanvasTheme()).toEqual(theme);
    feature.removeCanvasSession({ sessionToken: secondToken, sessionDocumentUri: "file:///second.nui" });
    expect(feature.currentCanvasTheme()).toBeNull();
    feature.dispose();
  });
});
