import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import { compileDslDocument } from "./dslDocument";

const analyze = (source: string) => {
  const parsed = parseDsl(source);
  const ids = new Map(parsed.statements.map((_, index) => [index, `statement:${index}`]));
  const namespace = buildSourceLexicalNamespaceIndex(parsed.statements, ids);
  return { parsed, namespace, analysis: namespace.geometryArraySemanticAnalysis! };
};

describe("geometry array source semantic integration", () => {
  it("uses the shared collection owner for scalar and nominal-record arrays", () => {
    const { namespace, analysis } = analyze([
      "nui 1",
      "record Pair(x: number)",
      "const numbers: number[] = [1, 2, 3]",
      "const labels: string[] = [\"a\", \"b\"]",
      "const flags: boolean[] = [true, false]",
      "const modes: choice(left, right)[] = [left, right]",
      "const pair: Pair = Pair(x: 1)",
      "const pairs: Pair[] = [@pair]",
      "const numberAlias: number[] = @numbers"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual([]);
    expect(analysis.genericValues.map((value) => value.name)).toEqual(["numbers", "labels", "flags", "modes", "pairs", "numberAlias"]);
    expect(analysis.genericValues.find((value) => value.name === "pairs")?.value).toMatchObject({
      kind: "literal",
      valueType: { kind: "array", elementType: { kind: "record", name: "Pair" } }
    });
    expect(analysis.genericValues.find((value) => value.name === "numberAlias")?.value).toMatchObject({
      kind: "alias",
      targetValueId: "statement:2"
    });
  });

  it("uses nominal record identity for collection members and declarations", () => {
    const result = analyze([
      "nui 1",
      "record Pair(x: number)",
      "record Other(x: number)",
      "const pair: Pair = Pair(x: 1)",
      "const pairs: Other[] = [@pair]",
      "const missing: Missing[] = []"
    ].join("\n"));
    expect(result.namespace.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "array-member-type-mismatch" }),
      expect.objectContaining({ code: "record-type-undefined" })
    ]));
  });

  it("keeps collection member and whole-value assignment fail-closed", () => {
    const { namespace } = analyze([
      "nui 1",
      "const numbers: number[] = [1, \"wrong\"]",
      "const labels: string[] = @numbers",
      "const forward: boolean[] = @later",
      "const later: boolean[] = []"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "array-member-type-mismatch", exactSpanOnly: true }),
      expect.objectContaining({ code: "array-assignability-mismatch", exactSpanOnly: true }),
      expect.objectContaining({ code: "array-reference-forward", exactSpanOnly: true })
    ]));
  });

  it("shares collection parameter semantics across Module locals and exports", () => {
    const { namespace, analysis } = analyze([
      "nui 1",
      "module M(values: number[], labels?: string[]) {",
      "  const local: number[] = @values",
      "  export const out: string[] = @labels",
      "}"
    ].join("\n"));

    expect(namespace.diagnostics).toEqual([]);
    expect(analysis.genericModuleParameters.map((parameter) => [parameter.name, parameter.valueType.elementType.kind, parameter.optional])).toEqual([
      ["values", "number", false],
      ["labels", "string", true]
    ]);
    expect(analysis.genericValues.find((value) => value.name === "local")?.value).toMatchObject({ kind: "alias" });
    expect(analysis.genericValues.find((value) => value.name === "out")?.exported).toBe(true);
  });

  it("keeps root collection declarations on the document compilation path", () => {
    const source = [
      "nui 1",
      "const numbers: number[] = [1, 2]",
      "const labels: string[] = [\"a\"]"
    ].join("\n");
    const parsed = parseDsl(source);
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]))
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks compatible whole-value collection arguments at Module boundaries", () => {
    const compatible = analyze([
      "nui 1",
      "const numbers: number[] = [1]",
      "module M(values: number[]) {",
      "  const local: number[] = @values",
      "}",
      "instance use = M(values: @numbers)"
    ].join("\n"));
    expect(compatible.namespace.diagnostics).toEqual([]);
    const compatibleSource = [
      "nui 1",
      "const numbers: number[] = [1]",
      "module M(values: number[]) {",
      "  const local: number[] = @values",
      "}",
      "instance use = M(values: @numbers)"
    ].join("\n");
    const compatibleParsed = parseDsl(compatibleSource);
    const compatibleCompiled = compileDslDocument(compatibleSource, {
      preparsed: compatibleParsed,
      assignedStatementIds: new Map(compatibleParsed.statements.map((_, index) => [index, `stable-boundary-${index}`]))
    });
    expect(compatibleCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const incompatible = analyze([
      "nui 1",
      "const labels: string[] = [\"a\"]",
      "module M(values: number[]) {",
      "}",
      "instance use = M(values: @labels)"
    ].join("\n"));
    expect(incompatible.namespace.diagnostics).toContainEqual(expect.objectContaining({
      code: "array-argument-type-mismatch",
      exactSpanOnly: true
    }));
  });

  it("checks qualified whole-value collection exports without flattening identity", () => {
    const { namespace } = analyze([
      "nui 1",
      "module M() {",
      "  export const labels: string[] = [\"a\"]",
      "}",
      "instance use = M()",
      "const bad: number[] = @use::labels"
    ].join("\n"));
    expect(namespace.diagnostics).toContainEqual(expect.objectContaining({
      code: "array-assignability-mismatch",
      exactSpanOnly: true
    }));
  });
  it("preserves order/duplicates and lifts line[] to path[] aliases", () => {
    const { parsed, namespace, analysis } = analyze([
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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
      "nui 1",
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

    const badCoordinate = analyze("nui 1\nconst paths: path[] = [(1, 2)]");
    expect(badCoordinate.namespace.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));

    const badDerived = analyze([
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const paths: path[] = [@L.start]"
    ].join("\n"));
    expect(badDerived.namespace.diagnostics).toContainEqual(expect.objectContaining({ code: "geometry-array-member-type-mismatch" }));
  });

  it("keeps pure geometry collection members as value occurrences", () => {
    const result = analyze([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const origin: point = @A",
      "const points: point[] = [@origin]"
    ].join("\n"));
    expect(result.namespace.diagnostics).toEqual([]);
    const value = result.analysis.values.find((candidate) => candidate.name === "points")?.value;
    expect(value?.kind).toBe("literal");
    if (value?.kind === "literal") expect(value.members[0]?.target.kind).toBe("geometryValue");
  });
});
