import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslCompletion } from "./dslCompletionQuery";

const revision = 33;

const compile = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: revision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `array-completion:${index}`]))
  });
};

const queryAt = (source: string, marker: string) => {
  const compiled = compile(source);
  const position = source.indexOf(marker) + marker.length;
  expect(position).toBeGreaterThanOrEqual(marker.length);
  return queryDslCompletion({
    source: { normalizedSource: source, sourceRevision: revision },
    position,
    semantic: { sourceRevision: revision, sourceText: source, compiled }
  });
};

const labels = (result: ReturnType<typeof queryDslCompletion>) => result?.candidates.map((candidate) => candidate.label) ?? [];

const geometryBase = [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line L = segment(start: @A, end: @B)",
  "arc Curve = arc(center: @A, radius: 10, start: 0, end: 90, direction: counterclockwise)"
];

describe("geometry array expected-type completion", () => {
  it("filters inline members by point/line/path interface", () => {
    const strict = [...geometryBase, "const strict: line[] = [@]"].join("\n");
    expect(labels(queryAt(strict, "[@"))).toContain("L");
    expect(labels(queryAt(strict, "[@"))).not.toContain("Curve");

    const paths = [...geometryBase, "const paths: path[] = [@]"].join("\n");
    expect(labels(queryAt(paths, "[@"))).toEqual(expect.arrayContaining(["L", "Curve"]));

    const points = [...geometryBase, "const points: point[] = [@]"].join("\n");
    expect(labels(queryAt(points, "[@"))).toEqual(expect.arrayContaining(["A", "B", "L.start", "L.end"]));
  });

  it("offers only assignable named arrays for a whole-array reference", () => {
    const source = [
      ...geometryBase,
      "const strict: line[] = [@L]",
      "const paths: path[] = [@Curve]",
      "const points: point[] = [@A]",
      "const copy: path[] = @"
    ].join("\n");
    const result = queryAt(source, "const copy: path[] = @");
    expect(labels(result)).toEqual(expect.arrayContaining(["strict", "paths"]));
    expect(labels(result)).not.toContain("points");
  });

  it("uses the Module parameter array type for inline and named arguments", () => {
    const named = [
      ...geometryBase,
      "const strict: line[] = [@L]",
      "const paths: path[] = [@Curve]",
      "module Use(paths: path[]) {",
      "}",
      "instance x = Use(paths: @)"
    ].join("\n");
    expect(labels(queryAt(named, "paths: @"))).toEqual(expect.arrayContaining(["strict", "paths"]));

    const inline = [
      ...geometryBase,
      "module Use(paths: path[]) {",
      "}",
      "instance x = Use(paths: [@])"
    ].join("\n");
    const result = queryAt(inline, "paths: [@");
    expect(labels(result)).toEqual(expect.arrayContaining(["L", "Curve"]));
    expect(inline.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe("@");
  });

  it("offers Module array parameters inside local array declarations", () => {
    const source = [
      "nui 1",
      "module Copy(paths: path[]) {",
      "  const local: path[] = @",
      "}",
    ].join("\n");
    expect(labels(queryAt(source, "const local: path[] = @"))).toContain("paths");
  });

  it("offers compatible exported arrays through a qualified instance reference", () => {
    const source = [
      "nui 1",
      "module Maker() {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 10, y: 0)",
      "  line L = segment(start: @A, end: @B)",
      "  export const edges: line[] = [@L]",
      "}",
      "instance made = Maker()",
      "const copy: path[] = @made::"
    ].join("\n");
    expect(labels(queryAt(source, "@made::"))).toContain("edges");
  });

  it("does not advertise immutable geometry-array types on let declarations", () => {
    const constSource = "const value: pa";
    expect(labels(queryAt(constSource, "pa"))).toEqual(expect.arrayContaining(["point[]", "path[]"]));

    const letSource = "let value: pa";
    expect(labels(queryAt(letSource, "pa"))).not.toEqual(expect.arrayContaining(["point[]"]));
    expect(labels(queryAt(letSource, "pa"))).not.toContain("point[]");
    expect(labels(queryAt(letSource, "pa"))).not.toContain("line[]");
    expect(labels(queryAt(letSource, "pa"))).not.toContain("path[]");
  });
});
