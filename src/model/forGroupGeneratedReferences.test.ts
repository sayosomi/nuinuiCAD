import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  generatedElementIdForTargetForGroup,
  isValidPickedPointAnchorForTarget,
  parseForGroupGeneratedElementId,
  pickedPointAnchorForTargetForGroup
} from "./forGroupGeneratedReferences";

const elements: CadElement[] = [
  {
    id: "loop",
    name: "繰り返し",
    type: "forGroup",
    visible: true,
    enabled: true,
    variableName: "i",
    start: 0,
    count: 3,
    step: 1,
    showGenerated: true
  },
  {
    id: "point-template",
    name: "点テンプレート",
    type: "freePoint",
    visible: true,
    enabled: true,
    parentGroupId: "loop",
    x: 0,
    y: 0
  },
  {
    id: "target",
    name: "対象",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    parentGroupId: "loop",
    fromPoint: { mode: "reference", pointId: "point-template" },
    dx: 10,
    dy: 0
  },
  {
    id: "outside",
    name: "外側",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 10,
    y: 10
  }
];

describe("forGroupGeneratedReferences", () => {
  it("parses generated for group element ids", () => {
    expect(parseForGroupGeneratedElementId("point-template@loop:12")).toEqual({
      forGroupId: "loop",
      templateElementId: "point-template",
      iterationIndex: 12
    });
    expect(parseForGroupGeneratedElementId("point-template")).toBeNull();
  });

  it("maps generated ids back to templates for targets inside the same for group", () => {
    expect(
      generatedElementIdForTargetForGroup({
        elements,
        targetElementId: "target",
        pickedElementId: "point-template@loop:2"
      })
    ).toBe("point-template");
  });

  it("rejects generated ids for targets outside the owning for group", () => {
    expect(
      generatedElementIdForTargetForGroup({
        elements,
        targetElementId: "outside",
        pickedElementId: "point-template@loop:2"
      })
    ).toBeNull();
  });

  it("maps generated point anchors back to template anchors", () => {
    expect(
      pickedPointAnchorForTargetForGroup({
        elements,
        targetElementId: "target",
        anchor: { mode: "reference", pointId: "point-template@loop:2" }
      })
    ).toEqual({ mode: "reference", pointId: "point-template" });
  });

  it("keeps a virtual target separate from the child borrowed for forGroup normalization", () => {
    expect(
      isValidPickedPointAnchorForTarget({
        elements,
        targetElementId: "__command-line__",
        normalizationTargetElementId: "point-template",
        anchor: { mode: "reference", pointId: "point-template" },
        allowLineEndpoint: false
      })
    ).toBe(true);
    expect(
      isValidPickedPointAnchorForTarget({
        elements,
        targetElementId: "__command-line__",
        normalizationTargetElementId: "point-template",
        anchor: { mode: "reference", pointId: "point-template@loop:1" },
        allowLineEndpoint: false
      })
    ).toBe(true);
  });

  it("still rejects a normal target's own point anchor", () => {
    expect(
      isValidPickedPointAnchorForTarget({
        elements,
        targetElementId: "target",
        anchor: { mode: "reference", pointId: "target" },
        allowLineEndpoint: false
      })
    ).toBe(false);
  });
});
