import { describe, expect, it } from "vitest";
import {
  canvasOpenFrameCheck,
  canvasOpenSampleStatistics,
  type CanvasOpenFrameEvidence,
  type CanvasOpenPanelConfig,
  type CanvasOpenRawSample
} from "./canvasOpenCapture";

const config: CanvasOpenPanelConfig = {
  runId: "run-1",
  openId: "open-1",
  documentToken: "document-1",
  mode: "cold",
  phase: "measured",
  sampleIndex: 0,
  expectedDocumentVersion: 7,
  fixture: {
    id: "single-root",
    hash: `sha256:${"a".repeat(64)}`,
    rootSourceSha256: "b".repeat(64),
    kind: "single-root",
    expectedDependencyCount: 0,
    minimumRuntimeElementCount: 100,
    minimumComputedGeometryCount: 100,
    minimumDrawablePrimitiveCount: 50
  }
};

const evidence = (): CanvasOpenFrameEvidence => ({
  runId: "run-1",
  openId: "open-1",
  documentToken: "document-1",
  documentVersion: 7,
  sourceRevision: 4,
  graphRevision: 9,
  rustEvaluationRequestId: 12,
  activeDocumentMatches: true,
  sourceMatchesCurrentDocument: true,
  graphCurrent: true,
  graphValid: true,
  graphMatchesRuntime: true,
  dependencyCount: 0,
  rustStatus: "ready",
  rustSource: "rust",
  rustEligible: true,
  evaluationIsCurrent: true,
  evaluationErrorCount: 0,
  lastGoodFallback: false,
  placeholderPaint: false,
  runtimeElementCount: 120,
  computedGeometryCount: 120,
  drawablePrimitiveCount: 80,
  evaluationRequestRevision: 6,
  renderSurface: {
    cssWidthPx: 800,
    cssHeightPx: 600,
    backingWidthPx: 1600,
    backingHeightPx: 1200,
    devicePixelRatio: 2
  },
  webviewUserAgent: "test-webview"
});

const sample = (hostElapsedMs: number): CanvasOpenRawSample => ({
  mode: "cold",
  sampleIndex: 0,
  hostElapsedMs,
  hostPid: 10,
  identity: { documentVersion: 7, sourceRevision: 4, graphRevision: 9, rustEvaluationRequestId: 12 },
  fixtureId: "single-root",
  fixtureHash: config.fixture.hash,
  runtimeElementCount: 120,
  computedGeometryCount: 120,
  drawablePrimitiveCount: 80,
  webviewElapsedMs: 100,
  webviewUserAgent: "test-webview",
  renderSurface: evidence().renderSurface!,
  hostPhases: { panelOpenToWebviewReadyMs: 20, panelOpenToAuthoritativeDocumentMs: 30, rustRequestServiceMs: 50 },
  phaseEvidence: {
    host: { clockOrigin: "extension-host", events: [] },
    webview: { clockOrigin: "webview", events: [] },
    durationsMs: {},
    completeness: {}
  }
});

describe("Canvas-open frame contract", () => {
  it("accepts only the exact active graph and Rust identity with enough drawn geometry", () => {
    const valid = evidence();
    expect(canvasOpenFrameCheck(config, valid)).toMatchObject({ accepted: true, identity: {
      documentVersion: 7,
      sourceRevision: 4,
      graphRevision: 9,
      rustEvaluationRequestId: 12
    } });
  });

  it.each([
    ["document-version-mismatch", { documentVersion: 8 }],
    ["document-not-current", { activeDocumentMatches: false }],
    ["source-not-current", { sourceMatchesCurrentDocument: false }],
    ["graphless", { graphRevision: null }],
    ["stale-graph", { graphCurrent: false }],
    ["invalid-graph", { graphValid: false }],
    ["graph-runtime-mismatch", { graphMatchesRuntime: false }],
    ["dependency-count-mismatch", { dependencyCount: 1 }],
    ["rust-not-ready", { rustStatus: "evaluating" }],
    ["rust-request-id-missing", { rustEvaluationRequestId: null }],
    ["evaluation-error", { rustStatus: "failed" }],
    ["last-good-fallback", { lastGoodFallback: true }],
    ["placeholder-paint", { placeholderPaint: true }],
    ["blank-frame", { drawablePrimitiveCount: 0 }],
    ["render-surface-unavailable", { renderSurface: null }]
  ] as const)("rejects %s", (reason, changes) => {
    expect(canvasOpenFrameCheck(config, { ...evidence(), ...changes })).toEqual({ accepted: false, reason });
  });
});

describe("Canvas-open aggregation", () => {
  it("records count and nearest-rank p50 and p95 from raw host samples", () => {
    expect(canvasOpenSampleStatistics([sample(40), sample(10), sample(30), sample(20)])).toEqual({
      count: 4,
      p50Ms: 20,
      p95Ms: 40
    });
  });

  it("rejects empty and invalid sample sets", () => {
    expect(() => canvasOpenSampleStatistics([])).toThrow("must not be empty");
    expect(() => canvasOpenSampleStatistics([sample(Number.NaN)])).toThrow("finite and nonnegative");
  });
});
