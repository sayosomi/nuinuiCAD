import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  runSourceCreationFlow: vi.fn()
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    }
  }
}));
vi.mock("./sourceCreationFlow", () => ({
  runSourceCreationFlow: mocks.runSourceCreationFlow
}));

import {
  registerVscodeSourceCreationCommandFeature,
  VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID
} from "./sourceCreationCommandFeature";

beforeEach(() => {
  mocks.commands.clear();
  mocks.runSourceCreationFlow.mockReset();
});

describe("Source Create Geometry command feature", () => {
  it("captures the supplied Source editor caret once and runs the existing flow", async () => {
    const activePosition = { line: 4, character: 7 };
    const editor = { selection: { active: activePosition } };
    const activeSourceEditor = vi.fn(() => editor);
    const displayLanguageFor = vi.fn(() => "ja-JP");
    mocks.runSourceCreationFlow.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).toHaveBeenCalledTimes(1);
    expect(mocks.runSourceCreationFlow).toHaveBeenCalledWith(editor, activePosition, "ja-JP");
    feature.dispose();
  });

  it("does nothing when the Source owner has no supported active editor", async () => {
    const activeSourceEditor = vi.fn(() => undefined);
    const displayLanguageFor = vi.fn(() => "en");
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).not.toHaveBeenCalled();
    expect(mocks.runSourceCreationFlow).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("leaves type and form cancellation to the existing flow without editing", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.runSourceCreationFlow.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.runSourceCreationFlow).toHaveBeenCalledTimes(1);
    feature.dispose();
  });
});
