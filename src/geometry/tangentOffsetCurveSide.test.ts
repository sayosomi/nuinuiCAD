import { describe, expect, it } from "vitest";
import type {
  BezierCurveElement,
  CadElement,
  FreePointElement,
  LineTangentOffsetPointElement
} from "../types/geometry";
import { evaluateElements } from "./evaluate";

const point = (id: string, x: number, y: number): FreePointElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const curve = (overrides: Partial<BezierCurveElement> = {}): BezierCurveElement => ({
  id: "curve",
  name: "曲線",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 90,
  startHandleLength: 10,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "b" },
  endHandleAngleDeg: 270,
  endHandleLength: 10,
  ...overrides
});

const tangent = (
  id: string,
  baseLineId: string,
  basePointId: string,
  curveSide: "convex" | "concave" | string,
  distance: number
): LineTangentOffsetPointElement => ({
  id,
  name: id,
  type: "lineTangentOffsetPoint",
  activity: "visible",
  baseLineId,
  basePoint: { mode: "reference", pointId: basePointId },
  tangentAngleDeg: 0,
  curveSide: curveSide as "convex" | "concave",
  distance
});

const standardCurveElements = (basePoint = point("base", 5, 7.5)): CadElement[] => [
  point("a", 0, 0),
  point("b", 10, 0),
  basePoint,
  curve(),
];

const pointResult = (result: ReturnType<typeof evaluateElements>, id: string) => {
  const geometry = result.computedGeometry.get(id);
  expect(geometry).toMatchObject({ kind: "point" });
  if (geometry?.kind !== "point") throw new Error(`expected point ${id}`);
  return geometry;
};

describe("tangentOffset curveSide", () => {
  it("places convex and concave offsets on opposite physical normals", () => {
    const result = evaluateElements([
      ...standardCurveElements(),
      tangent("convex", "curve", "base", "convex", 1),
      tangent("concave", "curve", "base", "concave", 1)
    ]);

    expect(result.errors).toEqual([]);
    expect(pointResult(result, "convex").x).toBeCloseTo(5, 10);
    expect(pointResult(result, "convex").y).toBeCloseTo(8.5, 10);
    expect(pointResult(result, "concave").x).toBeCloseTo(5, 10);
    expect(pointResult(result, "concave").y).toBeCloseTo(6.5, 10);
  });

  it("keeps the physical curve side after pathReverse", () => {
    const result = evaluateElements([
      ...standardCurveElements(),
      tangent("before", "curve", "base", "convex", 1),
      {
        id: "reverse",
        name: "",
        type: "pathReverse",
        activity: "visible",
        targetLineId: "curve"
      },
      tangent("after", "curve", "base", "convex", 1)
    ]);

    expect(result.errors).toEqual([]);
    const before = pointResult(result, "before");
    const after = pointResult(result, "after");
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it("accepts valid one-sided start and end endpoint curvature", () => {
    const result = evaluateElements([
      ...standardCurveElements(),
      tangent("startOffset", "curve", "a", "convex", 1),
      tangent("endOffset", "curve", "b", "concave", 1)
    ]);

    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get("startOffset")).toMatchObject({ kind: "point" });
    expect(result.computedGeometry.get("endOffset")).toMatchObject({ kind: "point" });
  });

  const joinedCurve = (sameCurvatureSide: boolean): CadElement[] => [
    point("a", 0, 0),
    point("m", 10, 0),
    point("b", 20, 0),
    point("base", 10, 0),
    curve({
      intermediatePoints: [{
        id: "middle-handle",
        point: { mode: "reference", pointId: "m" },
        handleAngleDeg: 90,
        incomingHandleLength: 5,
        outgoingHandleLength: 5
      }],
      endHandleAngleDeg: sameCurvatureSide ? 33.690067525979785 : 270,
      endHandleLength: sameCurvatureSide ? Math.sqrt(325) : 10
    })
  ];

  it("requires a unique physical side at a multi-segment internal join", () => {
    const valid = evaluateElements([
      ...joinedCurve(true),
      tangent("valid", "curve", "base", "concave", 1)
    ]);
    expect(valid.errors).toEqual([]);
    expect(pointResult(valid, "valid").x).toBeCloseTo(9, 10);

    const ambiguous = evaluateElements([
      ...joinedCurve(false),
      tangent("ambiguous", "curve", "base", "convex", 1)
    ]);
    expect(ambiguous.computedGeometry.has("ambiguous")).toBe(false);
    expect(ambiguous.errors[0]).toMatchObject({ elementId: "ambiguous" });
    expect(ambiguous.errors[0].message).toContain("曖昧な内部 join");
  });

  it.each([
    ["straight", curve({ startHandleAngleDeg: 0, startHandleLength: 10 / 3, endHandleAngleDeg: 180, endHandleLength: 10 / 3 }), point("base", 5, 0)],
    ["inflection", curve({ startHandleAngleDeg: 90, startHandleLength: 10, endHandleAngleDeg: 90, endHandleLength: 10 }), point("base", 5, 0)],
    ["near-flat", curve({ startHandleAngleDeg: 90, startHandleLength: 1e-10, endHandleAngleDeg: -270, endHandleLength: 1e-10 }), point("base", 5, 0)],
    ["zero-tangent", curve({ startHandleLength: 0 }), point("base", 0, 0)]
  ])("rejects %s curvature cases", (_label, baseCurve, basePoint) => {
    const result = evaluateElements([
      ...standardCurveElements(basePoint as FreePointElement).filter((element) => element.id !== "curve"),
      baseCurve as BezierCurveElement,
      tangent("offset", "curve", "base", "convex", 1)
    ]);
    expect(result.computedGeometry.has("offset")).toBe(false);
    expect(result.errors[0]).toMatchObject({ elementId: "offset" });
  });

  it("rejects invalid runtime literals, negative distance, and off-curve points", () => {
    const invalidLiteral = evaluateElements([
      ...standardCurveElements(),
      tangent("invalid", "curve", "base", "sideways", 1)
    ]);
    expect(invalidLiteral.errors[0].message).toContain("curveSide");

    const negative = evaluateElements([
      ...standardCurveElements(),
      tangent("negative", "curve", "base", "convex", -1)
    ]);
    expect(negative.errors[0].message).toContain("0以上");

    const offCurve = evaluateElements([
      ...standardCurveElements(point("off", 5, 8)),
      tangent("offCurve", "curve", "off", "convex", 1)
    ]);
    expect(offCurve.errors[0].message).toContain("曲線上にありません");
  });

  it("accepts zero distance only after validating a valid curvature frame", () => {
    const result = evaluateElements([
      ...standardCurveElements(),
      tangent("zero", "curve", "base", "convex", 0)
    ]);
    expect(result.errors).toEqual([]);
    expect(pointResult(result, "zero")).toMatchObject({ x: 5, y: 7.5 });
  });

  it("uses computed Bezier geometry from split, trim, extend, and reverse", () => {
    const splitBase = point("splitBase", 5, 22.5);
    const split = evaluateElements([
      ...standardCurveElements(splitBase).filter((element) => element.id !== "curve"),
      curve({ startHandleLength: 30, endHandleLength: 30 }),
      {
        id: "split",
        name: "分割曲線",
        type: "splitLine",
        activity: "visible",
        baseLineId: "curve",
        splitPoint: { mode: "reference", pointId: "splitBase" }
      },
      tangent("splitOffset", "split", "splitBase", "convex", 1)
    ]);
    expect(split.errors).toEqual([]);
    expect(split.computedGeometry.get("split")).toMatchObject({ kind: "bezierCurve" });
    expect(split.computedGeometry.get("splitOffset")).toMatchObject({ kind: "point" });

    const trimTarget = point("trimTarget", 5, 7.5);
    const trim = evaluateElements([
      ...standardCurveElements(trimTarget),
      {
        id: "trim",
        name: "短縮",
        type: "extendTrim",
        activity: "visible",
        endpoint: { lineId: "curve", endpointKey: "end" },
        point: { mode: "reference", pointId: "trimTarget" }
      },
      tangent("trimOffset", "curve", "trimTarget", "convex", 1)
    ]);
    expect(trim.errors).toEqual([]);
    expect(trim.computedGeometry.get("trimOffset")).toMatchObject({ kind: "point" });

    const extension = point("extension", 0, -10);
    const extended = evaluateElements([
      ...standardCurveElements(extension),
      {
        id: "extend",
        name: "延長",
        type: "extendTrim",
        activity: "visible",
        endpoint: { lineId: "curve", endpointKey: "start" },
        point: { mode: "reference", pointId: "extension" }
      },
      tangent("extendOffset", "curve", "extension", "convex", 1)
    ]);
    expect(extended.errors).toEqual([]);
    expect(extended.computedGeometry.get("extendOffset")).toMatchObject({ kind: "point" });
  });

  it("rejects curveSide on line, arc, and offsetLine computed geometry", () => {
    const line = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("base", 0, 0),
      { id: "line", name: "直線", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      tangent("lineOffset", "line", "base", "convex", 1)
    ]);
    expect(line.errors[0].message).toContain("ベジェ曲線");

    const arc = evaluateElements([
      point("center", 0, 0), point("base", 10, 0),
      { id: "arc", name: "円弧", type: "arcLine", activity: "visible", centerPoint: { mode: "reference", pointId: "center" }, radius: 10, startAngleDeg: 0, endAngleDeg: 90 },
      tangent("arcOffset", "arc", "base", "convex", 1)
    ]);
    expect(arc.errors[0].message).toContain("ベジェ曲線");

    const offsetLine = evaluateElements([
      point("a", 0, 0), point("b", 10, 0), point("base", 0, 1),
      { id: "line", name: "直線", type: "line", activity: "visible", startPoint: { mode: "reference", pointId: "a" }, endPoint: { mode: "reference", pointId: "b" } },
      { id: "offset", name: "オフセット線", type: "offsetLine", activity: "visible", baseLineIds: ["line"], offset: 1, side: "left", closed: false },
      tangent("offsetLinePoint", "offset", "base", "convex", 1)
    ]);
    expect(offsetLine.errors.some((error) => error.elementId === "offsetLinePoint" && error.message.includes("ベジェ曲線"))).toBe(true);
  });
});
