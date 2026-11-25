import { describe, expect, it } from "vitest";
import type { CanvasOpenFrameEvidence, CanvasOpenPanelConfig } from "./canvasOpenCapture";
import { createCanvasOpenFrameObserver } from "./canvasOpenFrameObserver";

const config: CanvasOpenPanelConfig = {
  runId: "run-1",
  openId: "open-1",
  documentToken: "doc-1",
  mode: "warm",
  phase: "measured",
  sampleIndex: 2,
  expectedDocumentVersion: 5,
  fixture: {
    id: "imported",
    hash: `sha256:${"c".repeat(64)}`,
    rootSourceSha256: "d".repeat(64),
    kind: "imported",
    expectedDependencyCount: 1,
    minimumRuntimeElementCount: 100,
    minimumComputedGeometryCount: 100,
    minimumDrawablePrimitiveCount: 50
  }
};

const current = (): Omit<CanvasOpenFrameEvidence, "drawablePrimitiveCount"> => ({
  runId: "run-1",
  openId: "open-1",
  documentToken: "doc-1",
  documentVersion: 5,
  sourceRevision: 3,
  graphRevision: 8,
  rustEvaluationRequestId: 19,
  activeDocumentMatches: true,
  sourceMatchesCurrentDocument: true,
  graphCurrent: true,
  graphValid: true,
  graphMatchesRuntime: true,
  dependencyCount: 1,
  rustStatus: "ready",
  rustSource: "rust",
  rustEligible: true,
  evaluationIsCurrent: true,
  evaluationErrorCount: 0,
  lastGoodFallback: false,
  placeholderPaint: false,
  runtimeElementCount: 120,
  computedGeometryCount: 120,
  evaluationRequestRevision: 10,
  renderSurface: {
    cssWidthPx: 800,
    cssHeightPx: 600,
    backingWidthPx: 1600,
    backingHeightPx: 1200,
    devicePixelRatio: 2
  },
  webviewUserAgent: "test"
});

const setup = () => {
  let now = 100;
  let evidence = current();
  const frames: Array<(timestamp: number) => void> = [];
  const acknowledgements: unknown[] = [];
  const statuses: unknown[] = [];
  const observer = createCanvasOpenFrameObserver({
    getCurrentEvidence: () => evidence,
    requestAnimationFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    now: () => now,
    postAcknowledgement: (message) => acknowledgements.push(message),
    postStatus: (status) => statuses.push(status)
  });
  return {
    observer,
    frames,
    acknowledgements,
    statuses,
    setEvidence: (next: Omit<CanvasOpenFrameEvidence, "drawablePrimitiveCount">) => { evidence = next; },
    setNow: (value: number) => { now = value; }
  };
};

describe("Canvas-open frame observer", () => {
  it("waits for the next animation-frame callback before acknowledging the drawn frame", () => {
    const harness = setup();
    harness.observer.configure(config);
    harness.observer.notifyProductionDrawCompleted(80, true, false);
    expect(harness.acknowledgements).toEqual([]);
    expect(harness.frames).toHaveLength(1);
    harness.setNow(145);
    harness.frames.shift()!(145);
    expect(harness.acknowledgements).toHaveLength(1);
    expect(harness.acknowledgements[0]).toMatchObject({
      runId: config.runId,
      openId: config.openId,
      phase: "measured",
      sampleIndex: 2,
      documentVersion: 5,
      sourceRevision: 3,
      graphRevision: 8,
      rustEvaluationRequestId: 19,
      drawablePrimitiveCount: 80,
      webviewElapsedMs: 45
    });
    harness.observer.notifyProductionDrawCompleted(80, true, false);
    expect(harness.frames).toHaveLength(0);
    harness.observer.dispose();
  });

  it("rejects a frame if any identity token changes before the animation-frame boundary", () => {
    const harness = setup();
    harness.observer.configure(config);
    harness.observer.notifyProductionDrawCompleted(80, true, false);
    harness.setEvidence({ ...current(), graphRevision: 9 });
    harness.frames.shift()!(110);
    expect(harness.acknowledgements).toEqual([]);
    expect(harness.statuses).toContainEqual(expect.objectContaining({
      reason: "stale-after-animation-frame",
      graphRevision: 9
    }));
    harness.observer.dispose();
  });

  it("does not acknowledge stale, projected, or empty draws", () => {
    const harness = setup();
    harness.observer.configure(config);
    harness.observer.notifyProductionDrawCompleted(80, false, false);
    harness.observer.notifyProductionDrawCompleted(80, true, true);
    harness.observer.notifyProductionDrawCompleted(0, true, false);
    expect(harness.frames).toHaveLength(0);
    expect(harness.acknowledgements).toEqual([]);
    expect(harness.statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "evaluation-not-current" }),
      expect.objectContaining({ reason: "last-good-fallback" }),
      expect.objectContaining({ reason: "blank-frame" })
    ]));
    harness.observer.dispose();
  });

  it("invalidates a scheduled callback when the observer is disposed", () => {
    const harness = setup();
    harness.observer.configure(config);
    harness.observer.notifyProductionDrawCompleted(80, true, false);
    expect(harness.frames).toHaveLength(1);
    harness.observer.dispose();
    harness.frames.shift()!(110);
    expect(harness.acknowledgements).toEqual([]);
  });
});
