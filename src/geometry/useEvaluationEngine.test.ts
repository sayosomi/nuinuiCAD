import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { CadElement } from "../types/geometry";
import type { ScalarProgram } from "../scalars/scalarProgram";
import { evaluateElementsReferencePayload } from "./evaluationEngine";
import { useEvaluationEngine } from "./useEvaluationEngine";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

const pointA: CadElement = {
  id: "a",
  name: "点A",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 0,
  y: 0
};

const pointB: CadElement = {
  id: "b",
  name: "点B",
  type: "freePoint",
  visible: true,
  enabled: true,
  x: 100,
  y: 0
};

const line: CadElement = {
  id: "line",
  name: "直線",
  type: "line",
  visible: true,
  enabled: true,
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

const unsupportedElement = {
  id: "unsupported",
  name: "未対応",
  type: "unsupportedElement",
  visible: true,
  enabled: true
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
          visible: true,
          enabled: true,
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
