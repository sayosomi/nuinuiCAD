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
      "curve C = bezier(start: A, end: B, startAngle: 0, startLength: 30, endAngle: 0, endLength: 30)",
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
      "curve C = bezier(start: A, end: B, startAngle: 0, startLength: 30, endAngle: 0, endLength: 30)",
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

  it("uses the existing coordinate-point and derived-point reference forms in point[] literals", () => {
    const ok = analyze([
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const points: point[] = [(1, 2), @L.start, @L.end]"
    ].join("\n"));
    expect(ok.namespace.diagnostics).toEqual([]);
    const value = ok.analysis.values.find((candidate) => candidate.name === "points")?.value;
    expect(value?.kind).toBe("literal");
    if (value?.kind === "literal") {
      expect(value.members.map((member) => member.target.kind === "geometry" ? member.target.pointKey ?? member.target.kind : member.target.kind))
        .toEqual(["coordinate", "start", "end"]);
    }

    const badCoordinate = analyze("nui 4\nconst paths: path[] = [(1, 2)]");
    expect(badCoordinate.namespace.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));

    const badDerived = analyze([
      "nui 4",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const paths: path[] = [@L.start]"
    ].join("\n"));
    expect(badDerived.namespace.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));
  });
});
