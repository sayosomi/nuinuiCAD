import { describe, expect, it } from "vitest";
import { compileDslDocument, serializeDocumentToDsl } from "./dslDocument";
import { dslReferenceCompletionOptions } from "./dslCompletionCandidates";
import { parseScalarExpression } from "../scalars/expressionParser";

describe("unified @ source-reference frontend", () => {
  it("accepts every ordinary geometry reference role through the shared syntax", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point C = offset(from: @AB.start, dx: 1, dy: 0)",
      "line D = offset(sources: [@AB], distance: 1, side: left, closed: false)"
    ].join("\n");
    const compiled = compileDslDocument(source);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
  });

  it("rejects bare geometry references with an exact source span", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: A, end: @A)"
    ].join("\n");
    const error = compileDslDocument(source).diagnostics.find((diagnostic) => diagnostic.code === "invalid-source-reference");
    expect(error).toMatchObject({ severity: "error", exactSpanOnly: true });
    const segment = error?.physicalSpan?.segments[0];
    expect(segment && source.slice(segment.from, segment.to)).toBe("A");
  });

  it("round-trips canonical geometry references with @", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)"
    ].join("\n");
    const compiled = compileDslDocument(source);
    expect(compiled.document).not.toBeNull();
    const serialized = serializeDocumentToDsl(compiled.document!, 1);
    expect(serialized).toContain("start: @A");
    expect(serialized).toContain("end: @B");
    expect(compileDslDocument(serialized).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps semantic completion labels bare but inserts the source marker", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line AB = segment(start: @A, end: @B)",
      "point C = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileDslDocument(source);
    const line = source.split("\n").length;
    const options = dslReferenceCompletionOptions({
      source,
      cursorLine: line,
      kind: "reference",
      query: "@",
      statementElementIds: new Map(Array.from(compiled.statementMap!.byElementId.entries(), ([elementId, statement]) => [statement.line, elementId] as const)),
      elements: compiled.document!.elements
    });
    const a = options.find((option) => option.label === "A");
    expect(a).toMatchObject({ label: "A", sourceToken: "@A" });
  });

  it("shares qualified and quoted path grammar with typed scalar properties", () => {
    const source = '@"Outer name"::"Inner name".length';
    const result = parseScalarExpression(source, { start: 0, end: source.length });
    expect(result.diagnostics).toEqual([]);
    expect(result.ast).toMatchObject({
      kind: "geometryProperty",
      elementName: '"Outer name"::"Inner name"',
      property: "length"
    });
  });
});
