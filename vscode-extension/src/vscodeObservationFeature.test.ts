import { describe, expect, it, vi } from "vitest";
import type { VscodeCanvasObservationSnapshot } from "../../src/vscode/protocol";
import { VscodeObservationState, type VscodeObservationHostDocument } from "./vscodeObservationState";
import { registerVscodeObservationFeature } from "./vscodeObservationFeature";

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

const publication = (snapshot = runtimeSnapshot()) => ({
  sessionDocumentUri: documentUri,
  sessionSurfaceKind: "canvas" as const,
  sessionIsCurrent: true,
  currentDocumentVersion: 3,
  snapshot
});

describe("registerVscodeObservationFeature", () => {
  it("owns provider setup and exact-current Canvas publication delegation", () => {
    const state = new VscodeObservationState();
    const hostDocuments = vi.fn(() => [hostDocument()]);
    const feature = registerVscodeObservationFeature({ hostDocuments }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    expect(hostDocuments).toHaveBeenCalled();
    expect(state.snapshot().documents[0]?.canvas?.selectedElementIds).toEqual(["point-a"]);

    feature.dispose();
    expect(feature.acceptCanvasPublication(publication())).toBe(false);
    expect(state.snapshot().documents).toEqual([]);
  });

  it("invalidates Canvas runtime for source changes and Canvas disposal", () => {
    const state = new VscodeObservationState();
    const feature = registerVscodeObservationFeature({ hostDocuments: () => [hostDocument()] }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    feature.invalidateDocumentRuntime(documentUri);
    expect(state.snapshot().documents[0]?.canvas).toBeNull();

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    feature.removeCanvasSession(documentUri);
    expect(state.snapshot().documents[0]?.canvas).toBeNull();
  });

  it("removes closed documents and does not resurrect them without host projection", () => {
    const state = new VscodeObservationState();
    let documents: readonly VscodeObservationHostDocument[] = [hostDocument()];
    const feature = registerVscodeObservationFeature({ hostDocuments: () => documents }, state);

    expect(feature.acceptCanvasPublication(publication())).toBe(true);
    documents = [];
    feature.removeDocument(documentUri);

    expect(state.snapshot().documents).toEqual([]);
    expect(feature.acceptCanvasPublication(publication())).toBe(false);
  });
});
