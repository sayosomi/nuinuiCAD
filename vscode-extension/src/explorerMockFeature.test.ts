import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  joinPath: vi.fn((base: unknown, ...parts: string[]) => ({ base, parts }))
}));

vi.mock("vscode", () => ({
  window: {
    registerWebviewViewProvider: mocks.registerWebviewViewProvider
  },
  Uri: {
    joinPath: mocks.joinPath
  }
}));

import { NUI_EXPLORER_MOCK_VIEW_ID, registerExplorerMockFeature } from "./explorerMockFeature";

describe("Explorer Mock Webview View feature", () => {
  it("registers a lifecycle-only provider with the shared bundle bootstrap", () => {
    const context = { extensionUri: { fsPath: "/extension" } };
    const disposable = registerExplorerMockFeature(context as never);
    expect(disposable).toBeTruthy();
    expect(mocks.registerWebviewViewProvider).toHaveBeenCalledWith(
      NUI_EXPLORER_MOCK_VIEW_ID,
      expect.objectContaining({ resolveWebviewView: expect.any(Function) })
    );

    const provider = mocks.registerWebviewViewProvider.mock.calls.at(-1)?.[1] as {
      resolveWebviewView: (view: { webview: { options: unknown; html: string; cspSource: string; asWebviewUri: (uri: unknown) => string } }) => void;
    };
    const webview = {
      options: undefined,
      html: "",
      cspSource: "vscode-resource-scheme",
      asWebviewUri: vi.fn((uri: unknown) => `resource:${JSON.stringify(uri)}`)
    };

    provider.resolveWebviewView({ webview });

    expect(webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [{ base: context.extensionUri, parts: ["dist"] }]
    });
    expect(webview.html).toContain('data-nuinui-surface="explorerMock"');
    expect(webview.html).toContain("webview.js");
    expect(webview.html).toContain("webview.css");
    expect(webview.html).toMatch(/script-src 'nonce-[a-f0-9]{32}'/);
    expect(webview.html).not.toContain("onDidReceiveMessage");
  });
});

