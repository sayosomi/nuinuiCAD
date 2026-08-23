import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { queryDslReferences } from "./dslReferencesQuery";
import { planDslRenameEdits } from "./dslRenameQuery";

const revision = 7;

const compile = (source: string): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: revision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `array-query:${index}`]))
  });
};

const semantic = (source: string) => ({ sourceRevision: revision, sourceText: source, compiled: compile(source) });
const sourceSnapshot = (source: string) => ({ normalizedSource: source, sourceRevision: revision });
const positionAt = (source: string, token: string, occurrence = 0) => {
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) index = source.indexOf(token, index + 1);
  if (index < 0) throw new Error(`missing token ${token}`);
  return index + token.length;
};

const source = [
  "nui 4",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line L = segment(start: @A, end: @B)",
  "const lines: line[] = [@L, @L]",
  "const paths: path[] = @lines",
  "module M(items: path[]) {",
  "  export const local: path[] = @items",
  "}"
].join("\n");

describe("geometry array language queries", () => {
  it("uses the existing Definition/References index for named array aliases", () => {
    const compiled = compile(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const definition = queryDslDefinition({
      source: sourceSnapshot(source),
      position: positionAt(source, "@lines"),
      semantic: { sourceRevision: revision, sourceText: source, compiled }
    });
    expect(definition).not.toBeNull();
    expect(source.slice(definition!.referenceRange.from, definition!.referenceRange.to)).toBe("lines");
    expect(source.slice(definition!.declarationRange.from, definition!.declarationRange.to)).toBe("lines");

    const references = queryDslReferences({
      source: sourceSnapshot(source),
      position: source.indexOf("const lines") + "const ".length + 1,
      semantic: { sourceRevision: revision, sourceText: source, compiled }
    });
    expect(references).not.toBeNull();
    expect(source.slice(references!.declarationRange.from, references!.declarationRange.to)).toBe("lines");
    expect(references!.referenceRanges.map((range) => source.slice(range.from, range.to))).toEqual(["lines"]);
  });

  it("maps array members and Module array parameters to their existing semantic declarations", () => {
    const compiled = compile(source);
    const member = queryDslDefinition({
      source: sourceSnapshot(source),
      position: positionAt(source, "@L", 0),
      semantic: { sourceRevision: revision, sourceText: source, compiled }
    });
    expect(member).not.toBeNull();
    expect(source.slice(member!.declarationRange.from, member!.declarationRange.to)).toBe("L");

    const parameter = queryDslDefinition({
      source: sourceSnapshot(source),
      position: positionAt(source, "@items"),
      semantic: { sourceRevision: revision, sourceText: source, compiled }
    });
    expect(parameter).not.toBeNull();
    expect(source.slice(parameter!.declarationRange.from, parameter!.declarationRange.to)).toBe("items");
  });

  it("feeds named array occurrences into the existing Rename planner", () => {
    const plan = planDslRenameEdits(
      { source: sourceSnapshot(source), semantic: semantic(source) },
      source.indexOf("const lines") + "const ".length + 1,
      "edges"
    );
    expect(plan).not.toBeNull();
    expect(plan!.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["lines", "lines"]);
    expect(plan!.edits.every((edit) => edit.newText === "edges")).toBe(true);
  });
});
