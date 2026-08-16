import { describe, expect, it, vi } from "vitest";
import { VscodeRustTransport } from "./vscodeRustTransport";

describe("VscodeRustTransport", () => {
  it("sends only the first request while keeping the latest pending request", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const first = transport.evaluate({ elements: [] });
    const superseded = transport.evaluate({ elements: [] });
    const latest = transport.evaluate({ elements: [] });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "rustEvaluationRequest", id: 1 })
    );
    await expect(superseded).rejects.toThrow("superseded");

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { value: 1 } })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "rustEvaluationRequest", id: 3 })
    );
    await expect(first).resolves.toEqual({ value: 1 });

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { value: 3 } })).toBe(true);
    await expect(latest).resolves.toEqual({ value: 3 });
  });

  it("advances the latest pending request after an error response", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const first = transport.evaluate({ elements: [] });
    const latest = transport.evaluate({ elements: [] });

    expect(transport.handleMessage({ type: "rustEvaluationError", id: 1, error: "evaluation failed" })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "rustEvaluationRequest", id: 2 })
    );
    await expect(first).rejects.toThrow("evaluation failed");

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { value: 2 } })).toBe(true);
    await expect(latest).resolves.toEqual({ value: 2 });
  });

  it("preserves request id matching and ignores responses for unsent or unknown requests", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const first = transport.evaluate({ elements: [] });
    const pending = transport.evaluate({ elements: [] });

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 99, payload: { ignored: true } })).toBe(false);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { ignored: true } })).toBe(false);
    expect(postMessage).toHaveBeenCalledTimes(1);

    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { value: 1 } })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { duplicate: true } })).toBe(false);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { value: 2 } })).toBe(true);
    await expect(first).resolves.toEqual({ value: 1 });
    await expect(pending).resolves.toEqual({ value: 2 });
  });

  it("rejects in-flight and pending requests on dispose and rejects later evaluations", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const inFlight = transport.evaluate({ elements: [] });
    const pending = transport.evaluate({ elements: [] });

    transport.dispose();
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { ignored: true } })).toBe(false);
    await expect(inFlight).rejects.toThrow("disposed");
    await expect(pending).rejects.toThrow("disposed");
    await expect(transport.evaluate({ elements: [] })).rejects.toThrow("disposed");
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
