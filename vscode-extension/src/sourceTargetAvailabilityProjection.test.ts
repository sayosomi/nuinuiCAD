import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageAnalysisSession } from "./languageAnalysisSession";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  activeTextEditor: undefined as TestEditor | undefined,
  activeEditorListeners: [] as Array<(editor: TestEditor | undefined) => void>,
  selectionListeners: [] as Array<(event: { textEditor: TestEditor }) => void>,
  documentChangeListeners: [] as Array<(event: { document: TestDocument; contentChanges: readonly unknown[] }) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>
}));

type TestPosition = { offset: number };
type TestDocument = {
  version: number;
  fileName: string;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: TestPosition) => number;
};
type TestEditor = {
  document: TestDocument;
  selection: { active: TestPosition };
  viewColumn: number;
};

const disposableFor = (dispose: () => void = () => undefined) => ({ dispose });
const removeListener = <T,>(listeners: T[], listener: T) => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => disposableFor(() => {
      for (const item of items) item.dispose();
    })
  },
  commands: {
    registerCommand: () => disposableFor(),
    executeCommand: mocks.executeCommand
  },
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
    showTextDocument: vi.fn(),
    showErrorMessage: vi.fn(),
    onDidChangeActiveTextEditor: (listener: (editor: TestEditor | undefined) => void) => {
      mocks.activeEditorListeners.push(listener);
      return disposableFor(() => removeListener(mocks.activeEditorListeners, listener));
    },
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor }) => void) => {
      mocks.selectionListeners.push(listener);
      return disposableFor(() => removeListener(mocks.selectionListeners, listener));
    }
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: { document: TestDocument; contentChanges: readonly unknown[] }) => void) => {
      mocks.documentChangeListeners.push(listener);
      return disposableFor(() => removeListener(mocks.documentChangeListeners, listener));
    },
    onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
      mocks.documentCloseListeners.push(listener);
      return disposableFor(() => removeListener(mocks.documentCloseListeners, listener));
    }
  }
}));

vi.mock("./referencePickSourceBridge", () => ({
  createVscodeReferencePickSourceBridge: vi.fn()
}));

import {
  registerVscodeReferencePickFeature,
  VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY,
  VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY
} from "./referencePickCommandFeature";

const flushContextUpdates = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

const contextValue = (key: string): boolean | undefined => {
  const matches = mocks.executeCommand.mock.calls.filter((call) => call[0] === "setContext" && call[1] === key);
  return matches.at(-1)?.[2] as boolean | undefined;
};

beforeEach(() => {
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.activeTextEditor = undefined;
  mocks.activeEditorListeners = [];
  mocks.selectionListeners = [];
  mocks.documentChangeListeners = [];
  mocks.documentCloseListeners = [];
});

describe("Source target availability projection", () => {
  it("reuses Reveal and Bake target semantics without conflating their hit areas", async () => {
    const source = [
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const width: number = @L.length"
    ].join("\n");
    const document: TestDocument = {
      version: 1,
      fileName: "/tmp/source-targets.nui",
      uri: { scheme: "file", toString: () => "file:///tmp/source-targets.nui" },
      getText: () => source,
      offsetAt: (position) => position.offset
    };
    const editor: TestEditor = {
      document,
      selection: { active: { offset: source.indexOf("@L.length") + 3 } },
      viewColumn: 1
    };
    mocks.activeTextEditor = editor;
    const analysis = createLanguageAnalysisSession(source);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => analysis,
      ensureCanvas: () => null
    });

    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(true);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);

    mocks.executeCommand.mockClear();
    editor.selection = { active: { offset: source.indexOf("segment") } };
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(true);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(true);

    mocks.executeCommand.mockClear();
    editor.selection = { active: { offset: 0 } };
    for (const listener of [...mocks.selectionListeners]) listener({ textEditor: editor });
    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);

    feature.dispose();
  });

  it("refreshes fail-closed after the active Source document loses its target", async () => {
    let source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const document: TestDocument = {
      version: 1,
      fileName: "/tmp/source-refresh.nui",
      uri: { scheme: "file", toString: () => "file:///tmp/source-refresh.nui" },
      getText: () => source,
      offsetAt: (position) => position.offset
    };
    const editor: TestEditor = {
      document,
      selection: { active: { offset: source.indexOf("coordinate") } },
      viewColumn: 1
    };
    mocks.activeTextEditor = editor;
    const analysis = createLanguageAnalysisSession(source);
    const feature = registerVscodeReferencePickFeature({
      languageAnalysisSessionFor: () => analysis,
      ensureCanvas: () => null
    });

    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(true);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(true);

    source = "nui 4\n// target removed";
    document.version += 1;
    editor.selection = { active: { offset: 0 } };
    mocks.executeCommand.mockClear();
    for (const listener of [...mocks.documentChangeListeners]) {
      listener({ document, contentChanges: [{}] });
    }
    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);

    mocks.executeCommand.mockClear();
    feature.dispose();
    await flushContextUpdates();
    expect(contextValue(VSCODE_REVEAL_IN_CANVAS_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);
    expect(contextValue(VSCODE_BAKE_SOURCE_TARGET_CONTEXT_KEY)).toBe(false);
  });
});