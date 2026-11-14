import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  openNativeSourceSnippetPicker: vi.fn(),
  pickCreationCommand: vi.fn(),
  showQuickPick: vi.fn(),
  vscodeShowQuickPick: vi.fn(),
  showInformationMessage: vi.fn(),
  insertCreationSnippet: vi.fn(),
  insertExtractSnippet: vi.fn(),
  insertOutputSnippet: vi.fn(),
  showErrorMessage: vi.fn(),
  currentCompiledSemanticSnapshotFor: vi.fn(),
  globalStateGet: vi.fn(() => true),
  globalStateUpdate: vi.fn(),
  filesystemWritable: true
}));

const disposable = (dispose: () => void = () => undefined) => ({ dispose });

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, handler);
      return disposable(() => mocks.commands.delete(id));
    },
    executeCommand: mocks.executeCommand
  },
  workspace: {
    fs: { isWritableFileSystem: () => mocks.filesystemWritable }
  },
  window: {
    showErrorMessage: mocks.showErrorMessage,
    showInformationMessage: mocks.showInformationMessage,
    showQuickPick: mocks.vscodeShowQuickPick
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
  insertSourceCreationSnippet: mocks.insertCreationSnippet,
  insertSourceExtractSnippet: mocks.insertExtractSnippet,
  insertSourceOutputTemplateSnippet: mocks.insertOutputSnippet,
  openNativeSourceSnippetPicker: mocks.openNativeSourceSnippetPicker
}));

import {
  registerVscodeSourceCreationCommandFeature as registerSourceCreationCommandFeature,
  VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID,
  VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID
} from "./sourceCreationCommandFeature";
import {
  OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY,
  officialSnippetConfigurationMessageFor,
  VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID
} from "./officialSnippetConfiguration";
import { createNuiLanguageSession } from "@nuinuicad/nui-language";
import { SOURCE_OUTPUT_TEMPLATE_DEFINITIONS } from "../../src/commands/sourceOutputTemplateCatalog";
import {
  sourceCreationMessageFor,
  sourceOutputPrintPickerItemsFor
} from "./sourceCreationPresentationLocalization";

const sourceFeatureTestContext = () => ({
  extensionUri: { fsPath: "/extension" },
  globalState: {
    get: (key: string) => mocks.globalStateGet(key),
    update: (key: string, value: unknown) => mocks.globalStateUpdate(key, value)
  }
} as never);

const registerVscodeSourceCreationCommandFeature = (
  options: Omit<Parameters<typeof registerSourceCreationCommandFeature>[0], "context">
) => registerSourceCreationCommandFeature({ ...options, context: sourceFeatureTestContext() });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const internalOutputInvocation = {
  documentUri: "file:///tmp/example.nui",
  expectedDocumentVersion: 1,
  insertionOrigin: "document-end",
  preselectedFamilyId: "output-print"
} as const;

const sourceEditorFor = (
  source: string,
  version = 1,
  line = 1,
  withSemanticSnapshot = false,
  fileName = "/tmp/example.nui"
) => {
  const document = {
    languageId: "nui",
    fileName,
    version,
    lineCount: source.split("\n").length,
    uri: { scheme: "file", toString: () => `file://${fileName}` },
    getText: () => source,
    positionAt: (offset: number) => {
      const prefix = source.slice(0, offset);
      const lines = prefix.split("\n");
      return { line: lines.length - 1, character: lines.at(-1)!.length };
    }
  };
  const selection = {
    anchor: { line, character: 4 },
    active: { line, character: 9 }
  };
  const editor = { document, selection, selections: [selection] };
  const session = createNuiLanguageSession(source);
  if (withSemanticSnapshot) {
    const semantic = session.runtimeEvaluationSnapshot();
    if (!semantic) throw new Error("Expected a current test semantic snapshot");
    mocks.currentCompiledSemanticSnapshotFor.mockReturnValue({
      sourceRevision: semantic.sourceRevision,
      sourceText: semantic.sourceText,
      compiled: semantic.compiled
    });
  }
  return { document, editor, selection, session };
};

beforeEach(() => {
  mocks.commands.clear();
  mocks.executeCommand.mockReset();
  mocks.openNativeSourceSnippetPicker.mockReset();
  mocks.pickCreationCommand.mockReset();
  mocks.showQuickPick.mockReset();
  mocks.vscodeShowQuickPick.mockReset();
  mocks.showInformationMessage.mockReset();
  mocks.insertCreationSnippet.mockReset();
  mocks.insertExtractSnippet.mockReset();
  mocks.insertOutputSnippet.mockReset();
  mocks.showErrorMessage.mockReset();
  mocks.currentCompiledSemanticSnapshotFor.mockReset();
  mocks.globalStateGet.mockReset();
  mocks.globalStateGet.mockReturnValue(true);
  mocks.globalStateUpdate.mockReset();
  mocks.filesystemWritable = true;
});

describe("Source Create Geometry command feature", () => {
  it("keeps Create Geometry on its existing dynamic authoring flow", async () => {
    const position = { line: 4, character: 7 };
    const editor = { selection: { active: position } };
    const activeSourceEditor = vi.fn(() => editor);
    const displayLanguageFor = vi.fn(() => "ja-JP");
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    const insertionResult = Promise.resolve(true);
    mocks.insertCreationSnippet.mockReturnValue(insertionResult);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor,
      displayLanguageFor
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);

    expect(activeSourceEditor).toHaveBeenCalledTimes(1);
    expect(displayLanguageFor).toHaveBeenCalledTimes(1);
    expect(mocks.pickCreationCommand).toHaveBeenCalledWith({
      displayLanguage: "ja-JP",
      includeSourceExtract: true,
      recentCommandIds: []
    });
    expect(mocks.insertCreationSnippet).toHaveBeenCalledTimes(1);
    expect(mocks.insertCreationSnippet.mock.calls[0]?.[0]).toBe(editor);
    expect(mocks.insertCreationSnippet.mock.calls[0]?.[2]).toBe(position);
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();

    mocks.pickCreationCommand.mockResolvedValue("addBezierCurve");
    mocks.insertCreationSnippet.mockResolvedValue(true);
    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBe(true);
    expect(mocks.pickCreationCommand).toHaveBeenLastCalledWith({
      displayLanguage: "ja-JP",
      includeSourceExtract: true,
      recentCommandIds: ["addLine"]
    });
    feature.dispose();
  });

  it("starts a fresh in-memory MRU for a new Create Geometry registration", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    mocks.pickCreationCommand.mockResolvedValue("addLine");
    mocks.insertCreationSnippet.mockResolvedValue(true);

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
      includeSourceExtract: true,
      recentCommandIds: []
    });
    secondFeature.dispose();
  });

  it("does nothing when Create Geometry has no supported active editor", async () => {
    const activeSourceEditor = vi.fn(() => undefined);
    const displayLanguageFor = vi.fn(() => "en");
    const feature = registerVscodeSourceCreationCommandFeature({ activeSourceEditor, displayLanguageFor });

    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(displayLanguageFor).not.toHaveBeenCalled();
    expect(mocks.pickCreationCommand).not.toHaveBeenCalled();
    expect(mocks.insertCreationSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Create Geometry type and form cancellation mutation-free", async () => {
    const editor = { selection: { active: { line: 1, character: 2 } } };
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    mocks.pickCreationCommand.mockResolvedValue(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertCreationSnippet).not.toHaveBeenCalled();

    mocks.pickCreationCommand.mockResolvedValue("addDivisionPoint");
    mocks.showQuickPick.mockResolvedValue(undefined);
    await expect(mocks.commands.get(VSCODE_SOURCE_CREATE_GEOMETRY_COMMAND_ID)?.()).resolves.toBeUndefined();
    expect(mocks.showQuickPick).toHaveBeenCalledOnce();
    expect(mocks.insertCreationSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });
});

describe("Source Insert Template command feature", () => {
  it("keeps the first-run prompt cancel-safe", async () => {
    const { editor } = sourceEditorFor("nui 1\n");
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockResolvedValue(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.prompt", "en"),
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.configure", "en"),
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en")
    );
    expect(mocks.globalStateUpdate).not.toHaveBeenCalled();
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("continues on a stable target after the deferred prompt, even for incomplete source", async () => {
    const { editor, selection } = sourceEditorFor("nui 1\nconst unfinished = (\n");
    mocks.globalStateGet.mockReturnValue(false);
    const prompt = deferred<unknown>();
    mocks.showInformationMessage.mockReturnValue(prompt.promise);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    const pendingInsert = mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.();
    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    prompt.resolve(officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en"));
    await expect(pendingInsert).resolves.toBeUndefined();

    expect(mocks.globalStateUpdate).toHaveBeenCalledExactlyOnceWith(
      OFFICIAL_SNIPPETS_PROMPT_ACKNOWLEDGED_STATE_KEY,
      true
    );
    expect(mocks.openNativeSourceSnippetPicker).toHaveBeenCalledExactlyOnceWith(editor, 1);
    expect(editor.selection).toBe(selection);
    expect(mocks.currentCompiledSemanticSnapshotFor).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("cancels the native picker when the active Source editor switches during the deferred prompt", async () => {
    const { editor: editorA } = sourceEditorFor("nui 1\n", 1, 1, false, "/tmp/A.nui");
    const { editor: editorB } = sourceEditorFor("nui 1\n", 1, 1, false, "/tmp/B.nui");
    let currentEditor: typeof editorA | typeof editorB | undefined = editorA;
    const activeSourceEditor = vi.fn(() => currentEditor);
    const prompt = deferred<unknown>();
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockReturnValue(prompt.promise);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor,
      displayLanguageFor: () => "en"
    });

    const pendingInsert = mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.();
    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    currentEditor = editorB;
    prompt.resolve(officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en"));
    await expect(pendingInsert).resolves.toBeUndefined();

    expect(activeSourceEditor).toHaveBeenCalledTimes(2);
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("cancels the native picker when any selection moves during the deferred prompt", async () => {
    const { editor } = sourceEditorFor("nui 1\n");
    const secondarySelection = {
      anchor: { line: 2, character: 3 },
      active: { line: 2, character: 8 }
    };
    editor.selections.push(secondarySelection);
    const prompt = deferred<unknown>();
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockReturnValue(prompt.promise);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    const pendingInsert = mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.();
    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    secondarySelection.active.character += 1;
    prompt.resolve(officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en"));
    await expect(pendingInsert).resolves.toBeUndefined();

    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("cancels the native picker when the original document version changes during the deferred prompt", async () => {
    const { editor, document } = sourceEditorFor("nui 1\n");
    const prompt = deferred<unknown>();
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockReturnValue(prompt.promise);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    const pendingInsert = mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.();
    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    document.version += 1;
    prompt.resolve(officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en"));
    await expect(pendingInsert).resolves.toBeUndefined();

    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("cancels the native picker when the original editor becomes inactive during the deferred prompt", async () => {
    const { editor } = sourceEditorFor("nui 1\n");
    let currentEditor: typeof editor | undefined = editor;
    const activeSourceEditor = vi.fn(() => currentEditor);
    const prompt = deferred<unknown>();
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockReturnValue(prompt.promise);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor,
      displayLanguageFor: () => "en"
    });

    const pendingInsert = mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.();
    expect(mocks.showInformationMessage).toHaveBeenCalledOnce();
    currentEditor = undefined;
    prompt.resolve(officialSnippetConfigurationMessageFor("officialSnippets.firstRun.continue", "en"));
    await expect(pendingInsert).resolves.toBeUndefined();

    expect(activeSourceEditor).toHaveBeenCalledTimes(2);
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("routes first-run configuration through the always-available dedicated command", async () => {
    const { editor } = sourceEditorFor("nui 1\n");
    mocks.globalStateGet.mockReturnValue(false);
    mocks.showInformationMessage.mockResolvedValue(
      officialSnippetConfigurationMessageFor("officialSnippets.firstRun.configure", "en")
    );
    mocks.executeCommand.mockResolvedValue(false);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.commands.has(VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID)).toBe(true);
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith(VSCODE_CONFIGURE_OFFICIAL_SNIPPETS_COMMAND_ID);
    expect(mocks.globalStateUpdate).not.toHaveBeenCalled();
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it.each([
    "nui 1\npoint G = offset(\n  from: @F,\n  dx: 0,\n  dy: \n)",
    "nui 1\ngroup G {\n  point P = coordinate(x: 1, y: 2)\n",
    "nui 1\ngroup G {\n  record Measurements(\n    bust: number,\n  )\n}\n",
    "nui 1\nmodule M() {\n  record Measurements(\n    bust: number,\n  )\n}\n",
    "nui 1\nconst x: number = (\n",
    "nui 1\nlayout L {\n  print P(\n}\n"
  ])("opens the native picker for incomplete or invalid source without compiling it", async (source) => {
    const { editor, selection } = sourceEditorFor(source);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => {
        throw new Error("Ordinary snippets must not request DSL compilation");
      }
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.openNativeSourceSnippetPicker).toHaveBeenCalledExactlyOnceWith(editor, 1);
    expect(editor.selection).toBe(selection);
    expect(mocks.currentCompiledSemanticSnapshotFor).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    feature.dispose();
  });

  it.each([
    { languageId: "plaintext", fileName: "/tmp/example.nui", scheme: "file" },
    { languageId: "nui", fileName: "/tmp/example.nui", scheme: "untitled" },
    { languageId: "nui", fileName: "/tmp/example.txt", scheme: "file" }
  ])("does not open a picker for a non-Source editor", async ({ languageId, fileName, scheme }) => {
    const editor = {
      document: {
        languageId,
        fileName,
        version: 1,
        uri: { scheme, toString: () => `${scheme}:///tmp/example` },
        getText: () => "nui 1\n"
      },
      selection: { active: { line: 0, character: 0 } }
    };
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("does not open the native picker for a read-only filesystem", async () => {
    const { editor } = sourceEditorFor("nui 1\n");
    mocks.filesystemWritable = false;
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en"
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.()).resolves.toBeUndefined();

    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it.each([
    { documentUri: "file:///tmp/other.nui", expectedDocumentVersion: 1 },
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 2 }
  ])("rejects a stale or mismatched Output Preview document", async (invocation) => {
    const { editor, session } = sourceEditorFor("nui 1\n", 1, 1, true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.({
      ...internalOutputInvocation,
      ...invocation
    })).resolves.toBeUndefined();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it.each([
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 1, insertionOrigin: "document-end" },
    { documentUri: "file:///tmp/example.nui", expectedDocumentVersion: 1, insertionOrigin: "document-end", preselectedFamilyId: "geometry" },
    { ...internalOutputInvocation, unexpected: true }
  ])("rejects malformed internal Output Preview requests", async (invocation) => {
    const { editor, session } = sourceEditorFor("nui 1\n", 1, 1, true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "en",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(invocation)).resolves.toBeUndefined();

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("preserves Output Preview's preselected family, document-end insertion, and validation", async () => {
    const { editor, session } = sourceEditorFor("nui 1", 1, 1, true);
    const displayLanguage = "en";
    mocks.showQuickPick.mockResolvedValueOnce(sourceOutputPrintPickerItemsFor(displayLanguage)[1]);
    mocks.insertOutputSnippet.mockResolvedValue(true);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => displayLanguage,
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(internalOutputInvocation)).resolves.toBe(true);

    expect(SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map(({ id }) => id)).toEqual([
      "layout-print", "layout", "place", "print", "svg"
    ]);
    expect(mocks.showQuickPick).toHaveBeenCalledExactlyOnceWith(sourceOutputPrintPickerItemsFor(displayLanguage));
    expect(mocks.insertOutputSnippet).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ templateId: "layout" }),
      { line: 0, character: 5 },
      { prefixText: "\n" }
    );
    expect(mocks.openNativeSourceSnippetPicker).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("keeps Output Preview cancellation mutation-free and rejects illegal Output scope", async () => {
    const { editor, session } = sourceEditorFor("nui 1\n", 1, 1, true);
    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(internalOutputInvocation)).resolves.toBeUndefined();
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();

    mocks.showQuickPick.mockResolvedValueOnce(sourceOutputPrintPickerItemsFor("ja-JP")[2]);
    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(internalOutputInvocation)).resolves.toBeUndefined();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(sourceCreationMessageFor("placeScope", "ja-JP"));
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });

  it("reports an Output Preview source change while its specialized picker is open", async () => {
    const { editor, document, session } = sourceEditorFor("nui 1\n", 1, 1, true);
    mocks.showQuickPick.mockImplementationOnce(async () => {
      document.version += 1;
      return sourceOutputPrintPickerItemsFor("ja-JP")[1];
    });
    const feature = registerVscodeSourceCreationCommandFeature({
      activeSourceEditor: () => editor,
      displayLanguageFor: () => "ja-JP",
      languageAnalysisSessionFor: () => session
    });

    await expect(mocks.commands.get(VSCODE_SOURCE_INSERT_TEMPLATE_COMMAND_ID)?.(internalOutputInvocation)).resolves.toBeUndefined();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(sourceCreationMessageFor("stale", "ja-JP"));
    expect(mocks.insertOutputSnippet).not.toHaveBeenCalled();
    feature.dispose();
  });
});
