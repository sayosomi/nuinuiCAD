import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedArcLine,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedOffsetLine,
  ComputedPolyline,
  ComputedPoint,
  EvaluationResult
} from "../types/geometry";
import {
  computedNumericReferenceValue,
  computedPathsForGeometry,
  formatValue,
  numericReferenceCandidates
} from "./numericReferencePaths";
import {
  computedReferencePathValue,
  numericComputedGeometryPropertiesFor,
  numericComputedGeometrySupportsProperty
} from "./numericExpressions";

const point = (id: string, x: number, y: number): ComputedPoint => ({
  kind: "point",
  elementId: id,
  name: id,
  x,
  y
});

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
    id: "curve",
    name: "曲線",
    type: "bezierCurve",
    activity: "visible",
    startPoint: { mode: "reference", pointId: "a" },
    startHandleAngleDeg: 15,
    startHandleLength: 20,
    intermediatePoints: [
      {
        id: "mid",
        point: { mode: "coordinate", x: 40, y: 10 },
        handleAngleDeg: 45,
        incomingHandleLength: 12,
        outgoingHandleLength: 18
      }
    ],
    endPoint: { mode: "coordinate", x: 80, y: 0 },
    endHandleAngleDeg: 165,
    endHandleLength: 25
  },
  {
    id: "target",
    name: "点T",
    type: "offsetPoint",
    activity: "visible",
    fromPointId: "a",
    dx: 0,
    dy: 0
  }
];

const curveGeometry: ComputedBezierCurve = {
  kind: "bezierCurve",
  elementId: "curve",
  name: "曲線",
  startPointId: "a",
  endPointId: null,
  intermediatePointIds: ["mid"],
  intermediateSlotIds: ["mid"],
  segments: [
    {
      startPointId: "a",
      endPointId: "mid",
      start: point("a", 0, 0),
      control1: { x: 20, y: 0 },
      control2: { x: 30, y: 10 },
      end: point("curve:intermediate:mid", 40, 10)
    },
    {
      startPointId: "mid",
      endPointId: null,
      start: point("curve:intermediate:mid", 40, 10),
      control1: { x: 50, y: 10 },
      control2: { x: 60, y: 0 },
      end: point("curve:end", 80, 0)
    }
  ],
  length: 84.25,
  startTangentAngleDeg: 15,
  endTangentAngleDeg: 345,
  startHandleAngleDeg: 15,
  startHandleLength: 20,
  endHandleAngleDeg: 165,
  endHandleLength: 25
};

const arcGeometry: ComputedArcLine = {
  kind: "arcLine",
  elementId: "arc",
  name: "円弧",
  centerPointId: "center",
  center: point("center", 0, 0),
  start: point("arc:start", 10, 0),
  end: point("arc:end", 0, 10),
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90,
  startTangentAngleDeg: 90,
  endTangentAngleDeg: 180,
  sweepAngleDeg: 90,
  length: Math.PI * 5
};

const evaluation: EvaluationResult = {
  computedGeometry: new Map<string, ComputedGeometry>([
    ["a", point("a", 0, 0)],
    ["curve", curveGeometry],
    ["target", point("target", 0, 0)]
  ]),
  errors: [],
  warnings: []
};

describe("numericReferencePaths", () => {
  it("formats numeric values with canonical property-aware units and preserved rounding", () => {
    expect(formatValue(12, "length")).toBe("12 mm");
    expect(formatValue(12.34567, "length")).toBe("12.346 mm");
    expect(formatValue(12.34567, "startAngleDeg")).toBe("12.346°");
    expect(formatValue(12.34567, "scale")).toBe("12.346");
    expect(formatValue(320, "naturalWidthPx")).toBe("320 px");
    expect(formatValue(240, "naturalHeightPx")).toBe("240 px");
    expect(formatValue(96, "sourceDpi")).toBe("96 dpi");
    expect(formatValue(3.7795, "targetPixelsPerMm")).toBe("3.78 px/mm");
    expect(formatValue(12.34567, "x")).toBe("12.346");
    expect(formatValue(12.34567, "intermediatePoints[1].x")).toBe("12.346");
    expect(formatValue(12.34567, "unclassifiedProperty")).toBe("12.346");
  });

  it("uses property-aware units for image metadata in numeric-reference candidates", () => {
    const imageElement: CadElement = {
      id: "image",
      name: "画像",
      type: "image",
      activity: "visible",
      sourcePath: "image.png",
      originPoint: { mode: "coordinate", x: 0, y: 0 },
      naturalWidthPx: 320,
      naturalHeightPx: 240,
      sourceDpi: 96,
      targetPixelsPerMm: 3.7795,
      scale: 1,
      angleDeg: 0,
      mirrorX: false
    };
    const imageGeometry: ComputedGeometry = {
      kind: "image",
      elementId: imageElement.id,
      name: imageElement.name,
      sourcePath: imageElement.sourcePath,
      origin: point("image:origin", 0, 0),
      naturalWidthPx: 320,
      naturalHeightPx: 240,
      sourceDpi: 96,
      targetPixelsPerMm: 3.7795,
      scale: 1,
      angleDeg: 0,
      mirrorX: false,
      widthMm: 84.667,
      heightMm: 63.5
    };
    const candidates = numericReferenceCandidates({
      elements: [imageElement],
      evaluation: {
        computedGeometry: new Map([[imageElement.id, imageGeometry]]),
        errors: [],
        warnings: []
      }
    });

    expect(candidates.find((candidate) => candidate.expression === "image.naturalWidthPx")).toMatchObject({
      valueLabel: "320 px"
    });
    expect(candidates.find((candidate) => candidate.expression === "image.sourceDpi")).toMatchObject({
      valueLabel: "96 dpi"
    });
    expect(candidates.find((candidate) => candidate.expression === "image.targetPixelsPerMm")).toMatchObject({
      valueLabel: "3.78 px/mm"
    });
    expect(candidates.find((candidate) => candidate.expression === "image.scale")).toMatchObject({
      valueLabel: "1"
    });
  });

  it("enumerates canonical properties from the resolved geometry family", () => {
    const arcProperties = numericComputedGeometryPropertiesFor(arcGeometry);
    expect(arcProperties).toEqual(expect.arrayContaining([
      "length",
      "radius",
      "sweepAngleDeg",
      "centerPoint.x",
      "startPoint.y",
      "endPoint.x"
    ]));
    expect(arcProperties).not.toContain("startHandleLength");
    expect(arcProperties.every((property) => typeof computedReferencePathValue(arcGeometry, property) === "number")).toBe(true);
    expect(numericComputedGeometrySupportsProperty(arcGeometry, "radius")).toBe(true);
    expect(numericComputedGeometrySupportsProperty(arcGeometry, "startHandleLength")).toBe(false);

    const curveProperties = numericComputedGeometryPropertiesFor(curveGeometry);
    expect(curveProperties).not.toContain("intermediatePoints[1].x");
    expect(curveProperties).not.toContain("intermediatePoints[1].y");
    expect(numericComputedGeometrySupportsProperty(curveGeometry, "intermediatePoints[1].x")).toBe(false);
    expect(numericComputedGeometrySupportsProperty(curveGeometry, "intermediatePoints[2].x")).toBe(false);
  });

  it("offers the canonical pi constant through the legacy numeric candidate path", () => {
    const candidate = numericReferenceCandidates({ elements, evaluation }).find((item) => item.expression === "pi");
    expect(candidate).toMatchObject({
      id: "function:pi",
      label: "pi",
      valueLabel: "3.142",
      insertable: true
    });
  });

  it("resolves Bezier handle and intermediate point reference values", () => {
    expect(computedNumericReferenceValue(curveGeometry, "startHandleAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(curveGeometry, "startHandleLength")).toBe(20);
    expect(computedNumericReferenceValue(curveGeometry, "endHandleAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(curveGeometry, "endHandleLength")).toBe(20);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].x")).toBe(40);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].y")).toBe(10);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].incomingHandleAngleDeg")).toBe(180);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].incomingHandleLength")).toBe(10);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].outgoingHandleAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].outgoingHandleLength")).toBe(10);
  });

  it("uses endpoint-to-interior direction semantics for every path family", () => {
    expect(computedNumericReferenceValue(arcGeometry, "startAngleDeg")).toBe(90);
    expect(computedNumericReferenceValue(arcGeometry, "endAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(arcGeometry, "startRadiusAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(arcGeometry, "endRadiusAngleDeg")).toBe(90);
    const fullTurn = {
      ...arcGeometry,
      end: point("arc:end", 10, 0),
      endAngleDeg: 360,
      sweepAngleDeg: 360
    };
    expect(computedNumericReferenceValue(fullTurn, "startRadiusAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(fullTurn, "endRadiusAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(fullTurn, "sweepAngleDeg")).toBe(360);
    expect(computedNumericReferenceValue(fullTurn, "startAngleDeg")).toBe(90);
    expect(computedNumericReferenceValue(fullTurn, "endAngleDeg")).toBe(270);
    expect(computedNumericReferenceValue(curveGeometry, "startAngleDeg")).toBe(0);
    expect(computedNumericReferenceValue(curveGeometry, "endAngleDeg")).toBe(180);

    const polyline: ComputedPolyline = {
      kind: "polyline",
      elementId: "closed",
      name: "閉じた折れ線",
      segments: [
        { kind: "line", start: point("p0", 0, 0), end: point("p0", 0, 0), length: 0 },
        { kind: "line", start: point("p0", 0, 0), end: point("p1", 0, 1), length: 1 },
        { kind: "line", start: point("p1", 0, 1), end: point("p2", 1, 1), length: 1 },
        { kind: "line", start: point("p2", 1, 1), end: point("p0", 0, 0), length: Math.SQRT2 }
      ],
      closed: true,
      start: point("p0", 0, 0),
      end: point("p0", 0, 0),
      length: 2 + Math.SQRT2,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };
    expect(computedNumericReferenceValue(polyline, "startAngleDeg")).toBe(90);
    expect(computedNumericReferenceValue(polyline, "endAngleDeg")).toBe(45);

    const offset: ComputedOffsetLine = {
      kind: "offsetLine",
      elementId: "mutated",
      name: "変形線",
      baseLineIds: ["line-ab"],
      start: point("mutated:start", 0, 0),
      end: point("mutated:end", 0, 5),
      segments: [{
        kind: "line",
        start: point("mutated:start", 0, 0),
        end: point("mutated:end", 0, 5),
        length: 5
      }],
      closed: false,
      length: 5,
      startTangentAngleDeg: 0,
      endTangentAngleDeg: 0
    };
    expect(computedNumericReferenceValue(offset, "startAngleDeg")).toBe(90);
    expect(computedNumericReferenceValue(offset, "endAngleDeg")).toBe(270);
  });

  it("derives Bezier endpoint and handle values from actual controls", () => {
    const degenerate: ComputedBezierCurve = {
      kind: "bezierCurve",
      elementId: "degenerate",
      name: "退化曲線",
      startPointId: null,
      endPointId: null,
      intermediatePointIds: [],
      intermediateSlotIds: [],
      segments: [
        {
          startPointId: null,
          endPointId: null,
          start: point("s0", 0, 0),
          control1: { x: 0, y: 0 },
          control2: { x: 0, y: 0 },
          end: point("s1", 0, 0)
        },
        {
          startPointId: null,
          endPointId: null,
          start: point("s1", 0, 0),
          control1: { x: 0, y: 0 },
          control2: { x: 1, y: 1 },
          end: point("s2", 2, 2)
        },
        {
          startPointId: null,
          endPointId: null,
          start: point("s2", 2, 2),
          control1: { x: 2, y: 2 },
          control2: { x: 2, y: 2 },
          end: point("s3", 2, 2)
        }
      ],
      length: 2 * Math.SQRT2,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null,
      startHandleAngleDeg: 0,
      startHandleLength: 0,
      endHandleAngleDeg: 0,
      endHandleLength: 0
    };
    expect(computedNumericReferenceValue(degenerate, "startAngleDeg")).toBe(45);
    expect(computedNumericReferenceValue(degenerate, "endAngleDeg")).toBe(225);
    expect(computedNumericReferenceValue(degenerate, "startHandleAngleDeg")).toBeUndefined();
    expect(computedNumericReferenceValue(degenerate, "startHandleLength")).toBe(0);
    expect(computedNumericReferenceValue(degenerate, "endHandleAngleDeg")).toBeUndefined();
    expect(computedNumericReferenceValue(degenerate, "endHandleLength")).toBe(0);
    expect(computedNumericReferenceValue(degenerate, "intermediatePoints[1].incomingHandleAngleDeg")).toBeUndefined();
    expect(computedNumericReferenceValue(degenerate, "intermediatePoints[1].incomingHandleLength")).toBe(0);
    expect(computedNumericReferenceValue(degenerate, "intermediatePoints[1].outgoingHandleAngleDeg")).toBeUndefined();
    expect(computedNumericReferenceValue(degenerate, "intermediatePoints[1].outgoingHandleLength")).toBe(0);

    const incomingZero = {
      ...curveGeometry,
      segments: [
        { ...curveGeometry.segments[0], control2: curveGeometry.segments[0].end },
        { ...curveGeometry.segments[1], control1: { x: 40, y: 20 } }
      ]
    } satisfies ComputedBezierCurve;
    expect(computedNumericReferenceValue(incomingZero, "intermediatePoints[1].incomingHandleAngleDeg")).toBe(270);
    expect(computedNumericReferenceValue(incomingZero, "intermediatePoints[1].incomingHandleLength")).toBe(0);
    expect(computedNumericReferenceValue(incomingZero, "intermediatePoints[1].outgoingHandleAngleDeg")).toBe(90);
    expect(computedNumericReferenceValue(incomingZero, "intermediatePoints[1].outgoingHandleLength")).toBe(10);

    const outgoingZero = {
      ...curveGeometry,
      segments: [
        { ...curveGeometry.segments[0], control2: { x: 30, y: 0 } },
        { ...curveGeometry.segments[1], control1: curveGeometry.segments[1].start }
      ]
    } satisfies ComputedBezierCurve;
    expect(computedNumericReferenceValue(outgoingZero, "intermediatePoints[1].incomingHandleAngleDeg")).toBe(225);
    expect(computedNumericReferenceValue(outgoingZero, "intermediatePoints[1].incomingHandleLength")).toBe(Math.sqrt(200));
    expect(computedNumericReferenceValue(outgoingZero, "intermediatePoints[1].outgoingHandleAngleDeg")).toBe(45);
    expect(computedNumericReferenceValue(outgoingZero, "intermediatePoints[1].outgoingHandleLength")).toBe(0);
  });

  it("keeps statically supported paths visible when runtime direction is undefined", () => {
    const lineElement: CadElement = {
      id: "zero-line",
      name: "ゼロ線",
      type: "line",
      activity: "visible",
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 0, y: 0 }
    };
    const zeroLine: ComputedGeometry = {
      kind: "line",
      elementId: "zero-line",
      name: "ゼロ線",
      startPointId: null,
      endPointId: null,
      start: point("z0", 0, 0),
      end: point("z1", 0, 0),
      length: 0,
      startAngleDeg: null,
      endAngleDeg: null,
      startTangentAngleDeg: null,
      endTangentAngleDeg: null
    };
    const candidates = numericReferenceCandidates({
      elements: [lineElement],
      evaluation: {
        computedGeometry: new Map([["zero-line", zeroLine]]),
        errors: [],
        warnings: []
      }
    });
    expect(candidates.find((candidate) => candidate.expression === "zero-line.startAngleDeg")).toMatchObject({
      valueLabel: ""
    });
  });

  it("offers Bezier handle and intermediate point paths as insert candidates", () => {
    const candidates = numericReferenceCandidates({
      elements,
      evaluation,
      currentElement: elements[2],
      currentParameterKey: "dx"
    });
    const expressions = candidates.map((candidate) => candidate.expression);

    expect(expressions).toContain("curve.startHandleAngleDeg");
    expect(expressions).toContain("curve.startHandleLength");
    expect(expressions).toContain("curve.endHandleAngleDeg");
    expect(expressions).toContain("curve.endHandleLength");
    expect(expressions).toContain("curve.intermediatePoints[1].x");
    expect(expressions).toContain("curve.intermediatePoints[1].y");
    expect(candidates.find((candidate) => candidate.expression === "curve.startHandleLength")).toMatchObject({
      valueLabel: "20 mm"
    });
    expect(candidates.find((candidate) => candidate.expression === "curve.startHandleAngleDeg")).toMatchObject({
      valueLabel: "0°"
    });
    expect(candidates.find((candidate) => candidate.expression === "curve.intermediatePoints[1].x")).toMatchObject({
      valueLabel: "40"
    });
  });

  it("exports the canonical computed paths used by numericReferenceCandidates", () => {
    expect(computedPathsForGeometry(curveGeometry)).toEqual(
      expect.arrayContaining(["length", "startHandleAngleDeg", "startHandleLength", "endHandleAngleDeg", "endHandleLength"])
    );
  });

  it("does not offer stale computed geometry from a moduleInstance", () => {
    const moduleInstance: CadElement = {
      id: "module1",
      name: "モジュール",
      type: "moduleInstance",
      activity: "visible"
    };
    const moduleElements = [elements[0], moduleInstance, elements[2]];
    const staleModuleGeometry = { ...curveGeometry, elementId: "module1", name: "モジュール" };
    const staleEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map<string, ComputedGeometry>([
        ["a", point("a", 0, 0)],
        ["module1", staleModuleGeometry],
        ["target", point("target", 0, 0)]
      ])
    };
    const candidates = numericReferenceCandidates({
      elements: moduleElements,
      evaluation: staleEvaluation,
      currentElement: elements[2],
      currentParameterKey: "dx"
    });

    expect(candidates.some((candidate) => candidate.expression.startsWith("module1."))).toBe(false);
  });
});
