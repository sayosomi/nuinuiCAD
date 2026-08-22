import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import type { EvaluationResult } from "../types/geometry";
import { VSCodeApp } from "./VSCodeApp";

const evaluationHarness = vi.hoisted(() => ({
  state: null as EvaluationEngineState | null
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async () => ({}))
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: (state: EvaluationEngineState | undefined, compiledDocumentRevision: number) => {
    if (!state) return true;
    if (state.isStale || state.evaluationRevision !== compiledDocumentRevision) return false;
    return state.status !== "evaluating" || state.source === "reference";
  },
  useEvaluationEngine: () => {
    if (!evaluationHarness.state) throw new Error("evaluation state not prepared");
    return evaluationHarness.state;
  }
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: () => <div data-testid="canvas" />
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const source = ["nui 4", "const x: number = 1"].join("\n");

const emptyEvaluation = (): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: []
} as EvaluationResult);

const evaluationResult = (
  bindingId: string,
  status: "error" | "ok"
): EvaluationResult => ({
  computedGeometry: new Map(),
  errors: [],
  warnings: [],
  computedScalarBindings: new Map([
    [
      bindingId,
      status === "error"
        ? { status: "error", type: { kind: "number" }, issueCode: "poisoned-binding" }
        : { status: "ok", type: { kind: "number" }, value: { kind: "number", value: 1 } }
    ]
  ])
} as EvaluationResult);

const setEvaluationState = (
  evaluation: EvaluationResult,
  requestRevision: number,
  overrides: Partial<EvaluationEngineState> = {}
) => {
  const documentState = useCadDocumentStore.getState();
  evaluationHarness.state = {
    evaluation,
    evaluationRevision: documentState.compiledDocumentRevision,
    evaluationRequestRevision: requestRevision,
    mode: "rust",
    source: "rust",
    status: "ready",
    rustEligible: true,
    isStale: false,
    error: null,
    ...overrides
  };
};

const currentBindingId = () => {
  const binding = useCadDocumentStore.getState().doc.bindingAnalysis?.catalog.bindings.find(
    (candidate) => candidate.kind === "typed" && candidate.name === "x"
  );
  if (!binding) throw new Error("expected typed binding x");
  return binding.id;
};

const acceptHostDocument = async (documentVersion: number) => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "replaceTextDocument", sourceText: source, documentVersion }
    }));
  });
};

const publications = (postMessage: ReturnType<typeof vi.fn>) => postMessage.mock.calls
  .map(([message]) => message)
  .filter((message) => message?.type === "runtimeDiagnosticsPublication");

describe("VSCodeApp runtime diagnostics publication", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    setEvaluationState(emptyEvaluation(), 0);
  });

  it("publishes the current canonical runtime diagnostic with host documentVersion as JSON-safe structured data", async () => {
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeApp api={api} />);
    await acceptHostDocument(7);

    const bindingId = currentBindingId();
    setEvaluationState(evaluationResult(bindingId, "error"), 1);
    await act(async () => {
      view.rerender(<VSCodeApp api={api} />);
    });

    const publication = publications(api.postMessage).at(-1);
    expect(publication).toMatchObject({
      type: "runtimeDiagnosticsPublication",
      documentVersion: 7,
      diagnostics: [
        {
          origin: "runtime",
          code: "poisoned-binding",
          bindingId,
          navigationTarget: { kind: "binding", bindingId }
        }
      ]
    });
    expect(JSON.parse(JSON.stringify(publication))).toEqual(publication);
  });

  it("does not publish a stale evaluation even when the host source itself is authoritative", async () => {
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeApp api={api} />);
    await acceptHostDocument(8);
    api.postMessage.mockClear();

    const bindingId = currentBindingId();
    setEvaluationState(evaluationResult(bindingId, "error"), 1, { isStale: true });
    await act(async () => {
      view.rerender(<VSCodeApp api={api} />);
    });

    expect(publications(api.postMessage)).toEqual([]);
  });

  it("publishes an empty current-version runtime layer when a later evaluation recovers", async () => {
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeApp api={api} />);
    await acceptHostDocument(9);

    const bindingId = currentBindingId();
    setEvaluationState(evaluationResult(bindingId, "error"), 1);
    await act(async () => {
      view.rerender(<VSCodeApp api={api} />);
    });
    expect(publications(api.postMessage).at(-1)?.diagnostics).toHaveLength(1);

    setEvaluationState(evaluationResult(bindingId, "ok"), 2);
    api.postMessage.mockClear();
    await act(async () => {
      view.rerender(<VSCodeApp api={api} />);
    });

    expect(publications(api.postMessage).at(-1)).toEqual({
      type: "runtimeDiagnosticsPublication",
      documentVersion: 9,
      diagnostics: []
    });
  });

  it("suppresses publication while previewElements is active", async () => {
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeApp api={api} />);
    await acceptHostDocument(10);

    const bindingId = currentBindingId();
    setEvaluationState(evaluationResult(bindingId, "error"), 1);
    await act(async () => {
      view.rerender(<VSCodeApp api={api} />);
    });
    expect(publications(api.postMessage).length).toBeGreaterThan(0);
    api.postMessage.mockClear();

    const documentState = useCadDocumentStore.getState();
    setEvaluationState(evaluationResult(bindingId, "error"), 2);
    await act(async () => {
      useCadDocumentStore.setState({ previewElements: [...documentState.elements] });
      view.rerender(<VSCodeApp api={api} />);
    });

    expect(publications(api.postMessage)).toEqual([]);
  });
});
