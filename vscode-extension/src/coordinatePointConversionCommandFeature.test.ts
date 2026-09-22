import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeTextEditor: null as TestEditor | null,
  textDocuments: [] as TestDocument[],
  evaluateCurrent: vi.fn(),
  invalidateDocument: vi.fn(),
  closeDocument: vi.fn(),
  disposeRuntime: vi.fn(),
  executeCommand: vi.fn(),
  activeEditorListeners: [] as Array<(editor?: TestEditor) => void>,
  selectionListeners: [] as Array<(event: { textEditor: TestEditor }) => void>,
  refreshElementsTree: vi.fn()
}));

vi.mock("vscode", () => ({
  env: { language: "en" },
  window: {
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
    get visibleTextEditors() {
      return mocks.activeTextEditor ? [mocks.activeTextEditor] : [];
    },
    onDidChangeActiveTextEditor: (listener: (editor?: TestEditor) => void) => {
      mocks.activeEditorListeners.push(listener);
      return { dispose: vi.fn() };
    },
    onDidChangeTextEditorSelection: (listener: (event: { textEditor: TestEditor }) => void) => {
      mocks.selectionListeners.push(listener);
      return { dispose: vi.fn() };
    }
  },
  workspace: {
    get textDocuments() {
      return mocks.textDocuments;
    }
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: mocks.executeCommand
  },
  Disposable: {
    from: (...items: Array<{ dispose: () => void }>) => ({
      dispose: () => items.forEach((item) => item.dispose())
    })
  }
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}), { virtual: true });

vi.mock("./runtimeEvaluationService", () => ({
  createNuiRuntimeEvaluationService: vi.fn(() => ({
    evaluateCurrent: mocks.evaluateCurrent,
    invalidateDocument: mocks.invalidateDocument,
    closeDocument: mocks.closeDocument,
    dispose: mocks.disposeRuntime
  }))
}));

import {
  registerVscodeCoordinatePointConversionFeature
} from "./coordinatePointConversionCommandFeature";

type TestDocument = {
  fileName: string;
  languageId: string;
  version: number;
  uri: { scheme: string; toString: () => string };
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
};

type TestEditor = {
  document: TestDocument;
  selection: { active: { line: number; character: number } };
};

const documentFor = (): TestDocument => ({
  fileName: "/tmp/coordinate.nui",
  languageId: "nui",
  version: 1,
  uri: { scheme: "file", toString: () => "file:///tmp/coordinate.nui" },
  getText: () => "nui 1\n",
  offsetAt: () => 0
});

const featureFor = () => registerVscodeCoordinatePointConversionFeature({
  languageAnalysisSessionFor: () => ({
    getSource: () => "nui 1\n",
    replaceSource: vi.fn(),
    getSourceRevision: () => 1
  } as never),
  rustProcessOwner: { get: vi.fn() },
  ensureCanvas: () => null,
  activeCanvasEndpoint: () => null,
  applySourceLineSplices: vi.fn(),
  activeExplorerDocument: () => mocks.activeTextEditor?.document,
  refreshElementsTree: mocks.refreshElementsTree
});

const settle = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

afterEach(() => {
  mocks.activeTextEditor = null;
  mocks.textDocuments.length = 0;
  mocks.evaluateCurrent.mockReset();
  mocks.invalidateDocument.mockReset();
  mocks.closeDocument.mockReset();
  mocks.disposeRuntime.mockReset();
  mocks.executeCommand.mockReset();
  mocks.activeEditorListeners.length = 0;
  mocks.selectionListeners.length = 0;
  mocks.refreshElementsTree.mockReset();
});

describe("coordinate Source eligibility query", () => {
  it("uses the feature-owned runtime resolution path without context or Explorer side effects", async () => {
    const document = documentFor();
    const editor = { document, selection: { active: { line: 1, character: 0 } } };
    mocks.activeTextEditor = editor;
    mocks.textDocuments.push(document);
    mocks.evaluateCurrent.mockResolvedValue(undefined);
    const feature = featureFor();
    await settle();
    mocks.executeCommand.mockReset();
    mocks.refreshElementsTree.mockReset();

    expect(await feature.sourceTargetAvailableForEditor(editor)).toBe(false);
    expect(mocks.evaluateCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
    expect(mocks.refreshElementsTree).not.toHaveBeenCalled();
  });

  it("keeps existing context refresh behavior routed through the reusable query", async () => {
    const document = documentFor();
    const editor = { document, selection: { active: { line: 1, character: 0 } } };
    mocks.activeTextEditor = editor;
    mocks.textDocuments.push(document);
    mocks.evaluateCurrent.mockResolvedValue(undefined);
    const feature = featureFor();
    await settle();
    mocks.executeCommand.mockReset();
    mocks.evaluateCurrent.mockClear();

    feature.handleDocumentChange(document);
    await settle();

    expect(mocks.evaluateCurrent).toHaveBeenCalledTimes(2);
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "nuinuiCAD.coordinatePointConversionSourceTarget",
      false
    );
  });

  it("fails closed before runtime evaluation for unsupported or non-current editors", async () => {
    const document = documentFor();
    document.languageId = "plaintext";
    document.fileName = "/tmp/coordinate.txt";
    const editor = { document, selection: { active: { line: 1, character: 0 } } };
    mocks.evaluateCurrent.mockResolvedValue(undefined);
    const feature = featureFor();

    expect(await feature.sourceTargetAvailableForEditor(undefined)).toBe(false);
    expect(await feature.sourceTargetAvailableForEditor(editor)).toBe(false);
    expect(mocks.evaluateCurrent).not.toHaveBeenCalled();
  });
});
