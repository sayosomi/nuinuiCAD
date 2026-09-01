import type { CSSProperties } from "react";
import type { DrawingModifierThemeRole } from "../types/geometry";

/** Semantic presentation colors shared by Canvas2D and the SVG overlay. */
export type CanvasTheme = {
  foreground: string;
  muted: string;
  accent: string;
  info: string;
  warning: string;
  error: string;
  background: string;
  minorGrid: string;
  majorGrid: string;
  axis: string;
  bezierHandleLine: string;
  bezierHandlePoint: string;
  selection: string;
  selectionOutline: string;
  pickCandidate: string;
};

/** The established non-VS-Code Canvas appearance used by the development/test harness. */
export const LEGACY_CANVAS_THEME: CanvasTheme = {
  foreground: "#31322f",
  muted: "#53564f",
  accent: "#0f766e",
  info: "#2563eb",
  warning: "#73320d",
  error: "#b91c1c",
  background: "#fbfbfa",
  minorGrid: "#eceee8",
  majorGrid: "#d6d8d2",
  axis: "#c4c9bf",
  bezierHandleLine: "rgb(83 86 79 / 42%)",
  bezierHandlePoint: "#0f766e",
  selection: "rgb(15 118 110 / 80%)",
  selectionOutline: "rgb(15 118 110 / 80%)",
  pickCandidate: "#0f766e"
};

export const canvasThemeColorForRole = (
  theme: CanvasTheme,
  role: DrawingModifierThemeRole
): string => theme[role];

export const canvasThemeCssVariables = (theme: CanvasTheme): CSSProperties => ({
  "--canvas-foreground": theme.foreground,
  "--canvas-muted": theme.muted,
  "--canvas-accent": theme.accent,
  "--canvas-info": theme.info,
  "--canvas-warning": theme.warning,
  "--canvas-error": theme.error,
  "--canvas-background": theme.background,
  "--canvas-minor-grid": theme.minorGrid,
  "--canvas-major-grid": theme.majorGrid,
  "--canvas-axis": theme.axis,
  "--canvas-bezier-handle-line": theme.bezierHandleLine,
  "--canvas-bezier-handle-point": theme.bezierHandlePoint,
  "--canvas-selection": theme.selection,
  "--canvas-selection-outline": theme.selectionOutline,
  "--canvas-pick-candidate": theme.pickCandidate
} as CSSProperties);
