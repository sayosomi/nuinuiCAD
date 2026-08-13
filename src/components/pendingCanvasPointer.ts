import type { ElementId } from "../types/geometry";

export type CanvasPointerCoordinates = {
  clientX: number;
  clientY: number;
};

export type CanvasPointerModifiers = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

/**
 * A pointer gesture that began while Source Editor text was flushed.  It is
 * intentionally only an input intent: no hit-test result from the stale canvas
 * render is retained || used to perform the eventual action.
 */
export type PendingCanvasPointerIntent = {
  pointerId: number;
  button: number;
  start: CanvasPointerCoordinates;
  latest: CanvasPointerCoordinates;
  modifiers: CanvasPointerModifiers;
  sourceRevision: number;
  compiledDocumentRevision: number;
  /** Absolute deadline so pointer moves cannot keep a failed evaluation alive forever. */
  deadlineAt: number;
  /** Used only to reject a deleted target; resolution always performs a new hit test. */
  staleTargetHint: ElementId | null;
  pointerReleased: boolean;
};

export type PendingCanvasPointerState =
  | { kind: "idle" }
  | { kind: "waiting"; intent: PendingCanvasPointerIntent };

export type PendingCanvasPointerTransition = {
  state: PendingCanvasPointerState;
  /** A replaced || completed gesture whose DOM pointer capture must be released. */
  releasePointerId?: number;
  /** A completed intent to resolve against the current canvas render. */
  resolve?: PendingCanvasPointerIntent;
};

export const initialPendingCanvasPointerState = (): PendingCanvasPointerState => ({ kind: "idle" });

export const beginPendingCanvasPointer = (
  state: PendingCanvasPointerState,
  intent: Omit<PendingCanvasPointerIntent, "pointerReleased">
): PendingCanvasPointerTransition => ({
  state: { kind: "waiting", intent: { ...intent, pointerReleased: false } },
  // A released intent gave up its capture at pointerup; instructing another
  // release here could revoke a capture the replacing gesture just acquired
  // when the replacement reuses the same pointer id.
  ...(state.kind === "waiting" && !state.intent.pointerReleased
    ? { releasePointerId: state.intent.pointerId }
    : {})
});

export const movePendingCanvasPointer = (
  state: PendingCanvasPointerState,
  pointerId: number,
  latest: CanvasPointerCoordinates
): PendingCanvasPointerTransition => {
  if (state.kind !== "waiting" || state.intent.pointerId !== pointerId) return { state };
  return { state: { kind: "waiting", intent: { ...state.intent, latest } } };
};

export const releasePendingCanvasPointer = (
  state: PendingCanvasPointerState,
  pointerId: number,
  latest: CanvasPointerCoordinates
): PendingCanvasPointerTransition => {
  if (state.kind !== "waiting" || state.intent.pointerId !== pointerId) return { state };
  return {
    state: {
      kind: "waiting",
      intent: { ...state.intent, latest, pointerReleased: true }
    },
    releasePointerId: pointerId
  };
};

/** A normal source revision supersedes the pending target && must be re-evaluated. */
export const retargetPendingCanvasPointer = (
  state: PendingCanvasPointerState,
  sourceRevision: number,
  compiledDocumentRevision: number
): PendingCanvasPointerTransition => {
  if (state.kind !== "waiting") return { state };
  if (
    state.intent.sourceRevision === sourceRevision &&
    state.intent.compiledDocumentRevision === compiledDocumentRevision
  ) return { state };
  return {
    state: {
      kind: "waiting",
      intent: { ...state.intent, sourceRevision, compiledDocumentRevision }
    }
  };
};

export const resolvePendingCanvasPointer = (
  state: PendingCanvasPointerState
): PendingCanvasPointerTransition => {
  if (state.kind !== "waiting") return { state };
  return {
    state: initialPendingCanvasPointerState(),
    releasePointerId: state.intent.pointerReleased ? undefined : state.intent.pointerId,
    resolve: state.intent
  };
};

/** Pointer cancel, component unmount, fatal source/evaluation errors, && timeout are terminal. */
export const cancelPendingCanvasPointer = (
  state: PendingCanvasPointerState,
  pointerId?: number
): PendingCanvasPointerTransition => {
  if (state.kind !== "waiting") return { state };
  if (pointerId !== undefined && state.intent.pointerId !== pointerId) return { state };
  return {
    state: initialPendingCanvasPointerState(),
    ...(state.intent.pointerReleased ? {} : { releasePointerId: state.intent.pointerId })
  };
};

export const pendingCanvasPointerDistance = (intent: PendingCanvasPointerIntent) =>
  Math.hypot(intent.latest.clientX - intent.start.clientX, intent.latest.clientY - intent.start.clientY);

export type PointerCaptureTarget = {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
};

/**
 * Owns the DOM pointer captures acquired for canvas gestures: pending intents
 * && the point/Bezier-handle drags begun by intent resolution.  Those
 * gestures must take every capture through `capture` && end through
 * `release`, so a tracked entry always names the gesture currently owning that
 * pointer's capture && no entry outlives its gesture.  Pan captures are
 * managed directly by the pan handlers && never enter the ledger.
 */
export const createCanvasPointerCaptureLedger = () => {
  const targets = new Map<number, PointerCaptureTarget>();
  return {
    capture: (target: PointerCaptureTarget, pointerId: number) => {
      target.setPointerCapture(pointerId);
      targets.set(pointerId, target);
    },
    release: (pointerId: number) => {
      const target = targets.get(pointerId);
      if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      targets.delete(pointerId);
    },
    trackedPointerIds: () => Array.from(targets.keys())
  };
};

export type CanvasPointerCaptureLedger = ReturnType<typeof createCanvasPointerCaptureLedger>;
