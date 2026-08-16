import { describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { CanvasPointDragAction, CanvasBezierHandleDragAction } from "../components/canvasHostAdapter";
import { VscodeDragPreviewScheduler } from "./vscodeDragPreviewScheduler";

const pointAction = (overrides: Partial<CanvasPointDragAction> = {}): CanvasPointDragAction => ({
  elementId: "point",
  dx: 1,
  dy: 2,
  angleLocked: false,
  distanceLocked: false,
  commitMode: "preview",
  baseElements: [],
  ...overrides
});

const bezierAction = (overrides: Partial<CanvasBezierHandleDragAction> = {}): CanvasBezierHandleDragAction => ({
  elementId: "curve",
  bezierHandleRole: "start",
  dx: 1,
  dy: 2,
  angleLocked: false,
  distanceLocked: false,
  commitMode: "preview",
  baseElements: [],
  ...overrides
});

const settledEvaluation = (evaluationRequestRevision = 2): EvaluationEngineState => ({
  evaluation: {} as EvaluationEngineState["evaluation"],
  evaluationRevision: evaluationRequestRevision,
  evaluationRequestRevision,
  mode: "rust" as EvaluationEngineState["mode"],
  source: "rust",
  status: "ready",
  rustEligible: true,
  isStale: false,
  error: null
});

describe("VscodeDragPreviewScheduler", () => {
  it("materializes the first preview immediately", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const action = pointAction();

    expect(scheduler.dispatchPreview(action)).toEqual({ status: "applied" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(action);
  });

  it("keeps only the latest pending intent and does not replay intermediate intents", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const first = pointAction({ dx: 1 });
    const intermediate = pointAction({ dx: 2 });
    const latest = pointAction({ dx: 3 });

    scheduler.dispatchPreview(first);
    scheduler.dispatchPreview(intermediate);
    scheduler.dispatchPreview(latest);
    expect(dispatch).toHaveBeenCalledTimes(1);

    scheduler.observeEvaluationState(settledEvaluation());
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(latest);
    expect(dispatch).not.toHaveBeenCalledWith(intermediate);
  });

  it("does not settle against the settled state that existed before materialization", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const stateBeforeMaterialization = settledEvaluation(12);

    scheduler.dispatchPreview(pointAction({ dx: 1 }), stateBeforeMaterialization);
    scheduler.dispatchPreview(pointAction({ dx: 2 }));
    scheduler.observeEvaluationState(stateBeforeMaterialization);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("settles when the current evaluation revision is lower than the old state", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const stateBeforeMaterialization = settledEvaluation(12);
    const latest = pointAction({ dx: 2 });

    scheduler.dispatchPreview(pointAction({ dx: 1 }), stateBeforeMaterialization);
    scheduler.dispatchPreview(latest);
    scheduler.observeEvaluationState({ ...stateBeforeMaterialization, status: "evaluating" });
    scheduler.observeEvaluationState(settledEvaluation(11));

    expect(dispatch).toHaveBeenLastCalledWith(latest);
  });

  it("settles when a same-revision current state is observed after materialization", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const stateBeforeMaterialization = settledEvaluation(12);
    const latest = pointAction({ dx: 2 });

    scheduler.dispatchPreview(pointAction({ dx: 1 }), stateBeforeMaterialization);
    scheduler.dispatchPreview(latest);
    scheduler.observeEvaluationState(settledEvaluation(12));

    expect(dispatch).toHaveBeenLastCalledWith(latest);
  });

  it("waits for a current failed evaluation as well as a ready evaluation", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const first = pointAction({ dx: 1 });
    const latest = pointAction({ dx: 2 });

    scheduler.dispatchPreview(first);
    scheduler.dispatchPreview(latest);
    scheduler.observeEvaluationState({ ...settledEvaluation(), status: "evaluating" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    scheduler.observeEvaluationState({ ...settledEvaluation(), status: "failed" });
    expect(dispatch).toHaveBeenLastCalledWith(latest);
  });

  it("does not become busy for rejected or noop preview mutations", () => {
    const dispatch = vi.fn()
      .mockReturnValueOnce({ status: "rejected" })
      .mockReturnValueOnce(undefined)
      .mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);

    scheduler.dispatchPreview(pointAction({ dx: 1 }));
    scheduler.dispatchPreview(pointAction({ dx: 2 }));
    scheduler.dispatchPreview(pointAction({ dx: 3 }));
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("supports point and Bezier actions through the same scheduler", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const point = pointAction();
    const bezier = bezierAction();

    scheduler.dispatchPreview(point);
    scheduler.dispatchPreview(bezier);
    scheduler.observeEvaluationState(settledEvaluation());
    expect(dispatch).toHaveBeenNthCalledWith(1, point);
    expect(dispatch).toHaveBeenNthCalledWith(2, bezier);
  });

  it("drops pending previews when a commit invalidates the generation", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const first = pointAction({ dx: 1 });
    const pending = bezierAction({ dx: 2 });
    const commit = pointAction({ dx: 3, commitMode: "commit" });

    scheduler.dispatchPreview(first);
    scheduler.dispatchPreview(pending);
    scheduler.dispatchCommit(commit);
    scheduler.observeEvaluationState(settledEvaluation());
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(2, commit);
  });

  it("does not accept a stale evaluation as settlement", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const first = pointAction({ dx: 1 });
    const latest = pointAction({ dx: 2 });

    scheduler.dispatchPreview(first);
    scheduler.dispatchPreview(latest);
    scheduler.observeEvaluationState({ ...settledEvaluation(), isStale: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    scheduler.observeEvaluationState(settledEvaluation());
    expect(dispatch).toHaveBeenLastCalledWith(latest);
  });

  it("does not accept a stale failed evaluation as settlement", () => {
    const dispatch = vi.fn().mockReturnValue({ status: "applied" });
    const scheduler = new VscodeDragPreviewScheduler(dispatch);
    const latest = pointAction({ dx: 2 });

    scheduler.dispatchPreview(pointAction({ dx: 1 }));
    scheduler.dispatchPreview(latest);
    scheduler.observeEvaluationState({ ...settledEvaluation(), status: "failed", isStale: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    scheduler.observeEvaluationState({ ...settledEvaluation(), status: "failed" });
    expect(dispatch).toHaveBeenLastCalledWith(latest);
  });
});
