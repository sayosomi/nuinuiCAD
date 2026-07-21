import { describe, expect, it } from "vitest";
import type { CadElement, ForGroupElement } from "../types/geometry";
import { expandForGroupIteration } from "./forGroupExpansion";

// 04: DivisionPlacement characterization。expandForGroupIterationは専用のforGroup clone
// pathを持たず、structuredClone + remapElementReferencesでtemplate要素全体を複製する。
// つまりplacementModeに関わらずdistance/ratio両fieldが常に無条件でiterationごとに
// 複製される。05のunion移行前に、この現行挙動をロックする。

const forGroup: ForGroupElement = {
  id: "loop",
  name: "Loop",
  type: "forGroup",
  visible: true,
  enabled: true,
  variableName: "i",
  start: 0,
  count: 2,
  step: 1,
  showGenerated: true
};

const basePoints: CadElement[] = [
  { id: "point-a", name: "点A", type: "freePoint", visible: true, enabled: true, x: 0, y: 0 },
  { id: "point-b", name: "点B", type: "freePoint", visible: true, enabled: true, x: 10, y: 0 }
];

describe("expandForGroupIteration (DivisionPlacement characterization)", () => {
  it("clones divisionPoint distance/ratio/placementMode verbatim across iterations", () => {
    const division: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      visible: true,
      enabled: true,
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placementMode: "distance",
      distance: 7,
      ratio: 0.9
    };
    const elements = [...basePoints, forGroup, division];

    for (const iterationIndex of [0, 1]) {
      const { generatedElements } = expandForGroupIteration({
        elements,
        forGroup,
        iterationIndex,
        variableValue: iterationIndex
      });
      const generatedDivision = generatedElements.find((element) => element.type === "divisionPoint");

      expect(generatedDivision).toMatchObject({
        placementMode: "distance",
        distance: 7,
        ratio: 0.9,
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      });
    }
  });

  it("clones lineDivisionPoint distance/ratio/placementMode verbatim across iterations", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const division: CadElement = {
      id: "division",
      name: "線上分点",
      type: "lineDivisionPoint",
      visible: true,
      enabled: true,
      parentGroupId: forGroup.id,
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      placementMode: "ratio",
      distance: 40,
      ratio: 0.2
    };
    const elements = [...basePoints, line, forGroup, division];

    for (const iterationIndex of [0, 1]) {
      const { generatedElements } = expandForGroupIteration({
        elements,
        forGroup,
        iterationIndex,
        variableValue: iterationIndex
      });
      const generatedDivision = generatedElements.find((element) => element.type === "lineDivisionPoint");

      expect(generatedDivision).toMatchObject({
        placementMode: "ratio",
        distance: 40,
        ratio: 0.2,
        // line-ab is a document-level sibling, not a forGroup descendant, so it is
        // outside the template idMap and its reference is left unchanged.
        endpoint: { lineId: "line-ab", endpointKey: "start" }
      });
    }
  });
});
