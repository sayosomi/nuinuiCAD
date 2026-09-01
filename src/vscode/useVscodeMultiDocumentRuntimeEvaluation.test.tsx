import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationPayload } from "../geometry/evaluationPayload";
import type { RustEvaluationTransport } from "../geometry/rustEvaluationRunner";
import type { CadElement } from "../types/geometry";
import type { VscodeMultiDocumentCanvasRuntimeSnapshot } from "./multiDocumentRuntimeTransport";
import { useVscodeMultiDocumentRuntimeEvaluation } from "./useVscodeMultiDocumentRuntimeEvaluation";

const elementFor = (id: string) => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x: 0,
  y: 0
} as unknown as CadElement);

const payload: EvaluationPayload = {
  computedGeometry: [],
  errors: [],
  warnings: [],
  evaluatedElementIds: [],
  evaluationLimitIndex: 1,
  effectiveVisibleElementIds: [],
  effectiveEnabledElementIds: []
};

const snapshotFor = (graphRevision: number, elementId: string): VscodeMultiDocumentCanvasRuntimeSnapshot => ({
  graphRevision,
  rootDocumentId: "file:///workspace/root.nui",
  rootSourceRevision: graphRevision,
  preparedRustEvaluation: {
    rustEligible: true,
    input: {
      elements: [elementFor(elementId)],
      evaluationLimitIndex: 1
    }
  },
  visibilityProfiles: [],
  activeVisibilityProfileId: "",
  modulePresentation: {
    instanceBaseGeometrySnapshots: [],
    origins: []
  }
});

describe("VS Code multi-document runtime evaluation", () => {
  it("evaluates the published prepared Rust input and exposes a current result", async () => {
    const transport = vi.fn<RustEvaluationTransport>(async (input) => {
      expect(input.elements[0]?.id).toBe("runtime-a");
      return payload;
    });
    const snapshot = snapshotFor(4, "runtime-a");
    const { result } = renderHook(() => useVscodeMultiDocumentRuntimeEvaluation(snapshot, transport));

    expect(result.current.status).toBe("evaluating");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.evaluationRevision).toBe(4);
    expect(result.current.source).toBe("rust");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("ignores a stale completion when a newer graph snapshot wins", async () => {
    let resolveFirst: ((value: EvaluationPayload) => void) | undefined;
    let resolveSecond: ((value: EvaluationPayload) => void) | undefined;
    const transport = vi.fn<RustEvaluationTransport>((input) => new Promise((resolve) => {
      if (input.elements[0]?.id === "runtime-a") resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    const first = snapshotFor(4, "runtime-a");
    const second = snapshotFor(5, "runtime-b");
    const { result, rerender } = renderHook(
      ({ snapshot }) => useVscodeMultiDocumentRuntimeEvaluation(snapshot, transport),
      { initialProps: { snapshot: first } }
    );

    rerender({ snapshot: second });
    resolveFirst?.(payload);
    await Promise.resolve();
    expect(result.current.status).toBe("evaluating");
    resolveSecond?.(payload);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.evaluationRevision).toBe(5);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("fails closed to an empty evaluation when Rust transport fails", async () => {
    const transport = vi.fn<RustEvaluationTransport>(async () => {
      throw new Error("transport unavailable");
    });
    const snapshot = snapshotFor(4, "runtime-a");
    const { result } = renderHook(() => useVscodeMultiDocumentRuntimeEvaluation(snapshot, transport));

    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.evaluation.computedGeometry).toEqual(new Map());
    expect(result.current.evaluation.errors).toEqual([]);
    expect(result.current.evaluationRevision).toBe(4);
  });
});
