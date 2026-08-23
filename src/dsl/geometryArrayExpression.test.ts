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
