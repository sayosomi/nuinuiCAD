import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CadElement } from "../types/geometry";
import type { ScalarProgram } from "@nuinuicad/nui-language";
import {
  abortBenchmarkSample,
  beginBenchmarkSample,
  beginSourceChange,
  bindElementsToActiveSample,
  drainCompletedBenchmarkSamples,
  measureCompile
} from "../performance/benchmarkInstrumentation";
import * as benchmarkInstrumentation from "../performance/benchmarkInstrumentation";
import {
  evaluateElementsReferencePayload,
  evaluateElementsWithRust
} from "./evaluationEngine";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import {
  evaluationStateIsCurrentFor,
  useEvaluationEngine
} from "./useEvaluationEngine";
import { fixtureFromSource, optionsFor } from "../../test/evaluationParitySupport";
import * as evaluationEngine from "./evaluationEngine";
import { buildRustEvaluationInput } from "./rustEvaluationInput";

const pointA: CadElement = {
  id: "a",
  name: "点A",
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "点B",
  type: "freePoint",
  activity: "visible",
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "直線",
  type: "line",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  endPoint: { mode: "reference", pointId: "b" }
};

const elements: CadElement[] = [pointA, pointB, line];
const unsupportedElement = {
  id: "unsupported",
  name: "未対応",
  type: "unsupportedElement",
  activity: "visible"
} as unknown as CadElement;

const scalarProgram: ScalarProgram = {
  statements: [{
    kind: "declare",
    bindingId: "binding:stable",
    scopeId: "root",
    sourceOrder: 0,
    declaration: {
      bindingKind: "const",
      declaredType: { kind: "number" },
      initializer: {
        kind: "numberLiteral",
        span: { start: 0, end: 1 },
        value: 1,
        type: { kind: "number" }
      }
    }
  }]
};

const transportReturning = (
  payload = evaluateElementsReferencePayload(elements)
): ReturnType<typeof vi.fn<RustEvaluationTransport>> =>
  vi.fn<RustEvaluationTransport>(async () => payload);

afterEach(() => {
  abortBenchmarkSample();
  drainCompletedBenchmarkSamples();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useEvaluationEngine", () => {
  it.each([
    {
      name: "plain",
      source: `nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)`,
      hasBindingVersions: false
    },
    {
      name: "extend",
      source: `nui 1
line L = segment(start: (0, 0), end: (100, 0))
point Mid = coordinate(x: 50, y: 0)
extend @L.end(to: @Mid)`,
      hasBindingVersions: false
    },
    {
      name: "scalar control",
      source: `nui 1
const dx: number = 50
point A = coordinate(x: @dx, y: 0)
point B = coordinate(x: 100, y: 0)`,
      hasBindingVersions: true
    }
  ])("forwards sourceStatementIndices for the $name fixture", async ({ source, hasBindingVersions }) => {
    const fixture = fixtureFromSource(source);
    if (!fixture.compiled) throw new Error("expected a compiler-produced fixture");
    expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    expect(options.statementInfoByElementId?.size ?? 0).toBeGreaterThan(0);
    if (hasBindingVersions) {
      expect(options.bindingVersions).toBeDefined();
    } else {
      expect(options).not.toHaveProperty("bindingVersions");
    }

    const expectedInput = buildRustEvaluationInput(fixture.elements, options);
    expect(expectedInput.sourceStatementIndices?.length ?? 0).toBeGreaterThan(0);
    const payload = evaluateElementsReferencePayload(fixture.elements, options);
    const transport = vi.fn<RustEvaluationTransport>(async () => payload);
    const { result } = renderHook(() => useEvaluationEngine(fixture.elements, options, 1, transport));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(transport).toHaveBeenCalledTimes(1);
    const actualInput = transport.mock.calls[0]?.[0];
    expect(actualInput).toBeDefined();
    expect(actualInput?.sourceStatementIndices).toEqual(expectedInput.sourceStatementIndices);
    expect(actualInput).toEqual(expectedInput);
  });

  it("revises the request and rejects a stale result when only source statement mapping changes", async () => {
    const fixture = fixtureFromSource(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)`);
    if (!fixture.compiled) throw new Error("expected a compiler-produced fixture");
    expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const options = optionsFor(fixture);
    const statementInfoByElementId = options.statementInfoByElementId;
    expect(statementInfoByElementId?.size ?? 0).toBeGreaterThan(1);
    if (!statementInfoByElementId) throw new Error("expected compiler-produced statement information");
    const originalEntries = Array.from(statementInfoByElementId);
    const reversedStatementIndices = originalEntries.map(([, info]) => info.statementIndex).reverse();
    const nextStatementInfoByElementId = new Map(
      originalEntries.map(([elementId, info], index) => [
        elementId,
        { ...info, statementIndex: reversedStatementIndices[index]! }
      ] as const)
    );
    const nextOptions = { ...options, statementInfoByElementId: nextStatementInfoByElementId };
    const expectedFirstInput = buildRustEvaluationInput(fixture.elements, options);
    const expectedNextInput = buildRustEvaluationInput(fixture.elements, nextOptions);
    expect(expectedFirstInput.sourceStatementIndices?.length ?? 0).toBeGreaterThan(0);
    expect(expectedNextInput.sourceStatementIndices).not.toEqual(expectedFirstInput.sourceStatementIndices);

    const payload = evaluateElementsReferencePayload(fixture.elements, options);
    let resolveFirst: ((value: typeof payload) => void) | undefined;
    let resolveNext: ((value: typeof payload) => void) | undefined;
    const transport = vi.fn<RustEvaluationTransport>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    const evaluationRevision = 12;
    const { result, rerender } = renderHook(
      ({ next }: { next: typeof options }) => useEvaluationEngine(fixture.elements, next, evaluationRevision, transport),
      { initialProps: { next: options } }
    );

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const firstRequestRevision = result.current.evaluationRequestRevision;
    expect(result.current.evaluationRevision).toBe(evaluationRevision);
    expect(transport.mock.calls[0]?.[0].sourceStatementIndices).toEqual(expectedFirstInput.sourceStatementIndices);

    rerender({ next: nextOptions });
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const nextRequestRevision = result.current.evaluationRequestRevision;
    expect(nextRequestRevision).toBeGreaterThan(firstRequestRevision);
    expect(result.current.evaluationRevision).toBe(evaluationRevision);
    expect(transport.mock.calls[1]?.[0].sourceStatementIndices).toEqual(expectedNextInput.sourceStatementIndices);

    await act(async () => {
      resolveNext?.(payload);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const publishedEvaluation = result.current.evaluation;
    const publishedRequestRevision = result.current.evaluationRequestRevision;
    expect(publishedRequestRevision).toBe(nextRequestRevision);

    await act(async () => {
      resolveFirst?.(payload);
      await Promise.resolve();
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.evaluation).toBe(publishedEvaluation);
    expect(result.current.evaluationRequestRevision).toBe(publishedRequestRevision);
    expect(result.current.evaluationRevision).toBe(evaluationRevision);
  });

  it.each(["typedDependencyGraph", "evaluationOrder"] as const)(
    "starts a fresh request when only %s changes at the same document revision",
    async (field) => {
      const fixture = fixtureFromSource(`nui 1
point A = coordinate(x: 0, y: 0)
point B = coordinate(x: 100, y: 0)
line AB = segment(start: @A, end: @B)`);
      const options = optionsFor(fixture);
      const graph = options.typedDependencyGraph!;
      expect(graph.edges.length).toBeGreaterThan(1);
      const transport = transportReturning(evaluateElementsReferencePayload(fixture.elements, options));
      const evaluate = vi.spyOn(evaluationEngine, "evaluateElementsWithRust");
      const { result, rerender } = renderHook(
        ({ nextOptions }) => useEvaluationEngine(fixture.elements, nextOptions, 7, transport),
        { initialProps: { nextOptions: options } }
      );
      await waitFor(() => expect(result.current.status).toBe("ready"));
      const firstRequest = result.current.evaluationRequestRevision;
      expect(evaluate.mock.calls.at(-1)![1]!.typedDependencyGraph).toBe(graph);
      expect(evaluate.mock.calls.at(-1)![1]!.evaluationOrder).toBe(options.evaluationOrder);
      const changed = field === "typedDependencyGraph"
        ? { ...options, typedDependencyGraph: { ...graph, edges: [...graph.edges].reverse() } }
        : { ...options, evaluationOrder: [...options.evaluationOrder!].reverse() };
      rerender({ nextOptions: changed });
      expect(result.current.status).toBe("evaluating");
      expect(result.current.isStale).toBe(true);
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.evaluationRequestRevision).toBeGreaterThan(firstRequest);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(evaluate.mock.calls.at(-1)![1]![field]).toBe(changed[field]);
      expect(transport.mock.calls.at(-1)![0]).toMatchObject({
        evaluationOrder: changed.evaluationOrder,
        scalarExpressionPayload: { conditionalDependencyGraph: { edges: changed.typedDependencyGraph!.edges } }
      });
      const secondRequest = result.current.evaluationRequestRevision;
      rerender({ nextOptions: changed });
      expect(transport).toHaveBeenCalledTimes(2);
      expect(result.current.evaluationRequestRevision).toBe(secondRequest);
      rerender({ nextOptions: options });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(transport).toHaveBeenCalledTimes(3);
      expect(result.current.evaluationRequestRevision).toBeGreaterThan(secondRequest);
    }
  );

  it.each(["recipe", "dependency plan", "numeric binding"] as const)(
    "starts a fresh Rust request when only a transformation %s changes",
    async (field) => {
      const fixture = fixtureFromSource([
        "nui 1",
        "const dx: number = 5",
        "line L = segment(start: (0, 0), end: (100, 0))",
        "move @L as shifted(from: (0, 0), to: (@dx, 0))"
      ].join("\n"));
      const options = optionsFor(fixture);
      expect(options.transformationRecipes).toHaveLength(1);
      expect(options.transformationDependencyPlans).toHaveLength(1);
      expect(options.transformationNumericBindingEntries).toHaveLength(1);

      const nextOptions = field === "recipe"
        ? {
            ...options,
            transformationRecipes: options.transformationRecipes?.map((recipe) => ({
              ...recipe,
              stageName: "renamed"
            }))
          }
        : field === "dependency plan"
          ? {
              ...options,
              transformationDependencyPlans: options.transformationDependencyPlans?.map((plan) => ({
                ...plan,
                statementIndex: plan.statementIndex + 1
              }))
            }
          : {
              ...options,
              transformationNumericBindingEntries: options.transformationNumericBindingEntries?.map((entry) => ({
                ...entry,
                expression: `${entry.expression} + 1`
              }))
            };
      const payload = evaluateElementsReferencePayload(fixture.elements, options);
      const transport = transportReturning(payload);
      const { result, rerender } = renderHook(
        ({ next }) => useEvaluationEngine(fixture.elements, next, 9, transport),
        { initialProps: { next: options } }
      );

      await waitFor(() => expect(result.current.status).toBe("ready"));
      const firstRequestRevision = result.current.evaluationRequestRevision;
      rerender({ next: nextOptions });
      await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(transport.mock.calls[0]?.[0].elements).toBe(transport.mock.calls[1]?.[0].elements);
      expect(result.current.evaluationRequestRevision).toBeGreaterThan(firstRequestRevision);
      expect(transport.mock.calls.at(-1)?.[0].transformationRecipes).toMatchObject({
        recipes: nextOptions.transformationRecipes,
        dependencyPlans: nextOptions.transformationDependencyPlans,
        numericBindings: nextOptions.transformationNumericBindingEntries
      });
    }
  );

  it("re-evaluates when its transformation recipes are removed without drawable element changes", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line L = segment(start: (0, 0), end: (100, 0))",
      "move @L as shifted(from: (0, 0), to: (5, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const nextOptions = {
      ...options,
      transformationRecipes: undefined,
      transformationDependencyPlans: undefined,
      transformationNumericBindingEntries: undefined
    };
    const transport = transportReturning(evaluateElementsReferencePayload(fixture.elements, options));
    const { result, rerender } = renderHook(
      ({ next }) => useEvaluationEngine(fixture.elements, next, 10, transport),
      { initialProps: { next: options } }
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const firstRequestRevision = result.current.evaluationRequestRevision;
    rerender({ next: nextOptions });
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.evaluationRequestRevision).toBeGreaterThan(firstRequestRevision);
    expect(transport.mock.calls.at(-1)?.[0]).not.toHaveProperty("transformationRecipes");
  });

  it("does not publish an older Rust result after a same-elements transformation change", async () => {
    const fixture = fixtureFromSource([
      "nui 1",
      "line L = segment(start: (0, 0), end: (100, 0))",
      "move @L as shifted(from: (0, 0), to: (50, 0))"
    ].join("\n"));
    const options = optionsFor(fixture);
    const nextOptions = {
      ...options,
      transformationRecipes: options.transformationRecipes?.map((recipe) => ({ ...recipe, enabled: false }))
    };
    const firstPayload = evaluateElementsReferencePayload(fixture.elements, options);
    const nextPayload = evaluateElementsReferencePayload(fixture.elements, nextOptions);
    let resolveFirst: ((value: typeof firstPayload) => void) | undefined;
    let resolveNext: ((value: typeof nextPayload) => void) | undefined;
    const transport = vi.fn<RustEvaluationTransport>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
    const { result, rerender } = renderHook(
      ({ next }) => useEvaluationEngine(fixture.elements, next, 11, transport),
      { initialProps: { next: options } }
    );

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const firstRequestRevision = result.current.evaluationRequestRevision;
    rerender({ next: nextOptions });
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    const nextRequestRevision = result.current.evaluationRequestRevision;
    expect(nextRequestRevision).toBeGreaterThan(firstRequestRevision);

    await act(async () => {
      resolveNext?.(nextPayload);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const lineId = fixture.elements.find((element) => element.name === "L")!.id;
    expect(result.current.evaluation.computedGeometry.get(lineId)).toMatchObject({
      kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }
    });

    await act(async () => {
      resolveFirst?.(firstPayload);
      await Promise.resolve();
    });
    expect(result.current.evaluationRequestRevision).toBe(nextRequestRevision);
    expect(result.current.evaluation.computedGeometry.get(lineId)).toMatchObject({
      kind: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }
    });
  });

  it("uses the TypeScript reference evaluator when no Rust transport is supplied", () => {
    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length }, 41)
    );

    expect(result.current.mode).toBe("reference");
    expect(result.current.source).toBe("reference");
    expect(result.current.status).toBe("idle");
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
    expect(result.current.evaluationRevision).toBe(41);
  });

  it("uses Rust by default when the host supplies a Rust transport", async () => {
    const transport = transportReturning();
    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length }, 7, transport)
    );

    expect(result.current.mode).toBe("rust");
    expect(result.current.source).toBe("rust");
    expect(result.current.status).toBe("evaluating");
    expect(result.current.evaluation.computedGeometry.size).toBe(0);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("rust");
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ elements }));
  });

  it("keeps unsupported documents on the TypeScript path even when a Rust transport exists", () => {
    const transport = transportReturning();
    const unsupportedElements = [unsupportedElement];
    const { result } = renderHook(() =>
      useEvaluationEngine(
        unsupportedElements,
        { evaluationLimitIndex: unsupportedElements.length },
        1,
        transport
      )
    );

    expect(result.current.mode).toBe("rust");
    expect(result.current.source).toBe("reference");
    expect(result.current.rustEligible).toBe(false);
    expect(result.current.status).toBe("idle");
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps the previous Rust result stale while a new request is pending", async () => {
    const firstPayload = evaluateElementsReferencePayload(elements);
    let resolveSecond: ((value: typeof firstPayload) => void) | undefined;
    const transport = vi.fn<RustEvaluationTransport>()
      .mockResolvedValueOnce(firstPayload)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { result, rerender } = renderHook(
      ({ nextElements, revision }: { nextElements: CadElement[]; revision: number }) =>
        useEvaluationEngine(
          nextElements,
          { evaluationLimitIndex: nextElements.length },
          revision,
          transport
        ),
      { initialProps: { nextElements: elements, revision: 7 } }
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const nextElements: CadElement[] = [
      ...elements,
      {
        id: "c",
        name: "点C",
        type: "freePoint",
        activity: "visible",
        x: 0,
        y: 50
      }
    ];
    rerender({ nextElements, revision: 8 });

    expect(result.current.status).toBe("evaluating");
    expect(result.current.source).toBe("rust");
    expect(result.current.isStale).toBe(true);
    expect(result.current.evaluationRevision).toBe(7);
    expect(evaluationStateIsCurrentFor(result.current, 8)).toBe(false);

    resolveSecond?.(evaluateElementsReferencePayload(nextElements));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.evaluationRevision).toBe(8);
    expect(evaluationStateIsCurrentFor(result.current, 8)).toBe(true);
  });

  it("falls back to the TypeScript reference evaluation when Rust evaluation fails", async () => {
    const error = new Error("rust failed");
    const transport = vi.fn<RustEvaluationTransport>().mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length }, 1, transport)
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.source).toBe("fallback");
    expect(result.current.error).toBe(error);
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
    expect(evaluationStateIsCurrentFor(result.current, 1)).toBe(true);
  });

  it("fails closed after a Rust failure when a scalar program is present", async () => {
    const error = new Error("scalar validation failed");
    const transport = vi.fn<RustEvaluationTransport>().mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() =>
      useEvaluationEngine(
        elements,
        { evaluationLimitIndex: elements.length, scalarProgram },
        1,
        transport
      )
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.source).toBe("rust");
    expect(result.current.error).toBe(error);
    expect(result.current.evaluation.computedGeometry.size).toBe(0);
    expect(evaluationStateIsCurrentFor(result.current, 1)).toBe(false);
  });

  it.each(["parity", "shadow"] as const)(
    "keeps the reference result in %s mode and warns when Rust differs",
    async (mode) => {
      vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
      const transport = transportReturning({
        ...evaluateElementsReferencePayload(elements),
        computedGeometry: []
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const { result } = renderHook(() =>
        useEvaluationEngine(elements, { evaluationLimitIndex: elements.length }, 1, transport)
      );

      expect(result.current.source).toBe("reference");
      expect(result.current.status).toBe("evaluating");
      expect(result.current.evaluation.computedGeometry.size).toBe(3);

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.source).toBe("reference");
      expect(warn).toHaveBeenCalledWith(
        "Rust evaluation differs from the TypeScript reference evaluation.",
        expect.any(Object)
      );
    }
  );

  it.each(["parity", "shadow"] as const)(
    "defers scalar reference evaluation until Rust validates successfully in %s mode",
    async (mode) => {
      vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
      let resolveRust: ((value: ReturnType<typeof evaluateElementsReferencePayload>) => void) | undefined;
      const transport = vi.fn<RustEvaluationTransport>(() =>
        new Promise((resolve) => { resolveRust = resolve; })
      );
      const referenceSpy = vi.spyOn(
        await import("./evaluationEngine"),
        "evaluateElementsReference"
      );

      const { result } = renderHook(() =>
        useEvaluationEngine(
          elements,
          { evaluationLimitIndex: elements.length, scalarProgram },
          1,
          transport
        )
      );

      expect(result.current.source).toBe("rust");
      expect(result.current.status).toBe("evaluating");
      expect(referenceSpy).not.toHaveBeenCalled();

      resolveRust?.(evaluateElementsReferencePayload(elements, { scalarProgram }));
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(referenceSpy).toHaveBeenCalledTimes(1);
      expect(result.current.source).toBe("reference");
    }
  );

  it("measures Rust round-trip timing around the explicit transport", async () => {
    const sample = beginBenchmarkSample("source-edit-v1");
    expect(sample).not.toBeNull();
    const sourceTiming = beginSourceChange();
    measureCompile(sourceTiming, () => undefined);
    expect(bindElementsToActiveSample(elements, sourceTiming!)).toBe(true);

    const transport = transportReturning();
    const begin = vi.spyOn(benchmarkInstrumentation, "beginRustRoundTrip");
    const finish = vi.spyOn(benchmarkInstrumentation, "finishRustRoundTrip");
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(50)
      .mockReturnValue(50);

    const result = await evaluateElementsWithRust(
      elements,
      { evaluationLimitIndex: elements.length },
      transport
    );

    expect(result.computedGeometry.size).toBe(3);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(transport.mock.invocationCallOrder[0]!);
    expect(finish.mock.invocationCallOrder[0]).toBeGreaterThan(transport.mock.invocationCallOrder[0]!);
  });
});
