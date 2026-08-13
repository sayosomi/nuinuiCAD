import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";

const compile = (source: string): TextCompileResult =>
  compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);

const errorCodes = (result: TextCompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code);

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
      "for Loop (i, from: 0, count: 2, step: 1) {",
      "  point P = coordinate(x: @i + 2, y: 0)",
      "}"
    ].join("\n")
  ])("accepts valid numeric arithmetic: %s", (body) => {
    const result = compile(["nui 3", body].join("\n"));
    expect(errorCodes(result)).toEqual([]);
  });

  it.each([
    "const n: number = 2\npoint P = coordinate(x: @n > 0, y: 0)",
    [
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point P = coordinate(x: @AB.length > 0, y: 0)"
    ].join("\n"),
    [
      "for Loop (i, from: 0, count: 2, step: 1) {",
      "  point P = coordinate(x: @i > 0, y: 0)",
      "}"
    ].join("\n")
  ])("rejects boolean results for numeric construction arguments: %s", (body) => {
    const result = compile(["nui 3", body].join("\n"));
    expect(errorCodes(result).filter((code) => code === "scalar-type-mismatch")).toHaveLength(1);
  });
});
