import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerCommand: vi.fn(),
  executeCommand: vi.fn()
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: mocks.registerCommand,
    executeCommand: mocks.executeCommand
  },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => ({
      dispose: () => items.forEach((item) => item.dispose())
    })
  }
}));

import {
  registerWebviewContextCommandAliases,
  WEBVIEW_CONTEXT_COMMAND_ALIASES
} from "./webviewContextCommandAliases";

describe("Webview context command aliases", () => {
  beforeEach(() => {
    mocks.registerCommand.mockReset();
    mocks.executeCommand.mockReset();
    mocks.registerCommand.mockImplementation((_command: string, handler: (...args: unknown[]) => unknown) => ({
      dispose: vi.fn(),
      handler
    }));
  });

  it("defines the exact unique alias-to-canonical command set", () => {
    expect(WEBVIEW_CONTEXT_COMMAND_ALIASES).toEqual([
      ["nuinuiCAD.webview.showCanvasPointNames", "nuinuiCAD.toggleCanvasPointNames"],
      ["nuinuiCAD.webview.hideCanvasPointNames", "nuinuiCAD.toggleCanvasPointNames"],
      ["nuinuiCAD.webview.showCanvasGeometryNames", "nuinuiCAD.toggleCanvasGeometryNames"],
      ["nuinuiCAD.webview.hideCanvasGeometryNames", "nuinuiCAD.toggleCanvasGeometryNames"],
      ["nuinuiCAD.webview.showCanvasPoints", "nuinuiCAD.toggleCanvasPoints"],
      ["nuinuiCAD.webview.hideCanvasPoints", "nuinuiCAD.toggleCanvasPoints"],
      ["nuinuiCAD.webview.modulePreview.showPointNames", "nuinuiCAD.modulePreview.togglePointNames"],
      ["nuinuiCAD.webview.modulePreview.hidePointNames", "nuinuiCAD.modulePreview.togglePointNames"],
      ["nuinuiCAD.webview.modulePreview.showGeometryNames", "nuinuiCAD.modulePreview.toggleGeometryNames"],
      ["nuinuiCAD.webview.modulePreview.hideGeometryNames", "nuinuiCAD.modulePreview.toggleGeometryNames"],
      ["nuinuiCAD.webview.modulePreview.showPoints", "nuinuiCAD.modulePreview.togglePoints"],
      ["nuinuiCAD.webview.modulePreview.hidePoints", "nuinuiCAD.modulePreview.togglePoints"]
    ]);
    expect(new Set(WEBVIEW_CONTEXT_COMMAND_ALIASES.map(([alias]) => alias)).size)
      .toBe(WEBVIEW_CONTEXT_COMMAND_ALIASES.length);
  });

  it("registers every alias and delegates exactly once with unchanged arguments and result", () => {
    const registration = registerWebviewContextCommandAliases();

    expect(mocks.registerCommand).toHaveBeenCalledTimes(WEBVIEW_CONTEXT_COMMAND_ALIASES.length);
    for (const [alias, canonical] of WEBVIEW_CONTEXT_COMMAND_ALIASES) {
      expect(mocks.registerCommand).toHaveBeenCalledWith(alias, expect.any(Function));
      const handler = mocks.registerCommand.mock.calls.find(([command]) => command === alias)?.[1] as
        (...args: unknown[]) => unknown;
      const args = [{ source: alias }, 42, undefined, "payload"];
      const result = { canonical };
      mocks.executeCommand.mockReturnValueOnce(result);

      expect(handler(...args)).toBe(result);
      expect(mocks.executeCommand).toHaveBeenLastCalledWith(canonical, ...args);
    }
    expect(mocks.executeCommand).toHaveBeenCalledTimes(WEBVIEW_CONTEXT_COMMAND_ALIASES.length);

    expect(() => registration.dispose()).not.toThrow();
  });
});
