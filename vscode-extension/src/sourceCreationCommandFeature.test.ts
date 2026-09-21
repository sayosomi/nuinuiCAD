import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  insertSnippet: vi.fn(),
  insertOutputSnippet: vi.fn(),
  showErrorMessage: vi.fn(),
  currentCompiledSemanticSnapshotFor: vi.fn()
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    }
  },
  workspace: { fs: { isWritableFileSystem: () => true } },
  window: { showErrorMessage: mocks.showErrorMessage },
  Position: class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }
}));
vi.mock("./languageAnalysisSession", () => ({
  currentCompiledSemanticSnapshotFor: mocks.currentCompiledSemanticSnapshotFor
}));
vi.mock("./creationCommandQuickPick", () => ({
  pickVscodeCreationCommand: mocks.pickCreationCommand
}));
vi.mock("./nativeQuickInput", () => ({
  nativeShowQuickPick: mocks.showQuickPick
}));
vi.mock("./sourceCreationSnippetAdapter", () => ({
  insertSourceCreationSnippet: mocks.insertSnippet,
  insertSourceOutputTemplateSnippet: mocks.insertOutputSnippet
}));

import {
  registerVscodeSourceCreationCommandFeature,
  VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID
} from "./sourceCreationCommandFeature";
import { VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID } from "./sourceCreationCommandFeature";
import { createNuiLanguageSession } from "@nuinuicad/nui-language";

beforeEach(() => {
  mocks.commands.clear();
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.insertSnippet.mockReset();
  mocks.insertOutputSnippet.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.currentCompiledSemanticSnapshotFor.mockReset();
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
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({
      displayLanguage: "ja-JP",
      recentCommandIds: []
    });
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    const [insertedEditor, materialization, insertedPosition] = mocks.insertSnippet.mock.calls[0]!;
    expect(insertedEditor).toBe(editor);
    expect(insertedPosition).toBe(activePosition);
    expect(materialization).toMatchObject({
      commandId: "addLine",
      formIndex: 0
    });

    mocks.pickCreationCommand.mockResolvedValue("addBezierCurve");
    mocks.insertSnippet.mockReturnValue(Promise.resolve(true));
    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.pickCreationCommand).toHaveBeenLastCalledWith({
      displayLanguage: "ja-JP",
      recentCommandIds: ["addLine"]
    });
    feature.dispose();
  });

  it("starts a fresh in-memory MRU for a new feature registration", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockResolvedValue(true);

    const firstFeature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });
    await mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.();
    firstFeature.dispose();

    const secondFeature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });
    await mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.();

    expect(mocks.pickCreationCommand).toHaveBeenLastCalledWith({
      displayLanguage: "en",
      recentCommandIds: []
    });
    secondFeature.dispose();
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

const sourceEditorFor = (source: string, version = 1, line = 1) => {
  const document = {
    languageId: "nui",
    fileName: "/tmp/example.nui",
    version,
    lineCount: source.split("\n").length,
    uri: { scheme: "file", toString: () => "file:///tmp/example.nui" },
    getText: () => source
  };
  const editor = { document, selection: { active: { line, character: 0 } } };
  const session = createNuiLanguageSession(source);
  const semantic = session.runtimeEvaluationSnapshot();
  if (!semantic) throw new Error("Expected a current test semantic snapshot");
  mocks.currentCompiledSemanticSnapshotFor.mockReturnValue({
    sourceRevision: semantic.sourceRevision,
    sourceText: semantic.sourceText,
    compiled: semantic.compiled
  });
  return { document, editor, session };
};

describe("Source Insert Template command feature", () => {
  it("captures the Source target before the fixed family picker and routes Output / Print in order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce("Layout + Print");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);

    expect(mocks.currentCompiledSemanticSnapshotFor.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.showQuickPick.mock.invocationCallOrder[0]);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(1, ["Geometry", "Output / Print"]);
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("keeps family cancellation and Output / Print cancellation mutation-free", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("rejects a document version change after family selection without opening a later picker or editing Source", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return "Output / Print";
    });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("changed"));
    feature.dispose();
  });

  it("rejects Place at the top level while preserving the fixed Output / Print catalog", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce("Place");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("layout body"));
    feature.dispose();
  });

  it("accepts Place only at a direct layout-body boundary", async () => {
    const { editor, session } = sourceEditorFor("nui 1\nlayout L {\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce("Place");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.insertOutputSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("rejects a top-level-only template in a nested group after the unchanged picker order", async () => {
    const { editor, session } = sourceEditorFor("nui 1\ngroup G {\n\n}\n", 1, 2);
    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce("SVG");
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenNthCalledWith(2, [
      "Layout + Print", "Layout", "Place", "Print", "SVG"
    ]);
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("top level"));
    feature.dispose();
  });

  it("uses the complete logical-statement boundary instead of splitting a multiline declaration", async () => {
    const source = "nui 1\npoint A = coordinate(\n  x: 0,\n  y: 0\n)\n";
    const { editor, session } = sourceEditorFor(source, 1, 1);
    mocks.showQuickPick
      .mockResolvedValueOnce("Output / Print")
      .mockResolvedValueOnce("Layout");
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    const insertedPosition = mocks.insertOutputSnippet.mock.calls[0]?.[2];
    expect(insertedPosition).toMatchObject({ line: 5, character: 0 });
    feature.dispose();
  });

  it("delegates the Geometry family to the existing Geometry chooser and keeps its MRU local", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n");
    mocks.showQuickPick.mockResolvedValueOnce("Geometry");
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({ displayLanguage: "en", recentCommandIds: [] });
    expect(mocks.insertSnippet).toHaveBeenCalledTimes(1);
    feature.dispose();
  });
});
