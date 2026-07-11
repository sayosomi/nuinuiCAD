import { describe, expect, it, vi } from "vitest";
import {
  beginPendingCanvasPointer,
  cancelPendingCanvasPointer,
  createCanvasPointerCaptureLedger,
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

  it("requests a capture release only when replacing an intent that still holds its capture", () => {
    const held = beginPendingCanvasPointer(initialPendingCanvasPointerState(), intent()).state;
    expect(beginPendingCanvasPointer(held, intent(2)).releasePointerId).toBe(1);

    const released = releasePendingCanvasPointer(held, 1, { clientX: 10, clientY: 20 }).state;
    // The released intent gave up its capture at pointerup; a same-pointer-id
    // replacement must not revoke the capture the new gesture just acquired.
    expect(beginPendingCanvasPointer(released, intent(1)).releasePointerId).toBeUndefined();
  });
});

describe("canvas pointer capture ledger", () => {
  const captureTarget = (hasCapture = true) => ({
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => hasCapture)
  });

  it("acquires the DOM capture and tracks the owning pointer", () => {
    const ledger = createCanvasPointerCaptureLedger();
    const target = captureTarget();
    ledger.capture(target, 1);
    expect(target.setPointerCapture).toHaveBeenCalledWith(1);
    expect(ledger.trackedPointerIds()).toEqual([1]);
  });

  it("removes the entry when a gesture ends, so no entry outlives its drag", () => {
    const ledger = createCanvasPointerCaptureLedger();
    const target = captureTarget();
    ledger.capture(target, 1);
    ledger.release(1);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(ledger.trackedPointerIds()).toEqual([]);

    // A second release is a no-op instead of revoking someone else's capture.
    ledger.release(1);
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
  });

  it("drops the entry even when the DOM capture is already gone", () => {
    const ledger = createCanvasPointerCaptureLedger();
    const target = captureTarget(false);
    ledger.capture(target, 3);
    ledger.release(3);
    expect(target.releasePointerCapture).not.toHaveBeenCalled();
    expect(ledger.trackedPointerIds()).toEqual([]);
  });

  it("reassigns ownership when a new gesture captures the same pointer id", () => {
    const ledger = createCanvasPointerCaptureLedger();
    const first = captureTarget();
    const second = captureTarget();
    ledger.capture(first, 1);
    ledger.capture(second, 1);
    ledger.release(1);
    expect(first.releasePointerCapture).not.toHaveBeenCalled();
    expect(second.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
