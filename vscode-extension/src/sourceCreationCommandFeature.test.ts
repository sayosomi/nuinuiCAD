import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  insertSnippet: vi.fn()
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
vi.mock("./creationCommandQuickPick", () => ({
  pickVscodeCreationCommand: mocks.pickCreationCommand
}));
vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.showQuickPick
}));
vi.mock("./sourceCreationSnippetAdapter", () => ({
  insertSourceCreationSnippet: mocks.insertSnippet
}));

import {
  registerVscodeSourceCreationCommandFeature,
  VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID
} from "./sourceCreationCommandFeature";

beforeEach(() => {
  mocks.commands.clear();
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.insertSnippet.mockReset();
});

describe("Source Create Geometry command feature", () => {
  it("runs the one-form production command path through materialization and snippet insertion", async () => {
    const activePosition = { line: 4, character: 7 };
    const editor = { selection: { active: activePosition } };
    const activeSourceEditor = vi.fn(() => editor);
    const displayLanguageFor = vi.fn(() => "ja-JP");
    const insertionResult = Promise.resolve(true);
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockReturnValue(insertionResult);
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).toHaveBeenCalledTimes(1);
    expect(mocks.pickCreationCommand).toHaveBeenCalledTimes(1);
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({ displayLanguage: "ja-JP" });
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    const [insertedEditor, materialization, insertedPosition] = mocks.insertSnippet.mock.calls[0]!;
    expect(insertedEditor).toBe(editor);
    expect(insertedPosition).toBe(activePosition);
    expect(materialization).toMatchObject({
      commandId: "addLine",
      formIndex: 0
    });
    feature.dispose();
  });

  it("does nothing when the Source owner has no supported active editor", async () => {
    const activeSourceEditor = vi.fn(() => undefined);
    const displayLanguageFor = vi.fn(() => "en");
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).not.toHaveBeenCalled();
    expect(mocks.pickCreationCommand).not.toHaveBeenCalled();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("stops at type cancellation without opening a form picker or inserting a snippet", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("stops at form cancellation after reaching the real form picker", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue("addDivisionPoint");
    mocks.showQuickPick.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });
});
