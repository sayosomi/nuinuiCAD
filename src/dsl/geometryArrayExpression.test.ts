import { describe, expect, it } from "vitest";
import { parseGeometryArrayExpression } from "./geometryArrayExpression";

describe("geometry array expression parser", () => {
  it("preserves empty literals, source order, duplicates, and exact member spans", () => {
    const empty = parseGeometryArrayExpression("[]");
    expect(empty).toEqual({
      expression: { kind: "literal", span: { start: 0, end: 2 }, members: [] },
      diagnostics: []
    });

    const source = "[ @A, @B, @A ]";
    const result = parseGeometryArrayExpression(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.expression?.kind).toBe("literal");
    if (result.expression?.kind !== "literal") return;
    expect(result.expression.members.map((member) => member.text)).toEqual(["@A", "@B", "@A"]);
    expect(result.expression.members.map((member) => source.slice(member.span.start, member.span.end))).toEqual(["@A", "@B", "@A"]);
  });

  it("preserves nested call syntax as one member for point-value semantic checking", () => {
    const result = parseGeometryArrayExpression("[coordinate(x: 1, y: 2), @B]");
    expect(result.diagnostics).toEqual([]);
    expect(result.expression?.kind === "literal" ? result.expression.members.map((member) => member.text) : []).toEqual([
      "coordinate(x: 1, y: 2)",
      "@B"
    ]);
  });

  it("accepts whole-value geometry-array references", () => {
    expect(parseGeometryArrayExpression(" @edges ")).toEqual({
      expression: { kind: "reference", span: { start: 1, end: 7 }, text: "@edges" },
      diagnostics: []
    });
    expect(parseGeometryArrayExpression("@instance::edges").diagnostics).toEqual([]);
  });

  it("recognizes value-for contextually and keeps a bare for choice literal out of the collection grammar", () => {
    const source = "for item in @values { @item * 2 }";
    expect(parseGeometryArrayExpression(source)).toEqual({
      expression: {
        kind: "valueFor",
        span: { start: 0, end: source.length },
        binder: "item",
        binderSpan: { start: 4, end: 8 },
        sourceText: "@values",
        sourceSpan: { start: 12, end: 19 },
        bodySpan: { start: 22, end: 31 }
      },
      diagnostics: []
    });
    const choiceLiteral = parseGeometryArrayExpression("[for]");
    expect(choiceLiteral.diagnostics).toEqual([]);
    expect(choiceLiteral.expression).toMatchObject({ kind: "literal", members: [{ text: "for" }] });
  });

  it("does not treat braces inside a quoted source segment as the value-for body", () => {
    const source = "for item in @\"values{draft\" { @item }";
    const result = parseGeometryArrayExpression(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.expression).toMatchObject({ kind: "valueFor", sourceText: '@"values{draft"' });
  });

  it("reports malformed, empty-member, nested-array, and non-array expressions", () => {
    expect(parseGeometryArrayExpression("[@A").diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-unclosed-literal" })
    );
    expect(parseGeometryArrayExpression("[@A,,@B]").diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-empty-member" })
    );
    expect(parseGeometryArrayExpression("[[@A], @B]").diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-nested-array" })
    );
    expect(parseGeometryArrayExpression("@A + @B").diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-invalid-expression" })
    );
    expect(parseGeometryArrayExpression("[] trailing").diagnostics).toContainEqual(
      expect.objectContaining({ code: "geometry-array-trailing-token" })
    );
  });
});
