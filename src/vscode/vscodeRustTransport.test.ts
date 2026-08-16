import { describe, expect, it, vi } from "vitest";
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
});
