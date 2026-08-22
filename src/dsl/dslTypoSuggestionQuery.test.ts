import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslTypoSuggestions } from "./dslTypoSuggestionQuery";
import type { DslDiagnostic } from "./dslTypes";

const SOURCE_REVISION = 37;

const compileWithIds = (source: string, sourceRevision = SOURCE_REVISION): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `typo-query-test:${index}`]))
  });
};

const diagnosticsOf = (compiled: CompiledDslDocument): readonly DslDiagnostic[] => [
  ...compiled.diagnostics,
  ...(compiled.bindingIssueDiagnostics ?? [])
];

const queryFor = (source: string, code: string) => {
  const compiled = compileWithIds(source);
  const diagnostic = diagnosticsOf(compiled).find((item) => item.code === code);
  expect(diagnostic, `missing ${code}`).toBeDefined();
  const result = queryDslTypoSuggestions({
    source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
    diagnostic: diagnostic!,
    semantic: { sourceRevision: SOURCE_REVISION, compiled }
  });
  return { compiled, diagnostic: diagnostic!, result };
};

const labels = (source: string, code: string) => queryFor(source, code).result?.candidates.map((candidate) => candidate.label) ?? [];

describe("queryDslTypoSuggestions", () => {
  it("reuses canonical keyword, type, construction, and construction-argument candidates", () => {
    expect(labels("nui 4\npont P = coordinate(x: 0, y: 0)", "unknown-dsl-keyword")).toContain("point");
    expect(labels("nui 4\nlet value: numbr = 10", "unknown-type")).toContain("number");

    const construction = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segmnt(start: @A, end: @B)"
    ].join("\n");
    expect(labels(construction, "unknown-construction")).toContain("segment");

    const argument = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segment(strat: @A, end: @B)"
    ].join("\n");
    expect(labels(argument, "unknown-construction-argument")).toContain("start");
  });

  it("uses the completion-owned edit range inside an exact @binding diagnostic span", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @widht"
    ].join("\n");
    const { diagnostic, result } = queryFor(source, "undefined-binding");
    expect(result).not.toBeNull();
    expect(result?.typedText).toBe("widht");
    expect(source.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe("widht");
    expect(result?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "binding", label: "width", distance: 1 })
    ]));
    const [diagnosticRange] = diagnostic.physicalSpan!.segments;
    expect(source.slice(diagnosticRange.from, diagnosticRange.to)).toBe("@widht");
    expect(result!.replacementRange.from).toBe(diagnosticRange.from + 1);
  });

  it("filters geometry suggestions through the current expected geometry kind and source order", () => {
    const source = [
      "nui 4",
      "point Anchor = coordinate(x: 0, y: 0)",
      "line Existing = segment(start: @Anchor, end: @Anchor)",
      "line Use = segment(start: @Anchro, end: @Anchor)"
    ].join("\n");
    const { result } = queryFor(source, "undefined-geometry-reference");
    expect(result?.typedText).toBe("Anchro");
    expect(result?.candidates[0]).toMatchObject({ kind: "geometry", label: "Anchor", distance: 1 });
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Existing");
  });

  it("reuses Module callee, argument, and body-reference visibility", () => {
    const calleeSource = [
      "nui 4",
      "module Pocket(width: number) {",
      "}",
      "instance Use = Pockte(width: 10)"
    ].join("\n");
    expect(labels(calleeSource, "module-unresolved-callee")).toContain("Pocket");

    const argumentSource = [
      "nui 4",
      "module M(startPoint: point) {",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "instance Use = M(stratPoint: @A)"
    ].join("\n");
    expect(labels(argumentSource, "module-unknown-argument")).toContain("startPoint");

    const bodySource = [
      "nui 4",
      "module M(width: number) {",
      "  const doubled: number = @widht * 2",
      "}"
    ].join("\n");
    expect(labels(bodySource, "module-undefined-reference")).toContain("width");
  });

  it("returns every threshold-eligible candidate in deterministic distance then authority order", () => {
    const source = [
      "nui 4",
      "const alpha: number = 1",
      "const alphi: number = 2",
      "const result: number = @alhpa"
    ].join("\n");
    const { result } = queryFor(source, "undefined-binding");
    expect(result?.candidates.map(({ label, distance }) => ({ label, distance }))).toEqual([
      { label: "alpha", distance: 1 },
      { label: "alphi", distance: 2 }
    ]);
  });

  it("fails closed for stale snapshots and non-spelling semantic failures", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @widht"
    ].join("\n");
    const compiled = compileWithIds(source);
    const diagnostic = diagnosticsOf(compiled).find((item) => item.code === "undefined-binding")!;

    expect(queryDslTypoSuggestions({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION + 1 },
      diagnostic,
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })).toBeNull();

    expect(queryDslTypoSuggestions({
      source: { normalizedSource: source, sourceRevision: SOURCE_REVISION },
      diagnostic: { ...diagnostic, code: "forward-binding-reference" },
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })).toBeNull();
  });
});
