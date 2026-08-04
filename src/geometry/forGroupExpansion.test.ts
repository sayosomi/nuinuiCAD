import { describe, expect, it } from "vitest";
import type { CadElement, ForGroupElement } from "../types/geometry";
import { expandForGroupIteration } from "./forGroupExpansion";

// 04/05: DivisionPlacement characterization。expandForGroupIterationは専用のforGroup clone
// pathを持たず、structuredClone + remapElementReferencesでtemplate要素全体を複製する。
// つまりplacementの値はiterationごとに無条件で複製される。

const forGroup: ForGroupElement = {
  id: "loop",
  name: "Loop",
  type: "forGroup",
  activity: "visible",
  variableName: "i",
  start: 0,
  count: 2,
  step: 1,
  showGenerated: true
};

const basePoints: CadElement[] = [
  { id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0 },
  { id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0 }
];

describe("expandForGroupIteration (DivisionPlacement characterization)", () => {
  it("clones divisionPoint placement verbatim across iterations", () => {
    const division: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      activity: "visible",
      parentGroupId: forGroup.id,
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" },
      placement: { kind: "distance", value: 7 }
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
        placement: { kind: "distance", value: 7 },
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      });
    }
  });

  it("clones lineDivisionPoint placement verbatim across iterations", () => {
    const line: CadElement = {
      id: "line-ab",
      name: "線AB",
      type: "line",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "point-a" },
      endPoint: { mode: "reference", pointId: "point-b" }
    };
    const division: CadElement = {
      id: "division",
      name: "線上分点",
      type: "lineDivisionPoint",
      activity: "visible",
      parentGroupId: forGroup.id,
      endpoint: { lineId: "line-ab", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.2 }
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
        placement: { kind: "ratio", value: 0.2 },
        // line-ab is a document-level sibling, not a forGroup descendant, so it is
        // outside the template idMap and its reference is left unchanged.
        endpoint: { lineId: "line-ab", endpointKey: "start" }
      });
    }
  });
});
