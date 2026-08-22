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
    const keyword = queryFor("nui 4\npont P = coordinate(x: 0, y: 0)", "unknown-dsl-keyword").result;
    expect(keyword?.targetKind).toBe("keyword");
    expect(keyword?.candidates.map((candidate) => candidate.label)).toContain("point");

    const type = queryFor("nui 4\nlet value: numbr = 10", "unknown-type").result;
    expect(type?.targetKind).toBe("type");
    expect(type?.candidates.map((candidate) => candidate.label)).toContain("number");

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

    const mutation = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segment(start: @A, end: @B)",
      "move(targets: [@L], form: @A, to: @B)"
    ].join("\n");
    expect(labels(mutation, "unknown-construction-argument")).toContain("from");
  });

  it("reuses builtin callable and named-argument candidates", () => {
    const callable = queryFor("nui 4\nconst value: number = roumd(12.3)", "unknown-function").result;
    expect(callable?.targetKind).toBe("builtinCallable");
    expect(callable?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "builtin", label: "round", distance: 1 })
    ]));

    const namedArgument = queryFor(
      "nui 4\nconst value: number = spreadAngle(lenght: 10, spread: 20)",
      "unknown-function-argument"
    ).result;
    expect(namedArgument?.targetKind).toBe("builtinArgument");
    expect(namedArgument?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "argumentName", label: "length", distance: 1 })
    ]));
  });

  it("uses the completion-owned edit range inside an exact @binding diagnostic span", () => {
    const source = [
      "nui 4",
      "const seamAllowance: number = 10",
      "const result: number = @seamAlowance"
    ].join("\n");
    const { diagnostic, result } = queryFor(source, "undefined-binding");
    expect(result).not.toBeNull();
    expect(result?.targetKind).toBe("bindingReference");
    expect(result?.typedText).toBe("seamAlowance");
    expect(source.slice(result!.replacementRange.from, result!.replacementRange.to)).toBe("seamAlowance");
    expect(result?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "binding", label: "seamAllowance", distance: 1 })
    ]));
    expect(result?.candidates.find((candidate) => candidate.label === "seamAllowance")?.identity).toBeDefined();
    const [diagnosticRange] = diagnostic.physicalSpan!.segments;
    expect(source.slice(diagnosticRange.from, diagnosticRange.to)).toBe("@seamAlowance");
    expect(result!.replacementRange.from).toBe(diagnosticRange.from + 1);
  });

  it("filters threshold-eligible geometry suggestions through current kind, scope, and source order", () => {
    const source = [
      "nui 4",
      "point Anchor = coordinate(x: 0, y: 0)",
      "line Anchur = segment(start: @Anchor, end: @Anchor)",
      "group HiddenGroup {",
      "  point Anchra = coordinate(x: 5, y: 5)",
      "}",
      "line Use = segment(start: @Anchro, end: @Anchor)",
      "point Anchre = coordinate(x: 10, y: 10)"
    ].join("\n");
    const { result } = queryFor(source, "undefined-geometry-reference");
    expect(result?.targetKind).toBe("geometryReference");
    expect(result?.typedText).toBe("Anchro");
    expect(result?.candidates[0]).toMatchObject({ kind: "geometry", label: "Anchor", distance: 1 });
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Anchur");
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Anchra");
    expect(result?.candidates.map((candidate) => candidate.label)).not.toContain("Anchre");
  });

  it("reuses Module callee and argument candidates", () => {
    const calleeSource = [
      "nui 4",
      "module Pocket(width: number) {",
      "}",
      "instance Use = Pockte(width: 10)"
    ].join("\n");
    const callee = queryFor(calleeSource, "module-unresolved-callee").result;
    expect(callee?.targetKind).toBe("moduleCallee");
    expect(callee?.candidates.map((candidate) => candidate.label)).toContain("Pocket");

    const argumentSource = [
      "nui 4",
      "module M(startPoint: point) {",
      "}",
      "point A = coordinate(x: 0, y: 0)",
      "instance Use = M(stratPoint: @A)"
    ].join("\n");
    const argument = queryFor(argumentSource, "module-unknown-argument").result;
    expect(argument?.targetKind).toBe("moduleArgument");
    expect(argument?.candidates.map((candidate) => candidate.label)).toContain("startPoint");
  });

  it("keeps forward, wrong-callable, already-used, and exclusive-group names out of candidates", () => {
    const forward = [
      "nui 4",
      "const use: number = @ltaerName",
      "const laterName: number = 10"
    ].join("\n");
    expect(labels(forward, "undefined-binding")).not.toContain("laterName");

    const wrongCallable = "nui 4\npoint P = coordinate(statr: 0, y: 0)";
    expect(labels(wrongCallable, "unknown-construction-argument")).not.toContain("start");

    const used = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line L = segment(start: @A, strat: @A, end: @B)"
    ].join("\n");
    expect(labels(used, "unknown-construction-argument")).not.toContain("start");

    const exclusive = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "point P = between(start: @A, end: @B, distance: 5, raito: 0.5)"
    ].join("\n");
    expect(labels(exclusive, "unknown-construction-argument")).not.toContain("ratio");
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

  it("returns an exact target with no candidates when no canonical name passes the threshold", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @zzzzzz"
    ].join("\n");
    const { result } = queryFor(source, "undefined-binding");
    expect(result?.typedText).toBe("zzzzzz");
    expect(result?.candidates).toEqual([]);
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
      source: { normalizedSource: `${source}\n`, sourceRevision: SOURCE_REVISION },
      diagnostic,
      semantic: { sourceRevision: SOURCE_REVISION, compiled }
    })).toBeNull();

    const forwardSource = [
      "nui 4",
      "const use: number = @later",
      "const later: number = 10"
    ].join("\n");
    const forwardCompiled = compileWithIds(forwardSource);
    const forwardDiagnostic = diagnosticsOf(forwardCompiled).find((item) => item.code === "forward-binding-reference");
    expect(forwardDiagnostic).toBeDefined();
    expect(queryDslTypoSuggestions({
      source: { normalizedSource: forwardSource, sourceRevision: SOURCE_REVISION },
      diagnostic: forwardDiagnostic!,
      semantic: { sourceRevision: SOURCE_REVISION, compiled: forwardCompiled }
    })).toBeNull();
  });
});
