import { describe, expect, it } from "vitest";
import type { CanvasOpenFrameIdentity, CanvasOpenPanelConfig } from "./canvasOpenCapture";
import { analyzeCanvasOpenPhaseEvidence, createCanvasOpenPhaseRecorder } from "./canvasOpenPhaseTracker";

const config: CanvasOpenPanelConfig = {
  runId: "run-current",
  openId: "open-current",
  documentToken: "document-current",
  mode: "warm",
  phase: "measured",
  sampleIndex: 0,
  expectedDocumentVersion: 7,
  fixture: {
    id: "imported",
    hash: `sha256:${"a".repeat(64)}`,
    rootSourceSha256: "b".repeat(64),
    kind: "imported",
    expectedDependencyCount: 1,
    minimumRuntimeElementCount: 20,
    minimumComputedGeometryCount: 20,
    minimumDrawablePrimitiveCount: 10
  }
};

const accepted: CanvasOpenFrameIdentity = {
  runId: config.runId,
  openId: config.openId,
  documentToken: config.documentToken,
  documentVersion: 7,
  sourceRevision: 11,
  graphRevision: 13,
  rustEvaluationRequestId: 17
};

describe("Canvas-open phase tracker", () => {
  it("calculates process-local Source and host lifecycle durations in event order", () => {
    const host = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    host.record("panelOpenStarted", {}, 0);
    host.record("webviewReadyReceived", {}, 5);
    host.record("authoritativeDocumentReadyReceived", { sourceRevision: 11, graphRevision: 13 }, 12);
    const hostResult = analyzeCanvasOpenPhaseEvidence(host.evidence(), accepted);
    expect(hostResult.durationsMs["host.panelOpenToWebviewReady"]).toBe(5);
    expect(hostResult.durationsMs["host.webviewReadyToDocumentReady"]).toBe(7);
    expect(hostResult.completeness["host.webviewReadyToDocumentReady"]).toBe("complete");

    const webview = createCanvasOpenPhaseRecorder(config, "webview", () => 0);
    webview.record("captureConfigReceived", {}, 0);
    webview.record("authoritativeSourceReceived", { sourceRevision: null, graphRevision: null }, 3);
    webview.record("sourceReplacementCompleted", { sourceRevision: 11, graphRevision: null }, 8);
    webview.record("documentReadyAcknowledgementDispatched", { sourceRevision: 11 }, 10);
    const webviewResult = analyzeCanvasOpenPhaseEvidence(webview.evidence(), accepted);
    expect(webviewResult.durationsMs["webview.sourceReplacement"]).toBe(5);
    expect(webviewResult.durationsMs["webview.sourceReplacementToDocumentReady"]).toBe(2);
    expect(hostResult.durationsMs["webview.sourceReplacement"]).toBeUndefined();
  });

  it("rejects old-panel events and separates superseded Rust request IDs", () => {
    const oldPanel = createCanvasOpenPhaseRecorder({ ...config, openId: "open-old" }, "webview", () => 0);
    oldPanel.record("rustRequestEnqueued", { rustEvaluationRequestId: 16 }, 1);
    oldPanel.record("rustRequestSent", { rustEvaluationRequestId: 16 }, 4);
    oldPanel.record("rustResponseReceived", { rustEvaluationRequestId: 16 }, 9);
    const currentPanel = createCanvasOpenPhaseRecorder(config, "webview", () => 0);
    currentPanel.record("rustRequestEnqueued", { sourceRevision: 11, graphRevision: 13, rustEvaluationRequestId: 16 }, 1);
    currentPanel.record("rustRequestSent", { sourceRevision: 11, graphRevision: 13, rustEvaluationRequestId: 16 }, 4);
    currentPanel.record("rustResponseReceived", { sourceRevision: 11, graphRevision: 13, rustEvaluationRequestId: 16 }, 8);
    currentPanel.record("rustRequestEnqueued", { sourceRevision: 11, graphRevision: 13, rustEvaluationRequestId: 17 }, 10);
    currentPanel.record("rustRequestSent", { sourceRevision: 11, graphRevision: 13, rustEvaluationRequestId: 17 }, 13);
    const result = analyzeCanvasOpenPhaseEvidence(currentPanel.evidence(), accepted);
    expect(result.durationsMs["webview.rustEnqueueToSend"]).toBe(3);
    expect(result.durationsMs["webview.rustSendToResponse"]).toBeNull();
    expect(result.completeness["webview.rustSendToResponse"]).toBe("unknown");
    expect(analyzeCanvasOpenPhaseEvidence(oldPanel.evidence(), accepted).completeness["webview.rustEnqueueToSend"]).toBe("missing");
  });

  it("marks an already-current warm graph as preexisting instead of a zero-duration build", () => {
    const host = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    host.record("panelOpenStarted", {}, 25);
    host.record("graphAlreadyCurrentAtPanelOpen", { sourceRevision: 11, graphRevision: 13 }, 25);
    const result = analyzeCanvasOpenPhaseEvidence(host.evidence(), accepted);
    expect(result.durationsMs["host.graphBuild"]).toBeNull();
    expect(result.completeness["host.graphBuild"]).toBe("preexisting");
  });

  it("does not accept phase pairs from a stale graph revision on the active panel", () => {
    const host = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    host.record("graphBuildStarted", { sourceRevision: 11, graphBuildRequestRevision: 4 }, 1);
    host.record("currentGraphPrepared", { sourceRevision: 11, graphRevision: 12, graphBuildRequestRevision: 4 }, 8);
    const result = analyzeCanvasOpenPhaseEvidence(host.evidence(), accepted);
    expect(result.durationsMs["host.graphBuild"]).toBeNull();
    expect(result.completeness["host.graphBuild"]).toBe("unknown");
  });

  it("does not pair an obsolete same-source graph rebuild with the accepted graph", () => {
    const host = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    host.record("graphBuildStarted", { sourceRevision: 11, graphBuildRequestRevision: 4 }, 1);
    host.record("graphBuildStarted", { sourceRevision: 11, graphBuildRequestRevision: 5 }, 3);
    host.record("currentGraphPrepared", { sourceRevision: 11, graphRevision: 13, graphBuildRequestRevision: 5 }, 9);
    const result = analyzeCanvasOpenPhaseEvidence(host.evidence(), accepted);
    expect(result.durationsMs["host.graphBuild"]).toBe(6);
    expect(result.completeness["host.graphBuild"]).toBe("complete");

    const unmatched = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    unmatched.record("graphBuildStarted", { sourceRevision: 11, graphBuildRequestRevision: 4 }, 1);
    unmatched.record("currentGraphPrepared", { sourceRevision: 11, graphRevision: 13, graphBuildRequestRevision: 5 }, 9);
    const unmatchedResult = analyzeCanvasOpenPhaseEvidence(unmatched.evidence(), accepted);
    expect(unmatchedResult.durationsMs["host.graphBuild"]).toBeNull();
    expect(unmatchedResult.completeness["host.graphBuild"]).toBe("unknown");
  });

  it("marks reversed and nonfinite process-local clocks invalid and missing spans unknown", () => {
    const host = createCanvasOpenPhaseRecorder(config, "extension-host", () => 0);
    host.record("graphBuildStarted", { sourceRevision: 11, graphRevision: 13, graphBuildRequestRevision: 5 }, 20);
    host.record("currentGraphPrepared", { sourceRevision: 11, graphRevision: 13, graphBuildRequestRevision: 5 }, 10);
    const result = analyzeCanvasOpenPhaseEvidence(host.evidence(), accepted);
    expect(result.durationsMs["host.graphBuild"]).toBeNull();
    expect(result.completeness["host.graphBuild"]).toBe("invalid");
    expect(result.completeness["host.rustRequestService"]).toBe("missing");

    const malformed = {
      clockOrigin: "extension-host" as const,
      events: [
        { ...accepted, name: "graphBuildStarted", clockOrigin: "extension-host" as const, graphBuildRequestRevision: 5, atMs: Number.NaN },
        { ...accepted, name: "currentGraphPrepared", clockOrigin: "extension-host" as const, graphBuildRequestRevision: 5, atMs: 30 }
      ]
    };
    expect(analyzeCanvasOpenPhaseEvidence(malformed, accepted).completeness["host.graphBuild"]).toBe("invalid");
  });

  it("does not use timestamps from the other process clock", () => {
    const evidence = {
      clockOrigin: "webview" as const,
      events: [
        { ...accepted, name: "captureConfigReceived", clockOrigin: "extension-host" as const, atMs: 0, graphBuildRequestRevision: null },
        { ...accepted, name: "authoritativeSourceReceived", clockOrigin: "extension-host" as const, atMs: 5, graphBuildRequestRevision: null }
      ]
    };
    const result = analyzeCanvasOpenPhaseEvidence(evidence, accepted);
    expect(result.durationsMs["webview.configToSourceReceipt"]).toBeNull();
    expect(result.completeness["webview.configToSourceReceipt"]).toBe("missing");
  });
});
