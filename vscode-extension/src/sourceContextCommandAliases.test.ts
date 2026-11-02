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
  registerSourceContextCommandAliases,
  SOURCE_CONTEXT_COMMAND_ALIASES
} from "./sourceContextCommandAliases";

describe("Source context command aliases", () => {
  beforeEach(() => {
    mocks.registerCommand.mockReset();
    mocks.executeCommand.mockReset();
    mocks.registerCommand.mockImplementation((_command: string, handler: (...args: unknown[]) => unknown) => ({
      dispose: vi.fn(),
      handler
    }));
  });

  it("contains only the Source rows whose global command titles cannot be overridden per menu", () => {
    expect(SOURCE_CONTEXT_COMMAND_ALIASES).toEqual([
      ["nuinuiCAD.sourceContext.insertTemplate", "nuinuiCAD.insertTemplate"],
      ["nuinuiCAD.sourceContext.insertModulePreviewInstance", "nuinuiCAD.insertModulePreviewInstance"]
    ]);
    expect(new Set(SOURCE_CONTEXT_COMMAND_ALIASES.map(([alias]) => alias)).size)
      .toBe(SOURCE_CONTEXT_COMMAND_ALIASES.length);
  });

  it("does not forward the native editor/context document Uri to Insert Template", () => {
    const registration = registerSourceContextCommandAliases();
    const alias = "nuinuiCAD.sourceContext.insertTemplate";
    const handler = mocks.registerCommand.mock.calls.find(([command]) => command === alias)?.[1] as
      (...args: unknown[]) => unknown;
    const nativeDocumentUri = {
      scheme: "file",
      authority: "",
      path: "/tmp/example.nui",
      query: "",
      fragment: "",
      fsPath: "/tmp/example.nui",
      toString: () => "file:///tmp/example.nui"
    };

    handler(nativeDocumentUri);

    expect(mocks.executeCommand).toHaveBeenCalledWith("nuinuiCAD.insertTemplate");
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    expect(() => registration.dispose()).not.toThrow();
  });

  it("forwards insertModulePreviewInstance arguments to its canonical command", () => {
    const registration = registerSourceContextCommandAliases();
    const [alias, canonical] = SOURCE_CONTEXT_COMMAND_ALIASES.find(([candidate]) =>
      candidate === "nuinuiCAD.sourceContext.insertModulePreviewInstance"
    )!;
    const handler = mocks.registerCommand.mock.calls.find(([command]) => command === alias)?.[1] as
      (...args: unknown[]) => unknown;
    const args = [{ source: alias }, 42, undefined, "payload"];
    const result = { canonical };
    mocks.executeCommand.mockReturnValue(result);

    expect(handler(...args)).toBe(result);
    expect(mocks.executeCommand).toHaveBeenCalledWith(canonical, ...args);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    expect(() => registration.dispose()).not.toThrow();
  });
});
