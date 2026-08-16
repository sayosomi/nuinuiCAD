import { describe, expect, it, vi } from "vitest";
import {
  createContinuousDragDiagnostic,
  type ContinuousDragDiagnostic
} from "./continuousDragDiagnostic";
import type { CadElement, EvaluationResult } from "../types/geometry";

const makeElements = (id: string): CadElement[] => [{
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
}];

const makeEvaluation = (): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: []
});

const makeDiagnostic = () => {
  let timestamp = 0;
  const scheduled: Array<() => void> = [];
  const log = vi.fn();
  const diagnostic = createContinuousDragDiagnostic({
    now: () => ++timestamp,
    scheduleFinalize: (callback) => scheduled.push(callback),
    log,
    publishGlobal: false
  });
  return { diagnostic, scheduled, log };
};

const beginAttempt = (
  diagnostic: ContinuousDragDiagnostic,
  dragId: number,
  elements: CadElement[],
  move?: ReturnType<ContinuousDragDiagnostic["beginMove"]>
) => {
  const activeMove = move ?? diagnostic.beginMove(dragId);
  if (!activeMove) throw new Error("Expected an active diagnostic move");
  diagnostic.withActiveMove(activeMove, () => {
    expect(diagnostic.bindPreviewElements(elements)).toBe(true);
  });
  const attempt = diagnostic.beginEvaluationAttempt(elements, {
    evaluationRevision: 4,
    evaluationRequestRevision: 9,
    requestKey: JSON.stringify(elements)
  });
  if (!attempt) throw new Error("Expected a diagnostic evaluation attempt");
  return { activeMove, attempt };
};

describe("continuous drag diagnostic", () => {
  it("records drag and move order without conflating move and evaluation attempt ids", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: makeElements("base") });
    const first = beginAttempt(diagnostic, dragId, makeElements("preview-1"));
    const second = beginAttempt(diagnostic, dragId, makeElements("preview-2"));

    diagnostic.recordEvaluationSettlement(first.attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: true,
      current: false
    });
    diagnostic.recordEvaluationSettlement(second.attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    diagnostic.recordTerminalCommit(dragId, "pointerup");
    diagnostic.endDrag(dragId, "commit");

    expect(log).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).toHaveBeenCalledTimes(1);

    const trace = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      events: Array<Record<string, unknown>>;
    };
    expect(trace.events.map((event) => event.type)).toEqual([
      "drag-start",
      "pointermove-entry",
      "preview-elements-mutation",
      "evaluation-attempt-start",
      "pointermove-entry",
      "preview-elements-mutation",
      "evaluation-attempt-start",
      "evaluation-resolved",
      "evaluation-outcome",
      "evaluation-resolved",
      "evaluation-outcome",
      "terminal-commit",
      "drag-end"
    ]);
    expect(trace.events[1]?.moveSeq).toBe(1);
    expect(trace.events[4]?.moveSeq).toBe(2);
    expect(trace.events[3]?.evaluationAttemptId).not.toBe(trace.events[6]?.evaluationAttemptId);
  });

  it("correlates preview element mutation and evaluation attempts to their move", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "bezier-handle", baseElements: [] });
    const move = diagnostic.beginMove(dragId);
    if (!move) throw new Error("Expected an active diagnostic move");
    const elements = makeElements("preview");
    diagnostic.withActiveMove(move, () => diagnostic.bindPreviewElements(elements));
    const attempt = diagnostic.beginEvaluationAttempt(elements, {
      evaluationRevision: 7,
      evaluationRequestRevision: 11,
      requestKey: "request"
    });
    if (!attempt) throw new Error("Expected a diagnostic evaluation attempt");

    diagnostic.recordEvaluationSettlement(attempt, {
      promise: "rejected",
      status: "failed",
      source: "fallback",
      isStale: false,
      current: true,
      error: new Error("failure")
    });
    diagnostic.endDrag(dragId, "commit");
    scheduled.shift()?.();

    const trace = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      events: Array<Record<string, unknown>>;
    };
    const mutation = trace.events.find((event) => event.type === "preview-elements-mutation");
    const evaluation = trace.events.find((event) => event.type === "evaluation-attempt-start");
    expect(mutation?.moveSeq).toBe(1);
    expect(evaluation?.moveSeq).toBe(1);
    expect(evaluation?.evaluationRequestRevision).toBe(11);
    expect(mutation?.previewElementCount).toBe(1);
    expect(mutation).not.toHaveProperty("previewElementIds");
  });

  it("records the preview command before the preview element mutation", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: [] });
    const move = diagnostic.beginMove(dragId);
    if (!move) throw new Error("Expected an active diagnostic move");
    const elements = makeElements("preview");
    diagnostic.withActiveMove(move, () => {
      expect(diagnostic.recordPreviewCommand()).toBe(true);
      expect(diagnostic.bindPreviewElements(elements)).toBe(true);
    });
    const attempt = diagnostic.beginEvaluationAttempt(elements, {
      evaluationRevision: 7,
      evaluationRequestRevision: 11,
      requestKey: "request"
    });
    if (!attempt) throw new Error("Expected a diagnostic evaluation attempt");
    diagnostic.recordEvaluationSettlement(attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: false
    });
    diagnostic.endDrag(dragId, "commit");
    scheduled.shift()?.();

    const trace = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      events: Array<Record<string, unknown>>;
    };
    expect(trace.events.map((event) => event.type)).toEqual([
      "drag-start",
      "pointermove-entry",
      "preview-command",
      "preview-elements-mutation",
      "evaluation-attempt-start",
      "evaluation-resolved",
      "evaluation-outcome",
      "drag-end"
    ]);
    const command = trace.events.find((event) => event.type === "preview-command");
    expect(command?.dragId).toBe(dragId);
    expect(command?.moveSeq).toBe(1);
  });

  it("distinguishes cancelled results from current adoption", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: [] });
    const cancelled = beginAttempt(diagnostic, dragId, makeElements("cancelled"));
    const current = beginAttempt(diagnostic, dragId, makeElements("current"));
    diagnostic.recordEvaluationSettlement(cancelled.attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: true,
      current: false
    });
    diagnostic.recordEvaluationSettlement(current.attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    diagnostic.endDrag(dragId, "commit");
    scheduled.shift()?.();

    const trace = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      events: Array<Record<string, unknown>>;
    };
    expect(trace.events.filter((event) => event.type === "evaluation-outcome").map((event) => event.outcome))
      .toEqual(["cancelled-discarded", "current-adopted"]);
  });

  it("does not finalize before drag end or while a related evaluation is pending", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: [] });
    const { attempt } = beginAttempt(diagnostic, dragId, makeElements("pending"));

    diagnostic.recordEvaluationSettlement(attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    expect(scheduled).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();

    const pending = beginAttempt(diagnostic, dragId, makeElements("still-pending"));
    diagnostic.endDrag(dragId, "commit");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).not.toHaveBeenCalled();

    diagnostic.recordEvaluationSettlement(pending.attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("waits for the current evaluation draw and finalizes exactly once afterward", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: [] });
    const evaluation = makeEvaluation();
    const { attempt } = beginAttempt(diagnostic, dragId, makeElements("current"));

    diagnostic.recordEvaluationSettlement(attempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true,
      evaluation
    });
    diagnostic.endDrag(dragId, "commit");

    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).not.toHaveBeenCalled();

    diagnostic.recordCanvasDraw(evaluation, {
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).toHaveBeenCalledTimes(1);

    diagnostic.recordCanvasDraw(evaluation, {
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("records effect cleanup and finalizes exactly once after all attempts settle", () => {
    const { diagnostic, scheduled, log } = makeDiagnostic();
    const dragId = diagnostic.beginDrag({ kind: "point", baseElements: [] });
    const { attempt } = beginAttempt(diagnostic, dragId, makeElements("cleanup"));
    diagnostic.endDrag(dragId, "abort");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(log).not.toHaveBeenCalled();

    diagnostic.recordEvaluationEffectCleanup(attempt);
    diagnostic.recordEvaluationSettlement(attempt, {
      promise: "rejected",
      status: "failed",
      source: "rust",
      isStale: true,
      current: false,
      error: "cancelled"
    });
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    scheduled.shift()?.();
    expect(log).toHaveBeenCalledTimes(1);

    const trace = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      events: Array<Record<string, unknown>>;
    };
    const cleanup = trace.events.find((event) => event.type === "evaluation-effect-cleanup");
    expect(cleanup?.status).toBe("cancelled");
    expect(cleanup?.current).toBe(false);
    expect(cleanup).not.toHaveProperty("isStale");
  });
});
