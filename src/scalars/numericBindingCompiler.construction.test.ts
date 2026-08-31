import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";

const compile = (source: string): TextCompileResult =>
  compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);

const errorCodes = (result: TextCompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);

const iterationReferenceDiagnostics = (result: TextCompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.code === "numeric-binding-iteration-reference");

describe("construction numeric typed-expression bridge", () => {
  it.each([
    "const n: number = 2\npoint P = coordinate(x: @n + 2, y: 0)",
    [
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point P = coordinate(x: @AB.length + 2, y: 0)"
    ].join("\n"),
    [
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point P = coordinate(x: @i + 2, y: 0)",
      "}"
    ].join("\n"),
    "const foo: number = 1\npoint P = coordinate(x: @foo + 2, y: 0)",
    "const foo: number = 1\npoint P = coordinate(x: (@foo + 2) * 3, y: 0)",
    "const foo: number = 1\nconst n: number = 2\npoint P = coordinate(x: @foo + @n, y: 0)"
  ])("accepts valid numeric arithmetic: %s", (body) => {
    const result = compile(["nui 1", body].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("keeps geometry property typechecking alongside a typed numeric binding", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "const foo: number = 1",
      "point P = coordinate(x: @foo + @AB.length, y: 0)"
    ].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("keeps bare pi separate from an ordinary user binding named pi", () => {
    const result = compile([
      "nui 1",
      "const pi: number = 2",
      "point P = coordinate(x: pi, y: @pi)"
    ].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("does not turn bare pi into a for-iteration reference while @pi remains ordinary", () => {
    const result = compile([
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for pi in range(from: 0, count: 1, step: 1) {",
      "  point P = offset(from: @Anchor, dx: pi, dy: @pi)",
      "}"
    ].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it("keeps @pi undefined when no user binding exists", () => {
    const result = compile("nui 1\nconst value: number = @pi");
    expect(result.doc?.bindingAnalysis?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "undefined-binding" })
    ]));
  });

  it("rejects a bare for iteration binding at its exact identifier span and names the @ spelling", () => {
    const source = [
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point P = offset(from: @Anchor, dx: i * 10, dy: 0)",
      "}"
    ].join("\n");
    const result = compile(source);
    const diagnostics = iterationReferenceDiagnostics(result);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "numeric-binding-iteration-reference",
      exactSpanOnly: true,
      message: expect.stringContaining("@i")
    });
    const segment = diagnostics[0]?.physicalSpan?.segments[0];
    const bareOffset = source.indexOf("i * 10");
    expect(segment).toMatchObject({ from: bareOffset, to: bareOffset + 1 });
    expect(source.slice(segment?.from ?? -1, segment?.to ?? -1)).toBe("i");
    expect(result.status).toBe("fatal");
  });

  it("rejects visible outer and inner iteration bindings through nested lexical scopes", () => {
    const result = compile([
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for outer in range(from: 0, count: 2, step: 1) {",
      "  point Outer = offset(from: @Anchor, dx: outer * 10, dy: 0)",
      "  for inner in range(from: 0, count: 2, step: 1) {",
      "    point Nested = offset(from: @Anchor, dx: outer + inner, dy: 0)",
      "  }",
      "}"
    ].join("\n"));

    const diagnostics = iterationReferenceDiagnostics(result);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("@outer"),
      expect.stringContaining("@outer"),
      expect.stringContaining("@inner")
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.physicalSpan?.segments[0])).toBe(true);
  });

  it("uses the innermost iteration binding when nested loops shadow the same name", () => {
    const source = [
      "nui 1",
      "point Anchor = coordinate(x: 0, y: 0)",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point Outer = offset(from: @Anchor, dx: i, dy: 0)",
      "  for i in range(from: 0, count: 2, step: 1) {",
      "    point Inner = offset(from: @Anchor, dx: i, dy: 0)",
      "  }",
      "}"
    ].join("\n");
    const result = compile(source);
    const diagnostics = iterationReferenceDiagnostics(result);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => {
      const segment = diagnostic.physicalSpan?.segments[0];
      return segment ? source.slice(segment.from, segment.to) : "";
    })).toEqual(["i", "i"]);
    expect(diagnostics[1]?.physicalSpan?.segments[0]?.from).toBe(source.lastIndexOf("i, dy: 0"));
  });

  it("keeps explicit iteration references, geometry properties, and builtin geometry/numeric calls valid", () => {
    const result = compile([
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 3, y: 4)",
      "line AB = segment(start: @A, end: @B)",
      "point Measurement = coordinate(x: distance(A, B), y: 0)",
      "for i in range(from: 0, count: 2, step: 1) {",
      "  point P = offset(from: @A, dx: @i + @AB.length + sqrt(9), dy: 0)",
      "}"
    ].join("\n"));

    expect(errorCodes(result)).toEqual([]);
  });

});
