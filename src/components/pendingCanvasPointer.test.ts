import { describe, expect, it } from "vitest";
import {
  beginPendingCanvasPointer,
  cancelPendingCanvasPointer,
  initialPendingCanvasPointerState,
  movePendingCanvasPointer,
  releasePendingCanvasPointer,
  resolvePendingCanvasPointer,
  retargetPendingCanvasPointer
} from "./pendingCanvasPointer";

const intent = (pointerId = 1) => ({
  pointerId,
  button: 0,
  start: { clientX: 10, clientY: 20 },
  latest: { clientX: 10, clientY: 20 },
  modifiers: { metaKey: false, ctrlKey: false, shiftKey: false },
  sourceRevision: 4,
  compiledDocumentRevision: 7,
  deadlineAt: 999,
  staleTargetHint: "point-a"
});

describe("pending canvas pointer state machine", () => {
  it("retains a released short click until current evaluation resolves it", () => {
    const begun = beginPendingCanvasPointer(initialPendingCanvasPointerState(), intent()).state;
    const released = releasePendingCanvasPointer(begun, 1, { clientX: 11, clientY: 20 });
    expect(released.releasePointerId).toBe(1);
    expect(released.state).toMatchObject({ kind: "waiting", intent: { pointerReleased: true } });

    const resolved = resolvePendingCanvasPointer(released.state);
    expect(resolved.resolve).toMatchObject({ pointerId: 1, latest: { clientX: 11, clientY: 20 } });
    expect(resolved.state).toEqual({ kind: "idle" });
  });

  it("retains the final coordinate across multiple moves before pointerup", () => {
    let state = beginPendingCanvasPointer(initialPendingCanvasPointerState(), intent()).state;
    state = movePendingCanvasPointer(state, 1, { clientX: 20, clientY: 25 }).state;
    state = movePendingCanvasPointer(state, 1, { clientX: 44, clientY: 55 }).state;
    const released = releasePendingCanvasPointer(state, 1, { clientX: 50, clientY: 60 });
    expect(resolvePendingCanvasPointer(released.state).resolve?.latest).toEqual({ clientX: 50, clientY: 60 });
  });

  it("retargets normal revisions but clears terminal cancel, unmount, and replacement states", () => {
    const begun = beginPendingCanvasPointer(initialPendingCanvasPointerState(), intent()).state;
    const retargeted = retargetPendingCanvasPointer(begun, 5, 8).state;
    expect(retargeted).toMatchObject({ kind: "waiting", intent: { sourceRevision: 5, compiledDocumentRevision: 8 } });

    const replacement = beginPendingCanvasPointer(retargeted, intent(2));
    expect(replacement.releasePointerId).toBe(1);
    expect(cancelPendingCanvasPointer(replacement.state, 2)).toEqual({
      state: { kind: "idle" },
      releasePointerId: 2
    });
  });

  it("ignores events from another pointer without losing the pending gesture", () => {
    const begun = beginPendingCanvasPointer(initialPendingCanvasPointerState(), intent()).state;
    expect(movePendingCanvasPointer(begun, 2, { clientX: 99, clientY: 99 }).state).toEqual(begun);
    expect(releasePendingCanvasPointer(begun, 2, { clientX: 99, clientY: 99 }).state).toEqual(begun);
  });
});
