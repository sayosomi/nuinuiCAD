import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslCompletion } from "./dslCompletionQuery";
import { queryDslDefinition } from "./dslDefinitionQuery";
import { queryDslReferences } from "./dslReferencesQuery";
import { planDslRenameEdits } from "./dslRenameQuery";
import { queryDslSignatureHelp } from "./dslSignatureHelpQuery";

const revision = 94;
const snapshot = (source: string) => ({ normalizedSource: source, sourceRevision: revision });

const compile = (source: string) => {
  const parsed = parseDslSnapshot(snapshot(source));
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `join-language:${index}`]))
  });
};

const semantic = (source: string) => {
  const compiled = compile(source);
  return { sourceRevision: revision, sourceText: source, compiled };
};

const textAt = (source: string, range: { from: number; to: number }) => source.slice(range.from, range.to);
const labels = (result: ReturnType<typeof queryDslCompletion>) => result?.candidates.map((candidate) => candidate.label) ?? [];

const base = [
  "nui 4",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "point C = coordinate(x: 20, y: 0)",
  "line First = segment(start: @A, end: @B)",
  "line Second = segment(start: @B, end: @C)"
];

describe("join language support", () => {
  it("shows the canonical path-array and closed parameter types in Signature Help", () => {
    const source = "nui 4\nline Joined = join(paths: ";
    const result = queryDslSignatureHelp({ source: snapshot(source), position: source.length });
    const parameters = result?.signatures[0]?.parameters ?? [];

    expect(parameters.find((parameter) => parameter.name === "paths")).toMatchObject({
      name: "paths",
      type: "path[]",
      optional: false
    });
    expect(parameters.find((parameter) => parameter.name === "closed")).toMatchObject({
      name: "closed",
      type: "boolean",
      optional: true,
      defaultValue: "false"
    });
  });

  it("offers compatible named arrays for the whole paths value and broad paths for inline members", () => {
    const namedSource = [
      ...base,
      "const strictLines: line[] = [@First]",
      "const paths: path[] = [@First, @Second]",
      "const points: point[] = [@A]",
      "line Joined = join(paths: @, closed: false)"
    ].join("\n");
    const namedPosition = namedSource.indexOf("paths: @") + "paths: @".length;
    const named = queryDslCompletion({
      source: snapshot(namedSource),
      position: namedPosition,
      semantic: semantic(namedSource)
    });
    expect(labels(named)).toEqual(expect.arrayContaining(["strictLines", "paths"]));
    expect(labels(named)).not.toContain("points");

    const inlineSource = [
      ...base,
      "line Joined = join(paths: [@], closed: false)"
    ].join("\n");
    const inlinePosition = inlineSource.indexOf("paths: [@") + "paths: [@".length;
    const inline = queryDslCompletion({
      source: snapshot(inlineSource),
      position: inlinePosition,
      semantic: semantic(inlineSource)
    });
    expect(labels(inline)).toEqual(expect.arrayContaining(["First", "Second"]));
    expect(labels(inline)).not.toContain("A");
  });

  it("uses the shared semantic occurrence owner for joined path members", () => {
    const source = [
      ...base,
      "line Joined = join(paths: [@First, @Second], closed: false)"
    ].join("\n");
    const compiled = compile(source);
    expect(compiled.diagnostics).toEqual([]);
    const semanticSnapshot = { sourceRevision: revision, sourceText: source, compiled };
    const position = source.lastIndexOf("@First") + 1;

    const definition = queryDslDefinition({ source: snapshot(source), position, semantic: semanticSnapshot });
    expect(definition).not.toBeNull();
    expect(textAt(source, definition!.declarationRange)).toBe("First");

    const references = queryDslReferences({ source: snapshot(source), position, semantic: semanticSnapshot });
    expect(references).not.toBeNull();
    expect(references!.referenceRanges.map((range) => textAt(source, range))).toContain("First");

    const rename = planDslRenameEdits({ source: snapshot(source), semantic: semanticSnapshot }, position, "Primary");
    expect(rename).not.toBeNull();
    expect(rename!.edits.map((edit) => edit.expectedText)).toEqual(expect.arrayContaining(["First", "First"]));
  });

  it("uses the shared geometry-array occurrence owner for a named join paths reference", () => {
    const source = [
      ...base,
      "const paths: path[] = [@First, @Second]",
      "line Joined = join(paths: @paths, closed: false)"
    ].join("\n");
    const compiled = compile(source);
    expect(compiled.diagnostics).toEqual([]);
    const semanticSnapshot = { sourceRevision: revision, sourceText: source, compiled };
    const position = source.lastIndexOf("@paths") + 1;

    const definition = queryDslDefinition({ source: snapshot(source), position, semantic: semanticSnapshot });
    expect(definition).not.toBeNull();
    expect(textAt(source, definition!.declarationRange)).toBe("paths");

    const references = queryDslReferences({ source: snapshot(source), position, semantic: semanticSnapshot });
    expect(references).not.toBeNull();
    expect(references!.referenceRanges.map((range) => textAt(source, range))).toContain("paths");

    const rename = planDslRenameEdits({ source: snapshot(source), semantic: semanticSnapshot }, position, "outlineParts");
    expect(rename).not.toBeNull();
    expect(rename!.edits.map((edit) => edit.expectedText)).toEqual(expect.arrayContaining(["paths", "paths"]));
  });
});
