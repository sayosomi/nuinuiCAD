import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const extensionPath = resolve(process.cwd(), "vscode-extension/src/extension.ts");
const featurePath = resolve(process.cwd(), "vscode-extension/src/outputPreviewFeature.ts");

describe("Output Preview Extension Host feature ownership", () => {
  it("owns the session lifecycle, hydration, command registration, and Webview routing", async () => {
    const source = await readFile(featurePath, "utf8");

    expect(source).toContain("export type OutputPreviewSession");
    expect(source).toContain("const openForDocument");
    expect(source).toContain("const disposeSession");
    expect(source).toContain("const deliverPendingOpen");
    expect(source).toContain('message.type === "webviewReady"');
    expect(source).toContain('message.type === "webviewAuthoritativeDocumentReady"');
    expect(source).toContain('message.type === "rustEvaluationRequest"');
    expect(source).toContain('vscode.commands.registerCommand("nuinuiCAD.openOutputPreview"');
    expect(source).toContain('vscode.commands.registerCommand("nuinuiCAD.fitOutputPreview"');
    expect(source).toContain('vscode.commands.registerCommand("nuinuiCAD.outputPreviewUndo"');
  });

  it("keeps the production root at narrow shared composition", async () => {
    const source = await readFile(extensionPath, "utf8");

    expect(source).toContain("registerOutputPreviewFeature");
    expect(source).toContain('get: (documentUri) => sessions.get(documentUri, "outputPreview")');
    expect(source).toContain("requestRustEvaluation: (input) => rustProcessOwner.get().request(input)");
    expect(source).toContain("activeCanvasDocumentForOpenCommand");
    expect(source).not.toContain("const createOutputPreviewPanel");
    expect(source).not.toContain("const executeOpenOutputPreview");
    expect(source).not.toContain("const executeOutputPreviewHistory");
  });
});
