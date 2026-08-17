import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  queryDslDefinition,
  type DslDefinitionQueryResult
} from "./dslDefinitionQuery";

const compileWithIds = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `definition-test:${index}`]))
  });
};

const exactQuery = (
  source: string,
  token: string,
  sourceRevision = 7,
  offset = token.length
): DslDefinitionQueryResult | null => {
  const compiled = compileWithIds(source, sourceRevision);
  const position = source.indexOf(token) + offset;
  return queryDslDefinition({
    source: { normalizedSource: source, sourceRevision },
    position,
    semantic: { sourceRevision, compiled }
  });
};

const sourceSlice = (source: string, range: { from: number; to: number }) => source.slice(range.from, range.to);

describe("queryDslDefinition", () => {
  it("returns the exact ordinary geometry reference and declaration identifiers", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@A");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("A");
    expect(sourceSlice(source, result!.declarationRange)).toBe("A");
    expect(result!.referenceRange.from).toBe(source.indexOf("@A") + 1);
    expect(result!.declarationRange.from).toBe(source.indexOf("point A") + "point ".length);
  });

  it("resolves ordinary geometry from source semantics without runtime materialization", () => {
    const source = [
      "nui 4",
      "group Front {",
      "  point Same = coordinate(x: 0, y: 0)",
      "  point Use = offset(from: @Same, dx: 1, dy: 0)",
      "}",
      "group Back {",
      "  point Same = coordinate(x: 10, y: 0)",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const runtimeIndependent = {
      ...compiled,
      document: compiled.document ? { ...compiled.document, elements: [] } : null
    };
    const position = source.indexOf("@Same") + "@Same".length;
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position,
      semantic: { sourceRevision: 7, compiled: runtimeIndependent }
    });

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.declarationRange)).toBe("Same");
    expect(result!.declarationRange.from).toBe(source.indexOf("  point Same" ) + "  point ".length);
  });

  it("uses the resolved BindingId for a typed reference", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width"
    ].join("\n");
    const result = exactQuery(source, "@width");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("width");
    expect(sourceSlice(source, result!.declarationRange)).toBe("width");
    expect(result!.declarationRange.from).toBe(source.indexOf("width"));
  });

  it("follows typed-binding shadowing through the resolved identity", () => {
    const source = [
      "nui 4",
      "const value: number = 1",
      "group Inner {",
      "  const value: number = 2",
      "  const result: number = @value",
      "}"
    ].join("\n");
    const result = exactQuery(source, "@value");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.declarationRange)).toBe("value");
    expect(result!.declarationRange.from).toBe(source.indexOf("  const value" ) + "  const ".length);
  });

  it("follows a resolved BindingId even when the declaration binding is invalid", () => {
    const source = [
      "nui 4",
      "const broken: number = @missing",
      "const result: number = @broken"
    ].join("\n");
    const result = exactQuery(source, "@broken");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("broken");
    expect(sourceSlice(source, result!.declarationRange)).toBe("broken");
    expect(result!.declarationRange.from).toBe(source.indexOf("broken"));
  });

  it("resolves Module callees and parameters to their declarations", () => {
    const source = [
      "nui 4",
      "module Measure(width: number) {",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const calleeOffset = source.indexOf("Measure", source.indexOf("instance Call"));
    const callee = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: calleeOffset + "Measure".length,
      semantic: { sourceRevision: 7, compiled: compileWithIds(source) }
    });
    const parameter = exactQuery(source, "width: 10", 7, "width".length);

    expect(callee && sourceSlice(source, callee.referenceRange)).toBe("Measure");
    expect(callee && sourceSlice(source, callee.declarationRange)).toBe("Measure");
    expect(parameter && sourceSlice(source, parameter.referenceRange)).toBe("width");
    expect(parameter && sourceSlice(source, parameter.declarationRange)).toBe("width");
  });

  it("resolves Module body source references by StatementIdentity", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "  point Q = offset(from: @P, dx: 1, dy: 0)",
      "}"
    ].join("\n");
    const result = exactQuery(source, "@P");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("P");
    expect(sourceSlice(source, result!.declarationRange)).toBe("P");
    expect(result!.declarationRange.from).toBe(source.indexOf("  point P") + "  point ".length);
  });

  it("resolves qualified Module exports without resolving the member name again", () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "instance Source = Producer()",
      "point Use = offset(from: @Source::Public, dx: 1, dy: 0)"
    ].join("\n");
    const memberOffset = source.indexOf("Public", source.indexOf("@Source::"));
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: memberOffset + "Public".length,
      semantic: { sourceRevision: 7, compiled: compileWithIds(source) }
    });

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("Public");
    expect(sourceSlice(source, result!.declarationRange)).toBe("Public");
    expect(result!.declarationRange.from).toBe(source.indexOf("  export point Public") + "  export point ".length);
  });

  it("fails closed for unresolved and ambiguous references", () => {
    const unresolved = [
      "nui 4",
      "point B = offset(from: @Missing, dx: 1, dy: 0)"
    ].join("\n");
    expect(exactQuery(unresolved, "@Missing")).toBeNull();

    const ambiguous = [
      "nui 4",
      "group One {",
      "  point Same = coordinate(x: 0, y: 0)",
      "}",
      "group Two {",
      "  point Same = coordinate(x: 1, y: 0)",
      "}",
      "point Use = offset(from: @Same, dx: 1, dy: 0)"
    ].join("\n");
    expect(exactQuery(ambiguous, "@Same")).toBeNull();
  });

  it("fails closed for stale revisions and same-revision source mismatches", () => {
    const oldSource = "nui 4\npoint A = coordinate(x: 0, y: 0)\npoint B = offset(from: @A, dx: 1, dy: 0)";
    const oldCompiled = compileWithIds(oldSource, 3);
    const liveSource = oldSource.replace("@A", "@Renamed");

    expect(queryDslDefinition({
      source: { normalizedSource: liveSource, sourceRevision: 4 },
      position: liveSource.indexOf("@Renamed") + "@Renamed".length,
      semantic: { sourceRevision: 3, compiled: oldCompiled }
    })).toBeNull();

    expect(queryDslDefinition({
      source: { normalizedSource: liveSource, sourceRevision: 3 },
      position: liveSource.indexOf("@Renamed") + "@Renamed".length,
      semantic: { sourceRevision: 3, compiled: oldCompiled }
    })).toBeNull();
  });

  it("returns null on declaration identifiers, comments, literals, and punctuation", () => {
    const source = [
      "nui 4",
      "# @A in a comment",
      "point A = coordinate(x: 0, y: 0)",
      "text Label = label(text: \"@A\", anchor: (0, 0))",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const query = (position: number) => queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position,
      semantic: { sourceRevision: 7, compiled }
    });

    expect(query(source.indexOf("point A") + "point ".length + 1)).toBeNull();
    expect(query(source.indexOf("@A in a comment") + 1)).toBeNull();
    expect(query(source.indexOf("\"@A\"") + 2)).toBeNull();
    expect(query(source.indexOf("from: @A") + "from: @".length - 1)).toBeNull();
  });

  it("returns null for builtin function names and geometry property names", () => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "const width: number = abs(@Base.length)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const query = (position: number) => queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position,
      semantic: { sourceRevision: 7, compiled }
    });

    expect(query(source.indexOf("abs") + 1)).toBeNull();
    expect(query(source.indexOf("length"))).toBeNull();
    const base = query(source.indexOf("@Base") + "@Base".length);
    expect(base).not.toBeNull();
    expect(sourceSlice(source, base!.declarationRange)).toBe("Base");
  });

  it("preserves exact Japanese and UTF-16 offsets", () => {
    const source = [
      "nui 4",
      "text Prefix = label(text: \"😀\", anchor: (0, 0))",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用 = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@前身頃");

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("前身頃");
    expect(sourceSlice(source, result!.declarationRange)).toBe("前身頃");
    expect(result!.referenceRange.from).toBe(source.indexOf("@前身頃") + 1);
    expect(result!.referenceRange.to).toBe(result!.referenceRange.from + "前身頃".length);
  });
});
