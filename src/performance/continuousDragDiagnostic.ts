import type { CadElement, EvaluationResult } from "../types/geometry";

export type ContinuousDragKind = "point" | "bezier-handle";
export type ContinuousDragTerminal = "commit" | "abort";

type DiagnosticEvent = {
  type: string;
  timestamp: number;
  dragId: number;
  kind: ContinuousDragKind;
  moveSeq?: number;
  evaluationAttemptId?: number;
  evaluationRequestRevision?: number;
  vscodeRequestId?: number;
  transportPendingCount?: number;
  transportPendingCountAfter?: number;
  status?: string;
  source?: string;
  isStale?: boolean;
  current?: boolean;
  [key: string]: unknown;
};

export type ContinuousDragTrace = {
  schemaVersion: 1;
  dragId: number;
  kind: ContinuousDragKind;
  events: DiagnosticEvent[];
  finalizedAt?: number;
  terminal?: ContinuousDragTerminal;
};

type InternalTrace = {
  trace: ContinuousDragTrace;
  nextMoveSeq: number;
  pendingAttempts: Set<ContinuousDragEvaluationAttempt>;
  pendingCurrentDraws: Set<ContinuousDragEvaluationAttempt>;
  finalizeScheduled: boolean;
  finalized: boolean;
};

export type ContinuousDragMove = {
  trace: InternalTrace;
  moveSeq: number;
};

export type ContinuousDragEvaluationAttempt = {
  attemptId: number;
  move: ContinuousDragMove;
  evaluationRevision: number;
  evaluationRequestRevision: number;
  requestKey: string;
  settled: boolean;
  cleanupRecorded: boolean;
  vscodeRequestId?: number;
};

type EvaluationSettlement = {
  promise: "resolved" | "rejected";
  status: "ready" | "failed";
  source: "rust" | "fallback";
  isStale: boolean;
  current: boolean;
  evaluation?: EvaluationResult;
  error?: unknown;
};

export type ContinuousDragDiagnostic = {
  beginDrag: (input: {
    kind: ContinuousDragKind;
    baseElements: CadElement[];
    baseEvaluation?: EvaluationResult;
  }) => number;
  beginMove: (dragId: number) => ContinuousDragMove | null;
  withActiveMove: <T>(move: ContinuousDragMove | null, callback: () => T) => T;
  recordPreviewCommand: () => boolean;
  bindPreviewElements: (elements: CadElement[]) => boolean;
  beginEvaluationAttempt: (
    elements: CadElement[],
    input: {
      evaluationRevision: number;
      evaluationRequestRevision: number;
      requestKey: string;
    }
  ) => ContinuousDragEvaluationAttempt | null;
  withActiveEvaluationAttempt: <T>(attempt: ContinuousDragEvaluationAttempt | null, callback: () => T) => T;
  recordTransportSend: (requestId: number, pendingCount: number) => boolean;
  recordTransportResponse: (requestId: number, pendingCount: number, pendingCountAfter: number) => boolean;
  recordEvaluationSettlement: (
    attempt: ContinuousDragEvaluationAttempt | null,
    settlement: EvaluationSettlement
  ) => void;
  recordEvaluationEffectCleanup: (attempt: ContinuousDragEvaluationAttempt | null) => void;
  recordCanvasDraw: (
    evaluation: EvaluationResult,
    input: {
      evaluationRequestRevision?: number;
      status?: string;
      source?: string;
      isStale?: boolean;
      current: boolean;
    }
  ) => void;
  recordTerminalCommit: (dragId: number, trigger: string) => void;
  recordAbort: (dragId: number, reason: string) => void;
  endDrag: (dragId: number, terminal: ContinuousDragTerminal) => void;
};

export type ContinuousDragDiagnosticDependencies = {
  now?: () => number;
  scheduleFinalize?: (callback: () => void) => void;
  log?: (message: string) => void;
  publishGlobal?: boolean;
};

const safeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const globalWithTrace = globalThis as typeof globalThis & {
  __nuinuiCADContinuousDragTrace?: ContinuousDragTrace;
};

export const createContinuousDragDiagnostic = ({
  now = () => performance.now(),
  scheduleFinalize = (callback) => {
    globalThis.setTimeout(callback, 0);
  },
  log = (message) => console.log(message),
  publishGlobal = true
}: ContinuousDragDiagnosticDependencies = {}): ContinuousDragDiagnostic => {
  let nextDragId = 1;
  let nextEvaluationAttemptId = 1;
  let activeDragId: number | null = null;
  let activeMove: ContinuousDragMove | null = null;
  let activeEvaluationAttempt: ContinuousDragEvaluationAttempt | null = null;
  const traces = new Map<number, InternalTrace>();
  const elementsToMove = new WeakMap<CadElement[], ContinuousDragMove>();
  const evaluationsToAttempt = new WeakMap<EvaluationResult, ContinuousDragEvaluationAttempt>();
  const transportRequests = new Map<number, ContinuousDragEvaluationAttempt>();

  const appendEvent = (
    internal: InternalTrace,
    type: string,
    details: Record<string, unknown> = {}
  ): void => {
    internal.trace.events.push({
      type,
      timestamp: now(),
      dragId: internal.trace.dragId,
      kind: internal.trace.kind,
      ...details
    });
  };

  const traceForDrag = (dragId: number): InternalTrace | null => {
    const internal = traces.get(dragId);
    return internal && !internal.finalized ? internal : null;
  };

  const fallbackTrace = (): InternalTrace | null => {
    if (activeDragId !== null) {
      const active = traceForDrag(activeDragId);
      if (active) return active;
    }
    let latest: InternalTrace | null = null;
    for (const internal of traces.values()) {
      if (!internal.finalized && (!latest || internal.trace.dragId > latest.trace.dragId)) {
        latest = internal;
      }
    }
    return latest;
  };

  const scheduleFinalizeIfReady = (internal: InternalTrace): void => {
    if (!internal.trace.terminal || internal.finalized || internal.finalizeScheduled) return;
    internal.finalizeScheduled = true;
    scheduleFinalize(() => {
      internal.finalizeScheduled = false;
      if (!internal.trace.terminal || internal.finalized) return;
      if (internal.pendingAttempts.size > 0 || internal.pendingCurrentDraws.size > 0) return;

      internal.finalized = true;
      internal.trace.finalizedAt = now();
      if (publishGlobal) globalWithTrace.__nuinuiCADContinuousDragTrace = internal.trace;
      log(JSON.stringify(internal.trace));
    });
  };

  const beginDrag = ({ kind, baseElements, baseEvaluation }: {
    kind: ContinuousDragKind;
    baseElements: CadElement[];
    baseEvaluation?: EvaluationResult;
  }): number => {
    const trace: InternalTrace = {
      trace: {
        schemaVersion: 1,
        dragId: nextDragId,
        kind,
        events: []
      },
      nextMoveSeq: 1,
      pendingAttempts: new Set(),
      pendingCurrentDraws: new Set(),
      finalizeScheduled: false,
      finalized: false
    };
    nextDragId += 1;
    traces.set(trace.trace.dragId, trace);
    activeDragId = trace.trace.dragId;
    appendEvent(trace, "drag-start", {
      baseElementCount: baseElements.length,
      baseEvaluationPresent: baseEvaluation !== undefined
    });
    return trace.trace.dragId;
  };

  const beginMove = (dragId: number): ContinuousDragMove | null => {
    const internal = traceForDrag(dragId);
    if (!internal || internal.trace.terminal) return null;
    const move = { trace: internal, moveSeq: internal.nextMoveSeq };
    internal.nextMoveSeq += 1;
    appendEvent(internal, "pointermove-entry", { moveSeq: move.moveSeq });
    return move;
  };

  const withActiveMove = <T>(move: ContinuousDragMove | null, callback: () => T): T => {
    activeMove = move;
    try {
      return callback();
    } finally {
      activeMove = null;
    }
  };

  const recordPreviewCommand = (): boolean => {
    if (!activeMove || activeMove.trace.finalized || activeMove.trace.trace.terminal) return false;
    appendEvent(activeMove.trace, "preview-command", { moveSeq: activeMove.moveSeq });
    return true;
  };

  const bindPreviewElements = (elements: CadElement[]): boolean => {
    if (!activeMove || activeMove.trace.finalized || activeMove.trace.trace.terminal) return false;
    elementsToMove.set(elements, activeMove);
    appendEvent(activeMove.trace, "preview-elements-mutation", {
      moveSeq: activeMove.moveSeq,
      previewElementCount: elements.length
    });
    return true;
  };

  const beginEvaluationAttempt = (
    elements: CadElement[],
    { evaluationRevision, evaluationRequestRevision, requestKey }: {
      evaluationRevision: number;
      evaluationRequestRevision: number;
      requestKey: string;
    }
  ): ContinuousDragEvaluationAttempt | null => {
    const move = elementsToMove.get(elements);
    if (!move || move.trace.finalized) return null;
    const attempt: ContinuousDragEvaluationAttempt = {
      attemptId: nextEvaluationAttemptId,
      move,
      evaluationRevision,
      evaluationRequestRevision,
      requestKey,
      settled: false,
      cleanupRecorded: false
    };
    nextEvaluationAttemptId += 1;
    move.trace.pendingAttempts.add(attempt);
    appendEvent(move.trace, "evaluation-attempt-start", {
      moveSeq: move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision,
      evaluationRequestRevision,
      status: "evaluating",
      source: "rust",
      isStale: false,
      current: true
    });
    return attempt;
  };

  const withActiveEvaluationAttempt = <T>(
    attempt: ContinuousDragEvaluationAttempt | null,
    callback: () => T
  ): T => {
    activeEvaluationAttempt = attempt;
    try {
      return callback();
    } finally {
      activeEvaluationAttempt = null;
    }
  };

  const recordTransportSend = (requestId: number, pendingCount: number): boolean => {
    const attempt = activeEvaluationAttempt;
    if (!attempt || attempt.settled || attempt.move.trace.finalized) return false;
    attempt.vscodeRequestId = requestId;
    transportRequests.set(requestId, attempt);
    appendEvent(attempt.move.trace, "vscode-transport-send", {
      moveSeq: attempt.move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision: attempt.evaluationRevision,
      evaluationRequestRevision: attempt.evaluationRequestRevision,
      vscodeRequestId: requestId,
      transportPendingCount: pendingCount
    });
    return true;
  };

  const recordTransportResponse = (
    requestId: number,
    pendingCount: number,
    pendingCountAfter: number
  ): boolean => {
    const attempt = transportRequests.get(requestId);
    if (!attempt || attempt.move.trace.finalized) return false;
    transportRequests.delete(requestId);
    appendEvent(attempt.move.trace, "vscode-transport-response", {
      moveSeq: attempt.move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision: attempt.evaluationRevision,
      evaluationRequestRevision: attempt.evaluationRequestRevision,
      vscodeRequestId: requestId,
      transportPendingCount: pendingCount,
      transportPendingCountAfter: pendingCountAfter
    });
    return true;
  };

  const recordEvaluationSettlement = (
    attempt: ContinuousDragEvaluationAttempt | null,
    settlement: EvaluationSettlement
  ): void => {
    if (!attempt || attempt.settled || attempt.move.trace.finalized) return;
    const internal = attempt.move.trace;
    appendEvent(internal, `evaluation-${settlement.promise}`, {
      moveSeq: attempt.move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision: attempt.evaluationRevision,
      evaluationRequestRevision: attempt.evaluationRequestRevision,
      ...(attempt.vscodeRequestId === undefined ? {} : { vscodeRequestId: attempt.vscodeRequestId }),
      status: settlement.status,
      source: settlement.source,
      isStale: settlement.isStale,
      current: settlement.current,
      ...(settlement.error === undefined ? {} : { error: safeError(settlement.error) })
    });
    appendEvent(internal, "evaluation-outcome", {
      moveSeq: attempt.move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision: attempt.evaluationRevision,
      evaluationRequestRevision: attempt.evaluationRequestRevision,
      ...(attempt.vscodeRequestId === undefined ? {} : { vscodeRequestId: attempt.vscodeRequestId }),
      outcome: settlement.current ? "current-adopted" : "cancelled-discarded",
      status: settlement.status,
      source: settlement.source,
      isStale: settlement.isStale,
      current: settlement.current
    });
    attempt.settled = true;
    internal.pendingAttempts.delete(attempt);
    if (settlement.evaluation) {
      evaluationsToAttempt.set(settlement.evaluation, attempt);
      if (settlement.current) internal.pendingCurrentDraws.add(attempt);
    }
    scheduleFinalizeIfReady(internal);
  };

  const recordEvaluationEffectCleanup = (attempt: ContinuousDragEvaluationAttempt | null): void => {
    if (!attempt || attempt.cleanupRecorded || attempt.move.trace.finalized) return;
    attempt.cleanupRecorded = true;
    appendEvent(attempt.move.trace, "evaluation-effect-cleanup", {
      moveSeq: attempt.move.moveSeq,
      evaluationAttemptId: attempt.attemptId,
      evaluationRevision: attempt.evaluationRevision,
      evaluationRequestRevision: attempt.evaluationRequestRevision,
      ...(attempt.vscodeRequestId === undefined ? {} : { vscodeRequestId: attempt.vscodeRequestId }),
      status: attempt.settled ? "settled" : "cancelled",
      source: "rust",
      current: false
    });
  };

  const recordCanvasDraw = (
    evaluation: EvaluationResult,
    input: {
      evaluationRequestRevision?: number;
      status?: string;
      source?: string;
      isStale?: boolean;
      current: boolean;
    }
  ): void => {
    const attempt = evaluationsToAttempt.get(evaluation);
    const internal = attempt?.move.trace ?? fallbackTrace();
    if (!internal || internal.finalized) return;
    appendEvent(internal, "canvas-draw", {
      ...(attempt === undefined ? {} : {
        moveSeq: attempt.move.moveSeq,
        evaluationAttemptId: attempt.attemptId,
        evaluationRevision: attempt.evaluationRevision
      }),
      ...(input.evaluationRequestRevision === undefined
        ? {}
        : { evaluationRequestRevision: input.evaluationRequestRevision }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.isStale === undefined ? {} : { isStale: input.isStale }),
      current: input.current
    });
    if (attempt && input.current && internal.pendingCurrentDraws.delete(attempt)) {
      scheduleFinalizeIfReady(internal);
    }
  };

  const recordTerminalCommit = (dragId: number, trigger: string): void => {
    const internal = traceForDrag(dragId);
    if (!internal || internal.trace.terminal) return;
    appendEvent(internal, "terminal-commit", { trigger });
  };

  const recordAbort = (dragId: number, reason: string): void => {
    const internal = traceForDrag(dragId);
    if (!internal || internal.trace.terminal) return;
    appendEvent(internal, "drag-abort", { reason });
  };

  const endDrag = (dragId: number, terminal: ContinuousDragTerminal): void => {
    const internal = traceForDrag(dragId);
    if (!internal || internal.trace.terminal) return;
    internal.trace.terminal = terminal;
    appendEvent(internal, "drag-end", { terminal });
    if (activeDragId === dragId) activeDragId = null;
    scheduleFinalizeIfReady(internal);
  };

  return {
    beginDrag,
    beginMove,
    withActiveMove,
    recordPreviewCommand,
    bindPreviewElements,
    beginEvaluationAttempt,
    withActiveEvaluationAttempt,
    recordTransportSend,
    recordTransportResponse,
    recordEvaluationSettlement,
    recordEvaluationEffectCleanup,
    recordCanvasDraw,
    recordTerminalCommit,
    recordAbort,
    endDrag
  };
};

export const continuousDragDiagnostic = createContinuousDragDiagnostic();
