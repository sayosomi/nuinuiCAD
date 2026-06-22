import { describe, expect, it } from "vitest";
import { sampleElements } from "../sampleData";
import type { CadElement } from "../types/geometry";
import { elementSearchResults } from "./elementSearch";

describe("elementSearchResults", () => {
  it("matches element names, ids, type labels, and document indexes", () => {
    expect(elementSearchResults(sampleElements, "点B").map((result) => result.element.id)).toEqual([
      "point-b"
    ]);
    expect(elementSearchResults(sampleElements, "line-ab").map((result) => result.element.id)).toEqual([
      "line-ab"
    ]);
    expect(elementSearchResults(sampleElements, "曲線").map((result) => result.element.id)).toEqual([
      "curve-ac"
    ]);
    expect(elementSearchResults(sampleElements, "4").map((result) => result.element.id)).toEqual([
      "line-ab"
    ]);
  });

  it("uses AND matching and preserves document order", () => {
    expect(elementSearchResults(sampleElements, "point b").map((result) => result.element.id)).toEqual([
      "point-b"
    ]);
    expect(elementSearchResults(sampleElements, "point").map((result) => result.element.id)).toEqual([
      "point-a",
      "point-b",
      "point-c"
    ]);
  });

  it("matches parent group names and returns the group path", () => {
    const elements: CadElement[] = [
      {
        id: "group-front",
        name: "前身頃",
        type: "group",
        visible: true,
        enabled: true,
        expanded: false
      },
      { ...sampleElements[0], parentGroupId: "group-front" }
    ];

    expect(elementSearchResults(elements, "前身頃 点A")).toEqual([
      {
        element: elements[1],
        index: 1,
        parentGroupNames: ["前身頃"]
      }
    ]);
  });
});
