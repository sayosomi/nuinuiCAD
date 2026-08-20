import type { CommandRibbonIconColor } from "../commandRibbons/commandRibbonVisuals";

export const vscodeCanvasRibbonIconColorValues: Record<CommandRibbonIconColor, string> = {
  default: "currentColor",
  teal: "var(--vscode-canvas-ribbon-icon-teal)",
  blue: "var(--vscode-canvas-ribbon-icon-blue)",
  green: "var(--vscode-canvas-ribbon-icon-green)",
  amber: "var(--vscode-canvas-ribbon-icon-amber)",
  orange: "var(--vscode-canvas-ribbon-icon-orange)",
  red: "var(--vscode-canvas-ribbon-icon-red)",
  pink: "var(--vscode-canvas-ribbon-icon-pink)",
  purple: "var(--vscode-canvas-ribbon-icon-purple)",
  slate: "var(--vscode-canvas-ribbon-icon-slate)"
};

export const resolveVscodeCanvasRibbonIconColor = (
  iconColor: CommandRibbonIconColor | undefined
): string => vscodeCanvasRibbonIconColorValues[iconColor ?? "default"];
