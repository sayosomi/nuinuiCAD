import { beforeEach, describe, expect, it, vi } from "vitest";

type TestDocument = {
  uri: { toString: () => string };
};

type TestDocumentChangeEvent = {
  document: TestDocument;
};

const mocks = vi.hoisted(() => ({
  activeEditorListeners: [] as Array<() => void>,
  documentChangeListeners: [] as Array<(event: TestDocumentChangeEvent) => void>,
  documentCloseListeners: [] as Array<(document: TestDocument) => void>,
  createTreeProvider: vi.fn(),
  registerTreeDataProvider: vi.fn(),
  treeRegistrationDispose: vi.fn()
}));

const removeListener = <T,>(listeners: T[], listener: T): void => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => ({
  Disposable: {
    from: (...disposables: Array<{ dispose: () => void }>) => ({
      dispose: () => {
        for (const disposable of disposables) disposable.dispose();
      }
    })
  },
  window: {
    registerTreeDataProvider: mocks.registerTreeDataProvider,
    onDidChangeActiveTextEditor: (listener: () => void) => {
      mocks.activeEditorListeners.push(listener);
      return { dispose: () => removeListener(mocks.activeEditorListeners, listener) };
    }
  },
  workspace: {
    onDidChangeTextDocument: (listener: (event: TestDocumentChangeEvent) => void) => {
      mocks.documentChangeListeners.push(listener);
      return { dispose: () => removeListener(mocks.documentChangeListeners, listener) };
    },
    onDidCloseTextDocument: (listener: (document: TestDocument) => void) => {
      mocks.documentCloseListeners.push(listener);
      return { dispose: () => removeListener(mocks.documentCloseListeners, listener) };
    }
  }
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}), { virtual: true });

vi.mock("./elementsTreeProvider", () => ({
  NUI_ELEMENTS_VIEW_ID: "nuinuiCAD.elements",
  createNuiElementsTreeProvider: mocks.createTreeProvider
}));

import { registerNuiElementsTreeFeature } from "./elementsTreeFeature";

const documentFor = (uri: string): TestDocument => ({ uri: { toString: () => uri } });

const activeDocument = documentFor("file:///workspace/active.nui");
const sameActiveDocument = documentFor("file:///workspace/active.nui");
const otherDocument = documentFor("file:///workspace/other.nui");

describe("registerNuiElementsTreeFeature", () => {
  let currentDocument: TestDocument | undefined;
  const refresh = vi.fn();
  const languageAnalysisSessionFor = vi.fn();
  const host = {
    activeNuiDocument: () => currentDocument as never,
    languageAnalysisSessionFor: languageAnalysisSessionFor as never
  };

  beforeEach(() => {
    currentDocument = activeDocument;
    refresh.mockReset();
    languageAnalysisSessionFor.mockReset();
    mocks.activeEditorListeners = [];
    mocks.documentChangeListeners = [];
    mocks.documentCloseListeners = [];
    mocks.createTreeProvider.mockReset();
    mocks.createTreeProvider.mockReturnValue({ refresh });
    mocks.registerTreeDataProvider.mockReset();
    mocks.treeRegistrationDispose.mockReset();
    mocks.registerTreeDataProvider.mockReturnValue({ dispose: mocks.treeRegistrationDispose });
  });

  it("creates and registers the existing provider with one listener for each refresh source", () => {
    const feature = registerNuiElementsTreeFeature(host);

    expect(mocks.createTreeProvider).toHaveBeenCalledWith(
      host.activeNuiDocument,
      host.languageAnalysisSessionFor
    );
    expect(mocks.registerTreeDataProvider).toHaveBeenCalledWith("nuinuiCAD.elements", { refresh });
    expect(mocks.activeEditorListeners).toHaveLength(1);
    expect(mocks.documentChangeListeners).toHaveLength(1);
    expect(mocks.documentCloseListeners).toHaveLength(1);

    feature.dispose();
  });

  it("refreshes for every active-editor change", () => {
    const feature = registerNuiElementsTreeFeature(host);

    mocks.activeEditorListeners[0]!();

    expect(refresh).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("refreshes only for a text change to the active supported document", () => {
    const feature = registerNuiElementsTreeFeature(host);

    mocks.documentChangeListeners[0]!({ document: sameActiveDocument });
    mocks.documentChangeListeners[0]!({ document: otherDocument });

    expect(refresh).toHaveBeenCalledTimes(1);
    feature.dispose();
  });

  it("preserves the active and no-active document-close refresh predicates", () => {
    const feature = registerNuiElementsTreeFeature(host);

    mocks.documentCloseListeners[0]!(otherDocument);
    mocks.documentCloseListeners[0]!(sameActiveDocument);
    currentDocument = undefined;
    mocks.documentCloseListeners[0]!(otherDocument);

    expect(refresh).toHaveBeenCalledTimes(2);
    feature.dispose();
  });

  it("disposes the view registration and all feature listeners together", () => {
    const feature = registerNuiElementsTreeFeature(host);

    feature.dispose();
    mocks.activeEditorListeners[0]?.();
    mocks.documentChangeListeners[0]?.({ document: activeDocument });
    mocks.documentCloseListeners[0]?.(activeDocument);

    expect(mocks.treeRegistrationDispose).toHaveBeenCalledTimes(1);
    expect(mocks.activeEditorListeners).toHaveLength(0);
    expect(mocks.documentChangeListeners).toHaveLength(0);
    expect(mocks.documentCloseListeners).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });
});
