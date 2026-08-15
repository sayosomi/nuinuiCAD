import { describe, expect, it } from "vitest";
import type { CadElement } from "../types/geometry";
import {
  createDependencyIndex,
  getDependencyJumpTargets,
  getDependencySummary,
  getDirectChildren,
  getDirectParentIds
} from "./dependencies";
import { compileDslDocument } from "../dsl/dslDocument";
import { buildTextTemplateEntriesByElementId } from "../geometry/textTemplateRuntime";

const elements: CadElement[] = [
  {
    id: "a",
    name: "点A",
    type: "freePoint",
    activity: "visible",
    x: 0,
    y: 0
  },
  {
    id: "b",
    name: "点B",
    type: "offsetPoint",
    activity: "visible",
    fromPointId: "a",
    dx: 10,
    dy: 0
  },
  {
    id: "c",
    name: "点C",
    type: "polarOffsetPoint",
    activity: "visible",
    fromPointId: "b",
    angleDeg: 0,
    distance: 10
  },
  {
    id: "ab",
    name: "線AB",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "reference", pointId: "b" }
  },
  {
    id: "bc",
    name: "線BC",
    type: "line",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "b" },
    endPoint: { mode: "reference", pointId: "c" }
  }
];

describe("dependencies", () => {
  it("returns direct parent ids by element type", () => {
    expect(getDirectParentIds(elements[0])).toEqual([]);
    expect(getDirectParentIds(elements[1])).toEqual(["a"]);
    expect(getDirectParentIds(elements[3])).toEqual(["a", "b"]);
  });

  it("uses compiled templates to exclude literals and typed holes from text geometry parents", () => {
    const compiled = compileDslDocument([
      "nui 4",
      "const length: number = 12.3456",
      'const label: string = "前身頃"',
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: @length, y: 0)",
      "line AB = segment(start: @A, end: @B, id: AB)",
      'text Label = label(text: "\\{draft\\} ${@label} ${@length}", anchor: none, size: 3)',
      'text Geometry = label(text: "length=${@AB.length}", anchor: none, size: 3)'
    ].join("\n"), {
      assignedStatementIds: new Map([
        [1, "test:length"],
        [2, "test:label"]
      ])
    });
    expect(compiled.diagnostics).toEqual([]);
    const compiledElements = compiled.document!.elements;
    const templates = buildTextTemplateEntriesByElementId({
      textTemplates: compiled.textTemplates!,
      elementIdByStatementIndex: compiled.statementMap!.elementIdByStatementIndex
    });
    const label = compiledElements.find((element) => element.name === "Label")!;
    const geometry = compiledElements.find((element) => element.name === "Geometry")!;
    const line = compiledElements.find((element) => element.name === "AB")!;

    expect(getDirectParentIds(label, { textTemplatesByElementId: templates })).toEqual([]);
    expect(createDependencyIndex(compiledElements, { textTemplatesByElementId: templates })
      .parentIdsByElementId.get(label.id)).toEqual([]);
    expect(getDirectParentIds(geometry, { textTemplatesByElementId: templates })).toEqual([line.id]);
  });

  it("returns Bezier curve point references as direct parent ids", () => {
    const curve: CadElement = {
      id: "curve",
      name: "曲線",
      type: "bezierCurve",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "a" },
      startHandleAngleDeg: 0,
      startHandleLength: 20,
      intermediatePoints: [
        {
          id: "mid-1",
          point: { mode: "reference", pointId: "b" },
          handleAngleDeg: 0,
          incomingHandleLength: 10,
          outgoingHandleLength: 10
        }
      ],
      endPoint: { mode: "reference", pointId: "c" },
      endHandleAngleDeg: 0,
      endHandleLength: 20
    };

    expect(getDirectParentIds(curve)).toEqual(["a", "b", "c"]);
  });

  it("returns Bezier extreme point line and numeric expression references", () => {
    const extreme: CadElement = {
      id: "extreme",
      name: "方向極値点",
      type: "bezierExtremePoint",
      activity: "visible",
      baseLineId: "curve",
      segmentIndex: { kind: "expression", expression: "ab.length" },
      directionDeg: { kind: "expression", expression: "bc.startAngleDeg" }
    };

    expect(getDirectParentIds(extreme)).toEqual(["curve", "ab", "bc"]);
  });

  it("returns Bezier bulge point line and numeric expression references", () => {
    const bulge: CadElement = {
      id: "bulge",
      name: "最大膨らみ点",
      type: "bezierBulgePoint",
      activity: "visible",
      baseLineId: "curve",
      segmentIndex: { kind: "expression", expression: "ab.length" }
    };

    expect(getDirectParentIds(bulge)).toEqual(["curve", "ab"]);
  });

  it("returns arc line center and numeric expression references as direct parent ids", () => {
    const arc: CadElement = {
      id: "arc",
      name: "円弧",
      type: "arcLine",
      activity: "visible",
      centerPoint: { mode: "reference", pointId: "a" },
      radius: { kind: "expression", expression: "bc.length" },
      startAngleDeg: 0,
      endAngleDeg: { kind: "expression", expression: "ab.startAngleDeg + 90" }
    };

    expect(getDirectParentIds(arc)).toEqual(["a", "bc", "ab"]);
  });

  it("returns image origin and numeric expression references as direct parent ids", () => {
    const image: CadElement = {
      id: "image",
      name: "画像",
      type: "image",
      activity: "visible",
      sourcePath: "underlay.png",
      originPoint: { mode: "reference", pointId: "a" },
      naturalWidthPx: 100,
      naturalHeightPx: 50,
      sourceDpi: 300,
      targetPixelsPerMm: 10,
      scale: { kind: "expression", expression: "ab.length / 100" },
      angleDeg: { kind: "expression", expression: "bc.startAngleDeg" },
      mirrorX: false
    };

    expect(getDirectParentIds(image)).toEqual(["a", "ab", "bc"]);
  });

  it("returns conditional group comparison expression references as direct parent ids", () => {
    const group: CadElement = {
      id: "if",
      name: "分岐",
      type: "conditionalGroup",
      activity: "visible",
      condition: { kind: "expression", expression: "ab.length >= 100  ||  bc.length >= 100" },
    };

    expect(getDirectParentIds(group)).toEqual(["ab", "bc"]);
  });

  it("returns three-point arc point and numeric expression references as direct parent ids", () => {
    const arc: CadElement = {
      id: "three-point-arc",
      name: "三点円弧",
      type: "threePointArcLine",
      activity: "visible",
      point1: { mode: "reference", pointId: "a" },
      point2: { mode: "reference", pointId: "b" },
      point3: { mode: "reference", pointId: "c" },
      startAngleDeg: { kind: "expression", expression: "ab.startAngleDeg" },
      endAngleDeg: { kind: "expression", expression: "bc.endAngleDeg" }
    };

    expect(getDirectParentIds(arc)).toEqual(["a", "b", "c", "ab", "bc"]);
  });

  it("returns division point endpoints and active numeric expression references as direct parent ids", () => {
    const point: CadElement = {
      id: "division",
      name: "分点",
      type: "divisionPoint",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "a" },
      endPoint: { mode: "reference", pointId: "b" },
      placement: { kind: "ratio", value: { kind: "expression", expression: "ab.length / 100" } }
    };

    expect(getDirectParentIds(point)).toEqual(["a", "b", "ab"]);
  });

  it("returns line division point endpoint and active numeric expression references as direct parent ids", () => {
    const point: CadElement = {
      id: "line-division",
      name: "線上分点",
      type: "lineDivisionPoint",
      activity: "visible",
      endpoint: { lineId: "ab", endpointKey: "start" },
      placement: { kind: "distance", value: { kind: "expression", expression: "bc.length / 2" } }
    };

    expect(getDirectParentIds(point)).toEqual(["ab", "bc"]);
  });

  it("returns intersection point line references and index expression references as direct parent ids", () => {
    const point: CadElement = {
      id: "intersection",
      name: "交点",
      type: "intersectionPoint",
      activity: "visible",
      line1Id: "ab",
      line2Id: "bc",
      intersectionIndex: { kind: "expression", expression: "cd.length / 100" },
      useExtensions: false
    };

    expect(getDirectParentIds(point)).toEqual(["ab", "bc", "cd"]);
  });

  it("returns line tangent offset point line, point, and numeric expression references as direct parent ids", () => {
    const point: CadElement = {
      id: "line-tangent-offset",
      name: "線上オフセット点",
      type: "lineTangentOffsetPoint",
      activity: "visible",
      baseLineId: "ab",
      basePoint: { mode: "reference", pointId: "b" },
      tangentAngleDeg: { kind: "expression", expression: "bc.startAngleDeg" },
      distance: { kind: "expression", expression: "cd.length / 2" }
    };

    expect(getDirectParentIds(point)).toEqual(["ab", "b", "bc", "cd"]);
  });

  it("returns edge endpoint and index expression references as direct parent ids", () => {
    const edge: CadElement = {
      id: "edge",
      name: "エッジ",
      type: "edge",
      activity: "visible",
      endpoint1: { lineId: "ab", endpointKey: "end" },
      endpoint2: { lineId: "bc", endpointKey: "start" },
      intersectionIndex: { kind: "expression", expression: "cd.length / 100" }
    };

    expect(getDirectParentIds(edge)).toEqual(["ab", "bc", "cd"]);
  });

  it("returns extend trim endpoint and point references as direct parent ids", () => {
    const extendTrim: CadElement = {
      id: "extend",
      name: "延長短縮",
      type: "extendTrim",
      activity: "visible",
      endpoint: { lineId: "ab", endpointKey: "end" },
      point: { mode: "reference", pointId: "c" }
    };

    expect(getDirectParentIds(extendTrim)).toEqual(["ab", "c"]);
  });

  it("returns the pathReverse target line as its direct parent id", () => {
    const pathReverse: CadElement = {
      id: "reverse",
      name: "",
      type: "pathReverse",
      activity: "visible",
      targetLineId: "ab"
    };

    expect(getDirectParentIds(pathReverse)).toEqual(["ab"]);
  });

  it("returns move point, angle, and target line references as direct parent ids", () => {
    const move: CadElement = {
      id: "move",
      name: "移動",
      type: "move",
      activity: "visible",
      startPoint: { mode: "reference", pointId: "a" },
      endPoint: { mode: "reference", pointId: "b" },
      scale: { kind: "expression", expression: "ef.length / 10" },
      angleDeg: { kind: "expression", expression: "cd.startAngleDeg" },
      mirrorX: false,
      baseLineIds: ["ab", "bc"]
    };

    expect(getDirectParentIds(move)).toEqual(["a", "b", "ef", "cd", "ab", "bc"]);
  });

  it("returns symmetric move axis and target line references as direct parent ids", () => {
    const move: CadElement = {
      id: "symmetric-move",
      name: "対称移動",
      type: "symmetricMove",
      activity: "visible",
      axisPoint1: { mode: "reference", pointId: "a" },
      axisPoint2: { mode: "reference", pointId: "b" },
      baseLineIds: ["ab", "bc"]
    };

    expect(getDirectParentIds(move)).toEqual(["a", "b", "ab", "bc"]);
  });

  it("returns direct coordinate expression references as parent ids", () => {
    const directLine: CadElement = {
      id: "direct",
      name: "直接線",
      type: "line",
      activity: "visible",
      startPoint: { mode: "coordinate", x: { kind: "expression", expression: "bc.length" }, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };

    expect(getDirectParentIds(directLine)).toEqual(["bc"]);
  });

  it("returns derived point references as direct parent ids", () => {
    const derivedLine: CadElement = {
      id: "derived",
      name: "派生線",
      type: "line",
      activity: "visible",
      startPoint: { mode: "derived", elementId: "ab", pointKey: "start" },
      endPoint: { mode: "derived", elementId: "bc", pointKey: "end" }
    };

    expect(getDirectParentIds(derivedLine)).toEqual(["ab", "bc"]);
  });

  it("returns derived base point references for offset points", () => {
    const derivedOffset: CadElement = {
      id: "derived-offset",
      name: "派生オフセット",
      type: "offsetPoint",
      activity: "visible",
      fromPoint: { mode: "derived", elementId: "ab", pointKey: "end" },
      dx: 10,
      dy: 0
    };

    expect(getDirectParentIds(derivedOffset)).toEqual(["ab"]);
  });

  it("returns direct children", () => {
    expect(getDirectChildren("b", elements).map((element) => element.id)).toEqual([
      "c",
      "ab",
      "bc"
    ]);
  });

  it("returns direct children from a shared dependency index", () => {
    const index = createDependencyIndex(elements);

    expect(getDirectChildren("b", elements, index).map((element) => element.id)).toEqual([
      "c",
      "ab",
      "bc"
    ]);
  });

  it("summarizes direct relationships and recursive counts without duplicates", () => {
    const summary = getDependencySummary(elements[4], elements);

    expect(summary.parents.map((parent) => parent.element?.id)).toEqual(["b", "c"]);
    expect(summary.parents.map((parent) => parent.ancestorCount)).toEqual([1, 2]);
    expect(summary.children).toEqual([]);
    expect(summary.ancestorCount).toBe(3);
    expect(summary.descendantCount).toBe(0);
  });

  it("summarizes relationships from a shared dependency index", () => {
    const index = createDependencyIndex(elements);
    const summary = getDependencySummary(elements[4], elements, index);

    expect(summary.parents.map((parent) => parent.element?.id)).toEqual(["b", "c"]);
    expect(summary.parents.map((parent) => parent.ancestorCount)).toEqual([1, 2]);
    expect(summary.children).toEqual([]);
    expect(summary.ancestorCount).toBe(3);
    expect(summary.descendantCount).toBe(0);
  });

  it("summarizes child descendant counts per direct child without duplicates", () => {
    const summary = getDependencySummary(elements[1], elements);

    expect(summary.children.map((child) => child.element.id)).toEqual(["c", "ab", "bc"]);
    expect(summary.children.map((child) => child.descendantCount)).toEqual([1, 0, 0]);
    expect(summary.descendantCount).toBe(3);
  });

  it("keeps missing direct references visible but out of jump targets", () => {
    const broken: CadElement = {
      id: "broken",
      name: "壊れた点",
      type: "offsetPoint",
      activity: "visible",
      fromPointId: "missing",
      dx: 0,
      dy: 0
    };
    const summary = getDependencySummary(broken, [...elements, broken]);

    expect(summary.parents).toEqual([{ id: "missing", element: null, ancestorCount: 0 }]);
    expect(getDependencyJumpTargets(broken, [...elements, broken])).toEqual([]);
  });

  it("orders jump targets as direct parents then direct children", () => {
    expect(getDependencyJumpTargets(elements[1], elements).map((element) => element.id)).toEqual([
      "a",
      "c",
      "ab",
      "bc"
    ]);
  });

  it("orders jump targets from a shared dependency index", () => {
    const index = createDependencyIndex(elements);

    expect(getDependencyJumpTargets(elements[1], elements, index).map((element) => element.id)).toEqual([
      "a",
      "c",
      "ab",
      "bc"
    ]);
  });
});
