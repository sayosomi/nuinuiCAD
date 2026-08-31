import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { ExtensionToVscodeMessage, VscodeWebviewApi } from "./protocol";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  useVSCodeCoordinatePointConversionSession,
  type VscodeCoordinatePointConversionCurrentContext
} from "./useVSCodeCoordinatePointConversionSession";

const source = [
  "nui 1",
  "point Base = coordinate(x: 0, y: 0)",
  "point Good = coordinate(x: 3, y: 4)",
  "point Bad = coordinate(x: @missing, y: 8)"
].join("\n");

const request: Extract<ExtensionToVscodeMessage, { type: "coordinatePointConversionStart" }> = {
  type: "coordinatePointConversionStart",
  requestId: 18,
  documentUri: "file:///tmp/conversion.nui",
  documentVersion: 1,
  mode: "xy",
  targetIds: [],
  origin: "canvas"
};

const currentContextFor = (): VscodeCoordinatePointConversionCurrentContext => {
  const state = useCadDocumentStore.getState();
  const evaluation = evaluateElements(state.elements, buildEvaluationOptions({
    compiledDocument: state.doc,
    evaluationLimitIndex: state.evaluationLimitIndex
  }));
  return {
    document: {
      sourceText: state.sourceText,
      doc: state.doc,
      docText: state.docText,
      diagnostics: state.diagnostics,
      bindingIssueDiagnostics: state.bindingIssueDiagnostics,
      typedDependencyGraph: state.typedDependencyGraph
    },
    source: {
      normalizedSource: state.sourceText,
      sourceRevision: state.doc.statementMap.sourceRevision
    },
    evaluation,
    evaluationIsCurrent: true
  };
};

const dispatch = (message: ExtensionToVscodeMessage): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent<ExtensionToVscodeMessage>("message", { data: message }));
  });
};

afterEach(() => {
  useCadDocumentStore.setState(initialCadDocumentState());
  useCadUiStore.setState(initialCadUiState());
});

describe("useVSCodeCoordinatePointConversionSession", () => {
  it("posts an owned commit and selects only targets that the plan applied", () => {
    useCadDocumentStore.getState().replaceTextDocument(source, {
      currentFilePath: "/tmp/conversion.nui",
      dirtySinceSave: false
    });
    const state = useCadDocumentStore.getState();
    const goodId = state.elements.find((element) => element.name === "Good")!.id;
    const badId = state.elements.find((element) => element.name === "Bad")!.id;
    useCadUiStore.getState().setCanvasSelectionEligibility(
      state.elements,
      new Set(state.elements.map((element) => element.id))
    );
    useCadDocumentStore.setState({
      commitLineSplices: vi.fn(() => ({ status: "applied" as const }))
    });
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const postCanvasCommit = vi.fn();
    const hook = renderHook(() => useVSCodeCoordinatePointConversionSession({
      api,
      currentContextFor,
      currentAuthorityFor: (documentVersion) => ({
        documentVersion,
        normalizedSource: source
      }),
      postCanvasCommit
    }));

    dispatch({ ...request, targetIds: [goodId, badId] });
    expect(hook.result.current.session).not.toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({
      elementId: "__coordinate-point-conversion__",
      parameterKey: "base"
    });
    const base = hook.result.current.session!.baseCandidates.find((candidate) =>
      candidate.sourceElementId === state.elements.find((element) => element.name === "Base")!.id
    );
    expect(base).toBeDefined();
    if (!base) return;

    act(() => hook.result.current.selectBase(base.key));
    act(() => hook.result.current.confirm());

    expect(postCanvasCommit).toHaveBeenCalled();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([goodId]);
    expect(postCanvasCommit).toHaveBeenCalledWith(1, request.requestId);
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionResult",
      status: "applied"
    }));
    hook.unmount();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });
});
