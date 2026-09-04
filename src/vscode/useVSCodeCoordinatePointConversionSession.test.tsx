import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { ExtensionToVscodeMessage, VscodeWebviewApi } from "./protocol";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";
import { webviewCanvasPresentationFor } from "./webviewCanvasPresentation";
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

const prepareConversion = () => {
  useCadDocumentStore.getState().replaceTextDocument(source, {
    currentFilePath: "/tmp/conversion.nui",
    dirtySinceSave: false
  });
  const state = useCadDocumentStore.getState();
  const goodId = state.elements.find((element) => element.name === "Good")!.id;
  const baseId = state.elements.find((element) => element.name === "Base")!.id;
  useCadUiStore.getState().setCanvasSelectionEligibility(
    state.elements,
    new Set(state.elements.map((element) => element.id))
  );
  return { goodId, baseId };
};

const authorityFor = (documentVersion: number) => ({
  documentVersion,
  normalizedSource: source
});

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

  it.each([
    ["ja", "現在のSourceと変換要求が一致しません。"],
    ["en", "The current Source does not match the conversion request."]
  ] as const)("localizes source/request mismatch through the session path (%s)", (language, message) => {
    const { goodId } = prepareConversion();
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const hook = renderHook(() => useVSCodeCoordinatePointConversionSession({
      api,
      currentContextFor,
      currentAuthorityFor: (documentVersion) => ({
        documentVersion,
        normalizedSource: "nui 1"
      }),
      postCanvasCommit: vi.fn(),
      presentation: webviewCanvasPresentationFor(webviewPresentationFor(language))
    }));

    dispatch({ ...request, targetIds: [goodId] });

    expect(hook.result.current.session).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "coordinatePointConversionResult",
      status: "rejected",
      skippedTargets: [{ targetId: goodId, reason: { code: "revalidation-failed", message } }]
    }));
    hook.unmount();
  });

  it.each([
    ["ja", "現在の文書または評価結果が古くなっています。"],
    ["en", "The current document or evaluation result is stale."]
  ] as const)("localizes stale document/evaluation context through confirm (%s)", (language, message) => {
    const { goodId } = prepareConversion();
    let evaluationIsCurrent = true;
    const currentContext = vi.fn(() => ({ ...currentContextFor(), evaluationIsCurrent }));
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const hook = renderHook(() => useVSCodeCoordinatePointConversionSession({
      api,
      currentContextFor: currentContext,
      currentAuthorityFor: authorityFor,
      postCanvasCommit: vi.fn(),
      presentation: webviewCanvasPresentationFor(webviewPresentationFor(language))
    }));

    dispatch({ ...request, targetIds: [goodId] });
    expect(hook.result.current.session).not.toBeNull();
    evaluationIsCurrent = false;
    act(() => hook.result.current.confirm());

    expect(hook.result.current.session).toMatchObject({
      error: { code: "revalidation-failed", message }
    });
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "coordinatePointConversionResult" }));
    hook.unmount();
  });

  it.each([
    ["ja", "基準点を選択するか、参照名を入力してください。"],
    ["en", "Select a base point or enter a reference name."]
  ] as const)("localizes the missing-base rejection through confirm (%s)", (language, message) => {
    const { goodId } = prepareConversion();
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const hook = renderHook(() => useVSCodeCoordinatePointConversionSession({
      api,
      currentContextFor,
      currentAuthorityFor: authorityFor,
      postCanvasCommit: vi.fn(),
      presentation: webviewCanvasPresentationFor(webviewPresentationFor(language))
    }));

    dispatch({ ...request, targetIds: [goodId] });
    expect(hook.result.current.session).not.toBeNull();
    act(() => hook.result.current.confirm());

    expect(hook.result.current.session).toMatchObject({
      error: { code: "base-not-candidate", message }
    });
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "coordinatePointConversionResult" }));
    hook.unmount();
  });

  it.each([
    ["ja", "変換結果をSource Editorへ反映できませんでした。"],
    ["en", "The conversion result could not be applied to the Source Editor."]
  ] as const)("localizes Source Editor apply failure through confirm (%s)", (language, message) => {
    const { goodId, baseId } = prepareConversion();
    const commitLineSplices = vi.fn(() => ({ status: "rejected" as const, reason: "invalid-change" as const }));
    useCadDocumentStore.setState({ commitLineSplices });
    const api = { postMessage: vi.fn() } satisfies VscodeWebviewApi;
    const postCanvasCommit = vi.fn();
    const hook = renderHook(() => useVSCodeCoordinatePointConversionSession({
      api,
      currentContextFor,
      currentAuthorityFor: authorityFor,
      postCanvasCommit,
      presentation: webviewCanvasPresentationFor(webviewPresentationFor(language))
    }));

    dispatch({ ...request, targetIds: [goodId] });
    const base = hook.result.current.session!.baseCandidates.find((candidate) => candidate.sourceElementId === baseId);
    expect(base).toBeDefined();
    if (!base) return;
    act(() => hook.result.current.selectBase(base.key));
    act(() => hook.result.current.confirm());

    expect(commitLineSplices).toHaveBeenCalledTimes(1);
    expect(hook.result.current.session).toMatchObject({
      error: { code: "revalidation-failed", message }
    });
    expect(postCanvasCommit).not.toHaveBeenCalled();
    expect(api.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "coordinatePointConversionResult" }));
    hook.unmount();
  });
});
