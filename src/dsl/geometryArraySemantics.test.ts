import { describe, expect, it } from "vitest";
import { parseGeometryArrayExpression } from "@nuinuicad/nui-language";
import { resolveDslArrayExpression, resolveGeometryArrayExpression } from "@nuinuicad/nui-language";
import type { GeometryArrayType } from "@nuinuicad/nui-language";

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

  it("keeps generic collection semantic diagnostics locale-neutral", () => {
    const numberArray = { kind: "array" as const, elementType: { kind: "number" as const } };
    const memberResolver = () => ({ kind: "resolved" as const, value: { elementType: { kind: "number" as const }, target: "member" } });

    const missingElse = resolveDslArrayExpression({
      expectedType: numberArray,
      expression: literal("if (true) { [1] }"),
      resolveMember: memberResolver,
      resolveArrayReference: () => ({ kind: "invalid" as const, diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(missingElse.diagnostics).toContainEqual(expect.objectContaining({
      code: "value-if-missing-else",
      message: "else を省略できる value-if の結果型は optional collection である必要があります。"
    }));

    const coalesce = resolveDslArrayExpression({
      expectedType: numberArray,
      expression: literal("@values ?? []"),
      resolveMember: memberResolver,
      resolveArrayReference: () => ({ kind: "resolved" as const, targetValueId: "values", valueType: numberArray })
    });
    expect(coalesce.diagnostics).toContainEqual(expect.objectContaining({ code: "coalesce-left-not-optional" }));

    const unsupportedValueFor = resolveDslArrayExpression({
      expectedType: numberArray,
      expression: literal("for item in @values { @item }"),
      resolveMember: memberResolver,
      resolveArrayReference: () => ({ kind: "invalid" as const, diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(unsupportedValueFor.diagnostics).toContainEqual(expect.objectContaining({ code: "array-value-for-unsupported" }));

    const mismatch = resolveDslArrayExpression({
      expectedType: numberArray,
      expression: literal("@values"),
      resolveMember: memberResolver,
      resolveArrayReference: () => ({
        kind: "resolved" as const,
        targetValueId: "values",
        valueType: { kind: "array" as const, elementType: { kind: "string" as const } }
      })
    });
    expect(mismatch.diagnostics).toContainEqual(expect.objectContaining({
      code: "array-assignability-mismatch",
      presentation: { key: "diagnostic.array-assignability-mismatch", parameters: { actual: "string[]", expected: "number[]" } }
    }));
  });

  it("keeps geometry collection semantic diagnostics locale-neutral", () => {
    const invalidExpected = resolveGeometryArrayExpression({
      expectedType: pointArray,
      expectedValueType: { kind: "number" as const },
      expression: literal("[]"),
      resolveMember: () => ({ kind: "resolved" as const, value: { interfaceType: "point" as const, target: "point" } }),
      resolveArrayReference: () => ({ kind: "invalid" as const, diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(invalidExpected.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-expected-array" }));

    const missingElse = resolveGeometryArrayExpression({
      expectedType: pointArray,
      expression: literal("if (true) { [] }"),
      resolveMember: () => ({ kind: "resolved" as const, value: { interfaceType: "point" as const, target: "point" } }),
      resolveArrayReference: () => ({ kind: "invalid" as const, diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(missingElse.diagnostics).toContainEqual(expect.objectContaining({ code: "value-if-missing-else" }));

    const unsupportedValueFor = resolveGeometryArrayExpression({
      expectedType: pointArray,
      expression: literal("for item in @values { @item }"),
      resolveMember: () => ({ kind: "resolved" as const, value: { interfaceType: "point" as const, target: "point" } }),
      resolveArrayReference: () => ({ kind: "invalid" as const, diagnostic: { code: "unexpected", message: "unexpected", span: { start: 0, end: 0 } } })
    });
    expect(unsupportedValueFor.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-value-for-unsupported" }));
  });
});
