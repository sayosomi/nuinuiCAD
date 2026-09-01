// End-to-end coverage for Task 23: compiles real nui 1 source through the
// production document pipeline (mirroring scalarProgramEvaluation.test.ts's
// approach), builds Task 23's elementId-keyed property binding entries via
// buildPropertyBindingRuntimeEntries, && evaluates through evaluateElements
// - proving the whole compile -> build entries -> materialize -> evaluate
// path works together, not just each piece in isolation.

import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import type { ArcLineElement, CadElement, PathReverseElement } from "../types/geometry";
import type { ScalarType } from "../scalars/types";
import type { TypedScalarExpression, TypedScalarGeometryPropertyReferenceNode } from "../scalars/typedExpressionAst";
import { evaluateElements } from "./evaluate";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";
import { resolveDocumentGeometryProperty, type DocumentGeometryRuntime } from "./scalarProgramEvaluation";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 1);
  const result = compileCanonicalText(baseline, source);
  expect(result.status).not.toBe("fatal");
  return result.doc;
};

const entriesFor = (compiled: LastGoodDslDocument) =>
  buildPropertyBindingRuntimeEntries(
    { propertyBindings: compiled.propertyBindings ?? new Map(), elementIdByStatementIndex: compiled.statementMap.elementIdByStatementIndex },
    compiled.document.elements
  );

/** Element ids are compiler-assigned opaque ids, not the DSL source name - look elements up by name. */
const idByName = (compiled: LastGoodDslDocument, name: string): string => {
  const element = compiled.document.elements.find((candidate) => candidate.name === name);
  if (!element) throw new Error(`no element named "${name}" in compiled document`);
  return element.id;
};

/**
 * Strips id/name fields (which are compiler-assigned per-document && never
 * expected to match across two separately-compiled documents) so two
 * computed geometries can be compared on their actual numeric shape alone.
 */
const geometryShape = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(geometryShape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "elementId" && key !== "name" && key !== "baseLineIds")
        .map(([key, nested]) => [key, geometryShape(nested)])
    );
  }
  return value;
};

const directionType = (): Extract<ScalarType, { kind: "choice" }> => ({
  kind: "choice",
  options: ["counterclockwise", "clockwise"]
});

const arc = (
  id: string,
  startAngleDeg: number,
  endAngleDeg: number,
  direction?: ArcLineElement["direction"]
): ArcLineElement => ({
  id,
  name: id,
  type: "arcLine",
  activity: "visible",
  centerPoint: { mode: "coordinate", x: 0, y: 0 },
  radius: 10,
  startAngleDeg,
  endAngleDeg,
  ...(direction ? { direction } : {})
});

const text = (fontSize: number): Extract<CadElement, { type: "text" }> => ({
  id: "text",
  name: "注記",
  type: "text",
  activity: "visible",
  text: "注記",
  anchor: null,
  fontSize
});

const geometryProperty = (
  elementId: string,
  property: string,
  targetSourceOrder: number,
  type: ScalarType = directionType()
): TypedScalarGeometryPropertyReferenceNode => ({
  kind: "geometryProperty",
  span: { start: 0, end: 1 },
  elementNameSpan: { start: 0, end: 1 },
  propertySpan: { start: 0, end: 1 },
  elementName: elementId,
  elementId,
  property,
  targetSourceOrder,
  type
});

const choiceLiteral = (value: string): TypedScalarExpression => ({
  kind: "choiceLiteral",
  span: { start: 0, end: 1 },
  value,
  type: directionType()
});

const directionBinding = (
  elementId: string,
  expression: TypedScalarExpression
) => ({
  elementId,
  parameterKey: "direction",
  expression,
  expectedType: directionType()
});

const evaluateDirectionRead = (
  elements: CadElement[],
  entries: ReturnType<typeof directionBinding>[],
  statementIndexes: ReadonlyArray<readonly [string, number]>
) => evaluateElements(elements, {
  scalarProgram: { statements: [] },
  statementInfoByElementId: new Map(statementIndexes.map(([id, statementIndex]) => [id, { statementIndex }] as const)),
  propertyBindingEntries: entries
});

describe("Task 23 standard property runtime, end-to-end through the real compiler", () => {
  it.each([3, 0, -1])("reads Text.fontSize from current computed geometry only for a positive size (%s)", (fontSize) => {
    const target = text(fontSize);
    const evaluation = evaluateElements([target]);
    const runtime: DocumentGeometryRuntime = {
      computedGeometry: evaluation.computedGeometry,
      elementsById: new Map([[target.id, target]]),
      activities: new Map()
    };
    const result = resolveDocumentGeometryProperty(
      runtime,
      geometryProperty(target.id, "fontSize", 0, { kind: "number" }),
      1
    );

    if (fontSize > 0) {
      expect(result).toEqual({
        status: "ok",
        type: { kind: "number" },
        value: { kind: "number", value: fontSize }
      });
    } else {
      expect(result).toEqual({
        status: "error",
        type: { kind: "number" },
        issueCode: "evaluation-geometry-property-unavailable"
      });
    }
  });

  it("evaluates a resolved geometry-property expression in a common boolean property", () => {
    const compiled = compileCanonical([
      "nui 1",
      "const _unused: number = 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: right, closed: @AB.length > 0, suppressTrimWarnings: false)"
    ].join("\n"));
    const result = evaluateElements(compiled.document.elements, {
      scalarProgram: compiled.scalarProgram,
      propertyBindingEntries: entriesFor(compiled)
    });
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.has(idByName(compiled, "Off"))).toBe(true);
  });

  it("offsetLine.side bound to a choice const flips the offset direction, matching a literal side of the same value", () => {
    const bound = compileCanonical([
      "nui 1",
      "const 方向: choice(right, left) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const literalLeft = compileCanonical([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const literalRight = compileCanonical([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: right, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));

    const boundResult = evaluateElements(bound.document.elements, {
      scalarProgram: bound.scalarProgram,
      propertyBindingEntries: entriesFor(bound)
    });
    const literalLeftResult = evaluateElements(literalLeft.document.elements, {});
    const literalRightResult = evaluateElements(literalRight.document.elements, {});

    expect(boundResult.errors).toEqual([]);
    expect(geometryShape(boundResult.computedGeometry.get(idByName(bound, "Off")))).toEqual(
      geometryShape(literalLeftResult.computedGeometry.get(idByName(literalLeft, "Off")))
    );
    expect(geometryShape(boundResult.computedGeometry.get(idByName(bound, "Off")))).not.toEqual(
      geometryShape(literalRightResult.computedGeometry.get(idByName(literalRight, "Off")))
    );
  });

  it("fails closed (no computedGeometry, an error) when the bound boolean binding is poisoned", () => {
    // A choice const can only ever be a literal || a reference to another
    // choice binding (no computed/conditional choice expressions - see
    // plan.md), so it can never itself become runtime-poisoned; a boolean
    // binding can, via a numeric comparison against a disabled element's
    // property, mirroring scalarProgramEvaluation.test.ts's own poison
    // fixture.
    const compiled = compileCanonical([
      "nui 1",
      "point Z1 = coordinate(x: 0, y: 0)",
      "point Z2 = coordinate(x: 3, y: 4)",
      "line D = segment(start: @Z1, end: @Z2, state: disabled)",
      "let 有効: boolean = @D.length > 0",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: right, closed: @有効, suppressTrimWarnings: false)"
    ].join("\n"));

    const result = evaluateElements(compiled.document.elements, {
      scalarProgram: compiled.scalarProgram,
      propertyBindingEntries: entriesFor(compiled)
    });

    const offId = idByName(compiled, "Off");
    expect(result.computedGeometry.has(offId)).toBe(false);
    expect(result.errors.some((error) => error.elementId === offId)).toBe(true);
  });

  it("materializes a bound boolean property uniformly across every forGroup-generated instance (template-id lookup)", () => {
    // copyLine (not move) stores its computed geometry under its own
    // elementId - move instead overwrites its *base* line's geometry in
    // place, which would only let the last of the 3 iterations' writes
    // survive && wouldn't exercise "every generated instance individually".
    const source = (mirrorXArg: string) =>
      [
        "nui 1",
        ...(mirrorXArg === "@反転" ? ["let 反転: boolean = true"] : []),
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "for i in range(from: 0, count: 3, step: 1) {",
        `  line C = transformCopy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: ${mirrorXArg}, baseLines: [@AB])`,
        "}"
      ].join("\n");

    const bound = compileCanonical(source("@反転"));
    const literalFalse = compileCanonical(source("false"));

    const boundResult = evaluateElements(bound.document.elements, {
      scalarProgram: bound.scalarProgram,
      propertyBindingEntries: entriesFor(bound)
    });
    const literalFalseResult = evaluateElements(literalFalse.document.elements, {});
    const boundRows = boundResult.forGroupGeneratedRows ?? [];
    const literalFalseRows = literalFalseResult.forGroupGeneratedRows ?? [];

    expect(boundResult.errors).toEqual([]);
    expect(boundRows).toHaveLength(3);
    expect(literalFalseRows).toHaveLength(3);

    for (const row of boundRows) {
      expect(boundResult.computedGeometry.has(row.generatedElementId)).toBe(true);
    }

    // Every generated instance must reflect the bound value (mirrorX: true),
    // not just the template - and must differ from the literal-false run,
    // proving the override actually took effect for each iteration rather
    // than being silently ignored.
    const boundGeometries = boundRows.map((row) => geometryShape(boundResult.computedGeometry.get(row.generatedElementId)));
    const literalGeometries = literalFalseRows.map((row) => geometryShape(literalFalseResult.computedGeometry.get(row.generatedElementId)));
    expect(boundGeometries).toEqual(boundGeometries.map(() => boundGeometries[0]));
    expect(boundGeometries[0]).not.toEqual(literalGeometries[0]);
  });

  it("resolves a choice geometry property with the exact supplied type, options, and value", () => {
    const source = arc("source", 0, 90);
    const evaluation = evaluateElements([source]);
    const runtime: DocumentGeometryRuntime = {
      computedGeometry: evaluation.computedGeometry,
      elementsById: new Map([[source.id, source]]),
      activities: new Map()
    };
    const type = directionType();
    expect(resolveDocumentGeometryProperty(runtime, geometryProperty(source.id, "direction", 0, type), 1)).toEqual({
      status: "ok",
      type,
      value: { kind: "choice", value: "counterclockwise", options: type.options }
    });
  });

  it("requires current computed geometry for choice reads while allowing hidden evaluated targets", () => {
    const disabled: ArcLineElement = { ...arc("disabled", 0, 90), activity: "disabled" };
    const failed: ArcLineElement = {
      ...arc("failed", 0, 90),
      centerPoint: { mode: "reference", pointId: "missing-center" }
    };
    const hidden: ArcLineElement = { ...arc("hidden", 0, 90), activity: "hidden" };
    const type = directionType();
    const read = (target: ArcLineElement, evaluation: ReturnType<typeof evaluateElements>) =>
      resolveDocumentGeometryProperty(
        {
          computedGeometry: evaluation.computedGeometry,
          elementsById: new Map([[target.id, target]]),
          activities: new Map()
        },
        geometryProperty(target.id, "direction", 0, type),
        1
      );

    expect(read(disabled, evaluateElements([disabled]))).toEqual({
      status: "error",
      type,
      issueCode: "evaluation-geometry-property-unavailable"
    });
    expect(read(failed, evaluateElements([failed]))).toEqual({
      status: "error",
      type,
      issueCode: "evaluation-geometry-property-unavailable"
    });
    expect(read(hidden, evaluateElements([hidden]))).toEqual({
      status: "ok",
      type,
      value: { kind: "choice", value: "counterclockwise", options: type.options }
    });
  });

  it("preserves the concrete choice type for unavailable, invalid-member, and too-late reads", () => {
    const source = arc("source", 0, 90);
    const evaluation = evaluateElements([source]);
    const type = directionType();
    const runtime: DocumentGeometryRuntime = {
      computedGeometry: evaluation.computedGeometry,
      elementsById: new Map([[source.id, source]]),
      activities: new Map()
    };
    expect(resolveDocumentGeometryProperty(runtime, geometryProperty("missing", "direction", 0, type), 1)).toEqual({
      status: "error",
      type,
      issueCode: "evaluation-geometry-property-unavailable"
    });
    expect(resolveDocumentGeometryProperty(runtime, geometryProperty(source.id, "direction", 0, { kind: "choice", options: ["clockwise"] }), 1)).toEqual({
      status: "error",
      type: { kind: "choice", options: ["clockwise"] },
      issueCode: "evaluation-geometry-property-unavailable"
    });
    expect(resolveDocumentGeometryProperty(runtime, geometryProperty(source.id, "direction", 1, type), 1)).toEqual({
      status: "error",
      type,
      issueCode: "evaluation-geometry-property-unavailable"
    });
  });

  it.each([
    ["positive sweep", arc("source", 0, 90), 90],
    ["negative sweep", arc("source", 0, 90, "clockwise"), -270],
    ["zero sweep explicit clockwise", arc("source", 0, 0, "clockwise"), -270],
    ["zero sweep omitted default", arc("source", 0, 0), 90]
  ] as const)("uses %s arc.direction runtime semantics", (_label, source, expectedTargetSweep) => {
    const target = arc("target", 0, 90);
    const result = evaluateDirectionRead(
      [source, target],
      [directionBinding(target.id, geometryProperty(source.id, "direction", 0))],
      [[source.id, 0], [target.id, 1]]
    );
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(target.id)).toMatchObject({ sweepAngleDeg: expectedTargetSweep });
    expect(result.computedGeometry.get(target.id)).toBeDefined();
  });

  it.each(["clockwise", "counterclockwise"] as const)("observes an effectively materialized zero-sweep %s direction value", (boundDirection) => {
    const source = arc("source", 0, 0);
    const target = arc("target", 0, 90);
    const result = evaluateDirectionRead(
      [source, target],
      [
        directionBinding(source.id, choiceLiteral(boundDirection)),
        directionBinding(target.id, geometryProperty(source.id, "direction", 0))
      ],
      [[source.id, 0], [target.id, 1]]
    );
    expect(result.errors).toEqual([]);
    expect(result.computedGeometry.get(target.id)).toMatchObject({
      sweepAngleDeg: boundDirection === "clockwise" ? -270 : 90
    });
  });

  it("lets a pathReverse before the read change arc.direction, while a later reverse is not retroactive", () => {
    const sourceBefore = arc("source-before", 0, 90);
    const reverseBefore: PathReverseElement = {
      id: "reverse-before",
      name: "",
      type: "pathReverse",
      activity: "visible",
      targetLineId: sourceBefore.id
    };
    const targetAfter = arc("target-after", 0, 90);
    const afterResult = evaluateDirectionRead(
      [sourceBefore, reverseBefore, targetAfter],
      [directionBinding(targetAfter.id, geometryProperty(sourceBefore.id, "direction", 0))],
      [[sourceBefore.id, 0], [reverseBefore.id, 1], [targetAfter.id, 2]]
    );
    expect(afterResult.errors).toEqual([]);
    expect(afterResult.computedGeometry.get(targetAfter.id)).toMatchObject({ sweepAngleDeg: -270 });

    const sourceLater = arc("source-later", 0, 90);
    const targetBefore = arc("target-before", 0, 90);
    const reverseLater: PathReverseElement = {
      id: "reverse-later",
      name: "",
      type: "pathReverse",
      activity: "visible",
      targetLineId: sourceLater.id
    };
    const laterResult = evaluateDirectionRead(
      [sourceLater, targetBefore, reverseLater],
      [directionBinding(targetBefore.id, geometryProperty(sourceLater.id, "direction", 0))],
      [[sourceLater.id, 0], [targetBefore.id, 1], [reverseLater.id, 2]]
    );
    expect(laterResult.errors).toEqual([]);
    expect(laterResult.computedGeometry.get(targetBefore.id)).toMatchObject({ sweepAngleDeg: 90 });
  });
});
