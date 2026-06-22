import { describe, expect, it } from "vitest";
import {
  fallbackElementName,
  formatReferenceOptionLabel,
  makeUniqueElementName
} from "./elementNames";
import type { CadElement } from "../types/geometry";

const elements: CadElement[] = [
  {
    id: "point-a",
    name: "点A",
    type: "freePoint",
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "point-b",
    name: "点A 2",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "point-a",
    dx: 10,
    dy: 0
  },
  {
    id: "line-a",
    name: "直線A",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "point-a" },
    endPoint: { mode: "reference", pointId: "point-b" }
  }
];

describe("elementNames", () => {
  it("keeps a name that is already unique", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "点C",
        fallbackBaseName: "点"
      })
    ).toBe("点C");
  });

  it("adds a suffix when the requested name is already used", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "点A",
        fallbackBaseName: "点"
      })
    ).toBe("点A 3");
  });

  it("does not treat the current element name as a duplicate", () => {
    expect(
      makeUniqueElementName({
        elements,
        elementId: "point-a",
        requestedName: "点A",
        fallbackBaseName: "点"
      })
    ).toBe("点A");
  });

  it("uses a fallback name for blank input", () => {
    expect(
      makeUniqueElementName({
        elements,
        requestedName: "   ",
        fallbackBaseName: "点"
      })
    ).toBe("点");
  });

  it("includes element type in reference option labels", () => {
    expect(formatReferenceOptionLabel(elements[1])).toBe("点A 2 - offset point");
  });

  it("has a fallback name for intersection points", () => {
    expect(fallbackElementName("intersectionPoint")).toBe("交点");
  });
});
