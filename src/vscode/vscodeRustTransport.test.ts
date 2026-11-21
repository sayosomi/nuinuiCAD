import { describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { buildRustEvaluationInput } from "../geometry/rustEvaluationInput";
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

  it("keeps the existing immediate entry point immediate for legal small and 1500-line edits", async () => {
    const sources = [
      {
        label: "small",
        makeSource: (revision: number) => `nui 1\npoint Probe = coordinate(x: ${revision}, y: 0)`
      },
      {
        label: "1500-line",
        makeSource: (revision: number) => [
          "nui 1",
          ...Array.from({ length: 1498 }, (_, index) => `const v${index}: number = ${index}`),
          `point Probe = coordinate(x: ${revision}, y: 0)`
        ].join("\n")
      }
    ];

    for (const { label, makeSource } of sources) {
      const inputs = Array.from({ length: 10 }, (_, revision) => {
        const compilation = compileFreshCanonicalText(makeSource(revision));
        expect(compilation.status).toBe("valid");
        const lastGood = compilation.doc;
        return buildRustEvaluationInput(
          lastGood.document.elements,
          buildEvaluationOptions({ compiledDocument: lastGood, evaluationLimitIndex: undefined })
        );
      });
      const sent: Array<{ type: string; id?: number }> = [];
      const transport = new VscodeRustTransport(message => sent.push(message));
      let firstSendLatencyMs: number | undefined;

      for (const [revision, input] of inputs.entries()) {
        const startedAt = performance.now();
        const result = transport.transport(input);
        if (revision === 0) firstSendLatencyMs = performance.now() - startedAt;
        const request = sent.at(-1);
        expect(request).toMatchObject({ type: "rustEvaluationRequest", id: revision + 1 });
        expect(transport.handleMessage({
          type: "rustEvaluationResponse",
          id: request!.id!,
          payload: { revision }
        })).toBe(true);
        await expect(result).resolves.toEqual({ revision });
      }

      expect(sent.filter(message => message.type === "rustEvaluationRequest")).toHaveLength(10);
      process.stdout.write(`[nuinuicad] Issue #1687 immediate control ${label}: rustEvaluationRequest=10, first-send=${firstSendLatencyMs?.toFixed(3)}ms\n`);
      transport.dispose();
    }
  });

  it("coalesces ten rapid automatic Source evaluations to the first and latest sends", async () => {
    const fixtures = [
      {
        label: "small",
        makeSource: (revision: number) => `nui 1\npoint Probe = coordinate(x: ${revision}, y: 0)`
      },
      {
        label: "1500-line",
        makeSource: (revision: number) => [
          "nui 1",
          ...Array.from({ length: 1498 }, (_, index) => `const v${index}: number = ${index}`),
          `point Probe = coordinate(x: ${revision}, y: 0)`
        ].join("\n")
      }
    ];

    for (const { label, makeSource } of fixtures) {
      const inputs = Array.from({ length: 10 }, (_, revision) => {
        const compilation = compileFreshCanonicalText(makeSource(revision));
        expect(compilation.status).toBe("valid");
        const lastGood = compilation.doc;
        return buildRustEvaluationInput(
          lastGood.document.elements,
          buildEvaluationOptions({ compiledDocument: lastGood, evaluationLimitIndex: undefined })
        );
      });
      vi.useFakeTimers();
      const sent: Array<{ type: string; id?: number; input?: unknown }> = [];
      const transport = new VscodeRustTransport(message => sent.push(message));
      const promises: Array<Promise<unknown>> = [];
      const startedAt = performance.now();

      try {
        const first = transport.automaticSourceTransport(inputs[0]);
        void first.catch(() => undefined);
        promises.push(first);
        const firstSendLatencyMs = performance.now() - startedAt;
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ type: "rustEvaluationRequest", id: 1, input: inputs[0] });

        for (let revision = 1; revision < inputs.length; revision += 1) {
          await vi.advanceTimersByTimeAsync(20);
          const pending = transport.automaticSourceTransport(inputs[revision]);
          void pending.catch(() => undefined);
          promises.push(pending);
          if (revision === 2) {
            expect(transport.handleMessage({
              type: "rustEvaluationResponse",
              id: 1,
              payload: { revision: 0 }
            })).toBe(true);
            await expect(first).resolves.toEqual({ revision: 0 });
            expect(sent.filter(message => message.type === "rustEvaluationRequest")).toHaveLength(1);
          }
        }

        for (const superseded of promises.slice(1, -1)) {
          await expect(superseded).rejects.toThrow("superseded");
        }
        await vi.advanceTimersByTimeAsync(199);
        expect(sent.filter(message => message.type === "rustEvaluationRequest")).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        const requests = sent.filter(message => message.type === "rustEvaluationRequest");
        expect(requests).toHaveLength(2);
        expect(requests.map(message => message.id)).toEqual([1, 10]);
        expect(requests[1].input).toEqual(inputs[9]);
        expect(transport.handleMessage({
          type: "rustEvaluationResponse",
          id: 10,
          payload: { revision: 9 }
        })).toBe(true);
        await expect(promises[9]).resolves.toEqual({ revision: 9 });
        expect(vi.getTimerCount()).toBe(0);
        process.stdout.write(
          `[nuinuicad] Issue #1687 fixed ${label}: rustEvaluationRequest=${requests.length}/10, first-send=${firstSendLatencyMs.toFixed(3)}ms, trailing-after-quiet=200ms\n`
        );
      } finally {
        transport.dispose();
        vi.useRealTimers();
      }
    }
  });

  it("starts separate automatic Source bursts immediately and sends each latest trailing request once", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = { elements: [] };
    try {
      const firstBurst = transport.automaticSourceTransport(input);
      void firstBurst.catch(() => undefined);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ type: "rustEvaluationRequest", id: 1 });
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { revision: 1 } })).toBe(true);
      await expect(firstBurst).resolves.toEqual({ revision: 1 });
      await vi.advanceTimersByTimeAsync(200);
      expect(vi.getTimerCount()).toBe(0);

      const secondBurst = transport.automaticSourceTransport(input);
      void secondBurst.catch(() => undefined);
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ type: "rustEvaluationRequest", id: 2 });
      await vi.advanceTimersByTimeAsync(50);
      const secondBurstLatest = transport.automaticSourceTransport({ elements: [{ id: "latest" }] as never[] });
      const latestExpectation = expect(secondBurstLatest).resolves.toEqual({ revision: 3 });
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { revision: 2 } })).toBe(true);
      await expect(secondBurst).resolves.toEqual({ revision: 2 });
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(199);
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 2, 3]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { revision: 3 } })).toBe(true);
      await latestExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });

  it("gives immediate requests priority over Source quiet waiting and clears quiet work on failure or dispose", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = { elements: [] };
    try {
      const first = transport.automaticSourceTransport(input);
      const superseded = transport.automaticSourceTransport(input);
      const supersededExpectation = expect(superseded).rejects.toThrow("superseded");
      const direct = transport.transport(input);
      const firstExpectation = expect(first).resolves.toEqual({ revision: 1 });
      const directExpectation = expect(direct).resolves.toEqual({ revision: 3 });
      expect(vi.getTimerCount()).toBe(0);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 99, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { revision: 1 } })).toBe(true);
      expect(sent.map(message => message.id)).toEqual([1, 3]);
      await firstExpectation;
      await supersededExpectation;
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { revision: 3 } })).toBe(true);
      await directExpectation;

      const quietFirst = transport.automaticSourceTransport(input);
      const quietLatest = transport.automaticSourceTransport(input);
      const quietFirstExpectation = expect(quietFirst).rejects.toThrow("quiet first failed");
      const quietLatestExpectation = expect(quietLatest).rejects.toThrow("quiet latest failed");
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 5, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationError", id: 4, error: "quiet first failed" })).toBe(true);
      await quietFirstExpectation;
      expect(sent.map(message => message.id)).toEqual([1, 3, 4]);
      await vi.advanceTimersByTimeAsync(199);
      expect(sent).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 3, 4, 5]);
      expect(transport.handleMessage({ type: "rustEvaluationError", id: 5, error: "quiet latest failed" })).toBe(true);
      await quietLatestExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }

    vi.useFakeTimers();
    const disposedMessages: Array<{ type: string; id?: number }> = [];
    const disposedTransport = new VscodeRustTransport(message => disposedMessages.push(message));
    try {
      const inFlight = disposedTransport.automaticSourceTransport(input);
      const pending = disposedTransport.automaticSourceTransport(input);
      const inFlightExpectation = expect(inFlight).rejects.toThrow("disposed");
      const pendingExpectation = expect(pending).rejects.toThrow("disposed");
      disposedTransport.dispose();
      expect(vi.getTimerCount()).toBe(0);
      await inFlightExpectation;
      await pendingExpectation;
      await vi.advanceTimersByTimeAsync(200);
      expect(disposedMessages).toHaveLength(1);
    } finally {
      disposedTransport.dispose();
      vi.useRealTimers();
    }
  });
});
