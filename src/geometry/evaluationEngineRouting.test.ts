import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import * as engine from "./evaluationEngine";
import { buildEvaluationOptions } from "./productionEvaluationContext";
import { evaluateElementsWithEngine } from "./evaluationEngineRouting";
import { ScalarOutputDecodeError, type EvaluationPayload } from "./evaluationPayload";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import { useEvaluationEngine } from "./useEvaluationEngine";

const fixture = (scalar: boolean) => {
  const source = ["nui 1", ...(scalar ? ["const length: number = 20"] : []),
    `line A = segment(start: (0, 0), end: (${scalar ? "@length" : "20"}, 0))`
  ].join("\n");
  const compiled = compileFreshCanonicalText(source);
  expect(compiled.status).toBe("valid");
  const options = buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined });
  return { elements: compiled.doc.document.elements, options };
};

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("shared live/transient evaluation routing", () => {
  it.each(["parity", "shadow"])("returns reference geometry and compares the Rust result in %s mode", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const { elements, options } = fixture(false);
    const reference = engine.evaluateElementsReference(elements, options);
    const transport = vi.fn<RustEvaluationTransport>().mockResolvedValue({
      ...engine.evaluateElementsReferencePayload(elements, options), computedGeometry: []
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await evaluateElementsWithEngine(elements, options, transport)).toEqual(reference);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Rust evaluation differs from the TypeScript reference evaluation.", expect.any(Object));
  });

  it.each(["parity", "shadow"])("validates scalar Rust output before reference work in %s mode", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const { elements, options } = fixture(true);
    const payload = engine.evaluateElementsReferencePayload(elements, options);
    const reference = engine.evaluateElementsReference(elements, options);
    const referenceSpy = vi.spyOn(engine, "evaluateElementsReference");
    let resolveRust!: (payload: EvaluationPayload) => void;
    const transport = vi.fn<RustEvaluationTransport>(() => new Promise(resolve => { resolveRust = resolve; }));
    const request = evaluateElementsWithEngine(elements, options, transport);
    expect(referenceSpy).not.toHaveBeenCalled();
    resolveRust(payload);
    expect(await request).toEqual(reference);
    expect(referenceSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["rust", "parity", "shadow"])("uses the permitted reference fallback after a transport failure in %s mode", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const { elements, options } = fixture(false);
    expect(options.scalarProgram).toBeUndefined();
    const error = new Error("transport unavailable");
    const transport = vi.fn<RustEvaluationTransport>().mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reference = engine.evaluateElementsReference(elements, options);
    expect(await evaluateElementsWithEngine(elements, options, transport)).toEqual(reference);
    const live = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(live.result.current.status).toBe("failed"));
    expect(live.result.current.evaluation).toEqual(reference);
    expect(live.result.current.error).toBe(error);
  });

  it.each(["rust", "parity", "shadow"])("fails closed for compiler-produced scalar program failure in %s mode", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const { elements, options } = fixture(true);
    expect(options.scalarProgram).toBeDefined();
    const error = new Error("scalar validation failed");
    const transport = vi.fn<RustEvaluationTransport>().mockRejectedValue(error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const referenceSpy = vi.spyOn(engine, "evaluateElementsReference");
    await expect(evaluateElementsWithEngine(elements, options, transport)).rejects.toBe(error);
    expect(referenceSpy).not.toHaveBeenCalled();
    const live = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(live.result.current.status).toBe("failed"));
    expect(live.result.current.evaluation.computedGeometry.size).toBe(0);
    expect(live.result.current.source).toBe("rust");
  });

  it.each(["rust", "parity", "shadow"])("rejects malformed scalar output instead of selecting reference geometry in %s mode", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const { elements, options } = fixture(false);
    const payload = engine.evaluateElementsReferencePayload(elements, options);
    const transport = vi.fn<RustEvaluationTransport>().mockResolvedValue({
      ...payload, computedScalarBindings: [{ bindingId: "bad", evaluation: { status: "invalid" } }]
    } as unknown as EvaluationPayload);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(evaluateElementsWithEngine(elements, options, transport)).rejects.toBeInstanceOf(ScalarOutputDecodeError);
  });

  it("does not publish or compare canceled live evaluation results", async () => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "shadow");
    const { elements, options } = fixture(true);
    const payload = engine.evaluateElementsReferencePayload(elements, options);
    let resolveRust!: (payload: EvaluationPayload) => void;
    const transport = vi.fn<RustEvaluationTransport>(() => new Promise(resolve => { resolveRust = resolve; }));
    const referenceSpy = vi.spyOn(engine, "evaluateElementsReference");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    view.unmount();
    await act(async () => { resolveRust(payload); await Promise.resolve(); });
    expect(referenceSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
