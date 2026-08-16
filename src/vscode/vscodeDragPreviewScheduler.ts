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

type EvaluationWait = {
  generation: number;
  phase: "waitingForEvaluationStart" | "waitingForCurrentSettlement";
  stateBeforeMaterialization?: EvaluationEngineState;
};

/**
 * Coalesces continuous VS Code drag previews behind the evaluation that
 * materialized the previous preview. The action remains based on the drag's
 * original snapshot; only superseded intents are discarded.
 */
export class VscodeDragPreviewScheduler {
  private generation = 0;
  private evaluationWait: EvaluationWait | null = null;
  private pendingAction: VscodeDragPreviewAction | null = null;
  private disposed = false;

  constructor(private readonly dispatchAction: DispatchAction) {}

  dispatchPreview(
    action: VscodeDragPreviewAction,
    currentEvaluationState?: EvaluationEngineState
  ): unknown {
    if (this.disposed) return undefined;
    if (this.evaluationWait !== null) {
      this.pendingAction = action;
      return undefined;
    }

    const result = this.dispatchAction(action);
    if (mutationWasApplied(result)) {
      this.evaluationWait = {
        generation: this.generation,
        phase: "waitingForEvaluationStart",
        stateBeforeMaterialization: currentEvaluationState
      };
    }
    return result;
  }

  dispatchCommit(action: VscodeDragPreviewAction): unknown {
    if (this.disposed) return undefined;
    this.generation += 1;
    this.evaluationWait = null;
    this.pendingAction = null;
    return this.dispatchAction(action);
  }

  observeEvaluationState(state: EvaluationEngineState): void {
    if (this.disposed) return;
    const evaluationWait = this.evaluationWait;
    if (!evaluationWait || evaluationWait.generation !== this.generation) return;

    if (evaluationWait.phase === "waitingForEvaluationStart") {
      if (evaluationWait.stateBeforeMaterialization === state) {
        return;
      }
      evaluationWait.phase = "waitingForCurrentSettlement";
    }

    if (!evaluationIsSettled(state)) return;
    if (evaluationWait.stateBeforeMaterialization === state) return;

    this.evaluationWait = null;
    const pendingAction = this.pendingAction;
    this.pendingAction = null;
    if (!pendingAction) return;

    const result = this.dispatchAction(pendingAction);
    if (mutationWasApplied(result)) {
      this.evaluationWait = {
        generation: this.generation,
        phase: "waitingForEvaluationStart",
        stateBeforeMaterialization: state
      };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.evaluationWait = null;
    this.pendingAction = null;
  }
}
