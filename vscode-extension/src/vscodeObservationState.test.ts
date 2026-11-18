import { describe, expect, it, vi } from "vitest";
import type { CompilerDiagnostic } from "./compilerDiagnostics";
import type { VscodeCanvasObservationSnapshot } from "../../src/vscode/protocol";
import {
  VscodeObservationState,
  type VscodeObservationHostDocument
} from "./vscodeObservationState";

const runtimeSnapshot = (documentVersion = 3): VscodeCanvasObservationSnapshot => ({
  documentVersion,
  selectedElementIds: ["point-a"],
  canvasCanSelectInstance: false,
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

const hostDocument = (
  overrides: Partial<VscodeObservationHostDocument> = {}
): VscodeObservationHostDocument => ({
  documentUri: "file:///tmp/pattern.nui",
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

const hostFactsFor = (document: VscodeObservationHostDocument) => {
  const { diagnostics, ...facts } = document;
  void diagnostics;
  return facts;
};

const accept = (
  state: VscodeObservationState,
  snapshot = runtimeSnapshot(),
  overrides: Partial<Parameters<VscodeObservationState["acceptCanvasPublication"]>[0]> = {}
) => state.acceptCanvasPublication({
  sessionDocumentUri: "file:///tmp/pattern.nui",
  sessionSurfaceKind: "canvas",
  sessionIsCurrent: true,
  currentDocumentVersion: 3,
  snapshot,
  ...overrides
});

describe("VscodeObservationState", () => {
  it("accepts only the current Canvas session/document version", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([hostDocument()]);

    expect(accept(state)).toBe(true);
    expect(state.snapshot().documents[0]?.canvas?.selectedElementIds).toEqual(["point-a"]);
    expect(accept(state, runtimeSnapshot(2))).toBe(false);
    expect(accept(state, runtimeSnapshot(), { currentDocumentVersion: 2 })).toBe(false);
    expect(accept(state, runtimeSnapshot(), { sessionSurfaceKind: "outputPreview" })).toBe(false);
    expect(accept(state, runtimeSnapshot(), { sessionIsCurrent: false })).toBe(false);
  });

  it("invalidates runtime immediately on text change and rejects old publication resurrection", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([hostDocument()]);
    expect(accept(state)).toBe(true);

    state.invalidateCanvasRuntime("file:///tmp/pattern.nui");
    state.replaceHostDocuments([hostDocument({ documentVersion: 4 })]);

    expect(state.snapshot().documents[0]?.canvas).toBeNull();
    expect(accept(state, runtimeSnapshot(3), { currentDocumentVersion: 4 })).toBe(false);
    expect(state.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("clears Canvas runtime when the Canvas session closes", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([hostDocument()]);
    expect(accept(state)).toBe(true);

    state.invalidateCanvasRuntime("file:///tmp/pattern.nui");
    state.replaceHostDocuments([hostDocument({ canvasSessionPresent: false, activeSurface: "source" })]);

    expect(state.snapshot().documents[0]?.canvas).toBeNull();
    expect(accept(state)).toBe(false);
  });

  it("stores Source caret/selection and active Canvas/Output Preview surfaces as host facts", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([
      hostDocument({
        activeSurface: "source",
        sourceSelection: {
          anchor: { line: 2, character: 1 },
          active: { line: 2, character: 4 },
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          isEmpty: false
        }
      }),
      hostDocument({
        documentUri: "file:///tmp/preview.nui",
        documentPath: "/tmp/preview.nui",
        activeSurface: "outputPreview",
        canvasSessionPresent: false,
        outputPreviewSessionPresent: true
      })
    ]);

    const snapshot = state.snapshot();
    expect(snapshot.activeDocumentUri).toBe("file:///tmp/pattern.nui");
    expect(snapshot.documents[0]?.sourceSelection).toMatchObject({
      active: { line: 2, character: 4 },
      isEmpty: false
    });
    expect(snapshot.documents[1]?.activeSurface).toBe("outputPreview");
  });

  it("retains only diagnostics explicitly supplied by the nuinuiCAD language-analysis owner", () => {
    const state = new VscodeObservationState();
    const diagnostic = {
      severity: "warning",
      message: "language analysis warning"
    } as CompilerDiagnostic;
    state.replaceHostDocuments([hostDocument({ diagnostics: [diagnostic] })]);

    expect(state.snapshot().documents[0]?.diagnostics).toEqual([diagnostic]);
  });

  it("refreshes Canvas context from lightweight facts without requesting or overwriting diagnostics", () => {
    const state = new VscodeObservationState();
    const diagnostic = {
      severity: "warning",
      message: "latest full Observation diagnostic"
    } as CompilerDiagnostic;
    const fullObservation = vi.fn(() => [hostDocument({ diagnostics: [diagnostic] })]);
    const currentFacts = vi.fn(() => [hostFactsFor(hostDocument())]);
    state.setHostDocumentsProvider(fullObservation);
    state.setHostFactsProvider(currentFacts);

    const context = state.canvasContextSnapshot();
    expect(context.documents[0]).toMatchObject({
      documentVersion: 3,
      activeSurface: "canvas",
      canvas: null
    });
    expect(context.documents[0]).not.toHaveProperty("diagnostics");
    expect(currentFacts).toHaveBeenCalledTimes(1);
    expect(fullObservation).not.toHaveBeenCalled();

    expect(state.snapshot().documents[0]?.diagnostics).toEqual([diagnostic]);
    expect(fullObservation).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to old diagnostics after a lightweight document-version refresh", () => {
    const state = new VscodeObservationState();
    const staleDiagnostic = {
      severity: "warning",
      message: "version 3 diagnostic"
    } as CompilerDiagnostic;
    const currentDiagnostic = {
      severity: "error",
      message: "version 4 diagnostic"
    } as CompilerDiagnostic;
    let facts = hostDocument();
    const fullObservation = vi.fn(() => [
      hostDocument({ documentVersion: facts.documentVersion, diagnostics: facts.documentVersion === 3
        ? [staleDiagnostic]
        : [currentDiagnostic] })
    ]);
    const currentFacts = vi.fn(() => [hostFactsFor(facts)]);
    state.setHostDocumentsProvider(fullObservation);
    state.setHostFactsProvider(currentFacts);

    expect(state.snapshot().documents[0]?.diagnostics).toEqual([staleDiagnostic]);
    expect(accept(state)).toBe(true);
    facts = hostDocument({ documentVersion: 4 });

    const context = state.canvasContextSnapshot();
    expect(context.documents[0]?.documentVersion).toBe(4);
    expect(context.documents[0]?.canvas).toBeNull();
    expect(context.documents[0]).not.toHaveProperty("diagnostics");
    expect(state.cachedSnapshot().documents[0]?.documentVersion).toBe(4);
    expect(state.cachedSnapshot().documents[0]).not.toHaveProperty("diagnostics");

    expect(state.snapshot().documents[0]?.documentVersion).toBe(4);
    expect(state.snapshot().documents[0]?.diagnostics).toEqual([currentDiagnostic]);
  });

  it("removes all observation facts when the document closes", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([hostDocument()]);
    expect(accept(state)).toBe(true);

    state.removeDocument("file:///tmp/pattern.nui");

    expect(state.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });
});
