import { describe, expect, it } from "vitest";
import { commandRibbonIconColors } from "../commandRibbons/commandRibbonVisuals";
import {
  resolveVscodeCanvasRibbonIconColor,
  vscodeCanvasRibbonIconColorValues
} from "./vscodeCanvasRibbonVisuals";

describe("VS Code Canvas Ribbon icon presentation", () => {
  it("resolves every semantic token through VS Code theme variables", () => {
    for (const iconColor of commandRibbonIconColors) {
      expect(resolveVscodeCanvasRibbonIconColor(iconColor)).toBe(vscodeCanvasRibbonIconColorValues[iconColor]);
    }

    expect(vscodeCanvasRibbonIconColorValues).toMatchObject({
      teal: "var(--vscode-canvas-ribbon-icon-teal)",
      blue: "var(--vscode-canvas-ribbon-icon-blue)",
      green: "var(--vscode-canvas-ribbon-icon-green)",
      amber: "var(--vscode-canvas-ribbon-icon-amber)",
      orange: "var(--vscode-canvas-ribbon-icon-orange)",
      red: "var(--vscode-canvas-ribbon-icon-red)",
      pink: "var(--vscode-canvas-ribbon-icon-pink)",
      purple: "var(--vscode-canvas-ribbon-icon-purple)",
      slate: "var(--vscode-canvas-ribbon-icon-slate)"
    });
  });

  it("keeps default icons on the inherited currentColor", () => {
    expect(resolveVscodeCanvasRibbonIconColor(undefined)).toBe("currentColor");
    expect(resolveVscodeCanvasRibbonIconColor("default")).toBe("currentColor");
  });
});
