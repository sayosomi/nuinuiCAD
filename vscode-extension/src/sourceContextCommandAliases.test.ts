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

  it("delegates each alias once to its canonical command and disposes registrations", () => {
    const registration = registerSourceContextCommandAliases();

    expect(mocks.registerCommand).toHaveBeenCalledTimes(SOURCE_CONTEXT_COMMAND_ALIASES.length);
    for (const [alias, canonical] of SOURCE_CONTEXT_COMMAND_ALIASES) {
      expect(mocks.registerCommand).toHaveBeenCalledWith(alias, expect.any(Function));
      const handler = mocks.registerCommand.mock.calls.find(([command]) => command === alias)?.[1] as
        (...args: unknown[]) => unknown;
      const args = [{ source: alias }, 42, undefined, "payload"];
      const result = { canonical };
      mocks.executeCommand.mockReturnValueOnce(result);

      expect(handler(...args)).toBe(result);
      expect(mocks.executeCommand).toHaveBeenLastCalledWith(canonical, ...args);
    }
    expect(mocks.executeCommand).toHaveBeenCalledTimes(SOURCE_CONTEXT_COMMAND_ALIASES.length);
    expect(() => registration.dispose()).not.toThrow();
  });
});
