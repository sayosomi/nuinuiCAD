import { describe, expect, it, vi } from "vitest";
import { continuousDragDiagnostic } from "../performance/continuousDragDiagnostic";
import { VscodeRustTransport } from "./vscodeRustTransport";

describe("VscodeRustTransport", () => {
  it("matches opaque responses by request id and rejects errors", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const first = transport.evaluate({ elements: [] });
    const second = transport.evaluate({ elements: [] });
    expect(postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "rustEvaluationRequest", id: 1 }));
    expect(postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "rustEvaluationRequest", id: 2 }));

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 99, payload: { ignored: true } })).toBe(false);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { value: 2 } })).toBe(true);
    expect(await second).toEqual({ value: 2 });
    expect(transport.handleMessage({ type: "rustEvaluationError", id: 1, error: "evaluation failed" })).toBe(true);
    await expect(first).rejects.toThrow("evaluation failed");
  });

  it("rejects pending requests on dispose", async () => {
    const transport = new VscodeRustTransport(vi.fn());
    const pending = transport.evaluate({ elements: [] });
    transport.dispose();
    await expect(pending).rejects.toThrow("disposed");
  });

  it("posts every request and preserves response resolution while diagnostics are enabled", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const dragId = continuousDragDiagnostic.beginDrag({ kind: "point", baseElements: [] });
    const firstElements = [{
      id: "preview-1",
      name: "preview-1",
      type: "freePoint" as const,
      activity: "visible" as const,
      x: 0,
      y: 0
    }];
    const secondElements = [{
      id: "preview-2",
      name: "preview-2",
      type: "freePoint" as const,
      activity: "visible" as const,
      x: 0,
      y: 0
    }];
    const firstMove = continuousDragDiagnostic.beginMove(dragId);
    if (!firstMove) throw new Error("Expected first move");
    continuousDragDiagnostic.withActiveMove(firstMove, () => {
      continuousDragDiagnostic.bindPreviewElements(firstElements);
    });
    const firstAttempt = continuousDragDiagnostic.beginEvaluationAttempt(firstElements, {
      evaluationRevision: 1,
      evaluationRequestRevision: 1,
      requestKey: "first"
    });
    if (!firstAttempt) throw new Error("Expected first evaluation attempt");
    const first = continuousDragDiagnostic.withActiveEvaluationAttempt(
      firstAttempt,
      () => transport.evaluate({ elements: [] })
    );

    const secondMove = continuousDragDiagnostic.beginMove(dragId);
    if (!secondMove) throw new Error("Expected second move");
    continuousDragDiagnostic.withActiveMove(secondMove, () => {
      continuousDragDiagnostic.bindPreviewElements(secondElements);
    });
    const secondAttempt = continuousDragDiagnostic.beginEvaluationAttempt(secondElements, {
      evaluationRevision: 2,
      evaluationRequestRevision: 2,
      requestKey: "second"
    });
    if (!secondAttempt) throw new Error("Expected second evaluation attempt");
    const second = continuousDragDiagnostic.withActiveEvaluationAttempt(
      secondAttempt,
      () => transport.evaluate({ elements: [] })
    );

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls.map(([message]) => message.id)).toEqual([1, 2]);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { value: 2 } })).toBe(true);
    expect(transport.handleMessage({ type: "rustEvaluationError", id: 1, error: "failed" })).toBe(true);
    await expect(second).resolves.toEqual({ value: 2 });
    await expect(first).rejects.toThrow("failed");

    continuousDragDiagnostic.recordEvaluationSettlement(firstAttempt, {
      promise: "rejected",
      status: "failed",
      source: "rust",
      isStale: false,
      current: true,
      error: "failed"
    });
    continuousDragDiagnostic.recordEvaluationSettlement(secondAttempt, {
      promise: "resolved",
      status: "ready",
      source: "rust",
      isStale: false,
      current: true
    });
    continuousDragDiagnostic.endDrag(dragId, "commit");
  });
});
