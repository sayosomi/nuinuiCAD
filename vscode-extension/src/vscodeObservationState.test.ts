import { describe, expect, it } from "vitest";
import type { CompilerDiagnostic } from "./compilerDiagnostics";
import type { VscodeCanvasObservationSnapshot } from "../../src/vscode/protocol";
import {
  VscodeObservationState,
  type VscodeObservationHostDocument
} from "./vscodeObservationState";

const runtimeSnapshot = (documentVersion = 3): VscodeCanvasObservationSnapshot => ({
  documentVersion,
  selectedElementIds: ["point-a"],
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

  it("removes all observation facts when the document closes", () => {
    const state = new VscodeObservationState();
    state.replaceHostDocuments([hostDocument()]);
    expect(accept(state)).toBe(true);

    state.removeDocument("file:///tmp/pattern.nui");

    expect(state.snapshot()).toEqual({ activeDocumentUri: null, documents: [] });
  });
});
