import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import { duplicateElements } from "./elementDuplication";

const createId = (type: CadElement["type"]) => `${type}-copy`;

describe("duplicateElements", () => {
  it("duplicates a single element after the selected element", () => {
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 20
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        x: 30,
        y: 40
      }
    ];

    const change = duplicateElements(elements, ["point-a"], { createId });

    expect(change?.elements.map((element) => element.id)).toEqual([
      "point-a",
      "freePoint-copy",
      "point-b"
    ]);
    expect(change?.elements[1]).toMatchObject({
      id: "freePoint-copy",
      name: "点A コピー",
      type: "freePoint",
      x: 10,
      y: 20
    });
    expect(change?.selectedElementIds).toEqual(["freePoint-copy"]);
    expect(change?.selectedElementId).toBe("freePoint-copy");
  });

  it("keeps a duplicated pathReverse element's name empty instead of generating a copy label", () => {
    const elements: CadElement[] = [
      {
        id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0
      },
      {
        id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0
      },
      {
        id: "line-ab", name: "線AB", type: "line", activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "reverse", name: "", type: "pathReverse", activity: "visible", targetLineId: "line-ab"
      }
    ];

    const change = duplicateElements(elements, ["reverse"], { createId });

    expect(change?.elements.find((element) => element.id === "pathReverse-copy")).toMatchObject({
      id: "pathReverse-copy",
      name: "",
      type: "pathReverse",
      // Not selected alongside the mutation, so the target reference is left
      // pointing at the original line (mirrors forGroup's mapId semantics).
      targetLineId: "line-ab"
    });
  });

  it("remaps references inside the duplicated selection only", () => {
    const ids = ["point-a-copy", "line-ab-copy"];
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 20
      },
      {
        id: "point-b",
        name: "点B",
        type: "freePoint",
        activity: "visible",
        x: 30,
        y: 40
      },
      {
        id: "line-ab",
        name: "直線AB",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" },
        numericVariables: [{
          id: "local",
          name: "補正",
          value: { kind: "expression", expression: "distance(point-a, point-b)" }
        }]
      }
    ];

    const change = duplicateElements(elements, ["point-a", "line-ab"], {
      createId: () => ids.shift() ?? "unexpected"
    });
    const copiedLine = change?.elements.find((element) => element.id === "line-ab-copy");

    expect(copiedLine).toMatchObject({
      type: "line",
      startPoint: { mode: "reference", pointId: "point-a-copy" },
      endPoint: { mode: "reference", pointId: "point-b" },
      numericVariables: [{
        id: "local",
        value: { kind: "expression", expression: "distance(point-a-copy, point-b)" }
      }]
    });
  });

  it("remaps image origin and numeric expressions inside the duplicated selection", () => {
    const ids = ["point-a-copy", "image-copy"];
    const elements: CadElement[] = [
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        x: 10,
        y: 20
      },
      {
        id: "image",
        name: "下絵",
        type: "image",
        activity: "visible",
        sourcePath: "underlay.png",
        originPoint: { mode: "reference", pointId: "point-a" },
        naturalWidthPx: 300,
        naturalHeightPx: 200,
        sourceDpi: 300,
        targetPixelsPerMm: 10,
        scale: { kind: "expression", expression: "distance(point-a, point-a)" },
        angleDeg: 0,
        mirrorX: false
      }
    ];

    const change = duplicateElements(elements, ["point-a", "image"], {
      createId: () => ids.shift() ?? "unexpected"
    });
    const copiedImage = change?.elements.find((element) => element.id === "image-copy");

    expect(copiedImage).toMatchObject({
      type: "image",
      originPoint: { mode: "reference", pointId: "point-a-copy" },
      scale: { kind: "expression", expression: "distance(point-a-copy, point-a-copy)" }
    });
  });

  it("remaps copied element id references in numeric expressions", () => {
    const ids = ["line-copy", "point-copy"];
    const elements: CadElement[] = [
      {
        id: "anchor",
        name: "基準点",
        type: "freePoint",
        activity: "visible",
        x: 0,
        y: 0
      },
      {
        id: "other",
        name: "端点",
        type: "freePoint",
        activity: "visible",
        x: 50,
        y: 0
      },
      {
        id: "line",
        name: "寸法",
        type: "line",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "anchor" },
        endPoint: { mode: "reference", pointId: "other" }
      },
      {
        id: "point",
        name: "オフセット点",
        type: "offsetPoint",
        activity: "visible",
        fromPoint: { mode: "reference", pointId: "anchor" },
        fromPointId: "anchor",
        dx: { kind: "expression", expression: "@line.length" },
        dy: 0
      }
    ];

    const change = duplicateElements(elements, ["line", "point"], {
      createId: () => ids.shift() ?? "unexpected"
    });
    const copiedPoint = change?.elements.find((element) => element.id === "point-copy");

    expect(copiedPoint).toMatchObject({
      type: "offsetPoint",
      dx: { kind: "expression", expression: "@line-copy.length" }
    });
  });

  it("remaps Bezier extreme point source and numeric expressions", () => {
    const elements: CadElement[] = [
      {
        id: "curve",
        name: "曲線",
        type: "bezierCurve",
        activity: "visible",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        startHandleAngleDeg: 0,
        startHandleLength: 10,
        intermediatePoints: [],
        endPoint: { mode: "coordinate", x: 10, y: 0 },
        endHandleAngleDeg: 180,
        endHandleLength: 10
      },
      {
        id: "extreme",
        name: "方向極値点",
        type: "bezierExtremePoint",
        activity: "visible",
        baseLineId: "curve",
        segmentIndex: { kind: "expression", expression: "curve.length" },
        directionDeg: { kind: "expression", expression: "curve.startAngleDeg + 90" }
      }
    ];

    const change = duplicateElements(elements, ["curve", "extreme"], {
      createId: (type) => `${type}-copy`
    });
    const copied = change?.elements.find((element) => element.id === "bezierExtremePoint-copy");

    expect(copied).toMatchObject({
      type: "bezierExtremePoint",
      baseLineId: "bezierCurve-copy",
      segmentIndex: { kind: "expression", expression: "bezierCurve-copy.length" },
      directionDeg: { kind: "expression", expression: "bezierCurve-copy.startAngleDeg + 90" }
    });
  });

  it("duplicates a selected group with its descendants and remaps parent groups", () => {
    const ids = ["group-copy", "point-a-copy", "point-b-copy", "line-copy"];
    const elements: CadElement[] = [
      {
        id: "group",
        name: "前身頃",
        type: "group",
        activity: "visible",
      },
      {
        id: "point-a",
        name: "点A",
        type: "freePoint",
        activity: "visible",
        parentGroupId: "group",
        x: 10,
        y: 20
      },
      {
        id: "point-b",
        name: "点B",
        type: "offsetPoint",
        activity: "visible",
        parentGroupId: "group",
        fromPointId: "point-a",
        dx: 30,
        dy: 0
      },
      {
        id: "line",
        name: "線",
        type: "line",
        activity: "visible",
        parentGroupId: "group",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      }
    ];

    const change = duplicateElements(elements, ["group"], {
      createId: () => ids.shift() ?? "unexpected"
    });

    expect(change?.elements.map((element) => element.id)).toEqual([
      "group",
      "point-a",
      "point-b",
      "line",
      "group-copy",
      "point-a-copy",
      "point-b-copy",
      "line-copy"
    ]);
    expect(change?.elements.find((element) => element.id === "point-a-copy")).toMatchObject({
      parentGroupId: "group-copy"
    });
    expect(change?.elements.find((element) => element.id === "point-b-copy")).toMatchObject({
      parentGroupId: "group-copy",
      fromPointId: "point-a-copy"
    });
    expect(change?.elements.find((element) => element.id === "line-copy")).toMatchObject({
      parentGroupId: "group-copy",
      startPoint: { mode: "reference", pointId: "point-a-copy" },
      endPoint: { mode: "reference", pointId: "point-b-copy" }
    });
    expect(change?.selectedElementIds).toEqual([
      "group-copy",
      "point-a-copy",
      "point-b-copy",
      "line-copy"
    ]);
  });

  // 05: DivisionPlacement union. elementDuplication.ts clones the single
  // `placement.value` unconditionally (no kind-conditional branch needed, since
  // there is only one value slot now). This replaces the pre-union
  // characterization that both `distance` and `ratio` sibling fields survived
  // cloning regardless of which was active -- that dual-value state no longer
  // exists to preserve.
  it("clones the divisionPoint placement value verbatim", () => {
    const ids = ["point-a-copy", "point-b-copy", "division-copy"];
    const elements: CadElement[] = [
      { id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0 },
      {
        id: "division", name: "分点", type: "divisionPoint", activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" },
        placement: { kind: "distance", value: 7 }
      }
    ];

    const change = duplicateElements(elements, ["point-a", "point-b", "division"], {
      createId: () => ids.shift() ?? "unexpected"
    });
    const copied = change?.elements.find((element) => element.id === "division-copy");

    expect(copied).toMatchObject({
      type: "divisionPoint",
      startPoint: { mode: "reference", pointId: "point-a-copy" },
      endPoint: { mode: "reference", pointId: "point-b-copy" },
      placement: { kind: "distance", value: 7 }
    });
  });

  it("clones the lineDivisionPoint placement value verbatim", () => {
    const ids = ["point-a-copy", "point-b-copy", "line-copy", "division-copy"];
    const elements: CadElement[] = [
      { id: "point-a", name: "点A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "point-b", name: "点B", type: "freePoint", activity: "visible", x: 10, y: 0 },
      {
        id: "line-ab", name: "線AB", type: "line", activity: "visible",
        startPoint: { mode: "reference", pointId: "point-a" },
        endPoint: { mode: "reference", pointId: "point-b" }
      },
      {
        id: "division", name: "線上分点", type: "lineDivisionPoint", activity: "visible",
        endpoint: { lineId: "line-ab", endpointKey: "start" },
        placement: { kind: "ratio", value: 0.2 }
      }
    ];

    const change = duplicateElements(elements, ["point-a", "point-b", "line-ab", "division"], {
      createId: () => ids.shift() ?? "unexpected"
    });
    const copied = change?.elements.find((element) => element.id === "division-copy");

    expect(copied).toMatchObject({
      type: "lineDivisionPoint",
      endpoint: { lineId: "line-copy", endpointKey: "start" },
      placement: { kind: "ratio", value: 0.2 }
    });
  });
});
