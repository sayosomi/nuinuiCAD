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

const textElement = (id = "text", text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): CadElement => ({
  id,
  name: id,
  type: "text",
  activity: "visible",
  text,
  anchor: { mode: "coordinate", x: 10, y: 20 },
  fontSize: 5
});

const textGeometry = (elementId = "text", text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): ComputedGeometry => ({
  kind: "text",
  elementId,
  name: elementId,
  text,
  anchor: { kind: "point", elementId: `${elementId}-anchor`, name: `${elementId}-anchor`, x: 10, y: 20 },
  fontSize: 5
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

  it("fits a text-only drawing using measured width and 32px safe padding", () => {
    useCadDocumentStore.setState({ elements: [textElement()] });
    useCadUiStore.getState().setCanvasViewport({ panX: 12, panY: -8, zoom: 7 });

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([textGeometry()], ["text"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect),
      measureCanvasTextWidth: (line, fontSize) => {
        expect(line).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        expect(fontSize).toBe(5);
        return 40;
      }
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual({
      panX: -252,
      panY: 147,
      zoom: 8.4
    });
  });

  it.each([null, Number.NaN, -1])("does not change the viewport when text measurement returns %s", (measuredWidth) => {
    const initialViewport = { panX: 12, panY: -8, zoom: 7 };
    useCadDocumentStore.setState({ elements: [textElement()] });
    useCadUiStore.getState().setCanvasViewport(initialViewport);

    viewModeCommandDefinitions.fitDrawing.run({
      evaluation: evaluationFor([textGeometry()], ["text"]),
      getCanvasViewportRect: () => ({ width: 400, height: 300 } as DOMRect),
      measureCanvasTextWidth: () => measuredWidth
    });

    expect(useCadUiStore.getState().canvasViewport).toEqual(initialViewport);
  });
});

describe("Canvas identity-label visibility commands", () => {
  beforeEach(() => {
    useCadUiStore.setState(initialCadUiState());
  });

  it("uses independent Point Names and Geometry Names defaults and keeps the alias on Point Names", () => {
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);
    expect(useCadUiStore.getState()).not.toHaveProperty("showCanvasElementNames");

    viewModeCommandDefinitions.toggleCanvasGeometryNames.run();
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(true);

    viewModeCommandDefinitions.toggleCanvasElementNames.run();
    expect(useCadUiStore.getState().showCanvasPointNames).toBe(false);
    expect(useCadUiStore.getState().showCanvasGeometryNames).toBe(true);
    expect(useCadUiStore.getState().showCanvasPoints).toBe(true);
  });
});
