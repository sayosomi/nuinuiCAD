import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type {
  CanvasBezierHandleDragAction,
  CanvasPointDragAction
} from "../components/canvasHostAdapter";

export type VscodeDragPreviewAction = CanvasPointDragAction | CanvasBezierHandleDragAction;

type DispatchAction = (action: VscodeDragPreviewAction) => unknown;

const mutationWasApplied = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "status" in value && value.status === "applied";

const evaluationIsSettled = (state: EvaluationEngineState): boolean =>
  !state.isStale && (state.status === "ready" || state.status === "failed");

/**
 * Coalesces continuous VS Code drag previews behind the evaluation that
 * materialized the previous preview. The action remains based on the drag's
 * original snapshot; only superseded intents are discarded.
 */
export class VscodeDragPreviewScheduler {
  private generation = 0;
  private waitingGeneration: number | null = null;
  private pendingAction: VscodeDragPreviewAction | null = null;
  private minimumEvaluationRequestRevision: number | null = null;
  private disposed = false;

  constructor(private readonly dispatchAction: DispatchAction) {}

  dispatchPreview(
    action: VscodeDragPreviewAction,
    currentEvaluationState?: EvaluationEngineState
  ): unknown {
    if (this.disposed) return undefined;
    if (this.waitingGeneration !== null) {
      this.pendingAction = action;
      return undefined;
    }

    const result = this.dispatchAction(action);
    if (mutationWasApplied(result)) {
      this.waitingGeneration = this.generation;
      this.minimumEvaluationRequestRevision = currentEvaluationState?.evaluationRequestRevision ?? null;
    }
    return result;
  }

  dispatchCommit(action: VscodeDragPreviewAction): unknown {
    if (this.disposed) return undefined;
    this.generation += 1;
    this.waitingGeneration = null;
    this.pendingAction = null;
    this.minimumEvaluationRequestRevision = null;
    return this.dispatchAction(action);
  }

  observeEvaluationState(state: EvaluationEngineState): void {
    if (this.disposed || !evaluationIsSettled(state)) return;
    if (this.waitingGeneration !== this.generation) return;
    if (
      this.minimumEvaluationRequestRevision !== null &&
      state.evaluationRequestRevision <= this.minimumEvaluationRequestRevision
    ) {
      return;
    }

    this.waitingGeneration = null;
    this.minimumEvaluationRequestRevision = null;
    const pendingAction = this.pendingAction;
    this.pendingAction = null;
    if (!pendingAction) return;

    const result = this.dispatchAction(pendingAction);
    if (mutationWasApplied(result)) {
      this.waitingGeneration = this.generation;
      this.minimumEvaluationRequestRevision = state.evaluationRequestRevision;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.waitingGeneration = null;
    this.pendingAction = null;
    this.minimumEvaluationRequestRevision = null;
  }
}
