import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { startSession } from "../commands/commandLineSession";
import { COMMAND_LINE_PICK_TARGET_ID } from "../commands/commandLinePickRouting";
import { creationRecipeForType } from "../commands/creationRecipes";
import { evaluateElements } from "../geometry/evaluate";
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
    const { result } = renderHook(() => useCanvasOverlayData({
      evaluation,
      elements,
      selectedElementId: null,
      activePointPickTarget: target,
      commandLineSession: session,
      commandLinePickParentGroupId: "group",
      viewportSize: { width: 500, height: 400 },
      canvasViewport: DEFAULT_CANVAS_VIEWPORT,
      documentPath: null
    }));

    expect(result.current.overlayPointPickCandidates.map((candidate) => candidate.anchor)).toEqual([
      { mode: "reference", pointId: "first-point" }
    ]);
  });
});
