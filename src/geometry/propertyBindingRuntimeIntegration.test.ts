// End-to-end coverage for Task 23: compiles real nui 3 source through the
// production document pipeline (mirroring scalarProgramEvaluation.test.ts's
// approach), builds Task 23's elementId-keyed property binding entries via
// buildPropertyBindingRuntimeEntries, and evaluates through evaluateElements
// - proving the whole compile -> build entries -> materialize -> evaluate
// path works together, not just each piece in isolation.

import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElements } from "./evaluate";
import { buildPropertyBindingRuntimeEntries } from "./propertyBindingRuntime";

const compileCanonical = (source: string): LastGoodDslDocument => {
  const baseline = regenerateCanonicalFromModel(emptyDocument(), 3);
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
 * Strips id/name fields (which are compiler-assigned per-document and never
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

describe("Task 23 standard property runtime, end-to-end through the real compiler", () => {
  it("offsetLine.side bound to a choice const flips the offset direction, matching a literal side of the same value", () => {
    const bound = compileCanonical([
      "nui 3",
      "const 方向: choice(right, left) = left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: @方向, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const literalLeft = compileCanonical([
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "line Off = offset(sources: [@AB], distance: 5, side: left, closed: false, suppressTrimWarnings: false)"
    ].join("\n"));
    const literalRight = compileCanonical([
      "nui 3",
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
    // A choice const can only ever be a literal or a reference to another
    // choice binding (no computed/conditional choice expressions - see
    // plan.md), so it can never itself become runtime-poisoned; a boolean
    // binding can, via a numeric comparison against a disabled element's
    // property, mirroring scalarProgramEvaluation.test.ts's own poison
    // fixture.
    const compiled = compileCanonical([
      "nui 3",
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
    // survive and wouldn't exercise "every generated instance individually".
    const source = (mirrorXArg: string) =>
      [
        "nui 3",
        ...(mirrorXArg === "@反転" ? ["let 反転: boolean = true"] : []),
        "point A = coordinate(x: 0, y: 0)",
        "point B = coordinate(x: 10, y: 0)",
        "line AB = segment(start: @A, end: @B)",
        "for 繰返し (i, from: 0, count: 3, step: 1) {",
        `  line C = copy(startPoint: @A, endPoint: @B, scale: 1, angleDeg: 0, mirrorX: ${mirrorXArg}, baseLines: [@AB])`,
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
});
