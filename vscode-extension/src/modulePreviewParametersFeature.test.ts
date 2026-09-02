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

import {
  NUI_MODULE_PREVIEW_PARAMETERS_VIEW_ID,
  registerModulePreviewParametersFeature
} from "./modulePreviewParametersFeature";

describe("Module Preview Parameters Webview View feature", () => {
  it("registers a production provider with the shared bundle bootstrap and host attachment", () => {
    const attachment = { dispose: vi.fn() };
    const modulePreviewFeature = { attachParameterView: vi.fn(() => attachment) };
    const context = { extensionUri: { fsPath: "/extension" } };
    const disposable = registerModulePreviewParametersFeature(context as never, modulePreviewFeature as never);

    expect(disposable).toBeTruthy();
    expect(mocks.registerWebviewViewProvider).toHaveBeenCalledWith(
      NUI_MODULE_PREVIEW_PARAMETERS_VIEW_ID,
      expect.objectContaining({ resolveWebviewView: expect.any(Function) })
    );

    const provider = mocks.registerWebviewViewProvider.mock.calls.at(-1)?.[1] as {
      resolveWebviewView: (view: {
        webview: {
          options: unknown;
          html: string;
          cspSource: string;
          asWebviewUri: (uri: unknown) => string;
        };
        onDidDispose: (listener: () => void) => void;
      }) => void;
    };
    const webview = {
      options: undefined,
      html: "",
      cspSource: "vscode-resource-scheme",
      asWebviewUri: vi.fn((uri: unknown) => `resource:${JSON.stringify(uri)}`)
    };
    const onDidDispose = vi.fn();

    provider.resolveWebviewView({ webview, onDidDispose });

    expect(webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [{ base: context.extensionUri, parts: ["dist"] }]
    });
    expect(webview.html).toContain('data-nuinui-surface="modulePreviewParameters"');
    expect(webview.html).toContain('<html lang="en" data-nuinui-surface="modulePreviewParameters">');
    expect(webview.html).toContain("webview.js");
    expect(webview.html).toContain("webview.css");
    expect(webview.html).toMatch(/script-src 'nonce-[a-f0-9]{32}'/);
    expect(modulePreviewFeature.attachParameterView).toHaveBeenCalledWith(webview);
    expect(onDidDispose).toHaveBeenCalledWith(expect.any(Function));
    onDidDispose.mock.calls[0]?.[0]();
    expect(attachment.dispose).toHaveBeenCalled();
  });

  it("uses the resolved host locale in the production Parameters HTML shell", () => {
    const modulePreviewFeature = { attachParameterView: vi.fn(() => ({ dispose: vi.fn() })) };
    const context = { extensionUri: { fsPath: "/extension" } };
    registerModulePreviewParametersFeature(context as never, modulePreviewFeature as never, () => "ja-JP");

    const provider = mocks.registerWebviewViewProvider.mock.calls.at(-1)?.[1] as {
      resolveWebviewView: (view: {
        webview: {
          options: unknown;
          html: string;
          cspSource: string;
          asWebviewUri: (uri: unknown) => string;
        };
        onDidDispose: (listener: () => void) => void;
      }) => void;
    };
    const webview = {
      options: undefined,
      html: "",
      cspSource: "vscode-resource-scheme",
      asWebviewUri: vi.fn((uri: unknown) => `resource:${JSON.stringify(uri)}`)
    };

    provider.resolveWebviewView({ webview, onDidDispose: vi.fn() });

    expect(webview.html).toContain('<html lang="ja" data-nuinui-surface="modulePreviewParameters">');
  });
});
