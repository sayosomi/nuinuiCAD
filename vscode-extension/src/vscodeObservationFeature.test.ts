import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VscodeCanvasObservationSnapshot } from "../../src/vscode/protocol";
import { VscodeObservationState, type VscodeObservationHostDocument } from "./vscodeObservationState";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  activeEditorListeners: [] as Array<() => void>,
  tabListeners: [] as Array<() => void>,
  tabGroupListeners: [] as Array<() => void>
}));

const removeListener = (listeners: Array<() => void>, listener: () => void): void => {
  const index = listeners.indexOf(listener);
  if (index >= 0) listeners.splice(index, 1);
};

vi.mock("vscode", () => ({
  commands: {
    executeCommand: mocks.executeCommand
  },
  window: {
    onDidChangeActiveTextEditor: (listener: () => void) => {
      mocks.activeEditorListeners.push(listener);
      return { dispose: () => removeListener(mocks.activeEditorListeners, listener) };
    },
    tabGroups: {
      onDidChangeTabs: (listener: () => void) => {
        mocks.tabListeners.push(listener);
        return { dispose: () => removeListener(mocks.tabListeners, listener) };
      },
      onDidChangeTabGroups: (listener: () => void) => {
        mocks.tabGroupListeners.push(listener);
        return { dispose: () => removeListener(mocks.tabGroupListeners, listener) };
      }
    }
  }
// @ts-expect-error Vitest's runtime supports the virtual-module options used here.
}), { virtual: true });

import {
  registerVscodeObservationFeature,
  VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY
} from "./vscodeObservationFeature";

const documentUri = "file:///tmp/pattern.nui";

const hostDocument = (
  overrides: Partial<VscodeObservationHostDocument> = {}
): VscodeObservationHostDocument => ({
  documentUri,
  documentPath: "/tmp/pattern.nui",
  documentVersion: 3,
  isDirty: true,
  activeSurface: "canvas",
  sourceSelection: null,
  diagnostics: [],
  canvasSessionPresent: true,
  outputPreviewSessionPresent: false,
  ...overrides
});

const runtimeSnapshot = (
  documentVersion = 3,
  selectedElementIds: readonly string[] = ["point-a"]
): VscodeCanvasObservationSnapshot => ({
  documentVersion,
  selectedElementIds,
  selectionSubject: { kind: "elements" },
  compiledDocumentRevision: 8,
  previewActive: false,
  evaluationRevision: 8,
  evaluationRequestRevision: 13,
  evaluationStatus: "ready",
  evaluationSource: "rust",
  rustEligible: true,
  isStale: false,
  isCurrent: true,
  errorCount: 0,
  warningCount: 0,
  errorSummaries: [],
  warningSummaries: []
});

const publication = (
  snapshot = runtimeSnapshot(),
  overrides: Partial<{
    sessionDocumentUri: string;
    currentDocumentVersion: number;
  }> = {}
) => ({
  sessionDocumentUri: documentUri,
  sessionSurfaceKind: "canvas" as const,
  sessionIsCurrent: true,
  currentDocumentVersion: 3,
  snapshot,
  ...overrides
});

const flushContextUpdates = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

const contextValue = (): boolean | undefined => {
  const calls = mocks.executeCommand.mock.calls.filter(
    (call) => call[0] === "setContext" && call[1] === VSCODE_CANVAS_HAS_SELECTION_CONTEXT_KEY
  );
  return calls.at(-1)?.[2] as boolean | undefined;
};

beforeEach(() => {
  mocks.executeCommand.mockReset();
  mocks.executeCommand.mockResolvedValue(undefined);
  mocks.activeEditorListeners = [];
  mocks.tabListeners = [];
  mocks.tabGroupListeners = [];
});

describe("registerVscodeObservationFeature", () => {
  it("owns provider setup and projects exact-current active Canvas selection", async () => {
    let document = hostDocument();
    const state = new VscodeObservationState();
    const hostDocuments = vi.fn(() => [document]);
    const feature = registerVscodeObservationFeature({ hostDocuments }, state);

    await flushContextUpdates();
    expect(contextValue()).toBe(false);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    await flushContextUpdates();
    expect(hostDocuments).toHaveBeenCalled();
    expect(state.snapshot().documents[0]?.canvas?.selectedElementIds).toEqual(["point-a"]);
    expect(contextValue()).toBe(true);

    document = hostDocument({ activeSurface: "source" });
    for (const listener of [...mocks.activeEditorListeners]) listener();
    await flushContextUpdates();
    expect(contextValue()).toBe(false);

    document = hostDocument({ activeSurface: "canvas" });
    for (const listener of [...mocks.tabListeners]) listener();
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    feature.dispose();
    await flushContextUpdates();
    expect(feature.acceptCanvasPublication(publication())).toBe(false);
    expect(state.snapshot().documents).toEqual([]);
    expect(contextValue()).toBe(false);
  });

  it("reprojects when the active Canvas changes without a new selection publication", async () => {
    const secondDocumentUri = "file:///tmp/second.nui";
    let documents: readonly VscodeObservationHostDocument[] = [
      hostDocument(),
      hostDocument({
        documentUri: secondDocumentUri,
        documentPath: "/tmp/second.nui",
        activeSurface: "none"
      })
    ];
    const state = new VscodeObservationState();
    const feature = registerVscodeObservationFeature({ hostDocuments: () => documents }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    expect(feature.acceptCanvasPublication(publication(runtimeSnapshot(3, []), {
      sessionDocumentUri: secondDocumentUri
    }))).toBe(true);
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    documents = [
      hostDocument({ activeSurface: "none" }),
      hostDocument({
        documentUri: secondDocumentUri,
        documentPath: "/tmp/second.nui",
        activeSurface: "canvas"
      })
    ];
    for (const listener of [...mocks.tabListeners]) listener();
    await flushContextUpdates();
    expect(contextValue()).toBe(false);

    documents = [
      hostDocument(),
      hostDocument({
        documentUri: secondDocumentUri,
        documentPath: "/tmp/second.nui",
        activeSurface: "none"
      })
    ];
    for (const listener of [...mocks.tabGroupListeners]) listener();
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    feature.dispose();
  });

  it("invalidates Canvas selection context for source changes and Canvas disposal", async () => {
    const state = new VscodeObservationState();
    const feature = registerVscodeObservationFeature({ hostDocuments: () => [hostDocument()] }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    feature.invalidateDocumentRuntime(documentUri);
    await flushContextUpdates();
    expect(state.snapshot().documents[0]?.canvas).toBeNull();
    expect(contextValue()).toBe(false);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    feature.removeCanvasSession(documentUri);
    await flushContextUpdates();
    expect(state.snapshot().documents[0]?.canvas).toBeNull();
    expect(contextValue()).toBe(false);

    feature.dispose();
  });

  it("removes closed documents and rejects stale publications fail-closed", async () => {
    const state = new VscodeObservationState();
    let documents: readonly VscodeObservationHostDocument[] = [hostDocument()];
    const feature = registerVscodeObservationFeature({ hostDocuments: () => documents }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    await flushContextUpdates();
    expect(contextValue()).toBe(true);

    documents = [hostDocument({ documentVersion: 4 })];
    expect(feature.acceptCanvasPublication(publication())).toBe(false);
    await flushContextUpdates();
    expect(contextValue()).toBe(false);

    documents = [];
    feature.removeDocument(documentUri);
    await flushContextUpdates();
    expect(state.snapshot().documents).toEqual([]);
    expect(feature.acceptCanvasPublication(publication())).toBe(false);
    expect(contextValue()).toBe(false);

    feature.dispose();
  });
});
