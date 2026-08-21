import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  queryDslReferences,
  type DslReferencesQueryResult,
  type DslReferencesSemanticSnapshot
} from "./dslReferencesQuery";

const compile = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `references-test:${index}`]))
  });
};

const snapshot = (source: string, sourceRevision = 7, compiled = compile(source, sourceRevision)): DslReferencesSemanticSnapshot => ({
  sourceRevision,
  sourceText: source,
  compiled
});

const queryAt = (source: string, token: string, occurrence = 0): DslReferencesQueryResult | null => {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
  if (offset < 0) throw new Error(`missing token ${token} occurrence ${occurrence}`);
  return queryDslReferences({
    source: { normalizedSource: source, sourceRevision: 7 },
    position: offset + token.length,
    semantic: snapshot(source)
  });
};

const slices = (
  source: string,
  ranges: { from: number; to: number } | readonly { from: number; to: number }[]
) => {
  const list = Array.isArray(ranges) ? ranges : [ranges];
  return list.map((range) => source.slice(range.from, range.to));
};

describe("queryDslReferences", () => {
  it("returns one declaration and ordered usages from either declaration or reference", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "point C = offset(from: @A, dx: 2, dy: 0)"
    ].join("\n");
    const declaration = queryAt(source, "A");
    const fromReference = queryAt(source, "@A");

    expect(declaration).not.toBeNull();
    expect(fromReference).toEqual(declaration);
    expect(slices(source, declaration!.declarationRange)).toEqual(["A"]);
    expect(slices(source, declaration!.referenceRanges)).toEqual(["A", "A"]);
    expect(declaration!.referenceRanges.every((range) =>
      range.from !== declaration!.declarationRange.from || range.to !== declaration!.declarationRange.to
    )).toBe(true);
  });

  it("resolves ordinary containers, parent references, and geometry properties", () => {
    const parentSource = [
      "nui 4",
      "group Outer {",
      "}",
      "group Inner (parent: @Outer) {",
      "}"
    ].join("\n");
    const parent = queryAt(parentSource, "@Outer");
    expect(parent).not.toBeNull();
    expect(slices(parentSource, parent!.declarationRange)).toEqual(["Outer"]);
    expect(slices(parentSource, parent!.referenceRanges)).toEqual(["Outer"]);

    const propertySource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const width: number = @A.x + 1",
      "const height: number = @A.x + 2"
    ].join("\n");
    const property = queryAt(propertySource, "@A");
    expect(property).not.toBeNull();
    expect(slices(propertySource, property!.declarationRange)).toEqual(["A"]);
    expect(slices(propertySource, property!.referenceRanges)).toEqual(["A", "A"]);
  });

  it("keeps qualified root typed geometry-property references at path-segment identity", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "  point A = coordinate(x: 0, y: 0)",
      "}",
      "const first: number = @Outer::A.x",
      "const second: number = @Outer::A.x"
    ].join("\n");
    const qualifiedStarts = [source.indexOf("@Outer::A.x"), source.indexOf("@Outer::A.x", source.indexOf("const second"))];
    const a = queryAt(source, "A");
    const outer = queryAt(source, "Outer");

    expect(a).not.toBeNull();
    expect(a!.referenceRanges).toEqual(qualifiedStarts.map((start) => ({
      from: start + 1 + "Outer::".length,
      to: start + 1 + "Outer::A".length
    })));
    expect(a!.referenceRanges.every((range) => source.slice(range.from, range.to) === "A")).toBe(true);
    expect(a!.referenceRanges.some((range) => source.slice(range.from, range.to) === "Outer::A")).toBe(false);

    expect(outer).not.toBeNull();
    expect(outer!.referenceRanges).toEqual(qualifiedStarts.map((start) => ({
      from: start + 1,
      to: start + 1 + "Outer".length
    })));
    expect(outer!.referenceRanges.every((range) => source.slice(range.from, range.to) === "Outer")).toBe(true);
  });

  it("uses BindingId identity and preserves typed shadowing", () => {
    const source = [
      "nui 4",
      "const value: number = 1",
      "const rootUse: number = @value",
      "group Inner {",
      "  const value: number = 2",
      "  const innerUse: number = @value",
      "}"
    ].join("\n");
    const root = queryAt(source, "value");
    const inner = queryAt(source, "value", 2);
    const innerReference = queryAt(source, "@value", 1);

    expect(root).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(slices(source, root!.referenceRanges)).toEqual(["value"]);
    expect(slices(source, inner!.referenceRanges)).toEqual(["value"]);
    expect(innerReference).toEqual(inner);
  });

  it("enumerates Module definitions, callees, parameters, and source symbols", () => {
    const source = [
      "nui 4",
      "module Measure(width: number) {",
      "  point P = coordinate(x: @width, y: 0)",
      "  point Q = offset(from: @P, dx: 1, dy: 0)",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const definition = queryAt(source, "Measure");
    const parameter = queryAt(source, "width");
    const sourceSymbol = queryAt(source, "P");
    const instance = queryAt(source, "Call");

    expect(definition).not.toBeNull();
    expect(slices(source, definition!.referenceRanges)).toEqual(["Measure"]);
    expect(parameter).not.toBeNull();
    expect(slices(source, parameter!.referenceRanges)).toEqual(["width", "width"]);
    expect(sourceSymbol).not.toBeNull();
    expect(slices(source, sourceSymbol!.referenceRanges)).toEqual(["P"]);
    expect(instance).not.toBeNull();
    expect(instance!.referenceRanges).toEqual([]);
  });

  it("keeps qualified export path segments as separate identities", () => {
    const source = [
      "nui 4",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "instance Source = Producer()",
      "point Use = offset(from: @Source::Public, dx: 1, dy: 0)"
    ].join("\n");
    const sourceSegment = queryAt(source, "Source", 1);
    const publicSegment = queryAt(source, "Public", 1);
    const publicDeclaration = queryAt(source, "Public");

    expect(sourceSegment).not.toBeNull();
    expect(slices(source, sourceSegment!.declarationRange)).toEqual(["Source"]);
    expect(slices(source, sourceSegment!.referenceRanges)).toEqual(["Source"]);
    expect(publicSegment).not.toBeNull();
    expect(slices(source, publicSegment!.declarationRange)).toEqual(["Public"]);
    expect(slices(source, publicSegment!.referenceRanges)).toEqual(["Public"]);
    expect(publicDeclaration).toEqual(publicSegment);
  });

  it("does not match comments, literals, punctuation, or unresolved and ambiguous references", () => {
    const source = [
      "nui 4",
      "// @A comment",
      "point A = coordinate(x: 0, y: 0)",
      "text Label = label(text: \"@A\", anchor: none, size: 3)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    expect(queryAt(source, "@A", 0)).toBeNull();
    expect(queryAt(source, "@A", 1)).toBeNull();
    expect(queryDslReferences({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: source.indexOf("from: @A") + "from: @".length - 1,
      semantic: snapshot(source)
    })).toBeNull();

    const unresolved = "nui 4\npoint B = offset(from: @Missing, dx: 1, dy: 0)";
    expect(queryAt(unresolved, "@Missing")).toBeNull();

    const ambiguous = [
      "nui 4",
      "group One {}",
      "group One {}",
      "point Use = offset(from: @One, dx: 1, dy: 0)"
    ].join("\n");
    expect(queryAt(ambiguous, "@One")).toBeNull();
  });

  it("fails closed for stale revision, source text, and source-map mismatches", () => {
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)\npoint B = offset(from: @A, dx: 1, dy: 0)";
    const compiled = compile(source, 7);
    const query = (liveSource: string, sourceRevision: number, semantic: DslReferencesSemanticSnapshot) => queryDslReferences({
      source: { normalizedSource: liveSource, sourceRevision },
      position: liveSource.indexOf("@A") + "@A".length,
      semantic
    });

    expect(query(source, 8, snapshot(source))).toBeNull();
    expect(query(source.replace("@A", "@B"), 7, snapshot(source))).toBeNull();
    expect(query(source, 7, {
      sourceRevision: 7,
      sourceText: source,
      compiled: {
        ...compiled,
        spans: {
          ...compiled.spans,
          sourceMap: { ...compiled.spans.sourceMap, source: `${source} ` }
        }
      }
    })).toBeNull();
  });

  it("keeps a safe resolved target available with an unrelated compiler diagnostic", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "const broken: number = @Missing"
    ].join("\n");
    const result = queryAt(source, "@A");
    expect(result).not.toBeNull();
    expect(slices(source, result!.referenceRanges)).toEqual(["A"]);
  });

  it("returns an unused declaration with no references and dedupes duplicate semantic reports", () => {
    const unused = "nui 4\nconst unused: number = 1";
    const unusedResult = queryAt(unused, "unused");
    expect(unusedResult).toEqual({
      declarationRange: { from: unused.indexOf("unused"), to: unused.indexOf("unused") + "unused".length },
      referenceRanges: []
    });

    const typed = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width + @width"
    ].join("\n");
    const typedResult = queryAt(typed, "width");
    expect(typedResult).not.toBeNull();
    expect(typedResult!.referenceRanges).toHaveLength(2);
    expect(typedResult!.referenceRanges[0]!.from).toBeLessThan(typedResult!.referenceRanges[1]!.from);
  });

  it("returns multiline output and qualified placement references by source identity", () => {
    const source = [
      "nui 4",
      "profile OutputProfile",
      "group Outer {",
      "  group Inner {",
      "    point Origin = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "layout Layout {",
      "  place @Outer::Inner(",
      "    origin: @Outer::Inner::Origin,",
      "    at: (0, 0),",
      "  )",
      "}",
      "print PrintOutput(",
      "  layout: @Layout,",
      "  profile: @OutputProfile,",
      "  paper: a4,",
      "  overlap: 0,",
      ")",
      "svg SvgOutput(",
      "  layout: @Layout,",
      "  profile: @OutputProfile,",
      ")"
    ].join("\n");
    const layout = queryAt(source, "Layout");
    const profile = queryAt(source, "OutputProfile");
    const outer = queryAt(source, "Outer");
    const inner = queryAt(source, "Inner");
    const origin = queryAt(source, "Origin");

    expect(layout).not.toBeNull();
    expect(slices(source, layout!.declarationRange)).toEqual(["Layout"]);
    expect(slices(source, layout!.referenceRanges)).toEqual(["Layout", "Layout"]);

    expect(profile).not.toBeNull();
    expect(slices(source, profile!.declarationRange)).toEqual(["OutputProfile"]);
    expect(slices(source, profile!.referenceRanges)).toEqual(["OutputProfile", "OutputProfile"]);

    expect(outer).not.toBeNull();
    expect(slices(source, outer!.referenceRanges)).toEqual(["Outer", "Outer"]);
    expect(inner).not.toBeNull();
    expect(slices(source, inner!.referenceRanges)).toEqual(["Inner", "Inner"]);
    expect(origin).not.toBeNull();
    expect(slices(source, origin!.referenceRanges)).toEqual(["Origin"]);
    expect(outer!.referenceRanges.every((range) => source.slice(range.from, range.to) !== "Outer::Inner")).toBe(true);
    expect(inner!.referenceRanges.every((range) => source.slice(range.from, range.to) !== "Outer::Inner")).toBe(true);
  });
});
