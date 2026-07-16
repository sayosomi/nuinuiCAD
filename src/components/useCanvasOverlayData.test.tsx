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
});
