import { act, render } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";

const drawingCanvasProps = vi.hoisted(() => ({
  evaluationIsCurrent: false,
  evaluation: { computedGeometry: new Map(), errors: [], warnings: [] } as EvaluationResult
}));

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: () => ({})
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async () => ({}))
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: () => drawingCanvasProps.evaluationIsCurrent,
  useEvaluationEngine: () => ({
    evaluation: drawingCanvasProps.evaluation
  })
}));

vi.mock("./VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: ({ canvasFocusRef }: { canvasFocusRef: RefObject<HTMLDivElement | null> }) =>
    <div ref={canvasFocusRef} data-testid="canvas" tabIndex={-1} />
}));

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

const moduleSource = (suffix = "") => [
  "nui 4",
  "module M() {",
  "  point P = coordinate(x: 80, y: 0)",
  "}",
  "instance A = M()",
  suffix
].filter(Boolean).join("\n");

const navigationResultsFor = (api: { postMessage: ReturnType<typeof vi.fn> }, requestId: number) =>
  api.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === "canvasNavigationResult" && message.requestId === requestId);

describe("VSCodeApp container Reveal evaluation readiness", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    drawingCanvasProps.evaluationIsCurrent = false;
    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };
  });

  it("defers a freshly opened Module instance Reveal until current evaluation is available", async () => {
    const source = moduleSource();
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 41 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 411,
          documentVersion: 41,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(navigationResultsFor(api, 411)).toEqual([]);

    drawingCanvasProps.evaluationIsCurrent = true;
    await act(async () => {
      view.rerender(<VSCodeAppForTest api={api} />);
      await Promise.resolve();
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: instance.id,
      selectedElementIds: [instance.id],
      selectionAnchorElementId: instance.id
    });
    expect(navigationResultsFor(api, 411)).toContainEqual({
      type: "canvasNavigationResult",
      requestId: 411,
      status: "resolved",
      degradations: []
    });
  });

  it("rejects ordinary geometry Reveal when no current evaluation presentation is available", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 42 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 421,
          documentVersion: 42,
          normalizedSourceOffset: source.indexOf("A")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(navigationResultsFor(api, 421)).toContainEqual({
      type: "canvasNavigationResult",
      requestId: 421,
      status: "failed",
      reason: "no-revealable-runtime-target"
    });
  });

  it("drops a deferred container Reveal when a newer authoritative source arrives", async () => {
    const source = moduleSource();
    const newerSource = moduleSource("// newer authoritative source");
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 43 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 431,
          documentVersion: 43,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: newerSource, documentVersion: 44 }
      }));
    });

    drawingCanvasProps.evaluationIsCurrent = true;
    await act(async () => {
      view.rerender(<VSCodeAppForTest api={api} />);
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(navigationResultsFor(api, 431)).toEqual([]);
  });
});
