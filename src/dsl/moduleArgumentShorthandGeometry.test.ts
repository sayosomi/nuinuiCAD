import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { parseDslSnapshot } from "./dslParser";
import { planDslRenameEditsResult } from "./dslRenameQuery";

const source = [
  "nui 4",
  "point base = coordinate(x: 0, y: 0)",
  "module Marker(base: point) {",
  "  export point P = coordinate(x: @base.x, y: @base.y)",
  "}",
  "instance marker = Marker(@base)"
].join("\n");

const compile = () => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:geometry:${index}`]))
  });
};

const snapshot = (compiled: ReturnType<typeof compile>) => ({
  source: { normalizedSource: source, sourceRevision: 0 },
  semantic: { sourceRevision: 0, sourceText: source, compiled }
});

const applyEdits = (text: string, edits: readonly { from: number; to: number; newText: string }[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((result, edit) => `${result.slice(0, edit.from)}${edit.newText}${result.slice(edit.to)}`, text);

describe("geometry Module same-name argument shorthand", () => {
  it("uses the geometry caller value as the Definition target", () => {
    const compiled = compile();
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const shorthand = source.indexOf("@base", source.indexOf("instance marker")) + 1;
    const declaration = source.indexOf("base", source.indexOf("point base"));
    const result = queryDslDefinition({ ...snapshot(compiled), position: shorthand + 1 });
    expect(result?.declarationRange).toEqual({ from: declaration, to: declaration + "base".length });
  });

  it("expands shorthand when the caller geometry is renamed", () => {
    const compiled = compile();
    const declaration = source.indexOf("base", source.indexOf("point base"));
    const result = planDslRenameEditsResult(snapshot(compiled), declaration + 1, "origin");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const renamed = applyEdits(source, result.plan.edits);
    expect(renamed).toContain("point origin = coordinate");
    expect(renamed).toContain("Marker(base: @origin)");
  });
});
