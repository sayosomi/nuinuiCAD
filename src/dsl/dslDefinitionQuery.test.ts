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

  it("resolves parent references to source container declarations without runtime materialization", () => {
    const source = [
      "nui 4",
      "group Front {",
      "}",
      "point Child = coordinate(x: 0, y: 0, parent: @Front)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const runtimeIndependent = {
      ...compiled,
      document: compiled.document ? { ...compiled.document, elements: [] } : null
    };
    const referenceOffset = source.indexOf("@Front") + "@Front".length;
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: referenceOffset,
      semantic: { sourceRevision: 7, compiled: runtimeIndependent }
    });

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("Front");
    expect(sourceSlice(source, result!.declarationRange)).toBe("Front");
    expect(result!.referenceRange).toEqual({ from: source.indexOf("@Front") + 1, to: source.indexOf("@Front") + 1 + "Front".length });
    expect(result!.declarationRange).toEqual({ from: source.indexOf("group Front") + "group ".length, to: source.indexOf("group Front") + "group Front".length });

    const declarationPosition = source.indexOf("group Front") + "group ".length + 1;
    expect(queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: declarationPosition,
      semantic: { sourceRevision: 7, compiled: runtimeIndependent }
    })).toBeNull();
  });

  it("resolves parent references from root group declarations", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "}",
      "group Inner (parent: @Outer) {",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const runtimeIndependent = {
      ...compiled,
      document: compiled.document ? { ...compiled.document, elements: [] } : null
    };
    const referenceOffset = source.indexOf("@Outer") + "@Outer".length;
    const result = queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: referenceOffset,
      semantic: { sourceRevision: 7, compiled: runtimeIndependent }
    });

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("Outer");
    expect(sourceSlice(source, result!.declarationRange)).toBe("Outer");
    expect(queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: source.indexOf("group Outer") + "group ".length + 1,
      semantic: { sourceRevision: 7, compiled: runtimeIndependent }
    })).toBeNull();
  });

  it("resolves parent references from root conditional and for containers", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "}",
      "if (true, parent: @Outer) {",
      "}",
      "for i in range(from: 0, count: 1, parent: @Outer) {",
      "}"
    ].join("\n");
    const compiled = compileWithIds(source);
    const queryAt = (token: string, from = 0) => {
      const tokenOffset = source.indexOf(token, from);
      return queryDslDefinition({
        source: { normalizedSource: source, sourceRevision: 7 },
        position: tokenOffset + token.length,
        semantic: { sourceRevision: 7, compiled }
      });
    };
    const ifReference = queryAt("@Outer");
    const forReference = queryAt("@Outer", source.indexOf("for "));

    expect(ifReference).not.toBeNull();
    expect(forReference).not.toBeNull();
    expect(sourceSlice(source, ifReference!.declarationRange)).toBe("Outer");
    expect(sourceSlice(source, forReference!.declarationRange)).toBe("Outer");
  });

  it("fails closed for unresolved, ambiguous, and non-container parent references", () => {
    const unresolved = [
      "nui 4",
      "point Child = coordinate(x: 0, y: 0, parent: @Missing)"
    ].join("\n");
    expect(exactQuery(unresolved, "@Missing")).toBeNull();

    const ambiguous = [
      "nui 4",
      "group One {}",
      "group One {}",
      "point Child = coordinate(x: 0, y: 0, parent: @One)"
    ].join("\n");
    expect(exactQuery(ambiguous, "@One")).toBeNull();

    const invalid = [
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Child = coordinate(x: 0, y: 0, parent: @Base)"
    ].join("\n");
    expect(exactQuery(invalid, "@Base")).toBeNull();

    const unresolvedContainer = [
      "nui 4",
      "group Inner (parent: @Missing) {",
      "}"
    ].join("\n");
    expect(exactQuery(unresolvedContainer, "@Missing")).toBeNull();
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

  it("resolves nominal record types, values, fields, Module parameters, and qualified exports", () => {
    const source = [
      "nui 4",
      "record Pair(x: number, label: string)",
      'const input: Pair = Pair(x: 1, label: "root")',
      "const alias: Pair = @input",
      "module Inner(input: Pair) {",
      "  const copy: Pair = @input",
      "  const member: number = @input.x",
      "  export const output: Pair = @copy",
      "}",
      "instance Use = Inner(input: @input)",
      "const exported: number = @Use::output.x"
    ].join("\n");
    const query = (needle: string, offset = needle.length) => exactQuery(source, needle, 7, offset);

    const type = query("Pair(x: 1", "Pair".length);
    expect(type && sourceSlice(source, type.declarationRange)).toBe("Pair");

    const field = query("Pair(x: 1", "Pair(x".length);
    expect(field && sourceSlice(source, field.declarationRange)).toBe("x");

    const value = query("const alias: Pair = @input", "const alias: Pair = @input".length);
    expect(value && sourceSlice(source, value.declarationRange)).toBe("input");

    const parameter = query("const copy: Pair = @input", "const copy: Pair = @input".length);
    expect(parameter && sourceSlice(source, parameter.declarationRange)).toBe("input");
    expect(parameter?.declarationRange.from).toBe(source.indexOf("input: Pair", source.indexOf("module Inner")));

    const qualifiedField = query("const exported: number = @Use::output.x");
    expect(qualifiedField && sourceSlice(source, qualifiedField.declarationRange)).toBe("x");
    expect(qualifiedField?.declarationRange.from).toBe(source.indexOf("x: number"));
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
      "// @A in a comment",
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

  it("resolves a qualified choice geometry property from its element path only", () => {
    const source = [
      "nui 4",
      "group Outer {",
      "  arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "}",
      "const direction: choice(counterclockwise, clockwise) = @Outer::A.direction"
    ].join("\n");
    const compiled = compileWithIds(source);
    const query = (position: number) => queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position,
      semantic: { sourceRevision: 7, compiled }
    });
    const referenceStart = source.indexOf("@Outer::A.direction");
    const elementStart = referenceStart + 1 + "Outer::".length;
    const result = query(elementStart + 1);

    expect(result).not.toBeNull();
    expect(sourceSlice(source, result!.referenceRange)).toBe("A");
    expect(sourceSlice(source, result!.declarationRange)).toBe("A");
    expect(query(referenceStart + "@Outer::A.".length + 1)).toBeNull();
  });

  it("resolves choice geometry properties in Module arguments and body expressions", () => {
    const source = [
      "nui 4",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: clockwise)",
      "module M(direction: choice(counterclockwise, clockwise)) {",
      "  arc Local = arc(center: (0, 0), radius: 20, start: 10, end: 90, direction: clockwise)",
      "  const inside: choice(counterclockwise, clockwise) = @Local.direction",
      "}",
      "instance Use = M(direction: @A.direction)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const query = (position: number) => queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position,
      semantic: { sourceRevision: 7, compiled }
    });
    const argumentStart = source.indexOf("@A.direction");
    const bodyStart = source.indexOf("@Local.direction");
    const argument = query(argumentStart + 2);
    const body = query(bodyStart + 3);

    expect(argument).not.toBeNull();
    expect(sourceSlice(source, argument!.referenceRange)).toBe("A");
    expect(sourceSlice(source, argument!.declarationRange)).toBe("A");
    expect(body).not.toBeNull();
    expect(sourceSlice(source, body!.referenceRange)).toBe("Local");
    expect(sourceSlice(source, body!.declarationRange)).toBe("Local");
    expect(query(argumentStart + "@A.".length + 1)).toBeNull();
    expect(query(bodyStart + "@Local.".length + 1)).toBeNull();
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

  it("resolves multiline print, SVG, and qualified place source references", () => {
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
    const compiled = compileWithIds(source);
    const query = (offset: number) => queryDslDefinition({
      source: { normalizedSource: source, sourceRevision: 7 },
      position: offset,
      semantic: { sourceRevision: 7, compiled }
    });
    const reference = (token: string, occurrence = 0) => {
      let offset = -1;
      for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(token, offset + 1);
      if (offset < 0) throw new Error(`missing token ${token} occurrence ${occurrence}`);
      return offset;
    };
    const resolved = (referenceStart: number, referenceName: string, declarationName: string) => {
      const result = query(referenceStart + 1);
      expect(result).not.toBeNull();
      expect(sourceSlice(source, result!.referenceRange)).toBe(referenceName);
      expect(sourceSlice(source, result!.declarationRange)).toBe(declarationName);
      return result!;
    };

    resolved(reference("@Layout", 0), "Layout", "Layout");
    resolved(reference("@Layout", 1), "Layout", "Layout");
    resolved(reference("@OutputProfile", 0), "OutputProfile", "OutputProfile");
    resolved(reference("@OutputProfile", 1), "OutputProfile", "OutputProfile");

    const targetPath = reference("@Outer::Inner");
    const targetOuter = query(targetPath + 1);
    const targetInner = query(targetPath + 1 + "Outer::".length);
    expect(targetOuter && sourceSlice(source, targetOuter.referenceRange)).toBe("Outer");
    expect(targetOuter && sourceSlice(source, targetOuter.declarationRange)).toBe("Outer");
    expect(targetInner && sourceSlice(source, targetInner.referenceRange)).toBe("Inner");
    expect(targetInner && sourceSlice(source, targetInner.declarationRange)).toBe("Inner");

    const originPath = reference("@Outer::Inner::Origin");
    const originOuter = query(originPath + 1);
    const originInner = query(originPath + 1 + "Outer::".length);
    const originPoint = query(originPath + 1 + "Outer::Inner::".length);
    expect(originOuter && sourceSlice(source, originOuter.referenceRange)).toBe("Outer");
    expect(originOuter && sourceSlice(source, originOuter.declarationRange)).toBe("Outer");
    expect(originInner && sourceSlice(source, originInner.referenceRange)).toBe("Inner");
    expect(originInner && sourceSlice(source, originInner.declarationRange)).toBe("Inner");
    expect(originPoint && sourceSlice(source, originPoint.referenceRange)).toBe("Origin");
    expect(originPoint && sourceSlice(source, originPoint.declarationRange)).toBe("Origin");
  });
});
