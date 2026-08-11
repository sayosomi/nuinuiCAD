import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { createDslCompletionSource } from "./cmAutocomplete";

const compileWithIds = (source: string) => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:test:${index}`]))
  });
};

const completionFor = async (source: string, cursor: number, fresh = true) => {
  const compiled = compileWithIds(source);
  const state = EditorState.create({ doc: source, selection: { anchor: cursor } });
  const sourceFn = createDslCompletionSource({
    elements: () => compiled.document?.elements ?? [],
    statementRanges: () => new Map(), printLayouts: () => [], printLayoutRanges: () => new Map(),
    isComposing: () => false, computedGeometry: () => undefined,
    effectiveEnabledElementIds: () => undefined, evaluationErrors: () => undefined,
    bindingAnalysis: () => compiled.bindingAnalysis,
    typedDeclarationRanges: () => new Map(), scopeBodyRanges: () => [], statementInfoByElementId: () => undefined,
    moduleSemanticMetadata: () => compiled, semanticMetadataFresh: () => fresh
  });
  return sourceFn({ state, pos: cursor, explicit: true } as never);
};

describe("module completion through the existing CodeMirror pipeline", () => {
  it("keeps generic module keyword completion available", async () => {
    const result = await completionFor("mod", 3);
    expect(result?.options.map((option) => option.label)).toContain("module");
  });

  it("offers only source-order visible module callees and excludes forward definitions", async () => {
    const source = ["nui 3", "module First() {", "}", "module Use = F", "module Forward() {", "}"].join("\n");
    const result = await completionFor(source, source.indexOf("F\n", source.indexOf("module Use")) + 1);
    expect(result?.options.map((option) => option.label)).toEqual(["First"]);
  });

  it("offers unconsumed named labels and type-filters scalar, point, and line arguments", async () => {
    const source = [
      "nui 3",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: P, end: P)",
      "curve C = bezier(start: P, end: P)",
      "module M(width: number, anchor: point, path: line, optional: number = 0) {",
      "}",
      "module I = M(width: 1, anchor: P, path: L)"
    ].join("\n");
    const label = await completionFor(source, source.indexOf("anchor: P") + "anchor".length);
    expect(label?.options.map((option) => option.label)).toContain("optional");
    expect(label?.options.map((option) => option.label)).not.toContain("width");
    const scalar = await completionFor(source, source.indexOf("1, anchor") + 1);
    expect(scalar?.options.map((option) => option.label)).toContain("0");
    expect(scalar?.options.map((option) => option.label)).not.toContain("P");
    const point = await completionFor(source, source.indexOf("P, path") + 1);
    expect(point?.options.map((option) => option.label)).toContain("P");
    expect(point?.options.map((option) => option.label)).not.toContain("L");
    const line = await completionFor(source, source.indexOf("L)") + 1);
    expect(line?.options.map((option) => option.label)).toContain("L");
    expect(line?.options.map((option) => option.label)).toContain("C");
    expect(line?.options.map((option) => option.label)).not.toContain("P");
  });

  it("offers module-body parameters and exports only for a qualified instance", async () => {
    const source = [
      "nui 3",
      "module M(width: number) {",
      "  export point Public = coordinate(x: @width, y: 0)",
      "  point Private = coordinate(x: @width, y: 0)",
      "}",
      "module I = M(width: 1)",
      "point X = offset(from: I::Public, dx: 1, dy: 0)"
    ].join("\n");
    const body = await completionFor(source, source.indexOf("@width") + "@width".length);
    expect(body?.options.map((option) => option.label)).toContain("@width");
    const qualified = await completionFor(source, source.indexOf("I::Public") + "I::".length);
    expect(qualified?.options.map((option) => option.label)).toEqual(["Public"]);
    expect(qualified?.options.map((option) => option.label)).not.toContain("Private");
  });

  it("projects a multiline module call label completion through the logical statement map", async () => {
    const source = [
      "nui 3",
      "module M(width: number, optional: number = 0) {",
      "}",
      "module I = M(",
      "  width: 1",
      ")"
    ].join("\n");
    const cursor = source.indexOf("width: 1") + "width".length;
    const result = await completionFor(source, cursor);
    expect(result?.from).toBe(cursor - "width".length);
    expect(result?.to).toBe(cursor);
    expect(result?.options.map((option) => option.label)).toContain("optional");
  });

  it("fails closed for module candidates while the semantic metadata is stale", async () => {
    const source = ["nui 3", "module M() {", "}", "module I = M()"].join("\n");
    const result = await completionFor(source, source.indexOf("M()", source.indexOf("module I")) + 1, false);
    expect(result?.options ?? []).toEqual([]);
  });
});
