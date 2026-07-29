import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../commands/commandLineSession";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import { creationRecipeForType } from "../commands/creationRecipes";
import { evaluateElements } from "../geometry/evaluate";
import { pickCandidates } from "../model/pickCandidates";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { DEFAULT_CANVAS_VIEWPORT } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";
import { useCanvasOverlayData } from "./useCanvasOverlayData";

describe("useCanvasOverlayData", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  it("keeps a planned group's first child in the virtual command-line point overlay", () => {
    const elements: CadElement[] = [
      {
        id: "group", name: "グループ", type: "group", visible: true, enabled: true
      },
      {
        id: "first-point", name: "先頭点", type: "freePoint", visible: true, enabled: true,
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
      visible: false,
      enabled: true,
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

  it("uses evaluated text size and Canvas zoom without a minimum-size fallback", () => {
    const elements: CadElement[] = [
      { id: "anchor", name: "Anchor", type: "freePoint", visible: true, enabled: true, x: 10, y: 20 },
      { id: "small", name: "Small", type: "text", visible: true, enabled: true, text: "small", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 0.25 },
      { id: "large", name: "Large", type: "text", visible: true, enabled: true, text: "large", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 0.75 },
      { id: "hidden", name: "Hidden", type: "text", visible: false, enabled: true, text: "hidden", anchor: { mode: "reference", pointId: "anchor" }, fontSize: 2 },
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
      { initialProps: { sourceElements: elements, zoom: 0.5 } },
    );

    expect(result.current.overlayTexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.objectContaining({ elementId: "small" }), fontSizePx: 0.125, screen: { x: 255, y: 190 } }),
      expect.objectContaining({ text: expect.objectContaining({ elementId: "large" }), fontSizePx: 0.375 }),
    ]));
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "hidden")).toBeUndefined();

    rerender({
      sourceElements: elements.map((element) => element.id === "small" ? { ...element, fontSize: 0.5 } as CadElement : element),
      zoom: 0.5,
    });
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "small")).toMatchObject({ fontSizePx: 0.25 });

    rerender({
      sourceElements: elements.map((element) => element.id === "small" ? { ...element, fontSize: 0.5 } as CadElement : element),
      zoom: 2,
    });
    expect(result.current.overlayTexts.find((item) => item.text.elementId === "small")).toMatchObject({ fontSizePx: 1 });
  });
});
