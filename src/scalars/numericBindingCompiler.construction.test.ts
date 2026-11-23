import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { emptyDocument } from "@nuinuicad/nui-language";

const compile = (source: string): TextCompileResult =>
  compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);

const errorCodes = (result: TextCompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);

const iterationReferences = (result: TextCompileResult) =>
  [...result.doc.numericBindings?.values() ?? []].flatMap(binding => binding.references);

describe("construction numeric typed-expression bridge", () => {
  it.each([
    "const n: number = 2\npoint P = coordinate(x: n + 2, y: 0)",
    [
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "point P = coordinate(x: AB.length + 2, y: 0)"
    ].join("\n"),
    [
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point P = coordinate(x: i + 2, y: 0)",
      "}"
    ].join("\n"),
    "const foo: number = 1\npoint P = coordinate(x: foo + 2, y: 0)",
    "const foo: number = 1\npoint P = coordinate(x: (foo + 2) * 3, y: 0)",
    "const foo: number = 1\nconst n: number = 2\npoint P = coordinate(x: foo + n, y: 0)"
  ])("accepts valid numeric arithmetic: %s", (body) => {
    const result = compile(["nui 1", body].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("keeps geometry property typechecking alongside a typed numeric binding", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: A, end: B)",
      "const foo: number = 1",
      "point P = coordinate(x: foo + AB.length, y: 0)"
    ].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("reserves pi against a numeric declaration", () => {
    const result = compile([
      "nui 1",
      "const pi: number = 2",
      "point P = coordinate(x: pi, y: 0)"
    ].join("\n"));
    expect(errorCodes(result)).toEqual(["reserved-builtin-constant-name"]);
  });

  it("reserves pi against a statement iteration binding", () => {
    const result = compile([
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for pi in range(min: 0, max: 0, step: 1) {",
      "  point P = offset(from: Anchor, dx: pi, dy: 0)",
      "}"
    ].join("\n"));
    expect(errorCodes(result)).toEqual(["reserved-builtin-constant-name"]);
  });

  it("rejects @pi in a numeric initializer as a choice without context", () => {
    const result = compile("nui 1\nconst value: number = @pi");
    expect(errorCodes(result)).toEqual(["invalid-choice-literal"]);
  });

  it("rejects a marked iteration binding at the exact choice-token span", () => {
    const source = [
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point P = offset(from: Anchor, dx: @i * 10, dy: 0)",
      "}"
    ].join("\n");
    const result = compile(source);
    const diagnostics = result.diagnostics;

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "invalid-choice-literal",
      exactSpanOnly: true,
      message: expect.stringContaining("i")
    });
    const segment = diagnostics[0]?.physicalSpan?.segments[0];
    const markerOffset = source.indexOf("@i * 10");
    expect(segment).toMatchObject({ from: markerOffset, to: markerOffset + 2 });
    expect(source.slice(segment?.from ?? -1, segment?.to ?? -1)).toBe("@i");
    expect(result.status).toBe("fatal");
  });

  it("resolves visible outer and inner iteration bindings through nested lexical scopes", () => {
    const source = [
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for outer in range(min: 0, max: 1, step: 1) {",
      "  point Outer = offset(from: Anchor, dx: outer * 10, dy: 0)",
      "  for inner in range(min: 0, max: 1, step: 1) {",
      "    point Nested = offset(from: Anchor, dx: outer + inner, dy: 0)",
      "  }",
      "}"
    ].join("\n");
    const result = compile(source);

    expect(errorCodes(result)).toEqual([]);
    const references = iterationReferences(result);
    expect(references.map(reference => {
      const span = reference.physicalNameSpan!.segments[0]!;
      return source.slice(span.from, span.to);
    })).toEqual(["outer", "outer", "inner"]);
    expect(references[0]?.bindingId).toBe(references[1]?.bindingId);
    expect(references[1]?.bindingId).not.toBe(references[2]?.bindingId);
  });

  it("uses the innermost iteration binding when nested loops shadow the same name", () => {
    const source = [
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point Outer = offset(from: Anchor, dx: i, dy: 0)",
      "  for i in range(min: 0, max: 1, step: 1) {",
      "    point Inner = offset(from: Anchor, dx: i, dy: 0)",
      "  }",
      "}"
    ].join("\n");
    const result = compile(source);
    expect(errorCodes(result)).toEqual([]);
    const references = iterationReferences(result);

    expect(references).toHaveLength(2);
    expect(references[0]?.bindingId).not.toBe(references[1]?.bindingId);
    expect(references.map((reference) => {
      const segment = reference.physicalNameSpan?.segments[0];
      return segment ? source.slice(segment.from, segment.to) : "";
    })).toEqual(["i", "i"]);
    expect(references[1]?.physicalNameSpan?.segments[0]?.from).toBe(source.lastIndexOf("i, dy: 0"));
  });

  it("keeps bare iteration references, geometry properties, and builtin geometry/numeric calls valid", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: A, end: B)",
      "point Measurement = coordinate(x: distance(A, B), y: 0)",
      "for i in range(min: 0, max: 1, step: 1) {",
      "  point P = offset(from: A, dx: i + AB.length + sqrt(9), dy: 0)",
      "}"
    ].join("\n"));

    expect(errorCodes(result)).toEqual([]);
  });

});
