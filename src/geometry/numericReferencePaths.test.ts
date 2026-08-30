import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedPoint,
  EvaluationResult
} from "../types/geometry";
import {
  computedNumericReferenceValue,
  computedPathsForGeometry,
  numericReferenceCandidates,
  parameterPathsForElement
} from "./numericReferencePaths";

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
    expect(computedNumericReferenceValue(curveGeometry, "startHandleAngleDeg")).toBe(15);
    expect(computedNumericReferenceValue(curveGeometry, "startHandleLength")).toBe(20);
    expect(computedNumericReferenceValue(curveGeometry, "endHandleAngleDeg")).toBe(165);
    expect(computedNumericReferenceValue(curveGeometry, "endHandleLength")).toBe(25);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].x")).toBe(40);
    expect(computedNumericReferenceValue(curveGeometry, "intermediatePoints[1].y")).toBe(10);
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
  });

  it("exports computedPathsForGeometry/parameterPathsForElement matching what numericReferenceCandidates already uses internally (regression for the export-only change)", () => {
    expect(computedPathsForGeometry(curveGeometry)).toEqual(
      expect.arrayContaining(["length", "startHandleAngleDeg", "startHandleLength", "endHandleAngleDeg", "endHandleLength"])
    );
    expect(parameterPathsForElement(elements[2])).toEqual(
      expect.arrayContaining(["params.dx", "params.dy"])
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
