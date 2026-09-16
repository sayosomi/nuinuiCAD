import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: vi.fn((base: unknown, ...parts: string[]) => ({ base, parts }))
  }
}));
vi.mock("./extension", () => ({
  activate: vi.fn(),
  currentCanvasThemeGeneration: vi.fn(() => 0),
  extensionDisplayLanguage: vi.fn(() => "ja-JP"),
  registerModulePreviewHistoryFallback: vi.fn(),
  deactivate: vi.fn()
}));
vi.mock("./modulePreviewFeature", () => ({ registerModulePreviewFeature: vi.fn() }));
vi.mock("./mcpObservationBridge", () => ({
  createMcpObservationBridge: vi.fn(),
  NUI_MCP_OBSERVATION_SETTING: "nuinuiCAD.mcpObservation"
}));
vi.mock("./moduleMultiDocumentHost", () => ({ createVscodeModuleMultiDocumentHost: vi.fn() }));
vi.mock("./rustEvaluationProcessOwner", () => ({ activeRustEvaluationProcessOwner: vi.fn() }));
vi.mock("./explorerMockFeature", () => ({ registerExplorerMockFeature: vi.fn() }));

import { modulePreviewWebviewHtml } from "./extensionEntry";

describe("Module Preview production HTML shell", () => {
  it("uses the Extension Host-resolved locale", () => {
    const panel = {
      webview: {
        cspSource: "vscode-resource-scheme",
        asWebviewUri: vi.fn((uri: unknown) => `resource:${JSON.stringify(uri)}`)
      }
    };

    const html = modulePreviewWebviewHtml(panel as never, { extensionUri: { fsPath: "/extension" } } as never);

    expect(html).toContain('<html lang="ja" data-nuinui-surface="modulePreview">');
  });

  it("does not register a separate Explorer parameter Webview View", async () => {
    const source = await readFile(resolve(process.cwd(), "vscode-extension/src/extensionEntry.ts"), "utf8");
    expect(source).not.toContain("modulePreviewParametersFeature");
    expect(source).not.toContain("registerModulePreviewParametersFeature");
  });
});
