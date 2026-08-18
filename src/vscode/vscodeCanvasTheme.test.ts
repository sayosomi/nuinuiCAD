import { describe, expect, it } from "vitest";
import { LEGACY_CANVAS_THEME } from "../components/canvasTheme";
import { resolveVSCodeCanvasTheme } from "./vscodeCanvasTheme";

const stylesFor = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? ""
});

describe("resolveVSCodeCanvasTheme", () => {
  it("maps active VS Code CSS variables to the shared CanvasTheme DTO", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-descriptionForeground": "#222222",
      "--vscode-focusBorder": "#333333",
      "--vscode-editorInfo-foreground": "#444444",
      "--vscode-editorWarning-foreground": "#555555",
      "--vscode-editorError-foreground": "#666666",
      "--vscode-editor-background": "#777777",
      "--vscode-editorIndentGuide-background1": "#888888",
      "--vscode-editorIndentGuide-activeBackground1": "#999999",
      "--vscode-editorRuler-foreground": "#aaaaaa",
      "--vscode-editor-selectionHighlightBorder": "#bbbbbb"
    }));

    expect(theme).toEqual({
      foreground: "#111111",
      muted: "#222222",
      accent: "#333333",
      info: "#444444",
      warning: "#555555",
      error: "#666666",
      background: "#777777",
      minorGrid: "#888888",
      majorGrid: "#999999",
      axis: "#aaaaaa",
      bezierHandleLine: "#222222",
      bezierHandlePoint: "#333333",
      selection: "#bbbbbb",
      pickCandidate: "#333333"
    });
  });

  it("falls back safely when optional values are missing", () => {
    const theme = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#101010",
      "--vscode-descriptionForeground": "#202020",
      "--vscode-focusBorder": "#303030"
    }));

    expect(theme.foreground).toBe("#101010");
    expect(theme.muted).toBe("#202020");
    expect(theme.axis).toBe("#202020");
    expect(theme.bezierHandleLine).toBe("#202020");
    expect(theme.bezierHandlePoint).toBe("#303030");
    expect(theme.selection).toBe("#303030");
    expect(theme.pickCandidate).toBe("#303030");
    expect(theme.background).toBe(LEGACY_CANVAS_THEME.background);
    expect(theme.minorGrid).toBe(LEGACY_CANVAS_THEME.minorGrid);
    expect(theme.majorGrid).toBe(LEGACY_CANVAS_THEME.majorGrid);
    expect(theme.info).toBe(LEGACY_CANVAS_THEME.info);
    expect(theme.warning).toBe(LEGACY_CANVAS_THEME.warning);
    expect(theme.error).toBe(LEGACY_CANVAS_THEME.error);
  });

  it("re-resolves changed computed values without naming or selecting themes", () => {
    const first = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#111111",
      "--vscode-editor-background": "#eeeeee"
    }));
    const second = resolveVSCodeCanvasTheme(stylesFor({
      "--vscode-editor-foreground": "#eeeeff",
      "--vscode-editor-background": "#111122"
    }));

    expect(first.foreground).toBe("#111111");
    expect(first.background).toBe("#eeeeee");
    expect(second.foreground).toBe("#eeeeff");
    expect(second.background).toBe("#111122");
  });
});
