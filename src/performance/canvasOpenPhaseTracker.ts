import type {
  CanvasOpenClockOrigin,
  CanvasOpenPhaseEvidence,
  CanvasOpenPhaseEvent,
  CanvasOpenPhaseIdentity,
  CanvasOpenPhaseStatus,
  CanvasOpenPanelConfig,
  CanvasOpenFrameIdentity
} from "./canvasOpenCapture";

export type CanvasOpenPhaseIdentityPatch = Partial<Omit<CanvasOpenPhaseIdentity, "runId" | "openId" | "documentToken">> & {
  graphBuildRequestRevision?: number | null;
};

export type CanvasOpenPhaseRecorder = {
  record: (name: string, identity?: CanvasOpenPhaseIdentityPatch, atMs?: number) => CanvasOpenPhaseEvent;
  evidence: () => CanvasOpenPhaseEvidence;
};

export const createCanvasOpenPhaseRecorder = (
  config: CanvasOpenPanelConfig,
  clockOrigin: CanvasOpenClockOrigin,
  now: () => number
): CanvasOpenPhaseRecorder => {
  const events: CanvasOpenPhaseEvent[] = [];
  return {
    record: (name, identity = {}, atMs = now()) => {
      const event: CanvasOpenPhaseEvent = {
        name,
        clockOrigin,
        atMs,
        runId: config.runId,
        openId: config.openId,
        documentToken: config.documentToken,
        documentVersion: identity.documentVersion === undefined ? config.expectedDocumentVersion : identity.documentVersion,
        sourceRevision: identity.sourceRevision ?? null,
        graphRevision: identity.graphRevision ?? null,
        rustEvaluationRequestId: identity.rustEvaluationRequestId ?? null,
        graphBuildRequestRevision: identity.graphBuildRequestRevision ?? null
      };
      events.push(event);
      return event;
    },
    evidence: () => ({ clockOrigin, events: [...events] })
  };
};

export type CanvasOpenPhaseMetric = {
  phase: string;
  clockOrigin: CanvasOpenClockOrigin;
  start: string;
  end: string;
  requires: readonly (keyof CanvasOpenFrameIdentity)[];
  requiresEnd?: readonly (keyof CanvasOpenFrameIdentity)[];
  correlate?: readonly ("graphBuildRequestRevision")[];
  preexistingEvent?: string;
};

export const CANVAS_OPEN_PHASE_METRICS: readonly CanvasOpenPhaseMetric[] = [
  { phase: "host.panelOpenToWebviewReady", clockOrigin: "extension-host", start: "panelOpenStarted", end: "webviewReadyReceived", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "host.panelOpenToDocumentReady", clockOrigin: "extension-host", start: "panelOpenStarted", end: "authoritativeDocumentReadyReceived", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "host.webviewReadyToDocumentReady", clockOrigin: "extension-host", start: "webviewReadyReceived", end: "authoritativeDocumentReadyReceived", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "host.webviewReadyToSourceDispatch", clockOrigin: "extension-host", start: "webviewReadyReceived", end: "authoritativeSourceDispatched", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "host.sourceDispatchToDocumentReady", clockOrigin: "extension-host", start: "authoritativeSourceDispatched", end: "authoritativeDocumentReadyReceived", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "host.graphBuild", clockOrigin: "extension-host", start: "graphBuildStarted", end: "currentGraphPrepared", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision"], requiresEnd: ["graphRevision"], correlate: ["graphBuildRequestRevision"], preexistingEvent: "graphAlreadyCurrentAtPanelOpen" },
  { phase: "host.graphPreparationToPublicationDispatch", clockOrigin: "extension-host", start: "currentGraphPrepared", end: "graphPublicationDispatched", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision"], preexistingEvent: "graphAlreadyCurrentAtPanelOpen" },
  { phase: "host.documentReadyToGraphReplay", clockOrigin: "extension-host", start: "authoritativeDocumentReadyReceived", end: "graphPublicationReplayed", requires: ["runId", "openId", "documentToken", "documentVersion"], requiresEnd: ["sourceRevision", "graphRevision"] },
  { phase: "host.rustRequestService", clockOrigin: "extension-host", start: "rustRequestReceived", end: "rustServiceCompleted", requires: ["runId", "openId", "documentToken", "documentVersion", "rustEvaluationRequestId"] },
  { phase: "host.rustServiceToResponseDispatch", clockOrigin: "extension-host", start: "rustServiceCompleted", end: "rustResponseDispatched", requires: ["runId", "openId", "documentToken", "documentVersion", "rustEvaluationRequestId"] },
  { phase: "webview.configToSourceReceipt", clockOrigin: "webview", start: "captureConfigReceived", end: "authoritativeSourceReceived", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "webview.configToFrameAcknowledgement", clockOrigin: "webview", start: "captureConfigReceived", end: "rafAcknowledgementBoundary", requires: ["runId", "openId", "documentToken", "documentVersion"], requiresEnd: ["sourceRevision", "graphRevision", "rustEvaluationRequestId"] },
  { phase: "webview.sourceReplacement", clockOrigin: "webview", start: "authoritativeSourceReceived", end: "sourceReplacementCompleted", requires: ["runId", "openId", "documentToken", "documentVersion"] },
  { phase: "webview.sourceReplacementToDocumentReady", clockOrigin: "webview", start: "sourceReplacementCompleted", end: "documentReadyAcknowledgementDispatched", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision"] },
  { phase: "webview.documentReadyToGraphReceipt", clockOrigin: "webview", start: "documentReadyAcknowledgementDispatched", end: "graphPublicationReceived", requires: ["runId", "openId", "documentToken", "documentVersion"], requiresEnd: ["sourceRevision", "graphRevision"] },
  { phase: "webview.graphReceiptToAcceptance", clockOrigin: "webview", start: "graphPublicationReceived", end: "graphPublicationAccepted", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision"] },
  { phase: "webview.graphAcceptanceToRuntimePresentation", clockOrigin: "webview", start: "graphPublicationAccepted", end: "runtimePresentationAvailable", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision"] },
  { phase: "webview.graphAcceptanceToRustReady", clockOrigin: "webview", start: "graphPublicationAccepted", end: "currentRustEvaluationReady", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision"], requiresEnd: ["rustEvaluationRequestId"] },
  { phase: "webview.runtimePresentationToRustReady", clockOrigin: "webview", start: "runtimePresentationAvailable", end: "currentRustEvaluationReady", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision"], requiresEnd: ["rustEvaluationRequestId"] },
  { phase: "webview.rustEnqueueToSend", clockOrigin: "webview", start: "rustRequestEnqueued", end: "rustRequestSent", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "rustEvaluationRequestId"] },
  { phase: "webview.rustSendToResponse", clockOrigin: "webview", start: "rustRequestSent", end: "rustResponseReceived", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "rustEvaluationRequestId"] },
  { phase: "webview.rustResponseToCurrentReady", clockOrigin: "webview", start: "rustResponseReceived", end: "currentRustEvaluationReady", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "rustEvaluationRequestId"], requiresEnd: ["graphRevision"] },
  { phase: "webview.rustReadyToProductionDraw", clockOrigin: "webview", start: "currentRustEvaluationReady", end: "productionDrawCompleted", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision", "rustEvaluationRequestId"] },
  { phase: "webview.productionDrawToRafAcknowledgement", clockOrigin: "webview", start: "productionDrawCompleted", end: "rafAcknowledgementBoundary", requires: ["runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision", "rustEvaluationRequestId"] }
];

const identityKeys: readonly (keyof CanvasOpenFrameIdentity)[] = [
  "runId", "openId", "documentToken", "documentVersion", "sourceRevision", "graphRevision", "rustEvaluationRequestId"
];

const compatibleWithAcceptedFrame = (event: CanvasOpenPhaseEvent, accepted: CanvasOpenFrameIdentity): boolean =>
  identityKeys.every((key) => event[key] === null || event[key] === accepted[key]);

export type CanvasOpenPhaseAnalysis = {
  durationsMs: Readonly<Record<string, number | null>>;
  completeness: Readonly<Record<string, CanvasOpenPhaseStatus>>;
};

export const analyzeCanvasOpenPhaseEvidence = (
  evidence: CanvasOpenPhaseEvidence,
  accepted: CanvasOpenFrameIdentity
): CanvasOpenPhaseAnalysis => {
  const durationsMs: Record<string, number | null> = {};
  const completeness: Record<string, CanvasOpenPhaseStatus> = {};
  for (const metric of CANVAS_OPEN_PHASE_METRICS.filter((item) => item.clockOrigin === evidence.clockOrigin)) {
    const baseEvents = evidence.events.filter((event) =>
      event.clockOrigin === evidence.clockOrigin &&
      event.runId === accepted.runId && event.openId === accepted.openId && event.documentToken === accepted.documentToken
    );
    const startCandidates = baseEvents.filter((event) => event.name === metric.start);
    const endCandidates = baseEvents.filter((event) => event.name === metric.end);
    const preexisting = metric.preexistingEvent && baseEvents.some((event) =>
      event.name === metric.preexistingEvent &&
      compatibleWithAcceptedFrame(event, accepted) &&
      [...metric.requires, ...(metric.requiresEnd ?? [])].every((key) => event[key] !== null && event[key] === accepted[key])
    );
    const validCandidates = (events: CanvasOpenPhaseEvent[], required: readonly (keyof CanvasOpenFrameIdentity)[]) => events.filter((event) =>
      compatibleWithAcceptedFrame(event, accepted) && required.every((key) => event[key] !== null)
    );
    const starts = validCandidates(startCandidates, metric.requires).filter((event) =>
      (metric.correlate ?? []).every((key) => event[key] !== null)
    );
    const ends = validCandidates(endCandidates, [...metric.requires, ...(metric.requiresEnd ?? [])]).filter((event) =>
      (metric.correlate ?? []).every((key) => event[key] !== null)
    );
    const invalidClock = [...startCandidates, ...endCandidates].some((event) => !Number.isFinite(event.atMs) || event.atMs < 0);
    let duration: number | null = null;
    let status: CanvasOpenPhaseStatus;
    if (invalidClock) {
      status = "invalid";
    } else if (!starts.length || !ends.length) {
      status = preexisting && !starts.length && !ends.length ? "preexisting" :
        startCandidates.length || endCandidates.length ? "unknown" : "missing";
    } else {
      const pairs = starts.flatMap((start) => ends
        .filter((end) => (metric.correlate ?? []).every((key) => start[key] === end[key]))
        .map((end) => ({ start, end })));
      const pair = pairs.find(({ start, end }) => end.atMs >= start.atMs);
      const start = pair?.start;
      const end = pair?.end;
      if (!start || !end) {
        status = pairs.length ? "invalid" : "unknown";
      } else if (!metric.requires.every((key) => start[key] === end[key] && start[key] === accepted[key]) ||
        (metric.requiresEnd ?? []).some((key) => end[key] !== accepted[key])) {
        status = "invalid";
      } else {
        duration = end.atMs - start.atMs;
        status = Number.isFinite(duration) && duration >= 0 ? "complete" : "invalid";
        if (status === "invalid") duration = null;
      }
    }
    durationsMs[metric.phase] = duration;
    completeness[metric.phase] = status;
  }
  return { durationsMs, completeness };
};
