/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const ruleBody = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`^${escapedSelector}\\s*\\{([\\s\\S]*?)^\\}`, "m"));

  expect(match, `Expected ${selector} rule in src/styles.css`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("shared stylesheet host layout ownership", () => {
  it("keeps the desktop minimum on .app-shell and lets Canvas webviews shrink", () => {
    expect(ruleBody("body")).not.toMatch(/min-width:\s*1180px/);
    expect(ruleBody(".app-shell")).toMatch(/min-width:\s*1180px/);

    const canvasWorkspace = ruleBody(".canvas-workspace");
    expect(canvasWorkspace).toMatch(/min-width:\s*0/);
    expect(canvasWorkspace).toMatch(/overflow:\s*hidden/);

    const vscodeCanvasWebviewBody = ruleBody("body.vscode-canvas-webview");
    expect(vscodeCanvasWebviewBody).toMatch(/margin:\s*0/);
    expect(vscodeCanvasWebviewBody).toMatch(/padding:\s*0/);
    expect(vscodeCanvasWebviewBody).toMatch(/min-width:\s*0/);
    expect(vscodeCanvasWebviewBody).toMatch(/overflow:\s*hidden/);
  });

  it("uses inherited VS Code Ribbon colors, active contrast, disabled foreground, and a side handle", () => {
    const vscodeWebview = ruleBody(".vscode-canvas-webview");
    expect(vscodeWebview).toContain("--vscode-canvas-ribbon-foreground:");
    expect(vscodeWebview).toContain(
      "--vscode-canvas-ribbon-active-foreground: var(--vscode-list-activeSelectionForeground, var(--vscode-canvas-ribbon-foreground));"
    );
    expect(stylesheet).not.toContain("--vscode-canvas-ribbon-icon-");
    expect(stylesheet).not.toContain("--vscode-charts-");
    expect(stylesheet).not.toContain("--vscode-terminal-ansi");
    expect(stylesheet).toMatch(
      /\.vscode-canvas-webview \.command-ribbon-handle,\s*\.vscode-canvas-webview \.command-ribbon-button,\s*\.vscode-canvas-webview \.command-ribbon-value\s*\{\s*color:\s*var\(--vscode-canvas-ribbon-foreground\)/
    );

    const activeCommand = ruleBody(
      ".vscode-canvas-webview .command-ribbon-button.is-active,\n.vscode-canvas-webview .command-ribbon-button[aria-pressed=\"true\"]"
    );
    expect(activeCommand).toMatch(/background:\s*var\(--vscode-canvas-ribbon-active\)/);
    expect(activeCommand).toMatch(/color:\s*var\(--vscode-canvas-ribbon-active-foreground\)/);

    const normalRibbon = ruleBody(".command-ribbon");
    expect(normalRibbon).toMatch(/background:\s*#ffffff/);
    expect(normalRibbon).toMatch(/color:\s*#252622/);

    const disabledCommand = ruleBody('.vscode-canvas-webview .command-ribbon-button[aria-disabled="true"]');
    expect(disabledCommand).toMatch(/color:\s*var\(--vscode-canvas-ribbon-disabled\)/);

    const focusableCommand = ruleBody(
      ".vscode-canvas-webview .command-ribbon-button:focus-visible,\n.vscode-canvas-webview .command-ribbon-handle:focus-visible"
    );
    expect(focusableCommand).toMatch(/outline:\s*2px solid var\(--vscode-canvas-ribbon-focus\)/);

    const tauriRibbonStyles = stylesheet.slice(
      stylesheet.indexOf(".command-ribbon-layer"),
      stylesheet.indexOf("/* VS Code owns its webview theme;")
    );
    expect(tauriRibbonStyles).not.toContain("--vscode-canvas-ribbon-active-foreground");
    expect(tauriRibbonStyles).not.toContain("--vscode-list-activeSelectionForeground");

    const sideHandleRibbon = ruleBody(".vscode-canvas-webview .command-ribbon.is-vertical.has-side-handle");
    expect(sideHandleRibbon).toMatch(/flex-direction:\s*row/);
    const sideHandleButtons = ruleBody(
      ".vscode-canvas-webview .command-ribbon.is-vertical.has-side-handle .command-ribbon-buttons"
    );
    expect(sideHandleButtons).toMatch(/flex-direction:\s*column/);

    const itemShell = ruleBody(".vscode-canvas-webview .command-ribbon-item-shell");
    expect(itemShell).toMatch(/display:\s*grid/);
    expect(itemShell).not.toMatch(/display:\s*inline/);
    expect(itemShell).not.toMatch(/vertical-align:/);
  });
});
