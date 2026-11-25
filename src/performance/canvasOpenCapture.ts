import type { BenchmarkMachine, BenchmarkRenderSurface } from "./benchmarkResultSchema";

export const CANVAS_OPEN_CAPTURE_SCHEMA_VERSION = 2 as const;
export const DEFAULT_CANVAS_OPEN_PANEL_TIMEOUT_MS = 60_000;
export const DEFAULT_CANVAS_OPEN_HOST_TIMEOUT_MS = 120_000;
export const DEFAULT_CANVAS_OPEN_COLD_SAMPLES = 5;
export const DEFAULT_CANVAS_OPEN_WARMUPS = 3;
export const DEFAULT_CANVAS_OPEN_WARM_SAMPLES = 21;

export type CanvasOpenMode = "cold" | "warm";
export type CanvasOpenPhase = "prime" | "warmup" | "measured";

export type CanvasOpenFixtureContract = {
  id: string;
  hash: string;
  rootSourceSha256: string;
  kind: "single-root" | "imported";
  expectedDependencyCount: number;
  minimumRuntimeElementCount: number;
  minimumComputedGeometryCount: number;
  minimumDrawablePrimitiveCount: number;
};

export type CanvasOpenPanelConfig = {
  runId: string;
  openId: string;
  documentToken: string;
  mode: CanvasOpenMode;
  phase: CanvasOpenPhase;
  sampleIndex: number;
  expectedDocumentVersion: number;
  fixture: CanvasOpenFixtureContract;
};

export type CanvasOpenHostConfig = {
  schemaVersion: typeof CANVAS_OPEN_CAPTURE_SCHEMA_VERSION;
  runId: string;
  resultPath: string;
  statusPath: string;
  mode: CanvasOpenMode;
  warmupCount: number;
  measuredSampleCount: number;
  panelTimeoutMs: number;
  hostTimeoutMs: number;
  fixture: CanvasOpenFixtureContract;
};

export type CanvasOpenFrameIdentity = {
  runId: string;
  openId: string;
  documentToken: string;
  documentVersion: number | null;
  sourceRevision: number | null;
  graphRevision: number | null;
  rustEvaluationRequestId: number | null;
};

export type CanvasOpenClockOrigin = "extension-host" | "webview";
export type CanvasOpenPhaseIdentity = CanvasOpenFrameIdentity;
export type CanvasOpenPhaseEvent = CanvasOpenPhaseIdentity & {
  name: string;
  clockOrigin: CanvasOpenClockOrigin;
  atMs: number;
  graphBuildRequestRevision: number | null;
};
export type CanvasOpenPhaseEvidence = {
  clockOrigin: CanvasOpenClockOrigin;
  events: readonly CanvasOpenPhaseEvent[];
};
export type CanvasOpenPhaseStatus = "complete" | "missing" | "preexisting" | "unknown" | "invalid";
export type CanvasOpenProcessPhaseEvidence = {
  host: CanvasOpenPhaseEvidence;
  webview: CanvasOpenPhaseEvidence;
  durationsMs: Readonly<Record<string, number | null>>;
  completeness: Readonly<Record<string, CanvasOpenPhaseStatus>>;
};

export type CanvasOpenFrameEvidence = CanvasOpenFrameIdentity & {
  activeDocumentMatches: boolean;
  sourceMatchesCurrentDocument: boolean;
  graphCurrent: boolean;
  graphValid: boolean;
  graphMatchesRuntime: boolean;
  dependencyCount: number | null;
  rustStatus: "idle" | "evaluating" | "ready" | "failed";
  rustSource: "rust" | "reference" | "fallback" | null;
  rustEligible: boolean;
  evaluationIsCurrent: boolean;
  evaluationErrorCount: number;
  lastGoodFallback: boolean;
  placeholderPaint: boolean;
  runtimeElementCount: number;
  computedGeometryCount: number;
  drawablePrimitiveCount: number;
  evaluationRequestRevision: number | null;
  renderSurface: BenchmarkRenderSurface | null;
  webviewUserAgent: string;
};

export type CanvasOpenFrameRejectReason =
  | "panel-identity-mismatch"
  | "document-version-mismatch"
  | "document-not-current"
  | "source-not-current"
  | "graphless"
  | "stale-graph"
  | "invalid-graph"
  | "graph-runtime-mismatch"
  | "dependency-count-mismatch"
  | "rust-not-ready"
  | "rust-request-id-missing"
  | "evaluation-request-revision-missing"
  | "rust-ineligible"
  | "evaluation-not-current"
  | "evaluation-error"
  | "last-good-fallback"
  | "placeholder-paint"
  | "blank-frame"
  | "render-surface-unavailable"
  | "stale-after-animation-frame";

export type CanvasOpenFrameCheck =
  | { accepted: true; identity: CanvasOpenFrameIdentity }
  | { accepted: false; reason: CanvasOpenFrameRejectReason };

export const canvasOpenFrameCheck = (
  config: CanvasOpenPanelConfig,
  evidence: CanvasOpenFrameEvidence
): CanvasOpenFrameCheck => {
  if (
    evidence.runId !== config.runId ||
    evidence.openId !== config.openId ||
    evidence.documentToken !== config.documentToken
  ) return { accepted: false, reason: "panel-identity-mismatch" };
  if (evidence.documentVersion !== config.expectedDocumentVersion) {
    return { accepted: false, reason: "document-version-mismatch" };
  }
  if (!Number.isSafeInteger(evidence.documentVersion) || evidence.documentVersion! < 0) {
    return { accepted: false, reason: "document-version-mismatch" };
  }
  if (!evidence.activeDocumentMatches) return { accepted: false, reason: "document-not-current" };
  if (evidence.graphRevision === null || evidence.dependencyCount === null) {
    return { accepted: false, reason: "graphless" };
  }
  if (!Number.isSafeInteger(evidence.graphRevision) || evidence.graphRevision < 1) {
    return { accepted: false, reason: "graphless" };
  }
  if (!evidence.sourceMatchesCurrentDocument || evidence.sourceRevision === null) {
    return { accepted: false, reason: "source-not-current" };
  }
  if (!Number.isSafeInteger(evidence.sourceRevision) || evidence.sourceRevision < 0) {
    return { accepted: false, reason: "source-not-current" };
  }
  if (!evidence.graphCurrent) return { accepted: false, reason: "stale-graph" };
  if (!evidence.graphValid) return { accepted: false, reason: "invalid-graph" };
  if (!evidence.graphMatchesRuntime) return { accepted: false, reason: "graph-runtime-mismatch" };
  if (evidence.dependencyCount !== config.fixture.expectedDependencyCount) {
    return { accepted: false, reason: "dependency-count-mismatch" };
  }
  if (evidence.rustStatus === "failed" || evidence.evaluationErrorCount > 0) {
    return { accepted: false, reason: "evaluation-error" };
  }
  if (evidence.rustStatus !== "ready" || evidence.rustSource !== "rust") {
    return { accepted: false, reason: "rust-not-ready" };
  }
  if (evidence.rustEvaluationRequestId === null || !Number.isSafeInteger(evidence.rustEvaluationRequestId) || evidence.rustEvaluationRequestId < 1) {
    return { accepted: false, reason: "rust-request-id-missing" };
  }
  if (evidence.evaluationRequestRevision === null || !Number.isSafeInteger(evidence.evaluationRequestRevision) || evidence.evaluationRequestRevision < 1) {
    return { accepted: false, reason: "evaluation-request-revision-missing" };
  }
  if (!evidence.rustEligible) return { accepted: false, reason: "rust-ineligible" };
  if (!evidence.evaluationIsCurrent) return { accepted: false, reason: "evaluation-not-current" };
  if (evidence.lastGoodFallback) return { accepted: false, reason: "last-good-fallback" };
  if (evidence.placeholderPaint) return { accepted: false, reason: "placeholder-paint" };
  if (
    evidence.runtimeElementCount < config.fixture.minimumRuntimeElementCount ||
    evidence.computedGeometryCount < config.fixture.minimumComputedGeometryCount ||
    evidence.drawablePrimitiveCount < config.fixture.minimumDrawablePrimitiveCount
  ) return { accepted: false, reason: "blank-frame" };
  if (!evidence.renderSurface) return { accepted: false, reason: "render-surface-unavailable" };
  const { cssWidthPx, cssHeightPx, backingWidthPx, backingHeightPx, devicePixelRatio } = evidence.renderSurface;
  if ([cssWidthPx, cssHeightPx, backingWidthPx, backingHeightPx, devicePixelRatio].some((value) => !Number.isFinite(value) || value <= 0)) {
    return { accepted: false, reason: "render-surface-unavailable" };
  }
  return {
    accepted: true,
    identity: {
      runId: evidence.runId,
      openId: evidence.openId,
      documentToken: evidence.documentToken,
      documentVersion: evidence.documentVersion,
      sourceRevision: evidence.sourceRevision,
      graphRevision: evidence.graphRevision,
      rustEvaluationRequestId: evidence.rustEvaluationRequestId
    }
  };
};

export const sameCanvasOpenFrameIdentity = (
  left: CanvasOpenFrameIdentity,
  right: CanvasOpenFrameIdentity
): boolean => left.runId === right.runId &&
  left.openId === right.openId &&
  left.documentToken === right.documentToken &&
  left.documentVersion === right.documentVersion &&
  left.sourceRevision === right.sourceRevision &&
  left.graphRevision === right.graphRevision &&
  left.rustEvaluationRequestId === right.rustEvaluationRequestId;

export type CanvasOpenHostPhaseDurations = {
  panelOpenToWebviewReadyMs: number | null;
  panelOpenToAuthoritativeDocumentMs: number | null;
  rustRequestServiceMs: number | null;
};

export type CanvasOpenRawSample = {
  mode: CanvasOpenMode;
  sampleIndex: number;
  hostElapsedMs: number;
  hostPid: number;
  identity: Omit<CanvasOpenFrameIdentity, "runId" | "openId" | "documentToken">;
  fixtureId: string;
  fixtureHash: string;
  runtimeElementCount: number;
  computedGeometryCount: number;
  drawablePrimitiveCount: number;
  webviewElapsedMs: number | null;
  webviewUserAgent: string;
  renderSurface: BenchmarkRenderSurface;
  hostPhases: CanvasOpenHostPhaseDurations;
  phaseEvidence: CanvasOpenProcessPhaseEvidence;
};

export type CanvasOpenHostRunResult = {
  schemaVersion: typeof CANVAS_OPEN_CAPTURE_SCHEMA_VERSION;
  runId: string;
  mode: CanvasOpenMode;
  status: "complete";
  hostPid: number;
  fixtureId: string;
  fixtureHash: string;
  warmupCount: number;
  measuredSampleCount: number;
  samples: CanvasOpenRawSample[];
};

export type CanvasOpenCaptureResult = {
  schemaVersion: typeof CANVAS_OPEN_CAPTURE_SCHEMA_VERSION;
  capturedAt: string;
  sourceCommitSha: string;
  rustEvaluationBinarySha256: string;
  rustBuildProfile: "release";
  machine: BenchmarkMachine;
  fixture: {
    id: string;
    hash: string;
    kind: CanvasOpenFixtureContract["kind"];
    rootSourceSha256: string;
    expectedDependencyCount: number;
    minimumRuntimeElementCount: number;
    minimumComputedGeometryCount: number;
    minimumDrawablePrimitiveCount: number;
    files: readonly { path: string; sha256: string }[];
  };
  renderSurface: {
    description: "VS Code Webview Canvas 2D backing surface";
    coldSamples: readonly BenchmarkRenderSurface[];
    warmSamples: readonly BenchmarkRenderSurface[];
  };
  protocol: {
    coldSamples: number;
    warmups: number;
    warmSamples: number;
    panelTimeoutMs: number;
    hostTimeoutMs: number;
  };
  cold: {
    independentHostCount: number;
    hostPids: readonly number[];
    count: number;
    p50Ms: number;
    p95Ms: number;
    rawSamples: readonly CanvasOpenRawSample[];
  };
  warm: {
    hostPid: number;
    count: number;
    p50Ms: number;
    p95Ms: number;
    rawSamples: readonly CanvasOpenRawSample[];
  };
  phaseSummaries: readonly CanvasOpenPhaseSummary[];
  notes: readonly string[];
};

export type CanvasOpenPhaseSummary = {
  mode: CanvasOpenMode;
  phase: string;
  clockOrigin: CanvasOpenClockOrigin;
  sampleCount: number;
  missingCount: number;
  unknownCount: number;
  preexistingCount: number;
  invalidCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export const percentileNearestRank = (samples: readonly number[], percentile: number): number => {
  if (!samples.length) throw new Error("Canvas-open samples must not be empty");
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) throw new Error("Percentile must be in (0, 1]");
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Canvas-open samples must be finite and nonnegative");
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * percentile) - 1]!;
};

export const canvasOpenSampleStatistics = (samples: readonly CanvasOpenRawSample[]) => {
  const durations = samples.map((sample) => sample.hostElapsedMs);
  return {
    count: samples.length,
    p50Ms: percentileNearestRank(durations, 0.5),
    p95Ms: percentileNearestRank(durations, 0.95)
  };
};
