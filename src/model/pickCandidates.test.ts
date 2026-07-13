import { describe, expect, it } from "vitest";
import type {
  CadElement,
  ComputedBezierCurve,
  ComputedGeometry,
  ComputedLine,
  ComputedPoint,
  EvaluationResult
} from "../types/geometry";
import { pickCandidates } from "./pickCandidates";

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
    visible: true,
    enabled: true,
    x: 0,
    y: 0
  },
  {
    id: "line",
    name: "直線",
    type: "line",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "a" },
    endPoint: { mode: "coordinate", x: 10, y: 0 }
  },
  {
    id: "curve",
    name: "曲線",
    type: "bezierCurve",
    visible: true,
    enabled: true,
    startPoint: { mode: "reference", pointId: "a" },
    startHandleAngleDeg: 0,
    startHandleLength: 20,
    intermediatePoints: [],
    endPoint: { mode: "coordinate", x: 20, y: 0 },
    endHandleAngleDeg: 180,
    endHandleLength: 20
  },
  {
    id: "target",
    name: "点T",
    type: "offsetPoint",
    visible: true,
    enabled: true,
    fromPointId: "a",
    dx: 0,
    dy: 0
  }
];

const line: ComputedLine = {
  kind: "line",
  elementId: "line",
  name: "直線",
  startPointId: "a",
  endPointId: null,
  start: point("a", 0, 0),
  end: point("line:end", 10, 0),
  length: 10,
  startAngleDeg: 0,
  endAngleDeg: 180,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180
};

const curve: ComputedBezierCurve = {
  kind: "bezierCurve",
  elementId: "curve",
  name: "曲線",
  startPointId: "a",
  endPointId: null,
  intermediatePointIds: [],
  segments: [
    {
      startPointId: "a",
      endPointId: null,
      start: point("a", 0, 0),
      control1: { x: 20, y: 0 },
      control2: { x: 0, y: 0 },
      end: point("curve:end", 20, 0)
    }
  ],
  length: 20,
  startTangentAngleDeg: 0,
  endTangentAngleDeg: 180,
  startHandleAngleDeg: 0,
  startHandleLength: 20,
  endHandleAngleDeg: 180,
  endHandleLength: 20
};

const evaluation: EvaluationResult = {
  computedGeometry: new Map<string, ComputedGeometry>([
    ["a", point("a", 0, 0)],
    ["line", line],
    ["curve", curve],
    ["target", point("target", 0, 0)]
  ]),
  computedVariables: new Map(),
  errors: [],
  warnings: []
};

describe("pickCandidates", () => {
  it("excludes later and unevaluated geometry from numeric candidates", () => {
    const laterLine: CadElement = {
      id: "later-line",
      name: "後の線",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };
    const candidates = pickCandidates([...elements, laterLine], evaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: {
        elementId: "target",
        parameterKey: "dx",
        mode: "replace",
        property: "length"
      }
    });

    expect(candidates.map((candidate) => candidate.elementId)).not.toContain("later-line");
    expect(candidates.map((candidate) => candidate.elementId)).toContain("line");
  });

  it("offers Bezier handle numeric references only for Bezier geometry", () => {
    const candidates = pickCandidates(elements, evaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: {
        elementId: "target",
        parameterKey: "dx",
        mode: "replace",
        property: "startHandleLength"
      }
    });

    expect(candidates).toEqual([
      {
        elementId: "curve",
        options: [
          {
            kind: "numericReference",
            label: "startHandleLength",
            property: "startHandleLength",
            expression: "curve.startHandleLength"
          }
        ]
      }
    ]);
  });
});
