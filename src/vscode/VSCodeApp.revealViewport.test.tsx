import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputedLine, ComputedPoint, EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { VSCodeApp as VSCodeAppForTest } from "./VSCodeApp";

const drawingCanvasProps = vi.hoisted(() => ({
  evaluationIsCurrent: true,
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

const pointGeometry = (elementId: string, name: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId,
  name,
  x,
  y
});

const lineGeometry = (
  elementId: string,
  name: string,
  start: ComputedPoint,
  end: ComputedPoint
): ComputedLine => ({
  kind: "line",
  elementId,
  name,
  startPointId: start.elementId,
  endPointId: end.elementId,
  start,
  end,
  length: Math.hypot(end.x - start.x, end.y - start.y),
  startAngleDeg: null,
  endAngleDeg: null,
  startTangentAngleDeg: null,
  endTangentAngleDeg: null
});

const setViewportRect = () => {
  vi.spyOn(screen.getByTestId("canvas"), "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 300
  } as DOMRect);
};

describe("VSCodeApp Reveal viewport fitting", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    drawingCanvasProps.evaluationIsCurrent = true;
    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };
  });

  it("refits and centers ordinary geometry even when it was already visible", async () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 100, y: 50)",
      "line AB = segment(start: @A, end: @B)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    setViewportRect();
    useCadUiStore.getState().setCanvasViewport({ panX: 12, panY: -8, zoom: 1 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 51 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const pointA = state.elements.find((element) => element.name === "A")!;
    const pointB = state.elements.find((element) => element.name === "B")!;
    const line = state.elements.find((element) => element.name === "AB")!;
    const start = pointGeometry(pointA.id, pointA.name, 0, 0);
    const end = pointGeometry(pointB.id, pointB.name, 100, 50);
    drawingCanvasProps.evaluation.computedGeometry.set(line.id, lineGeometry(line.id, line.name, start, end));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 511,
          documentVersion: 51,
          normalizedSourceOffset: source.indexOf("AB = segment")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(line.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("fits a group from its existing aggregate descendant bounds", async () => {
    const source = [
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "  point Q = coordinate(x: 100, y: 50)",
      "}"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    setViewportRect();
    useCadUiStore.getState().setCanvasViewport({ panX: 30, panY: 10, zoom: 2 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 54 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const group = state.elements.find((element) => element.type === "group" && element.name === "G")!;
    const childP = state.elements.find((element) => element.parentGroupId === group.id && element.name === "P")!;
    const childQ = state.elements.find((element) => element.parentGroupId === group.id && element.name === "Q")!;
    drawingCanvasProps.evaluation.computedGeometry.set(
      childP.id,
      pointGeometry(childP.id, childP.name, 0, 0)
    );
    drawingCanvasProps.evaluation.computedGeometry.set(
      childQ.id,
      pointGeometry(childQ.id, childQ.name, 100, 50)
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 541,
          documentVersion: 54,
          normalizedSourceOffset: source.indexOf("G {")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(group.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("fits a concrete Module instance from its existing aggregate descendant bounds", async () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "  point Q = coordinate(x: 100, y: 50)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    setViewportRect();
    useCadUiStore.getState().setCanvasViewport({ panX: -40, panY: 25, zoom: 2 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 52 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const childP = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    const childQ = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "Q")!;
    drawingCanvasProps.evaluation.computedGeometry.set(
      childP.id,
      pointGeometry(childP.id, childP.name, 0, 0)
    );
    drawingCanvasProps.evaluation.computedGeometry.set(
      childQ.id,
      pointGeometry(childQ.id, childQ.name, 100, 50)
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 521,
          documentVersion: 52,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(instance.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("keeps the viewport unchanged when a Module instance has no renderable descendant bounds", async () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    setViewportRect();
    const initialViewport = { panX: 17, panY: -9, zoom: 4 };
    useCadUiStore.getState().setCanvasViewport(initialViewport);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 53 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 531,
          documentVersion: 53,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(instance.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual(initialViewport);
  });
});
