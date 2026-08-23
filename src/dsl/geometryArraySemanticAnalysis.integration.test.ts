import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";

const analyze = (source: string) => {
  const parsed = parseDsl(source);
  const ids = new Map(parsed.statements.map((_, index) => [index, `statement:${index}`]));
  const namespace = buildSourceLexicalNamespaceIndex(parsed.statements, ids);
  return { parsed, namespace, analysis: namespace.geometryArraySemanticAnalysis! };
};

describe("geometry array source semantic integration", () => {
  it("preserves order/duplicates and lifts line[] to path[] aliases", () => {
    const { parsed, namespace, analysis } = analyze([
      "nui 4",
      "line L = segment(start: A, end: B)",
      "curve C = bezier(start: A, control1: A, control2: B, end: B)",
      "const straight: line[] = [@L, @L]",
      "const paths: path[] = [@L, @C, @L]",
      "const alias: path[] = @straight"
    ].join("\n"));

    expect(parsed.diagnostics).toEqual([]);
    expect(namespace.diagnostics).toEqual([]);
    const straight = analysis.values.find((value) => value.name === "straight")!;
    expect(straight.value?.kind).toBe("literal");
    if (straight.value?.kind === "literal") {
      expect(straight.value.members.map((member) => member.target.kind === "geometry" ? member.target.statementId : member.target.kind))
        .toEqual(["statement:1", "statement:1"]);
    }
    expect(analysis.values.find((value) => value.name === "alias")?.value).toMatchObject({
      kind: "alias",
      targetValueId: "statement:3",
      type: { kind: "geometryArray", elementType: "path" }
    });
  });

  it("resolves module array parameters as read-only local aliases", () => {
    const { namespace, analysis } = analyze([
      "nui 4",
      "module M(edges: line[], anchors?: point[]) {",
      "  const paths: path[] = @edges",
      "  const points: point[] = @anchors",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual([]);
    expect(analysis.moduleParameters.map((parameter) => [parameter.name, parameter.type.elementType, parameter.optional])).toEqual([
      ["edges", "line", false],
      ["anchors", "point", true]
    ]);
    expect(analysis.values.find((value) => value.name === "paths")?.value).toMatchObject({
      kind: "alias",
      targetValueId: "statement:1:parameter:0",
      type: { elementType: "path" }
    });
  });

  it("reports strict member mismatches, forward array aliases, and Module defaults", () => {
    const { namespace } = analyze([
      "nui 4",
      "curve C = bezier(start: A, control1: A, control2: B, end: B)",
      "const badLine: line[] = [@C]",
      "const forward: path[] = @later",
      "const later: path[] = []",
      "module M(paths: path[] = []) {",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "geometry-array-member-type-mismatch", exactSpanOnly: true }),
      expect.objectContaining({ code: "geometry-array-reference-forward", exactSpanOnly: true }),
      expect.objectContaining({ code: "geometry-array-parameter-default", exactSpanOnly: true })
    ]));
  });

  it("accepts coordinate(...) values only in point[] literals", () => {
    const ok = analyze("nui 4\nconst points: point[] = [coordinate(x: 1, y: 2)]");
    expect(ok.namespace.diagnostics).toEqual([]);
    expect(ok.analysis.values[0]?.value?.kind).toBe("literal");

    const bad = analyze("nui 4\nconst paths: path[] = [coordinate(x: 1, y: 2)]");
    expect(bad.namespace.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));
  });
});
