import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../commands/commandLineSession";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import { creationRecipeForType } from "../commands/creationRecipes";
import { evaluateElements } from "../geometry/evaluate";
import { pickCandidates } from "../model/pickCandidates";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT } from "../state/cadUiStore";
import type { CadElement, ComputedLine, ComputedPoint, EvaluationResult } from "../types/geometry";
import { useCanvasOverlayData } from "./useCanvasOverlayData";
import { hitTestCanvasGeometry } from "./DrawingCanvasHitTest";

describe("useCanvasOverlayData", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("keeps a planned group's first child in the virtual command-line point overlay", () => {
    const elements: CadElement[] = [
      {
        id: "group", name: "グループ", type: "group", activity: "visible"
      },
      {
        id: "first-point", name: "先頭点", type: "freePoint", activity: "visible",
        parentGroupId: "group", x: 20, y: 0
      }
    ];
    const session = startSession(creationRecipeForType("line")!, {
      insertionIndex: elements.length,
      revision: 0,
      elements
    });
    const evaluation = evaluateElements(elements);
    const target = {
      elementId: COMMAND_LINE_PICK_TARGET_ID,
      parameterKey: "startPoint",
      insertionIndex: elements.length
    } as const;
    const pointPickCandidates = pickCandidates(elements, evaluation, {
      activePointPickTarget: target,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      commandLineSession: session,
      commandLinePickParentGroupId: "group",
      referenceElements: elements
    });
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates,
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));

    expect(result.current.overlayPointPickCandidates.map((candidate) => candidate.anchor)).toEqual([
      { mode: "reference", pointId: "first-point" }
    ]);
  });

  it("keeps hidden shared candidates out of Canvas overlays", () => {
    const elements: CadElement[] = [{
      id: "hidden-point",
      name: "Hidden",
      type: "freePoint",
      activity: "hidden",
      x: 20,
      y: 0
    }];
    const evaluation = evaluateElements(elements);
    const pointPickCandidates = pickCandidates(elements, evaluation, {
      activePointPickTarget: {
        elementId: COMMAND_LINE_PICK_TARGET_ID,
        parameterKey: "startPoint",
        insertionIndex: 1
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      referenceElements: elements
    });
    expect(pointPickCandidates).toHaveLength(1);

    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates,
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));
    expect(result.current.overlayPointPickCandidates).toEqual([]);
  });

  it("does not draw a moduleInstance even when stale computed geometry is present", () => {
    const elements: CadElement[] = [{
      id: "module",
      name: "Module",
      type: "moduleInstance",
      activity: "visible"
    }];
    const point: ComputedPoint = { kind: "point", elementId: "module", name: "Module", x: 10, y: 20 };
    const line: ComputedLine = {
      kind: "line",
      elementId: "module",
      name: "Module",
      startPointId: null,
      endPointId: null,
      start: point,
      end: { ...point, x: 30 },
      length: 20,
      startAngleDeg: 0,
      endAngleDeg: 0,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 0
    };
    const evaluation: EvaluationResult = {
      computedGeometry: new Map([["module", line]]),
      errors: [],
      warnings: []
    };
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates: [],
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));

    expect(result.current.lines).toEqual([]);
    expect(result.current.overlayLines).toEqual([]);
  });

  it("keeps materialized private geometry in normal Canvas drawing and hit testing", () => {
    const privateId = "module-runtime:private-line";
    const elements: CadElement[] = [{
      id: privateId,
      name: "脇コピー",
      type: "line",
      activity: "visible",
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 30, y: 0 }
    }];
    const evaluation = evaluateElements(elements);
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates: [],
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));

    expect(result.current.lines.map((line) => line.elementId)).toEqual([privateId]);
    expect(hitTestCanvasGeometry({
      screen: result.current.overlayLines[0].start,
      lines: result.current.overlayLines,
      points: []
    })).toBe(privateId);
  });

  it("keeps showGenerated=false loop geometry out of Canvas and pick overlays while retaining evaluation metadata", () => {
    const elements: CadElement[] = [
      {
        id: "loop", name: "Loop", type: "forGroup", activity: "visible",
        variableName: "i", start: 0, count: 2, step: 1, showGenerated: false
      },
      {
        id: "generated-point", name: "Generated point", type: "freePoint", activity: "visible",
        parentGroupId: "loop", x: 10, y: 0
      }
    ];
    const evaluation = evaluateElements(elements);
    const generatedId = "generated-point@loop:0";
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      pointPickCandidates: [{
        elementId: generatedId,
        options: [{
          kind: "point",
          label: "Generated point",
          anchor: { mode: "reference", pointId: generatedId }
        }]
      }],
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));

    expect(evaluation.computedGeometry.has(generatedId)).toBe(true);
    expect(evaluation.forGroupGeneratedRows).toHaveLength(2);
    expect(evaluation.effectiveVisibleElementIds?.has(generatedId)).toBe(false);
    expect(result.current.overlayPoints.some(({ point }) => point.elementId === generatedId)).toBe(false);
    expect(result.current.overlayPointPickCandidates).toEqual([]);
  });

  it("uses evaluated document text size and Canvas zoom without a minimum-size fallback", () => {
    const elements: CadElement[] = [
      { id: "anchor", name: "Anchor", type: "freePoint", activity: "visible", x: 10, y: 20 },
      { id: "small", name: "Small", type: "text", activity: "visible", text: "small", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 3 },
      { id: "large", name: "Large", type: "text", activity: "visible", text: "large", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 30 },
      { id: "hidden", name: "Hidden", type: "text", activity: "hidden", text: "hidden", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 2 },
    ];
    const pointPickCandidates = pickCandidates(elements, evaluateElements(elements), {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      referenceElements: elements,
    });
    const { result, rerender } = renderHook(
      ({ sourceElements, zoom }: { sourceElements: CadElement[]; zoom: number }) => useCanvasOverlayData({
        evaluation: evaluateElements(sourceElements),
        elements: sourceElements,
        selectedElementId: null,
        pointPickCandidates,
        viewportSize: { width: 500, height: 400 },
        canvasViewport: { panX: 0, panY: 0, zoom },
        documentPath: null,
      }),
      { initialProps: { sourceElements: elements, zoom: 0.25 } },
    );

    expect(result.current.overlayTexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.objectContaining({ elementId: "small" }), fontSizePx: 0.75, screen: { x: 252.5, y: 195 } }),
      expect.objectContaining({ text: expect.objectContaining({ elementId: "large" }), fontSizePx: 7.5 }),
    ]));
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "hidden")).toBeUndefined();

    rerender({
      sourceElements: elements.map((element) => element.id === "small" ? { ...element, fontSize: 6 } as CadElement : element),
      zoom: 0.25,
    });
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "small")).toMatchObject({ fontSizePx: 1.5 });

    rerender({
      sourceElements: elements.map((element) => element.id === "small" ? { ...element, fontSize: 6 } as CadElement : element),
      zoom: 2,
    });
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "small")).toMatchObject({ fontSizePx: 12 });
  });
});
