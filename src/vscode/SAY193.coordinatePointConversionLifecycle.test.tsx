import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationEngineState } from "../geometry/useEvaluationEngine";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage, VscodeWebviewApi } from "./protocol";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { sourceOwnerByRuntimeElementId } from "../dsl/sourceOwnership";
import { VSCodeApp } from "./VSCodeApp";
import { setVscodeWebviewApi } from "./vscodeWebviewApiContext";

const lifecycle = vi.hoisted(() => ({ evaluationCurrent: true }));

vi.mock("../geometry/useEvaluationEngine", async () => {
  const { useCadDocumentStore } = await import("../state/cadDocumentStore");
  const { evaluateElements } = await import("../geometry/evaluate");
  return {
    evaluationStateIsCurrentFor: () => lifecycle.evaluationCurrent,
    useEvaluationEngine: (): EvaluationEngineState => {
      const elements = useCadDocumentStore((state) => state.elements);
      const revision = useCadDocumentStore((state) => state.compiledDocumentRevision);
      const evaluation = evaluateElements(elements);
      return {
        evaluation,
        evaluationRevision: revision,
        evaluationRequestRevision: revision,
        mode: "reference",
        source: "reference",
        status: "ready",
        rustEligible: true,
        isStale: false,
        error: null
      };
    }
  };
});

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const source = [
  "nui 1",
  "const boundX: number = 40",
  "point Base = coordinate(x: -40, y: -40)",
  "point TargetA = coordinate(x: 40, y: 0)",
  "point TargetB = coordinate(x: 0, y: 40)",
  "point BindingTarget = coordinate(x: @boundX, y: 40)"
].join("\n");

const post = (message: ExtensionToVscodeMessage): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent<ExtensionToVscodeMessage>("message", { data: message }));
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
};

describe("SAY-193 coordinate conversion Canvas lifecycle", () => {
  beforeEach(() => {
    lifecycle.evaluationCurrent = true;
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 400 });
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 500,
      bottom: 400,
      width: 500,
      height: 400,
      toJSON: () => ({})
    }));
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      arc: vi.fn(),
      bezierCurveTo: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn(() => ({ width: 0 })),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn()
    } as unknown as CanvasRenderingContext2D);
    class ResizeObserverMock {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("keeps successful post-edit targets after a late terminal Base-pick delivery", async () => {
    const messages: VscodeToExtensionMessage[] = [];
    let sourceStatementIndexesByRuntimeId = new Map<string, number>();
    const pendingCanvasCommit: {
      value: Extract<VscodeToExtensionMessage, { type: "canvasCommit" }> | null;
    } = { value: null };
    const api: VscodeWebviewApi = {
      postMessage: (message) => {
        messages.push(message);
        if (message.type === "canvasCommit" && message.coordinatePointConversionRequestId !== undefined) {
          lifecycle.evaluationCurrent = false;
          pendingCanvasCommit.value = message;
        }
        if (message.type === "coordinatePointConversionResult" && message.status === "applied") {
          const successfulTargetSourceStatementIndexes = message.successfulTargetIds
            .map((targetId) => sourceStatementIndexesByRuntimeId.get(targetId));
          if (successfulTargetSourceStatementIndexes.some((index) => index === undefined)) return;
          queueMicrotask(() => post({
            type: "coordinatePointConversionSelection",
            requestId: message.requestId,
            documentVersion: 2,
            successfulTargetSourceStatementIndexes: successfulTargetSourceStatementIndexes as number[]
          }));
        }
      }
    };
    setVscodeWebviewApi(api);
    const container = document.createElement("div");
    document.body.append(container);
    let blockReactPointerBoundary = false;
    container.addEventListener("pointerdown", (event) => {
      if (blockReactPointerBoundary) event.stopImmediatePropagation();
    });
    render(<VSCodeApp api={api} />, { container });

    post({ type: "replaceTextDocument", sourceText: source, documentVersion: 1 });
    await flush();
    const preEditState = useCadDocumentStore.getState();
    const base = preEditState.elements.find((element) => element.name === "Base");
    const targetA = preEditState.elements.find((element) => element.name === "TargetA");
    const targetB = preEditState.elements.find((element) => element.name === "TargetB");
    const bindingTarget = preEditState.elements.find((element) => element.name === "BindingTarget");
    if (!base || !targetA || !targetB || !bindingTarget) throw new Error("Expected conversion fixture points");
    const owners = sourceOwnerByRuntimeElementId(preEditState.doc);
    sourceStatementIndexesByRuntimeId = new Map(
      [targetA, targetB, bindingTarget].map((element) => [
        element.id,
        owners.get(element.id)?.sourceStatementIndex
      ] as const).filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
    );
    useCadUiStore.getState().setCanvasSelectionEligibility(
      preEditState.elements,
      new Set(preEditState.elements.map((element) => element.id))
    );
    useCadUiStore.getState().setSelectedElementIds(
      [targetA.id, targetB.id, bindingTarget.id],
      targetB.id
    );

    post({
      type: "coordinatePointConversionStart",
      requestId: 901,
      documentUri: "file:///tmp/say-193.nui",
      documentVersion: 1,
      mode: "angle-distance",
      targetIds: [targetA.id, targetB.id, bindingTarget.id],
      origin: "canvas",
      canvasBasePick: true
    });
    await flush();

    const viewport = document.querySelector<HTMLDivElement>(".canvas-viewport");
    const basePoint = [...document.querySelectorAll<SVGCircleElement>(".overlay-draggable-point")]
      .find((point) => point.getAttribute("cx") === "210" && point.getAttribute("cy") === "240");
    if (!viewport || !basePoint) throw new Error("Expected Canvas viewport and Base point");
    expect(useCadUiStore.getState().activePointPickTarget).toMatchObject({
      elementId: "__coordinate-point-conversion__",
      parameterKey: "base"
    });
    fireEvent.pointerDown(basePoint, {
      button: 0,
      buttons: 1,
      clientX: 210,
      clientY: 240,
      pointerId: 91
    });
    expect(pendingCanvasCommit.value).toMatchObject({ coordinatePointConversionRequestId: 901 });
    await flush();
    fireEvent.pointerUp(viewport, {
      buttons: 0,
      clientX: 210,
      clientY: 240,
      pointerId: 91
    });
    await flush();

    // Model a late duplicate delivery of the same terminal pointer gesture
    // while the authoritative post-edit evaluation is still pending.
    blockReactPointerBoundary = true;
    fireEvent.pointerDown(viewport, {
      button: 0,
      buttons: 1,
      clientX: 210,
      clientY: 240,
      pointerId: 91
    });
    blockReactPointerBoundary = false;
    await flush();

    const canvasCommit = pendingCanvasCommit.value;
    if (!canvasCommit) throw new Error("Expected the conversion Canvas commit");
    post({
      type: "commitText",
      sourceText: canvasCommit.sourceText,
      documentVersion: 2,
      reason: "edit"
    });
    post({
      type: "canvasCommitResult",
      operationId: canvasCommit.operationId ?? 0,
      status: "accepted",
      documentVersion: 2
    });
    await flush();

    const postEditState = useCadDocumentStore.getState();
    const postEditTargetA = postEditState.elements.find((element) => element.name === "TargetA");
    const postEditTargetB = postEditState.elements.find((element) => element.name === "TargetB");
    if (!postEditTargetA || !postEditTargetB) throw new Error("Expected post-edit target points");
    expect(postEditTargetA.id).not.toBe(targetA.id);
    expect(postEditTargetB.id).not.toBe(targetB.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([postEditTargetA.id, postEditTargetB.id]);
    lifecycle.evaluationCurrent = true;
    useCadUiStore.getState().setCanvasSelectionEligibility(
      postEditState.elements,
      new Set(postEditState.elements.map((element) => element.id))
    );
    await flush();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([postEditTargetA.id, postEditTargetB.id]);

    const selectedNames = useCadUiStore.getState().selectedElementIds.map((elementId) =>
      useCadDocumentStore.getState().elements.find((element) => element.id === elementId)?.name
    );
    expect(selectedNames).toEqual(["TargetA", "TargetB"]);
    expect(selectedNames).not.toContain("Base");
    expect(selectedNames).not.toContain("BindingTarget");
    expect(messages.some((message) => message.type === "canvasCommit")).toBe(true);
    const conversionResult = messages.find((message): message is Extract<
      VscodeToExtensionMessage,
      { type: "coordinatePointConversionResult" }
    > => message.type === "coordinatePointConversionResult");
    expect(conversionResult?.status).toBe("applied");
    expect(conversionResult?.successfulTargetIds).toEqual([targetA.id, targetB.id]);
    expect(conversionResult?.skippedTargets.map((target) => target.targetId)).toContain(bindingTarget.id);
    container.remove();
  });
});
