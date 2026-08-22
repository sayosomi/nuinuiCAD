import { describe, expect, it } from "vitest";
import type { GroupElement } from "../types/geometry";
import {
  DrawingModifierInspectionDecodeError,
  evaluationPayloadToResult,
  evaluationResultToPayload,
  type EvaluationPayload
} from "./evaluationPayload";
import { evaluateElements } from "./evaluate";
import { effectiveDrawingModifierResolutionsFromResult } from "../model/drawingModifierInspection";

const groupElement = (): GroupElement => ({
  id: "group",
  name: "group",
  type: "group",
  activity: "visible",
  modifierNames: ["detail"]
});

describe("Drawing Modifier inspection evaluation payload", () => {
  it("round-trips winner-only metadata through the production JSON boundary", () => {
    const result = evaluateElements([groupElement()], {
      drawingModifiers: [{
        name: "detail",
        widthPx: 2,
        style: "dashed",
        profileDeltas: [{
          profileId: "profile-print",
          profileName: "print",
          widthPx: 5
        }]
      }],
      selectedDrawingProfileId: "profile-print"
    });

    const payload = evaluationResultToPayload(result);
    expect(payload.effectiveDrawingModifierResolutions).toEqual([{
      elementId: "group",
      resolution: expect.objectContaining({
        widthPx: {
          value: 5,
          winner: {
            ownerElementId: "group",
            modifierName: "detail",
            selectedProfileDelta: {
              profileId: "profile-print",
              profileName: "print"
            }
          }
        },
        style: {
          value: "dashed",
          winner: {
            ownerElementId: "group",
            modifierName: "detail",
            selectedProfileDelta: null
          }
        }
      })
    }]);

    const decoded = evaluationPayloadToResult(payload);
    expect(effectiveDrawingModifierResolutionsFromResult(decoded).get("group")?.widthPx).toEqual({
      value: 5,
      winner: {
        ownerElementId: "group",
        modifierName: "detail",
        selectedProfileDelta: {
          profileId: "profile-print",
          profileName: "print"
        }
      }
    });
  });

  it("fails closed on malformed Rust winner metadata", () => {
    const payload: EvaluationPayload = {
      computedGeometry: [],
      errors: [],
      warnings: [],
      evaluatedElementIds: [],
      evaluationLimitIndex: 0,
      effectiveVisibleElementIds: [],
      effectiveEnabledElementIds: [],
      effectiveDrawingModifierResolutions: [{
        elementId: "group",
        resolution: {
          state: { value: "visible", winner: null },
          widthPx: {
            value: 2,
            winner: {
              ownerElementId: "group",
              modifierName: "detail",
              selectedProfileDelta: { profileId: "profile-print" }
            }
          },
          style: { value: "solid", winner: null },
          color: { value: { kind: "themeRole", role: "foreground" }, winner: null }
        }
      } as never]
    };

    expect(() => evaluationPayloadToResult(payload)).toThrow(DrawingModifierInspectionDecodeError);
  });
});
