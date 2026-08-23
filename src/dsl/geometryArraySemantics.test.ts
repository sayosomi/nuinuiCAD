import { describe, expect, it } from "vitest";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";
import { resolveGeometryArrayExpression } from "./geometryArraySemantics";
import type { GeometryArrayType } from "./geometryArrayTypes";

const pathArray: GeometryArrayType = { kind: "geometryArray", elementType: "path" };
const lineArray: GeometryArrayType = { kind: "geometryArray", elementType: "line" };
const pointArray: GeometryArrayType = { kind: "geometryArray", elementType: "point" };

const literal = (source: string) => {
  const parsed = parseGeometryArrayExpression(source);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.expression).not.toBeNull();
  return parsed.expression!;
};

describe("geometry array typed value semantics", () => {
  it("preserves literal order and duplicate definition-backed targets", () => {
    const expression = literal("[@A, @B, @A]");
    const result = resolveGeometryArrayExpression({
      expectedType: pointArray,
      expression,
      resolveMember: (member) => ({ kind: "resolved", value: { interfaceType: "point", target: member.text.slice(1) } }),
      resolveArrayReference: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.kind).toBe("literal");
    if (result.value?.kind !== "literal") return;
    expect(result.value.members.map((member) => member.target)).toEqual(["A", "B", "A"]);
  });

  it("lifts line-to-path covariance element-wise and rejects reverse/point conversions", () => {
    const lineMember = literal("[@L]");
    expect(resolveGeometryArrayExpression({
      expectedType: pathArray,
      expression: lineMember,
      resolveMember: () => ({ kind: "resolved", value: { interfaceType: "line", target: "L" } }),
      resolveArrayReference: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    }).diagnostics).toEqual([]);

    const reverse = resolveGeometryArrayExpression({
      expectedType: lineArray,
      expression: lineMember,
      resolveMember: () => ({ kind: "resolved", value: { interfaceType: "path", target: "curve" } }),
      resolveArrayReference: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(reverse.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));

    const pointMismatch = resolveGeometryArrayExpression({
      expectedType: pointArray,
      expression: lineMember,
      resolveMember: () => ({ kind: "resolved", value: { interfaceType: "line", target: "L" } }),
      resolveArrayReference: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(pointMismatch.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));
  });

  it("keeps named array pass-through as an alias instead of flattening members", () => {
    const expression = literal("@straightEdges");
    const result = resolveGeometryArrayExpression({
      expectedType: pathArray,
      expression,
      resolveMember: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } }),
      resolveArrayReference: () => ({ kind: "resolved", targetValueId: "statement:edges", type: lineArray })
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.value).toMatchObject({
      kind: "alias",
      type: pathArray,
      targetValueId: "statement:edges"
    });
  });

  it("rejects path[] -> line[] named alias assignment", () => {
    const expression = literal("@paths");
    const result = resolveGeometryArrayExpression({
      expectedType: lineArray,
      expression,
      resolveMember: () => ({ kind: "invalid", diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } }),
      resolveArrayReference: () => ({ kind: "resolved", targetValueId: "statement:paths", type: pathArray })
    });
    expect(result.value).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-assignability-mismatch" }));
  });
});
