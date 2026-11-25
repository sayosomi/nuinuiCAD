import {
  canvasOpenFrameCheck,
  sameCanvasOpenFrameIdentity,
  type CanvasOpenFrameEvidence,
  type CanvasOpenFrameIdentity,
  type CanvasOpenFrameRejectReason,
  type CanvasOpenPanelConfig,
  type CanvasOpenPhaseEvidence
} from "./canvasOpenCapture";
import type { BenchmarkRenderSurface } from "./benchmarkResultSchema";

export type CanvasOpenFrameAcknowledgement = {
  runId: string;
  openId: string;
  documentToken: string;
  mode: CanvasOpenPanelConfig["mode"];
  phase: CanvasOpenPanelConfig["phase"];
  sampleIndex: number;
  documentVersion: number;
  sourceRevision: number;
  graphRevision: number;
  rustEvaluationRequestId: number;
  evaluationRequestRevision: number;
  runtimeElementCount: number;
  computedGeometryCount: number;
  drawablePrimitiveCount: number;
  webviewElapsedMs: number | null;
  webviewUserAgent: string;
  renderSurface: BenchmarkRenderSurface;
  phaseEvidence: CanvasOpenPhaseEvidence;
};

export type CanvasOpenFrameObserver = {
  configure: (config: CanvasOpenPanelConfig) => void;
  notifyProductionDrawCompleted: (drawablePrimitiveCount: number, isCurrentDraw: boolean, isProjectedDraw: boolean) => void;
  dispose: () => void;
};

export type CanvasOpenFrameObserverDependencies = {
  getCurrentEvidence: () => Omit<CanvasOpenFrameEvidence, "drawablePrimitiveCount">;
  requestAnimationFrame: (callback: (timestamp: number) => void) => number;
  now: () => number;
  postAcknowledgement: (message: CanvasOpenFrameAcknowledgement) => void;
  phaseEvidenceAtAcknowledgement?: (identity: CanvasOpenFrameIdentity, atMs: number) => CanvasOpenPhaseEvidence;
  postStatus: (input: {
    runId: string;
    openId: string;
    documentToken: string;
    reason: CanvasOpenFrameRejectReason;
    documentVersion: number | null;
    sourceRevision: number | null;
    graphRevision: number | null;
    rustEvaluationRequestId: number | null;
  }) => void;
};

export const createCanvasOpenFrameObserver = (
  dependencies: CanvasOpenFrameObserverDependencies
): CanvasOpenFrameObserver => {
  let config: CanvasOpenPanelConfig | null = null;
  let configuredAt = 0;
  let generation = 0;
  let accepted = false;
  let disposed = false;
  let pendingIdentity: CanvasOpenFrameIdentity | null = null;
  let lastStatusSignature = "";

  const evidenceFor = (drawablePrimitiveCount: number): CanvasOpenFrameEvidence => ({
    ...dependencies.getCurrentEvidence(),
    drawablePrimitiveCount
  });

  const postRejected = (reason: CanvasOpenFrameRejectReason, evidence: CanvasOpenFrameEvidence): void => {
    if (!config) return;
    const signature = `${reason}:${evidence.documentVersion}:${evidence.sourceRevision}:${evidence.graphRevision}:${evidence.rustEvaluationRequestId}`;
    if (signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    dependencies.postStatus({
      runId: config.runId,
      openId: config.openId,
      documentToken: config.documentToken,
      reason,
      documentVersion: evidence.documentVersion,
      sourceRevision: evidence.sourceRevision,
      graphRevision: evidence.graphRevision,
      rustEvaluationRequestId: evidence.rustEvaluationRequestId
    });
  };

  const configure = (nextConfig: CanvasOpenPanelConfig): void => {
    config = nextConfig;
    configuredAt = dependencies.now();
    generation += 1;
    accepted = false;
    pendingIdentity = null;
    lastStatusSignature = "";
  };

  const notifyProductionDrawCompleted = (
    drawablePrimitiveCount: number,
    isCurrentDraw: boolean,
    isProjectedDraw: boolean
  ): void => {
    if (!config || disposed || accepted) return;
    const currentConfig = config;
    const evidence = evidenceFor(drawablePrimitiveCount);
    if (!isCurrentDraw || isProjectedDraw) {
      generation += 1;
      pendingIdentity = null;
      postRejected(isProjectedDraw ? "last-good-fallback" : "evaluation-not-current", evidence);
      return;
    }
    const check = canvasOpenFrameCheck(currentConfig, evidence);
    if (!check.accepted) {
      generation += 1;
      pendingIdentity = null;
      postRejected(check.reason, evidence);
      return;
    }

    if (pendingIdentity && sameCanvasOpenFrameIdentity(pendingIdentity, check.identity)) return;
    pendingIdentity = check.identity;
    const scheduledGeneration = ++generation;
    dependencies.requestAnimationFrame(() => {
      if (disposed || accepted || generation !== scheduledGeneration || config !== currentConfig) return;
      const latest = evidenceFor(drawablePrimitiveCount);
      const latestCheck = canvasOpenFrameCheck(currentConfig, latest);
      if (!latestCheck.accepted || !sameCanvasOpenFrameIdentity(check.identity, latestCheck.identity)) {
        pendingIdentity = null;
        postRejected("stale-after-animation-frame", latest);
        return;
      }
      const renderSurface = latest.renderSurface;
      if (!renderSurface) {
        pendingIdentity = null;
        postRejected("render-surface-unavailable", latest);
        return;
      }
      accepted = true;
      pendingIdentity = null;
      const acknowledgementAt = dependencies.now();
      let phaseEvidence: CanvasOpenPhaseEvidence = { clockOrigin: "webview", events: [] };
      try {
        phaseEvidence = dependencies.phaseEvidenceAtAcknowledgement?.(latestCheck.identity, acknowledgementAt) ?? phaseEvidence;
      } catch {
        // Phase reporting is optional and must not block a valid frame acknowledgement.
      }
      dependencies.postAcknowledgement({
        runId: currentConfig.runId,
        openId: currentConfig.openId,
        documentToken: currentConfig.documentToken,
        mode: currentConfig.mode,
        phase: currentConfig.phase,
        sampleIndex: currentConfig.sampleIndex,
        documentVersion: latest.documentVersion!,
        sourceRevision: latest.sourceRevision!,
        graphRevision: latest.graphRevision!,
        rustEvaluationRequestId: latest.rustEvaluationRequestId!,
        evaluationRequestRevision: latest.evaluationRequestRevision!,
        runtimeElementCount: latest.runtimeElementCount,
        computedGeometryCount: latest.computedGeometryCount,
        drawablePrimitiveCount: latest.drawablePrimitiveCount,
        webviewElapsedMs: Number.isFinite(configuredAt) && Number.isFinite(acknowledgementAt) && acknowledgementAt >= configuredAt
          ? acknowledgementAt - configuredAt
          : null,
        webviewUserAgent: latest.webviewUserAgent,
        renderSurface,
        phaseEvidence
      });
    });
  };

  return {
    configure,
    notifyProductionDrawCompleted,
    dispose: () => {
      disposed = true;
      generation += 1;
      pendingIdentity = null;
    }
  };
};
