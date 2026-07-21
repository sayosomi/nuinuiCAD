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
import { startSession } from "../commands/commandLineSession";
import { creationRecipeForType } from "../commands/creationRecipes";
import { evaluateElements } from "../geometry/evaluate";
import { makeNumericExpression } from "../geometry/numericExpressions";

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

const group = (id: string): CadElement => ({
  id,
  name: id,
  type: "group",
  visible: true,
  enabled: true
});

const virtualCommandLineSession = (type: "line" | "lineDivisionPoint", insertionIndex: number) =>
  startSession(creationRecipeForType(type)!, {
    insertionIndex,
    revision: 1,
    elements: []
  });

describe("pickCandidates", () => {
  it("returns same-forGroup generated point, endpoint, and line instances in explicit iteration order", () => {
    const generatedElements: CadElement[] = [
      {
        id: "loop", name: "Loop", type: "forGroup", visible: true, enabled: true,
        variableName: "i", start: 0, count: 3, step: 1, showGenerated: true
      },
      {
        id: "loop-point", name: "Loop point", type: "freePoint", visible: true, enabled: true,
        parentGroupId: "loop", x: makeNumericExpression("@i * 20"), y: 0
      },
      {
        id: "loop-line", name: "Loop line", type: "line", visible: true, enabled: true,
        parentGroupId: "loop", startPoint: { mode: "reference", pointId: "loop-point" },
        endPoint: { mode: "coordinate", x: makeNumericExpression("@i * 20"), y: 10 }
      },
      {
        id: "other-loop", name: "Other", type: "forGroup", visible: true, enabled: true,
        variableName: "j", start: 0, count: 3, step: 1, showGenerated: true
      },
      {
        id: "other-point", name: "Other point", type: "freePoint", visible: true, enabled: true,
        parentGroupId: "other-loop", x: 0, y: 0
      },
      {
        id: "endpoint-target", name: "Endpoint target", type: "lineDivisionPoint", visible: true, enabled: true,
        parentGroupId: "loop", endpoint: { lineId: "loop-line", endpointKey: "start" },
        placement: { kind: "ratio", value: 0.5 }
      },
      {
        id: "point-target", name: "Point target", type: "offsetPoint", visible: true, enabled: true,
        parentGroupId: "loop", fromPoint: { mode: "reference", pointId: "loop-point" }, dx: 5, dy: 0
      },
      {
        id: "line-target", name: "Line target", type: "offsetLine", visible: true, enabled: true,
        parentGroupId: "loop", baseLineIds: [], offset: 2, side: "right", closed: false
      },
      {
        id: "later", name: "Later", type: "freePoint", visible: true, enabled: true,
        parentGroupId: "loop", x: 0, y: 0
      }
    ];
    const generatedEvaluation = evaluateElements(generatedElements);
    const reversedGeometryEvaluation = {
      ...generatedEvaluation,
      computedGeometry: new Map([...generatedEvaluation.computedGeometry].reverse())
    };

    const pointIds = pickCandidates(generatedElements, reversedGeometryEvaluation, {
      activePointPickTarget: { elementId: "point-target", parameterKey: "fromPoint" },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null
    }).filter((candidate) => candidate.referenceElementId === "loop-point");
    expect(pointIds.map((candidate) => candidate.elementId)).toEqual([
      "loop-point@loop:0", "loop-point@loop:1", "loop-point@loop:2"
    ]);

    const endpointCandidates = pickCandidates(generatedElements, generatedEvaluation, {
      activePointPickTarget: { elementId: "endpoint-target", parameterKey: "endpoint" },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null
    }).filter((candidate) => candidate.referenceElementId === "loop-line");
    expect(endpointCandidates.flatMap((candidate) => candidate.options.map((option) => option.label))).toEqual([
      "[i=0] Loop line.始点", "[i=0] Loop line.終点",
      "[i=1] Loop line.始点", "[i=1] Loop line.終点",
      "[i=2] Loop line.始点", "[i=2] Loop line.終点"
    ]);

    const lineCandidates = pickCandidates(generatedElements, generatedEvaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: { elementId: "line-target", parameterKey: "baseLineIds" },
      activeNumericReferencePickTarget: null
    });
    expect(lineCandidates.filter((candidate) => candidate.referenceElementId === "loop-line")
      .map((candidate) => candidate.elementId)).toEqual([
        "loop-line@loop:0", "loop-line@loop:1", "loop-line@loop:2"
      ]);
    expect(lineCandidates.map((candidate) => candidate.elementId)).not.toContain("later@loop:0");
    expect(lineCandidates.map((candidate) => candidate.elementId)).not.toContain("other-point@other-loop:0");
  });

  it("uses referenceElements as the authoritative source pool and preserves enabled fallback semantics", () => {
    const hiddenPoint = { ...elements[0], visible: false } as CadElement;
    const sourceElements = [hiddenPoint, ...elements.slice(1)];
    const target = {
      activePointPickTarget: {
        elementId: "target",
        parameterKey: "fromPoint",
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      referenceElements: [hiddenPoint]
    } as const;
    const withDiagnostic = {
      ...evaluation,
      errors: [{ elementId: "a", message: "non-fatal diagnostic" }] as never
    };

    expect(pickCandidates(sourceElements, withDiagnostic, target).map((candidate) => candidate.elementId))
      .toEqual(["a"]);
    expect(pickCandidates(sourceElements, {
      ...withDiagnostic,
      effectiveEnabledElementIds: new Set()
    }, target)).toEqual([]);
    expect(pickCandidates(sourceElements, {
      ...withDiagnostic,
      effectiveEnabledElementIds: new Set(["a"])
    }, target).map((candidate) => candidate.elementId)).toEqual(["a"]);
  });

  it("includes unnamed sources for command-line and existing virtual pick targets", () => {
    const unnamedLine: CadElement = {
      id: "unnamed-line",
      name: "",
      type: "line",
      visible: true,
      enabled: true,
      startPoint: { mode: "coordinate", x: 0, y: 0 },
      endPoint: { mode: "coordinate", x: 10, y: 0 }
    };
    const withUnnamed = [...elements.slice(0, 2), unnamedLine, ...elements.slice(2)];
    const withUnnamedEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map([
        ...evaluation.computedGeometry,
        ["unnamed-line", { ...line, elementId: "unnamed-line", name: "" }]
      ])
    };
    const session = startSession(creationRecipeForType("freePoint")!, {
      insertionIndex: withUnnamed.length,
      revision: 1,
      elements: withUnnamed
    });

    const commandLineCandidates = pickCandidates(withUnnamed, withUnnamedEvaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: {
        elementId: "__command-line__",
        parameterKey: "x",
        insertionIndex: withUnnamed.length,
        mode: "replace",
        property: "length"
      },
      commandLineSession: session
    });
    const templateCandidates = pickCandidates(withUnnamed, withUnnamedEvaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: {
        elementId: "__template-insertion-numeric__",
        parameterKey: "sleeve",
        insertionIndex: withUnnamed.length,
        mode: "insert",
        property: "length"
      }
    });

    expect(commandLineCandidates.map((candidate) => candidate.elementId)).toContain("unnamed-line");
    expect(templateCandidates.map((candidate) => candidate.elementId)).toContain("unnamed-line");
  });

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

  it("offers candidates to a virtual target through its insertion index", () => {
    const virtualNumeric = (insertionIndex?: number) =>
      pickCandidates(elements, evaluation, {
        activePointPickTarget: null,
        activeLinePickTarget: null,
        activeNumericReferencePickTarget: {
          elementId: "__template-insertion-numeric__",
          parameterKey: "sleeve",
          ...(insertionIndex === undefined ? {} : { insertionIndex }),
          mode: "insert",
          property: "length"
        }
      });

    expect(virtualNumeric(elements.length).map((candidate) => candidate.elementId))
      .toEqual(["line", "curve"]);
    expect(virtualNumeric(2).map((candidate) => candidate.elementId)).toEqual(["line"]);
    expect(virtualNumeric(undefined)).toEqual([]);

    const pointCandidates = pickCandidates(elements, evaluation, {
      activePointPickTarget: {
        elementId: "__template-insertion-pick__",
        parameterKey: "point:p",
        insertionIndex: elements.length
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null
    });
    expect(pointCandidates.map((candidate) => candidate.elementId)).toContain("a");

    const lineCandidates = pickCandidates(elements, evaluation, {
      activePointPickTarget: null,
      activeLinePickTarget: {
        elementId: "__template-insertion-pick__",
        parameterKey: "line:l",
        insertionIndex: elements.length
      },
      activeNumericReferencePickTarget: null
    });
    expect(lineCandidates.map((candidate) => candidate.elementId)).toEqual(["line", "curve"]);
  });

  it("keeps the first direct child of a normal planned group in command-line point candidates", () => {
    const groupedElements: CadElement[] = [
      group("parent"),
      {
        id: "first-point", name: "先頭点", type: "freePoint", visible: true, enabled: true,
        parentGroupId: "parent", x: 0, y: 0
      }
    ];
    const groupedEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map([["first-point", point("first-point", 0, 0)]])
    };
    const candidates = pickCandidates(groupedElements, groupedEvaluation, {
      activePointPickTarget: {
        elementId: "__command-line__",
        parameterKey: "startPoint",
        insertionIndex: groupedElements.length
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      commandLineSession: virtualCommandLineSession("line", groupedElements.length),
      commandLinePickParentGroupId: "parent"
    });

    expect(candidates).toContainEqual(expect.objectContaining({ elementId: "first-point" }));
  });

  it("keeps the first direct child of a normal planned group in endpoint candidates", () => {
    const groupedElements: CadElement[] = [
      group("parent"),
      {
        id: "first-line", name: "先頭線", type: "line", visible: true, enabled: true,
        parentGroupId: "parent",
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 10, y: 0 }
      }
    ];
    const groupedEvaluation: EvaluationResult = {
      ...evaluation,
      computedGeometry: new Map([[
        "first-line",
        {
          kind: "line",
          elementId: "first-line",
          name: "先頭線",
          startPointId: null,
          endPointId: null,
          start: point("first-line:start", 0, 0),
          end: point("first-line:end", 10, 0),
          length: 10,
          startAngleDeg: 0,
          endAngleDeg: 180,
          startTangentAngleDeg: 0,
          endTangentAngleDeg: 180
        }
      ]])
    };
    const candidates = pickCandidates(groupedElements, groupedEvaluation, {
      activePointPickTarget: {
        elementId: "__command-line__",
        parameterKey: "endpoint",
        insertionIndex: groupedElements.length
      },
      activeLinePickTarget: null,
      activeNumericReferencePickTarget: null,
      commandLineSession: virtualCommandLineSession("lineDivisionPoint", groupedElements.length),
      commandLinePickParentGroupId: "parent"
    });

    expect(candidates).toContainEqual(expect.objectContaining({ elementId: "first-line" }));
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
