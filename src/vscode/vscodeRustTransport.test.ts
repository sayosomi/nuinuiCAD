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

  it("exposes the request ID sent for an exact prepared input without changing the protocol", async () => {
    const postMessage = vi.fn();
    const transport = new VscodeRustTransport(postMessage);
    const input = { elements: [] };
    const result = transport.evaluate(input);

    expect(transport.requestIdForInput(input)).toBe(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "rustEvaluationRequest", id: 1, input });
    expect(transport.requestIdForInput({ elements: [] })).toBeNull();
    transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { value: 1 } });
    await expect(result).resolves.toEqual({ value: 1 });
  });

  it("passively attributes enqueue, send, and matching responses across superseded requests", async () => {
    const postMessage = vi.fn();
    const phases: Array<{ name: string; id: number; atMs: number; identity: unknown }> = [];
    let now = 0;
    const transport = new VscodeRustTransport(postMessage, {
      now: () => ++now,
      onPhase: (event) => phases.push(event)
    });
    const firstInput = { elements: [{ id: "first" }] as never[] };
    const supersededInput = { elements: [{ id: "superseded" }] as never[] };
    const acceptedInput = { elements: [{ id: "accepted" }] as never[] };
    const identity = { documentVersion: 7, sourceRevision: 11, graphRevision: 13 };
    for (const input of [firstInput, supersededInput, acceptedInput]) transport.setPhaseIdentityForInput(input, identity);
    const first = transport.evaluate(firstInput);
    const superseded = transport.evaluate(supersededInput);
    const accepted = transport.evaluate(acceptedInput);
    await expect(superseded).rejects.toThrow("superseded");
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { ok: true } })).toBe(true);
    expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { ok: true } })).toBe(true);
    await expect(first).resolves.toEqual({ ok: true });
    await expect(accepted).resolves.toEqual({ ok: true });
    expect(phases.map(({ name, id }) => `${name}:${id}`)).toEqual([
      "rustRequestEnqueued:1",
      "rustRequestSent:1",
      "rustRequestEnqueued:2",
      "rustRequestEnqueued:3",
      "rustResponseReceived:1",
      "rustRequestSent:3",
      "rustResponseReceived:3"
    ]);
    expect(phases.find(({ id }) => id === 3)).toMatchObject({ identity, atMs: expect.any(Number) });
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

  it("keeps the latest Source request behind prioritized direct work until its quiet deadline", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = (revision: number) => ({ elements: [], sourceRevision: revision } as never);
    try {
      const first = transport.automaticSourceTransport(input(1));
      void first.catch(() => undefined);
      const firstExpectation = expect(first).resolves.toEqual({ revision: 1 });
      void firstExpectation.catch(() => undefined);
      const latestSource = transport.automaticSourceTransport(input(2));
      void latestSource.catch(() => undefined);
      const latestSourceExpectation = expect(latestSource).resolves.toEqual({ revision: 2 });
      void latestSourceExpectation.catch(() => undefined);
      const direct = transport.transport(input(99));
      void direct.catch(() => undefined);
      const directExpectation = expect(direct).resolves.toEqual({ revision: 99 });
      void directExpectation.catch(() => undefined);
      expect(sent.map(message => message.id)).toEqual([1]);
      expect(vi.getTimerCount()).toBe(1);

      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 99, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { revision: 1 } })).toBe(true);
      await firstExpectation;
      expect(sent.map(message => message.id)).toEqual([1, 3]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { revision: 99 } })).toBe(true);
      await directExpectation;
      expect(sent.map(message => message.id)).toEqual([1, 3]);

      await vi.advanceTimersByTimeAsync(199);
      expect(sent.map(message => message.id)).toEqual([1, 3]);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 3, 2]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { revision: 2 } })).toBe(true);
      await latestSourceExpectation;
      expect(vi.getTimerCount()).toBe(0);

      const quietFirst = transport.automaticSourceTransport(input(4));
      const quietLatest = transport.automaticSourceTransport(input(5));
      void quietFirst.catch(() => undefined);
      void quietLatest.catch(() => undefined);
      const quietFirstExpectation = expect(quietFirst).rejects.toThrow("quiet first failed");
      const quietLatestExpectation = expect(quietLatest).rejects.toThrow("quiet latest failed");
      void quietFirstExpectation.catch(() => undefined);
      void quietLatestExpectation.catch(() => undefined);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 99, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationError", id: 4, error: "quiet first failed" })).toBe(true);
      await quietFirstExpectation;
      expect(sent.map(message => message.id)).toEqual([1, 3, 2, 4]);
      await vi.advanceTimersByTimeAsync(199);
      expect(sent).toHaveLength(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 3, 2, 4, 5]);
      expect(transport.handleMessage({ type: "rustEvaluationError", id: 5, error: "quiet latest failed" })).toBe(true);
      await quietLatestExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });

  it("preserves direct priority while replacing retained Source intent with the newest revision", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = (revision: number) => ({ elements: [], sourceRevision: revision } as never);
    try {
      const first = transport.automaticSourceTransport(input(1));
      void first.catch(() => undefined);
      const sourceB = transport.automaticSourceTransport(input(2));
      void sourceB.catch(() => undefined);
      const sourceBExpectation = expect(sourceB).rejects.toThrow("superseded");
      void sourceBExpectation.catch(() => undefined);
      const directOne = transport.transport(input(90));
      void directOne.catch(() => undefined);
      const directOneExpectation = expect(directOne).rejects.toThrow("superseded");
      void directOneExpectation.catch(() => undefined);
      const directTwo = transport.transport(input(91));
      void directTwo.catch(() => undefined);
      const directTwoExpectation = expect(directTwo).rejects.toThrow("direct failed");
      void directTwoExpectation.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(50);
      const sourceC = transport.automaticSourceTransport(input(3));
      void sourceC.catch(() => undefined);
      const sourceCExpectation = expect(sourceC).resolves.toEqual({ revision: 3 });
      void sourceCExpectation.catch(() => undefined);

      await sourceBExpectation;
      await directOneExpectation;
      expect(sent.map(message => message.id)).toEqual([1]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { revision: 1 } })).toBe(true);
      expect(sent.map(message => message.id)).toEqual([1, 4]);
      expect(transport.handleMessage({ type: "rustEvaluationError", id: 4, error: "direct failed" })).toBe(true);
      await directTwoExpectation;
      expect(sent.map(message => message.id)).toEqual([1, 4]);
      await vi.advanceTimersByTimeAsync(199);
      expect(sent.map(message => message.id)).toEqual([1, 4]);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 4, 5]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { ignored: true } })).toBe(false);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 5, payload: { revision: 3 } })).toBe(true);
      await sourceCExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });

  it("sends direct work immediately with no in-flight request and retains quiet Source work", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = (revision: number) => ({ elements: [], sourceRevision: revision } as never);
    try {
      const first = transport.automaticSourceTransport(input(1));
      void first.catch(() => undefined);
      const firstExpectation = expect(first).resolves.toEqual({ revision: 1 });
      void firstExpectation.catch(() => undefined);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 1, payload: { revision: 1 } })).toBe(true);
      await firstExpectation;
      await vi.advanceTimersByTimeAsync(50);

      const latestSource = transport.automaticSourceTransport(input(2));
      void latestSource.catch(() => undefined);
      const latestSourceExpectation = expect(latestSource).resolves.toEqual({ revision: 2 });
      void latestSourceExpectation.catch(() => undefined);
      const direct = transport.transport(input(99));
      void direct.catch(() => undefined);
      const directExpectation = expect(direct).resolves.toEqual({ revision: 99 });
      void directExpectation.catch(() => undefined);
      expect(sent.map(message => message.id)).toEqual([1, 3]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 3, payload: { revision: 99 } })).toBe(true);
      await directExpectation;
      await vi.advanceTimersByTimeAsync(199);
      expect(sent.map(message => message.id)).toEqual([1, 3]);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent.map(message => message.id)).toEqual([1, 3, 2]);
      expect(transport.handleMessage({ type: "rustEvaluationResponse", id: 2, payload: { revision: 2 } })).toBe(true);
      await latestSourceExpectation;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });

  it("rejects the in-flight, direct, and retained Source requests on dispose", async () => {
    vi.useFakeTimers();
    const sent: Array<{ type: string; id?: number }> = [];
    const transport = new VscodeRustTransport(message => sent.push(message));
    const input = { elements: [] };
    try {
      const inFlight = transport.automaticSourceTransport(input);
      const retainedSource = transport.automaticSourceTransport(input);
      const direct = transport.transport(input);
      void inFlight.catch(() => undefined);
      void retainedSource.catch(() => undefined);
      void direct.catch(() => undefined);
      const inFlightExpectation = expect(inFlight).rejects.toThrow("disposed");
      const retainedSourceExpectation = expect(retainedSource).rejects.toThrow("disposed");
      const directExpectation = expect(direct).rejects.toThrow("disposed");
      void inFlightExpectation.catch(() => undefined);
      void retainedSourceExpectation.catch(() => undefined);
      void directExpectation.catch(() => undefined);
      transport.dispose();
      expect(vi.getTimerCount()).toBe(0);
      await Promise.all([inFlightExpectation, retainedSourceExpectation, directExpectation]);
      await vi.advanceTimersByTimeAsync(200);
      expect(sent.map(message => message.id)).toEqual([1]);
    } finally {
      transport.dispose();
      vi.useRealTimers();
    }
  });
});
