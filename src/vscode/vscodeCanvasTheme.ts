import {
  LEGACY_CANVAS_THEME,
  type CanvasTheme
} from "../components/canvasTheme";

type CssVariableSource = {
  getPropertyValue: (property: string) => string;
};

const colorFrom = (
  styles: CssVariableSource,
  variableName: string,
  fallback: string
): string => {
  const value = styles.getPropertyValue(variableName).trim();
  return value || fallback;
};

/** Resolves the active VS Code webview theme without exposing host details downstream. */
export const resolveVSCodeCanvasTheme = (styles: CssVariableSource): CanvasTheme => {
  const foreground = colorFrom(styles, "--vscode-editor-foreground", LEGACY_CANVAS_THEME.foreground);
  const muted = colorFrom(styles, "--vscode-descriptionForeground", LEGACY_CANVAS_THEME.muted);
  const accent = colorFrom(styles, "--vscode-focusBorder", LEGACY_CANVAS_THEME.accent);
  const selection = colorFrom(styles, "--vscode-editor-selectionHighlightBorder", accent);

  return {
    foreground,
    muted,
    accent,
    info: colorFrom(styles, "--vscode-editorInfo-foreground", LEGACY_CANVAS_THEME.info),
    warning: colorFrom(styles, "--vscode-editorWarning-foreground", LEGACY_CANVAS_THEME.warning),
    error: colorFrom(styles, "--vscode-editorError-foreground", LEGACY_CANVAS_THEME.error),
    background: colorFrom(styles, "--vscode-editor-background", LEGACY_CANVAS_THEME.background),
    minorGrid: colorFrom(styles, "--vscode-editorIndentGuide-background1", LEGACY_CANVAS_THEME.minorGrid),
    majorGrid: colorFrom(styles, "--vscode-editorIndentGuide-activeBackground1", LEGACY_CANVAS_THEME.majorGrid),
    axis: colorFrom(styles, "--vscode-editorRuler-foreground", muted),
    bezierHandleLine: colorFrom(styles, "--vscode-descriptionForeground", muted),
    bezierHandlePoint: colorFrom(styles, "--vscode-focusBorder", accent),
    selection,
    pickCandidate: colorFrom(styles, "--vscode-focusBorder", accent)
  };
};

export const readVSCodeCanvasTheme = (): CanvasTheme =>
  resolveVSCodeCanvasTheme(window.getComputedStyle(document.documentElement));
