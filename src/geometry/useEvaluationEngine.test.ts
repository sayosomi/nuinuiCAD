import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { CadElement } from "../types/geometry";
import type { ScalarProgram } from "../scalars/scalarProgram";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { buildConditionalGroupConditionsByElementId } from "./controlBooleanRuntime";
import { buildConditionalMutationOwners, conditionalOwnerIdByElementId } from "../scalars/conditionalMutationControl";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../scalars/forGroupMutationControl";
import * as evaluationEngine from "./evaluationEngine";
import { evaluateElementsReferencePayload } from "./evaluationEngine";
import { useEvaluationEngine } from "./useEvaluationEngine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

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

const elements = [pointA, pointB, line];
const scalarProgram: ScalarProgram = {
  statements: [{
    kind: "declare",
    bindingId: "binding:stable",
    scopeId: "root",
    sourceOrder: 0,
    declaration: {
      bindingKind: "const",
      declaredType: { kind: "number" },
      initializer: { kind: "numberLiteral", span: { start: 0, end: 1 }, value: 1, type: { kind: "number" } }
    }
  }]
};

const copySource = (angleDeg: string) => [
  "nui 3",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line AB = segment(start: @A, end: @B)",
  "for Loop (i, from: 0, count: 2, step: 1, showGenerated: true) {",
  `  line Copy = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: ${angleDeg}, mirrorX: false, baseLines: [@AB])`,
  "}"
].join("\n");

const unsupportedElement = {
  id: "unsupported",
  name: "未対応",
  type: "unsupportedElement",
  activity: "visible"
} as unknown as CadElement;

const invokeMock = vi.mocked(invoke);

const setTauriRuntime = () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {}
  });
};

const clearTauriRuntime = () => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
};

afterEach(() => {
  clearTauriRuntime();
  vi.unstubAllEnvs();
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

describe("useEvaluationEngine", () => {
  it("does not warn while a valid numeric expression is temporarily incomplete", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "parity");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const valid = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), copySource("90"));
    const incomplete = compileCanonicalText(valid, copySource("90 +"));
    const completed = compileCanonicalText(incomplete, copySource("90 + 10"));
    expect(valid.status).toBe("valid");
    expect(incomplete.status).toBe("valid");
    expect(completed.status).toBe("valid");

    const payloads = [
      evaluateElementsReferencePayload(valid.doc.document.elements),
      evaluateElementsReferencePayload(incomplete.doc.document.elements),
      evaluateElementsReferencePayload(completed.doc.document.elements)
    ];
    invokeMock.mockImplementation(() => Promise.resolve(payloads.shift()!));

    const { result, rerender } = renderHook(
      ({ source, revision }: { source: typeof valid; revision: number }) =>
        useEvaluationEngine(source.doc.document.elements, {}, revision),
      { initialProps: { source: valid, revision: 1 } }
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ source: incomplete, revision: 2 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ source: completed, revision: 3 });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(result.current.evaluation.errors).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns the reference evaluation in browser mode", () => {
    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length }, 41)
    );

    expect(result.current.mode).toBe("reference");
    expect(result.current.source).toBe("reference");
    expect(result.current.status).toBe("idle");
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
    expect(result.current.evaluationRevision).toBe(41);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns an empty evaluating state before the first Rust result in Rust mode", () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    expect(result.current.mode).toBe("rust");
    expect(result.current.source).toBe("rust");
    expect(result.current.status).toBe("evaluating");
    expect(result.current.isStale).toBe(false);
    expect(result.current.evaluation.computedGeometry.size).toBe(0);
  });

  it("uses Rust by default in Tauri dev when the document is supported", async () => {
    setTauriRuntime();
    invokeMock.mockResolvedValue(evaluateElementsReferencePayload(elements));

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    expect(result.current.mode).toBe("rust");
    expect(result.current.source).toBe("rust");
    expect(result.current.status).toBe("evaluating");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("evaluate_document", expect.any(Object)));
  });

  it("adopts the Rust result for a canonical forGroup mutation graph", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), [
      "nui 3",
      "let total: number = 0",
      "for Loop (i, from: 0, count: 2, step: 1) {",
      "  set total = @total + 1",
      "  point P = coordinate(x: @total, y: 0)",
      "}"
    ].join("\n"));
    expect(compiled.status).not.toBe("fatal");
    const bindingVersions = compiled.doc.bindingVersions!;
    const options = {
      evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex,
      bindingVersions,
      statementInfoByElementId: compiled.doc.statementMap.byElementId,
      statementIdByStatementIndex: compiled.doc.statementMap.statementIdByStatementIndex,
      forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
        bindingVersions,
        compiled.doc.document.elements,
        compiled.doc.statementMap.byElementId,
        compiled.doc.statementMap.statementIdByStatementIndex
      ))
    };
    const rustPayload = evaluateElementsReferencePayload(compiled.doc.document.elements, options);
    invokeMock.mockResolvedValue(rustPayload);

    const { result } = renderHook(() => useEvaluationEngine(compiled.doc.document.elements, options));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("rust");
    expect(result.current.rustEligible).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("evaluate_document", {
      input: expect.objectContaining({
        bindingVersions: expect.objectContaining({ forGroupOwners: expect.any(Array) })
      })
    });
    const bindingId = bindingVersions.versions[0].bindingId;
    expect(result.current.evaluation.computedScalarBindings?.get(bindingId)).toMatchObject({
      value: { value: 2 }
    });
  });

  it("adopts Rust for canonical nested conditional and forGroup mutation", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), [
      "nui 3",
      "let total: number = 0",
      "for Outer (i, from: 0, count: 2, step: 1) {",
      "  if Branch (@total == 0) {",
      "    let scratch: number = 1",
      "    set total = @total + @scratch",
      "  } else {",
      "    set total = @total + 10",
      "  }",
      "  for Inner (j, from: 0, count: 2, step: 1) {",
      "    set total = @total + 1",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}"
    ].join("\n"));
    expect(compiled.status).not.toBe("fatal");
    const bindingVersions = compiled.doc.bindingVersions!;
    const options = {
      scalarProgram: compiled.doc.scalarProgram,
      bindingVersions,
      statementInfoByElementId: compiled.doc.statementMap.byElementId,
      statementIdByStatementIndex: compiled.doc.statementMap.statementIdByStatementIndex,
      conditionalOwnerStatementIdByElementId: conditionalOwnerIdByElementId(buildConditionalMutationOwners(
        bindingVersions,
        compiled.doc.document.elements,
        compiled.doc.statementMap.byElementId,
        compiled.doc.statementMap.statementIdByStatementIndex
      )),
      forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
        bindingVersions,
        compiled.doc.document.elements,
        compiled.doc.statementMap.byElementId,
        compiled.doc.statementMap.statementIdByStatementIndex
      )),
      conditionalGroupConditionsByElementId: buildConditionalGroupConditionsByElementId(
        compiled.doc.conditionalGroupConditions ?? new Map(),
        compiled.doc.statementMap.elementIdByStatementIndex
      )
    };
    invokeMock.mockResolvedValue(evaluateElementsReferencePayload(compiled.doc.document.elements, options));

    const { result } = renderHook(() => useEvaluationEngine(compiled.doc.document.elements, options));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("rust");
    expect(result.current.rustEligible).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("evaluate_document", {
      input: expect.objectContaining({
        bindingVersions: expect.objectContaining({
          conditionalOwners: expect.any(Array),
          forGroupOwners: expect.any(Array)
        })
      })
    });
    expect(result.current.evaluation.computedScalarBindings?.get(bindingVersions.versions[0].bindingId)).toMatchObject({
      value: { value: 15 }
    });
  });

  it("round-trips optional scalar bindings through the desktop command", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    invokeMock.mockResolvedValue(evaluateElementsReferencePayload(elements, { scalarProgram }));

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram })
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("evaluate_document", {
      input: expect.objectContaining({ elements, scalarProgram })
    }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.evaluation.computedScalarBindings?.get("binding:stable")).toEqual({
      status: "ok",
      type: { kind: "number" },
      value: { kind: "number", value: 1 }
    });
  });

  it("does not invoke Rust for unsupported Tauri documents", () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const unsupportedElements = [unsupportedElement];

    const { result } = renderHook(() =>
      useEvaluationEngine(unsupportedElements, {
        evaluationLimitIndex: unsupportedElements.length
      })
    );

    expect(result.current.mode).toBe("rust");
    expect(result.current.source).toBe("reference");
    expect(result.current.rustEligible).toBe(false);
    expect(result.current.status).toBe("idle");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the Rust result after Rust evaluation succeeds", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    invokeMock.mockResolvedValue(evaluateElementsReferencePayload(elements));

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("rust");
    expect(result.current.isStale).toBe(false);
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
  });

  it("keeps the previous Rust result as stale while a new Rust evaluation is pending", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    invokeMock.mockResolvedValueOnce(evaluateElementsReferencePayload(elements));

    const { result, rerender } = renderHook(
      ({ nextElements, revision }: { nextElements: CadElement[]; revision: number }) =>
        useEvaluationEngine(nextElements, { evaluationLimitIndex: nextElements.length }, revision),
      { initialProps: { nextElements: elements, revision: 7 } }
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    invokeMock.mockImplementationOnce(() => new Promise(() => undefined));
    rerender({
      nextElements: [
        ...elements,
        {
          id: "c",
          name: "点C",
          type: "freePoint",
          activity: "visible",
          x: 0,
          y: 50
        }
      ],
      revision: 8
    });

    expect(result.current.status).toBe("evaluating");
    expect(result.current.source).toBe("rust");
    expect(result.current.isStale).toBe(true);
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
    expect(result.current.evaluationRevision).toBe(7);
  });

  it("falls back to the TypeScript reference evaluation when Rust evaluation fails", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const error = new Error("rust failed");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.source).toBe("fallback");
    expect(result.current.error).toBe(error);
    expect(result.current.evaluation.computedGeometry.size).toBe(3);
  });

  it("fails closed instead of adopting a fallback after scalar program validation fails", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const malformedScalarProgram = { statements: "not-an-array" } as unknown as ScalarProgram;
    const error = { code: "scalar-payload-invalid-field-type", message: "scalar program statements must be an array" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram: malformedScalarProgram })
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.source).toBe("rust");
    expect(result.current.error).toBe(error);
    expect(result.current.evaluation.computedGeometry.size).toBe(0);
  });

  it.each([
    ["malformed scalar output", { bindingId: "binding:stable", evaluation: { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } } }],
    ["duplicate scalar output bindings", [
      { bindingId: "binding:stable", evaluation: { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } } },
      { bindingId: "binding:stable", evaluation: { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 2 } } }
    ]]
  ])("fails closed instead of adopting a fallback after %s", async (_name, computedScalarBindings) => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockResolvedValue({
      ...evaluateElementsReferencePayload(elements, { scalarProgram }),
      computedScalarBindings
    });

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram })
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.source).toBe("rust");
    expect(result.current.evaluation.computedGeometry.size).toBe(0);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it.each(["parity", "shadow"] as const)(
    "keeps malformed scalar input fail-closed in %s mode before TS reference evaluation",
    async (mode) => {
      setTauriRuntime();
      vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
      const malformedScalarProgram = { statements: "not-an-array" } as unknown as ScalarProgram;
      const error = { code: "scalar-payload-invalid-field-type", message: "scalar program statements must be an array" };
      const referenceSpy = vi.spyOn(evaluationEngine, "evaluateElementsReference");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      invokeMock.mockRejectedValue(error);

      const { result } = renderHook(() =>
        useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram: malformedScalarProgram })
      );

      await waitFor(() => expect(result.current.status).toBe("failed"));
      expect(referenceSpy).not.toHaveBeenCalled();
      expect(result.current.source).toBe("rust");
      expect(result.current.evaluation.computedGeometry.size).toBe(0);
      expect(result.current.error).toBe(error);
    }
  );

  it.each(["parity", "shadow"] as const)(
    "keeps malformed scalar output fail-closed in %s mode",
    async (mode) => {
      setTauriRuntime();
      vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
      const malformedOutput = {
        ...evaluateElementsReferencePayload(elements, { scalarProgram }),
        computedScalarBindings: { bindingId: "binding:stable" }
      };
      const referenceSpy = vi.spyOn(evaluationEngine, "evaluateElementsReference");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      invokeMock.mockResolvedValue(malformedOutput);

      const { result } = renderHook(() =>
        useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram })
      );

      await waitFor(() => expect(result.current.status).toBe("failed"));
      expect(referenceSpy).not.toHaveBeenCalled();
      expect(result.current.source).toBe("rust");
      expect(result.current.evaluation.computedGeometry.size).toBe(0);
      expect(result.current.error).toBeInstanceOf(Error);
    }
  );

  it.each(["parity", "shadow"] as const)(
    "runs TS reference evaluation after successful Rust scalar validation in %s mode",
    async (mode) => {
      setTauriRuntime();
      vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
      let resolveRustPayload: ((value: unknown) => void) | undefined;
      invokeMock.mockImplementation(() => new Promise((resolve) => { resolveRustPayload = resolve; }));
      const rustPayload = evaluateElementsReferencePayload(elements, { scalarProgram });
      const referenceSpy = vi.spyOn(evaluationEngine, "evaluateElementsReference");

      const { result } = renderHook(() =>
        useEvaluationEngine(elements, { evaluationLimitIndex: elements.length, scalarProgram })
      );

      await waitFor(() => expect(invokeMock).toHaveBeenCalled());
      expect(referenceSpy).not.toHaveBeenCalled();
      resolveRustPayload?.(rustPayload);

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(referenceSpy).toHaveBeenCalledTimes(1);
      expect(result.current.source).toBe("reference");
      expect(result.current.evaluation.computedGeometry.size).toBe(3);
    }
  );

  it("returns the TypeScript reference result in shadow mode and warns on Rust differences", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "shadow");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invokeMock.mockResolvedValue({
      ...evaluateElementsReferencePayload(elements),
      computedGeometry: []
    });

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    expect(result.current.mode).toBe("shadow");
    expect(result.current.source).toBe("reference");
    expect(result.current.status).toBe("evaluating");
    expect(result.current.evaluation.computedGeometry.size).toBe(3);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("reference");
    expect(warn).toHaveBeenCalledWith(
      "Rust evaluation differs from the TypeScript reference evaluation.",
      expect.any(Object)
    );
  });

  it("returns the TypeScript reference result in parity mode and warns on Rust differences", async () => {
    setTauriRuntime();
    vi.stubEnv("VITE_EVALUATION_ENGINE", "parity");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invokeMock.mockResolvedValue({
      ...evaluateElementsReferencePayload(elements),
      computedGeometry: []
    });

    const { result } = renderHook(() =>
      useEvaluationEngine(elements, { evaluationLimitIndex: elements.length })
    );

    expect(result.current.mode).toBe("parity");
    expect(result.current.source).toBe("reference");
    expect(result.current.status).toBe("evaluating");
    expect(result.current.evaluation.computedGeometry.size).toBe(3);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("reference");
    expect(warn).toHaveBeenCalledWith(
      "Rust evaluation differs from the TypeScript reference evaluation.",
      expect.any(Object)
    );
  });
});
