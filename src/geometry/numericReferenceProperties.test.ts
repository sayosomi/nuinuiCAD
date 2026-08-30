import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedLine,
  ComputedOffsetLine,
  ComputedPoint,
  ComputedPolyline
} from "../types/geometry";
import {
  angleNumericParameterStepLevels,
  ratioNumericParameterStepLevels
} from "../parameters/parameterDefinitions";
import {
  initialNumericReferencePickProperty,
  numericReferenceGeometrySupportsProperty,
  numericReferencePickProperties,
  numericReferencePropertiesForElement,
  numericReferencePropertiesForGeometry
} from "./numericReferenceProperties";

const point = (id: string, x = 0, y = 0): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

const line: ComputedLine = {
  kind: "line",
  elementId: "line",
  name: "直線",
  startPointId: "a",
  endPointId: "b",
  start: point("a"),
  end: point("b", 10),
  length: 10,
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
};

const arc: ComputedArcLine = {
  kind: "arcLine",
  elementId: "arc",
  name: "円弧",
  centerPointId: "a",
  center: point("a"),
  start: point("arc:start", 10),
  end: point("arc:end", 0, 10),
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90,
  startTangentAngleDeg: 90,
  endTangentAngleDeg: 270,
  sweepAngleDeg: 90,
  length: Math.PI * 5
};

const curve: ComputedBezierCurve = {
  kind: "bezierCurve",
  elementId: "curve",
  name: "曲線",
  startPointId: "a",
  endPointId: "b",
  intermediatePointIds: [],
  segments: [
    {
      startPointId: "a",
      endPointId: "b",
      start: point("a"),
      control1: { x: 10, y: 0 },
      control2: { x: 20, y: 0 },
      end: point("b", 30)
    }
  ],
  length: 30,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180,
  startHandleAngleDeg: 0,
  startHandleLength: 10,
  endHandleAngleDeg: 180,
  endHandleLength: 10
};

const offsetLine: ComputedOffsetLine = {
  kind: "offsetLine",
  elementId: "offset",
  name: "オフセット線",
  baseLineIds: ["line"],
  start: point("offset:start"),
  end: point("offset:end", 10),
  segments: [{ kind: "line", start: point("offset:start"), end: point("offset:end", 10), length: 10 }],
  closed: false,
  length: 10,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
};

const polyline: ComputedPolyline = {
  kind: "polyline",
  elementId: "polyline",
  name: "ポリライン",
  segments: [{ kind: "line", start: point("polyline:start"), end: point("polyline:end", 10), length: 10 }],
  closed: false,
  start: point("polyline:start"),
  end: point("polyline:end", 10),
  length: 10,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
};

const baseElement = {
  id: "element",
  name: "要素",
  activity: "visible" as const
};

describe("numericReferenceProperties", () => {
  it("lists computed geometry reference properties by geometry kind", () => {
    expect(numericReferencePropertiesForGeometry(line)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferencePropertiesForGeometry(arc)).toEqual([
      "length",
      "startAngleDeg",
      "endAngleDeg",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferencePropertiesForGeometry(curve)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg",
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength"
    ]);
    expect(numericReferencePropertiesForGeometry(offsetLine)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
    expect(numericReferencePropertiesForGeometry(polyline)).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg"
    ]);
  });

  it("lists static element reference properties where element type is enough", () => {
    const cases: Array<[CadElement, readonly string[]]> = [
      [{ ...baseElement, type: "line", startPoint: { mode: "coordinate", x: 0, y: 0 }, endPoint: { mode: "coordinate", x: 10, y: 0 } }, ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"]],
      [{ ...baseElement, type: "arcLine", centerPoint: { mode: "coordinate", x: 0, y: 0 }, radius: 10, startAngleDeg: 0, endAngleDeg: 90 }, ["length", "startAngleDeg", "endAngleDeg", "startTangentAngleDeg", "endTangentAngleDeg"]],
      [{ ...baseElement, type: "bezierCurve", startPoint: { mode: "coordinate", x: 0, y: 0 }, startHandleAngleDeg: 0, startHandleLength: 10, intermediatePoints: [], endPoint: { mode: "coordinate", x: 10, y: 0 }, endHandleAngleDeg: 180, endHandleLength: 10 }, ["length", "startTangentAngleDeg", "endTangentAngleDeg", "startHandleAngleDeg", "startHandleLength", "endHandleAngleDeg", "endHandleLength"]],
      [{ ...baseElement, type: "offsetLine", baseLineIds: ["line"], offset: 10, side: "right", closed: false }, ["length", "startTangentAngleDeg", "endTangentAngleDeg"]],
      [{ ...baseElement, type: "copyLine", startPoint: { mode: "coordinate", x: 0, y: 0 }, endPoint: { mode: "coordinate", x: 10, y: 0 }, scale: 1, angleDeg: 0, mirrorX: false, baseLineIds: ["line"] }, ["length", "startTangentAngleDeg", "endTangentAngleDeg"]],
      [{ ...baseElement, type: "symmetricCopyLine", axisPoint1: { mode: "coordinate", x: 0, y: 0 }, axisPoint2: { mode: "coordinate", x: 0, y: 10 }, baseLineIds: ["line"] }, ["length", "startTangentAngleDeg", "endTangentAngleDeg"]],
      [{ ...baseElement, type: "splitLine", baseLineId: "line", splitPoint: { mode: "coordinate", x: 5, y: 0 } }, []]
    ];

    for (const [element, expected] of cases) {
      expect(numericReferencePropertiesForElement(element)).toEqual(expected);
    }
  });

  it("rejects unsupported properties for a computed geometry kind", () => {
    expect(numericReferenceGeometrySupportsProperty(curve, "startHandleLength")).toBe(true);
    expect(numericReferenceGeometrySupportsProperty(line, "startHandleLength")).toBe(false);
    expect(numericReferenceGeometrySupportsProperty(offsetLine, "startAngleDeg")).toBe(false);
  });

  it("keeps the keyboard-pick cycle broad enough for every supported measurement", () => {
    expect(numericReferencePickProperties).toEqual([
      "length",
      "startTangentAngleDeg",
      "endTangentAngleDeg",
      "startAngleDeg",
      "endAngleDeg",
      "startHandleAngleDeg",
      "startHandleLength",
      "endHandleAngleDeg",
      "endHandleLength"
    ]);
  });

  it("starts an angle-shaped target parameter on an angle measurement instead of length", () => {
    expect(initialNumericReferencePickProperty(angleNumericParameterStepLevels)).toBe("startTangentAngleDeg");
  });

  it("keeps length as the default for non-angle target parameters", () => {
    expect(initialNumericReferencePickProperty(ratioNumericParameterStepLevels)).toBe("length");
    expect(initialNumericReferencePickProperty(undefined)).toBe("length");
  });

  it("chooses a default that every NumericReferenceGeometry kind actually supports", () => {
    for (const geometry of [line, arc, curve, offsetLine, polyline]) {
      expect(numericReferenceGeometrySupportsProperty(geometry, initialNumericReferencePickProperty(undefined))).toBe(true);
      expect(
        numericReferenceGeometrySupportsProperty(geometry, initialNumericReferencePickProperty(angleNumericParameterStepLevels))
      ).toBe(true);
    }
  });
});
