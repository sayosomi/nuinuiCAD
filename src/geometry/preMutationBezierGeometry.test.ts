import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { forGroupGeneratedElementId } from "./forGroupExpansion";
import { evaluateElements } from "./evaluate";
import { makeNumericExpression } from "./numericExpressions";
import { buildEvaluationOptions } from "./productionEvaluationContext";
import type { CadElement } from "../types/geometry";

const point = (id: string, x: number, y: number): CadElement => ({
  id,
  name: id,
  type: "freePoint",
  activity: "visible",
  x,
  y
});

const curve = (
  overrides: Partial<Extract<CadElement, { type: "bezierCurve" }>> = {}
): Extract<CadElement, { type: "bezierCurve" }> => ({
  id: "curve",
  name: "Curve",
  type: "bezierCurve",
  activity: "visible",
  startPoint: { mode: "reference", pointId: "a" },
  startHandleAngleDeg: 0,
  startHandleLength: 30,
  intermediatePoints: [],
  endPoint: { mode: "reference", pointId: "b" },
  endHandleAngleDeg: 180,
  endHandleLength: 30,
  ...overrides
});

const curveFrom = (evaluation: ReturnType<typeof evaluateElements>, id = "curve") => {
  const geometry = evaluation.computedGeometry.get(id);
  if (geometry?.kind !== "bezierCurve") throw new Error(`Expected final Bezier ${id}`);
  return geometry;
};

const snapshotFrom = (evaluation: ReturnType<typeof evaluateElements>, id = "curve") => {
  const geometry = evaluation.preMutationBezierGeometry?.get(id);
  if (!geometry) throw new Error(`Expected pre-mutation Bezier ${id}`);
  return geometry;
};

const extendedBezierElements = (extra: CadElement[] = []): CadElement[] => [
  point("a", 0, 0),
  point("b", 100, 0),
  ...extra,
  curve(),
  {
    id: "extend",
    name: "Extend",
    type: "extendTrim",
    activity: "visible",
    endpoint: { lineId: "curve", endpointKey: "start" },
    point: { mode: "reference", pointId: "target" }
  }
];

describe("preMutationBezierGeometry", () => {
  it("captures an unmodified Bezier and keeps the snapshot independent", () => {
    const evaluation = evaluateElements([point("a", 0, 0), point("b", 100, 0), curve()]);
    const finalCurve = curveFrom(evaluation);
    const snapshot = snapshotFrom(evaluation);

    expect(snapshot).toEqual(finalCurve);
    snapshot.segments[0].control1.x = 999;
    expect(finalCurve.segments[0].control1.x).toBe(30);
  });

  it("keeps the authored start and handle after a downstream extend", () => {
    const evaluation = evaluateElements(extendedBezierElements([point("target", -20, 0)]));
    const finalCurve = curveFrom(evaluation);
    const snapshot = snapshotFrom(evaluation);

    expect(finalCurve.segments[0].start).toMatchObject({ x: -20, y: 0 });
    expect(finalCurve.segments[0].control1).toMatchObject({ x: 10, y: 0 });
    expect(snapshot.segments[0].start).toMatchObject({ x: 0, y: 0 });
    expect(snapshot.segments[0].control1).toMatchObject({ x: 30, y: 0 });
  });

  it("keeps the constructed Bezier when a downstream move transforms the final geometry", () => {
    const evaluation = evaluateElements([
      point("a", 0, 0),
      point("b", 100, 0),
      point("move-to", 0, 50),
      curve(),
      {
        id: "move",
        name: "Move",
        type: "move",
        activity: "visible",
        startPoint: { mode: "reference", pointId: "a" },
        endPoint: { mode: "reference", pointId: "move-to" },
        scale: 1,
        angleDeg: 0,
        mirrorX: false,
        baseLineIds: ["curve"]
      }
    ]);
    const finalCurve = curveFrom(evaluation);
    const snapshot = snapshotFrom(evaluation);

    expect(finalCurve.segments[0].start).toMatchObject({ x: 0, y: 50 });
    expect(snapshot.segments[0].start).toMatchObject({ x: 0, y: 0 });
    expect(snapshot.segments[0].control1).toMatchObject({ x: 30, y: 0 });
  });

  it("keeps the constructed geometry through chained downstream mutations", () => {
    const evaluation = evaluateElements([
      point("a", 0, 0),
      point("b", 100, 0),
      point("first-target", -20, 0),
      point("second-target", -40, 0),
      curve(),
      {
        id: "first-extend",
        name: "First extend",
        type: "extendTrim",
        activity: "visible",
        endpoint: { lineId: "curve", endpointKey: "start" },
        point: { mode: "reference", pointId: "first-target" }
      },
      {
        id: "second-extend",
        name: "Second extend",
        type: "extendTrim",
        activity: "visible",
        endpoint: { lineId: "curve", endpointKey: "start" },
        point: { mode: "reference", pointId: "second-target" }
      }
    ]);

    expect(curveFrom(evaluation).segments[0].start.x).toBe(-40);
    expect(snapshotFrom(evaluation).segments[0].start.x).toBe(0);
    expect(snapshotFrom(evaluation).segments[0].control1.x).toBe(30);
  });

  it("captures incoming and outgoing handles for intermediate points", () => {
    const evaluation = evaluateElements([
      point("a", 0, 0),
      point("mid", 50, 20),
      point("b", 100, 0),
      curve({
        intermediatePoints: [{
          id: "mid-point",
          point: { mode: "reference", pointId: "mid" },
          handleAngleDeg: 0,
          incomingHandleLength: 10,
          outgoingHandleLength: 10
        }]
      })
    ]);
    const snapshot = snapshotFrom(evaluation);

    expect(snapshot.segments[0].control2).toMatchObject({ x: 40, y: 20 });
    expect(snapshot.segments[1].control1).toMatchObject({ x: 60, y: 20 });
  });

  it("captures resolved numeric expressions rather than source literals", () => {
    const evaluation = evaluateElements([
      point("a", 0, 0),
      point("b", 100, 0),
      curve({ startHandleLength: makeNumericExpression("10 + 5") })
    ]);

    expect(snapshotFrom(evaluation).startHandleLength).toBe(15);
    expect(snapshotFrom(evaluation).segments[0].control1).toMatchObject({ x: 15, y: 0 });
  });

  it("captures materialized numeric binding values", () => {
    const compiled = compileCanonicalText(
      regenerateCanonicalFromModel(emptyDocument(), 4),
      [
        "nui 4",
        "const handleLength: number = 15",
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 100, y: 0)",
        "curve Curve = bezier(start: @A, end: @B, startAngle: 0, startLength: @handleLength, endAngle: 180, endLength: 30)"
      ].join("\n")
    );
    expect(compiled.status).not.toBe("fatal");
    if (!compiled.doc) throw new Error("Expected compiled document");
    const evaluation = evaluateElements(compiled.doc.document.elements, buildEvaluationOptions({
      compiledDocument: compiled.doc,
      evaluationLimitIndex: undefined
    }));
    const curveElement = compiled.doc.document.elements.find((element) => element.name === "Curve");
    if (!curveElement) throw new Error("Expected compiled Curve element");

    expect(evaluation.errors).toEqual([]);
    expect(snapshotFrom(evaluation, curveElement.id).startHandleLength).toBe(15);
  });

  it("keys generated forGroup Beziers by their runtime occurrence ids", () => {
    const elements: CadElement[] = [
      {
        id: "loop",
        name: "Loop",
        type: "forGroup",
        activity: "visible",
        variableName: "i",
        start: 0,
        count: 2,
        step: 1,
        showGenerated: true
      },
      {
        ...curve({ id: "template-curve", name: "Template curve", parentGroupId: "loop" }),
        startPoint: { mode: "coordinate", x: 0, y: 0 },
        endPoint: { mode: "coordinate", x: 100, y: 0 }
      }
    ];
    const evaluation = evaluateElements(elements);
    const firstId = forGroupGeneratedElementId({ forGroupId: "loop", templateElementId: "template-curve", iterationIndex: 0 });
    const secondId = forGroupGeneratedElementId({ forGroupId: "loop", templateElementId: "template-curve", iterationIndex: 1 });

    expect(evaluation.preMutationBezierGeometry?.has(firstId)).toBe(true);
    expect(evaluation.preMutationBezierGeometry?.has(secondId)).toBe(true);
    expect(evaluation.preMutationBezierGeometry?.get(firstId)?.elementId).toBe(firstId);
    expect(evaluation.preMutationBezierGeometry?.get(secondId)?.elementId).toBe(secondId);
  });

  it("does not expose disabled, failed, or unevaluated Beziers", () => {
    const disabled = evaluateElements([
      point("a", 0, 0),
      point("b", 100, 0),
      curve({ activity: "disabled" })
    ]);
    const failed = evaluateElements([point("a", 0, 0), curve()]);
    const unevaluated = evaluateElements([point("a", 0, 0), point("b", 100, 0), curve()], {
      evaluationLimitIndex: 2
    });

    expect(disabled.preMutationBezierGeometry?.size).toBe(0);
    expect(failed.preMutationBezierGeometry?.size).toBe(0);
    expect(unevaluated.preMutationBezierGeometry?.size).toBe(0);
  });

  it("keeps the snapshot as the constructed curve when final geometry is mutated", () => {
    const evaluation = evaluateElements(extendedBezierElements([point("target", -20, 0)]));
    const snapshot = snapshotFrom(evaluation);
    const finalCurve = curveFrom(evaluation);

    expect(finalCurve).not.toEqual(snapshot);
    expect(snapshot.startHandleAngleDeg).toBe(0);
    expect(snapshot.endHandleAngleDeg).toBe(180);
  });
});
