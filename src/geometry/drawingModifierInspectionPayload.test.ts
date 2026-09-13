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
        lineType: "dashed",
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
        lineType: {
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
          visible: { value: true, winner: null },
          widthPx: {
            value: 2,
            winner: {
              ownerElementId: "group",
              modifierName: "detail",
              selectedProfileDelta: { profileId: "profile-print" }
            }
          },
          lineType: { value: "solid", winner: null },
          color: { value: { kind: "themeRole", role: "foreground" }, winner: null }
        }
      } as never]
    };

    expect(() => evaluationPayloadToResult(payload)).toThrow(DrawingModifierInspectionDecodeError);
  });

  it("round-trips explicit no-fill, fill opacity, and their winners strictly", () => {
    const result = evaluateElements([{
      ...groupElement(),
      modifierNames: ["base", "clear"]
    }], {
      drawingModifiers: [
        { name: "base", fill: { kind: "fixed", hex: "#123456" }, fillOpacity: 0.25 },
        { name: "clear", fill: { kind: "none" } }
      ]
    });
    const payload = evaluationResultToPayload(result);
    expect(payload.effectiveDrawingModifierResolutions?.[0]?.resolution.fill).toEqual({
      value: { kind: "none" },
      winner: { ownerElementId: "group", modifierName: "clear", selectedProfileDelta: null }
    });
    expect(payload.effectiveDrawingModifierResolutions?.[0]?.resolution.fillOpacity).toEqual({
      value: 0.25,
      winner: { ownerElementId: "group", modifierName: "base", selectedProfileDelta: null }
    });
    expect(evaluationPayloadToResult(payload).effectiveDrawingModifierResolutions?.get("group")).toEqual(
      result.effectiveDrawingModifierResolutions?.get("group")
    );
  });

  it("rejects malformed fill colors and out-of-range fill opacity at the payload boundary", () => {
    const baseline = evaluationResultToPayload(evaluateElements([groupElement()]));
    const resolution = {
      visible: { value: true, winner: null },
      widthPx: { value: 1, winner: null },
      lineType: { value: "solid" as const, winner: null },
      color: { value: { kind: "themeRole" as const, role: "foreground" as const }, winner: null },
      fill: { value: { kind: "fixed" as const, hex: "#12345" }, winner: null },
      fillOpacity: { value: 1.1, winner: null }
    };
    expect(() => evaluationPayloadToResult({
      ...baseline,
      effectiveDrawingModifierResolutions: [{ elementId: "group", resolution }]
    })).toThrow(DrawingModifierInspectionDecodeError);
  });
});
