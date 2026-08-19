import { beforeEach, describe, expect, it } from "vitest";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { viewModeCommandDefinitions } from "./viewModeCommandDefinitions";

const pointElement = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const pointGeometry = (elementId: string, x: number, y: number): ComputedGeometry => ({
  kind: "point",
  elementId,
  name: elementId,
  x,
  y
});

const evaluationFor = (geometry: ComputedGeometry[], visibleIds: string[]): EvaluationResult => ({
  computedGeometry: new Map(geometry.map((item) => [item.elementId, item])),
  errors: [],
  warnings: [],
  effectiveVisibleElementIds: new Set(visibleIds)
});

describe("fitDrawing", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("centers visible geometry with 32px edge padding", () => {
    const elements = [pointElement("left", 0, 0), pointElement("right", 100, 50)];
    useCadDocumentStore.setState({ elements });
    const evaluation = evaluationFor([
      pointGeometry("left", 0, 0),
      pointGeometry("right", 100, 50)
    ], ["left", "right"]);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({
      zoom: 3.36,
      panX: -168,
      panY: 84
    });
  });

  it("no-ops when there is no visible drawing target or usable viewport", () => {
    const initialViewport = { panX: 12, panY: -8, zoom: 7 };
    useCadUiStore.getState().setCanvasViewport(initialViewport);
    const evaluation = evaluationFor([], []);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation,
      getCanvasViewportRect: () => ({ width: 64, height: 200 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual(initialViewport);
  });

  it("handles a zero-size target without producing non-finite zoom or pan", () => {
    const element = pointElement("point", 12, -8);
    useCadDocumentStore.setState({ elements: [element] });
    useCadUiStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: 7 });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([pointGeometry("point", 12, -8)], ["point"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect)
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({ panX: -84, panY: -56, zoom: 7 });
  });
});
