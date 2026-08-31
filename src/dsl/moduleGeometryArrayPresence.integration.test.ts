import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";

const compileWithIds = (source: string, prefix = "array-presence") => {
  const parsed = parseDsl(source);
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `${prefix}:${index}`] as const))
  });
};

const errorsOf = (compiled: ReturnType<typeof compileWithIds>) =>
  compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("module geometry array presence", () => {
  it("allows an optional path[] consumer after hasValue proves presence", () => {
    const compiled = compileWithIds([
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "module M(paths?: path[]) {",
      "  if (hasValue(@paths)) {",
      "    line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "  }",
      "}",
      "instance Omitted = M()",
      "instance Supplied = M(paths: [@A])"
    ].join("\n"));

    expect(errorsOf(compiled)).toEqual([]);
  });

  it("rejects an optional path[] consumer without a presence guard", () => {
    const compiled = compileWithIds([
      "nui 1",
      "module M(paths?: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}"
    ].join("\n"));

    expect(errorsOf(compiled)).toContainEqual(expect.objectContaining({
      code: "module-optional-value-required"
    }));
  });
});
