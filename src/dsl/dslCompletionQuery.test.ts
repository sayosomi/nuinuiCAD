import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import {
  queryDslCompletion,
  type DslCompletionQueryResult
} from "./dslCompletionQuery";

const compileWithIds = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `completion-test:${index}`]))
  });
};

const exactQuery = (
  source: string,
  marker: string,
  offset = marker.length
): DslCompletionQueryResult | null => {
  const sourceRevision = 7;
  const compiled = compileWithIds(source, sourceRevision);
  const position = source.indexOf(marker) + offset;
  return queryDslCompletion({
    source: { normalizedSource: source, sourceRevision },
    position,
    semantic: { sourceRevision, compiled }
  });
};

const labels = (result: DslCompletionQueryResult | null) => result?.candidates.map((candidate) => candidate.label) ?? [];

const queryIncomplete = (source: string, position = source.length) => queryDslCompletion({
  source: { normalizedSource: source, sourceRevision: 1 },
  position
});

describe("queryDslCompletion", () => {
  it("returns keyword, declaration type, module parameter type, construction, and argument candidates", () => {
    expect(labels(queryIncomplete("poi", 3))).toContain("point");
    expect(labels(queryIncomplete("const value: cho"))).toEqual(["number", "string", "boolean", "choice"]);
    expect(labels(queryIncomplete("nui 4\nmodule M(input: pa"))).toContain("path");
    expect(labels(queryIncomplete("point P = co"))).toContain("coordinate");
    const lineConstructions = labels(queryIncomplete("line L = tran"));
    expect(lineConstructions).toContain("transformCopy");
    expect(lineConstructions).not.toContain("copy");
    const transformCopyArguments = labels(queryIncomplete("line L = transformCopy("));
    expect(transformCopyArguments).toEqual(expect.arrayContaining([
      "startPoint", "endPoint", "scale", "angleDeg", "mirrorX", "baseLines"
    ]));
    const argument = queryIncomplete("point P = offset(\n  d");
    expect(argument?.category).toBe("argument");
    expect(labels(argument)).toEqual(expect.arrayContaining(["dx", "dy"]));
    expect(argument?.candidates.every((candidate) => candidate.kind === "argumentName")).toBe(true);
  });

  it("completes the next argument name after a comma in an incomplete call", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A,",
      "  d",
      ")"
    ].join("\n");
    const position = source.indexOf("\n  d") + "\n  d".length;
    const result = queryIncomplete(source, position);

    expect(result?.category).toBe("argument");
    expect(labels(result)).toEqual(expect.arrayContaining(["dx", "dy"]));
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("d");
  });

  it("uses the builtin argument owner, including spreadAngle's named arguments", () => {
    const source = "nui 4\nconst value: number = spreadAngle(";
    const result = queryIncomplete(source);
    expect(result?.category).toBe("typedInitializer");
    expect(labels(result)).toEqual(["length", "spread"]);
    expect(result?.candidates.every((candidate) => candidate.kind === "argumentName")).toBe(true);
  });

  it("returns typed scalar syntax candidates for numeric, boolean, string, and choice expressions", () => {
    const number = queryIncomplete("nui 4\nconst value: number = ");
    expect(labels(number)).toContain("abs");
    expect(number?.candidates.some((candidate) => candidate.kind === "builtin")).toBe(true);

    const boolean = queryIncomplete("nui 4\nconst value: boolean = ");
    expect(labels(boolean)).toEqual(expect.arrayContaining(["true", "false"]));
    expect(labels(boolean)).not.toContain("0");

    const string = queryIncomplete("nui 4\nconst value: string = ");
    expect(labels(string)).toContain('""');

    const choice = queryIncomplete("nui 4\nconst value: choice(left, right) = ");
    expect(labels(choice)).toEqual(expect.arrayContaining(["left", "right"]));
  });

  it("returns visible typed bindings and keeps the @ marker outside the replacement range", () => {
    const source = "nui 4\nconst width: number = 10\nconst value: number = @width";
    const result = exactQuery(source, "@width");
    expect(result?.category).toBe("typedInitializer");
    expect(labels(result)).toContain("width");
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("width");
    expect(result?.candidates.find((candidate) => candidate.label === "width")?.kind).toBe("binding");
  });

  it("returns typed builtins, numeric operators, and array/list references without filtering or truncation", () => {
    const points = Array.from({ length: 12 }, (_, index) => `point P${index} = coordinate(x: ${index}, y: 0)`);
    const source = ["nui 4", ...points, "line L = segment(start: @P0, end: @P1)"].join("\n");
    const result = exactQuery(source, "@P0");
    expect(result?.category).toBe("parameter");
    expect(labels(result).filter((label) => /^P\d+$/.test(label))).toHaveLength(12);
    expect(labels(result)).toContain("P11");
    expect(result?.candidates.some((candidate) => candidate.kind === "operator")).toBe(false);

    const listSource = [
      "nui 4",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 0), end: (20, 0))",
      "line L = offset(sources: [@A], distance: 1, side: left)"
    ].join("\n");
    const list = exactQuery(listSource, "@A");
    expect(list?.category).toBe("parameter");
    expect(labels(list)).toContain("A");
    expect(list?.replacementRange.from).toBe(listSource.indexOf("@A") + 1);
  });

  it("uses source geometry semantics for @ references and . properties without runtime evaluation", () => {
    const source = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "line AB = segment(start: @A, end: @A)",
      "const value: number = @AB.length"
    ].join("\n");
    const reference = exactQuery(source, "@AB");
    expect(reference?.category).toBe("typedInitializer");
    const property = exactQuery(source, "@AB.le", 6);
    expect(property?.category).toBe("elementParameter");
    expect(labels(property)).toContain("length");
    expect(property && source.slice(property.replacementRange.from, property.replacementRange.to)).toBe("le");
    expect(property?.replacementRange.from).toBe(source.indexOf("@AB.le") + "@AB.".length);
  });

  it("completes qualified members in the ordinary CAD namespace", () => {
    const source = [
      "nui 4",
      "group 前身頃 {",
      "  point か = coordinate(x: 0, y: 0)",
      "}",
      "point 使用 = offset(from: @前身頃::か, dx: 0, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@前身頃::か");
    expect(result?.category).toBe("moduleQualifiedMember");
    expect(labels(result)).toContain("か");
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("か");
    expect(result?.replacementRange.from).toBe(source.indexOf("@前身頃::か") + "@前身頃::".length);
  });

  it("filters ordinary CAD qualified members by the point reference parameter kind", () => {
    const source = [
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "  line L = segment(start: @P, end: @P)",
      "}",
      "point X = offset(from: @G::, dx: 0, dy: 0)"
    ].join("\n");
    const result = exactQuery(source, "@G::", "@G::".length);
    expect(result?.context).toMatchObject({ expectedGeometryKind: "point" });
    expect(labels(result)).toEqual(["P"]);
  });

  it("filters ordinary CAD qualified members by the line reference parameter kind", () => {
    const source = [
      "nui 4",
      "group G {",
      "  point P = coordinate(x: 0, y: 0)",
      "  line L = segment(start: @P, end: @P)",
      "}",
      "point X = intersection(line1: @G::, line2: @G::, index: 0, extensions: false)"
    ].join("\n");
    const result = exactQuery(source, "@G::", "@G::".length);
    expect(result?.context).toMatchObject({ expectedGeometryKind: "lineReference" });
    expect(labels(result)).toEqual(["L"]);
  });

  it("uses the canonical typed-scalar geometry property vocabulary", () => {
    const source = [
      "nui 4",
      "arc Arc = arc(center: (0, 0), radius: 10, start: 0, end: 90)",
      "const value: number = @Arc.ra"
    ].join("\n");
    const result = exactQuery(source, "@Arc.ra");
    expect(result?.category).toBe("elementParameter");
    expect(labels(result)).toEqual(expect.arrayContaining(["radius", "startPoint.x", "centerPoint.x"]));
    expect(result && source.slice(result.replacementRange.from, result.replacementRange.to)).toBe("ra");
  });

  it("returns choice literals and mutable set targets only", () => {
    const source = [
      "nui 4",
      "let target: number = 1",
      "const fixed: number = 2",
      "set ta = @target"
    ].join("\n");
    const set = exactQuery(source, "set ta", "set ta".length);
    expect(set?.category).toBe("setTarget");
    expect(labels(set)).toContain("target");
    expect(labels(set)).not.toContain("fixed");
    expect(set?.candidates.every((candidate) => candidate.kind === "binding")).toBe(true);

    const choiceSource = "nui 4\nline L = offset(sources: [A], distance: 1, side: le)";
    const choicePosition = choiceSource.indexOf("side: le") + "side: le".length;
    const choice = queryIncomplete(choiceSource, choicePosition);
    expect(choice?.category).toBe("parameter");
    expect(labels(choice)).toEqual(expect.arrayContaining(["left", "right"]));
  });

  it("returns template-hole scalar expressions and maps multiline ranges back to physical source", () => {
    const source = [
      "nui 4",
      "const width: number = 10",
      "text Label = label(text: \"width=${@width}\", anchor: (0, 0))"
    ].join("\n");
    const template = exactQuery(source, "@width");
    expect(template?.category).toBe("templateHole");
    expect(labels(template)).toContain("width");
    expect(template && source.slice(template.replacementRange.from, template.replacementRange.to)).toBe("width");

    const multiline = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "point P = offset(",
      "  from: @A",
      "  d",
      ")"
    ].join("\n");
    const position = multiline.indexOf("\n  d") + "\n  d".length;
    const result = queryIncomplete(multiline, position);
    expect(result?.category).toBe("argument");
    expect(result && multiline.slice(result.replacementRange.from, result.replacementRange.to)).toBe("d");
    expect(result?.replacementRange.from).toBe(position - 1);
  });

  it("supports Module callee, argument labels, typed filtering, geometry interfaces, and qualified members", () => {
    const source = [
      "nui 4",
      "point P = coordinate(x: 0, y: 0)",
      "line L = segment(start: @P, end: @P)",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "module Strict(input: line, width: number) {",
      "}",
      "module Broad(input: path, width: number, optional: number = 0) {",
      "}",
      "instance Source = Producer()",
      "instance Use = Strict(input: @)",
      "instance Call = Broad(input: @L, )"
    ].join("\n");

    const calleeSource = source.replace("instance Call = Broad(input: @L,", "instance Call = Br");
    const callee = exactQuery(calleeSource, "= Br", "= Br".length);
    expect(callee?.category).toBe("moduleCallee");
    expect(labels(callee)).toContain("Broad");

    const argument = exactQuery(source, "Broad(input: @L, ", "Broad(input: @L, ".length);
    expect(argument?.category).toBe("moduleArgumentLabel");
    expect(labels(argument)).toContain("width");

    const lineArgument = exactQuery(source, "@)", 1);
    expect(lineArgument?.category).toBe("moduleArgumentValue");
    expect(labels(lineArgument)).toContain("L");
    expect(labels(lineArgument)).not.toContain("P");

    const qualifiedSource = source.replace("instance Call = Broad(input: @L, )", "point X = offset(from: @Source::Public, dx: 1, dy: 0)");
    const qualified = exactQuery(qualifiedSource, "@Source::", "@Source::".length);
    expect(qualified?.category).toBe("moduleQualifiedMember");
    expect(labels(qualified)).toEqual(["Public"]);
    expect(qualified?.replacementRange.from).toBe(qualifiedSource.indexOf("@Source::") + "@Source::".length);
  });

  it("supports Japanese source identifiers and fails closed for stale semantic snapshots", () => {
    const source = [
      "nui 4",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "line 身頃線 = segment(start: @前身頃, end: @前身頃)",
      "point 後身頃 = offset(from: @前身頃, dx: 1, dy: 0)"
    ].join("\n");
    const japanese = exactQuery(source, "@前身頃");
    expect(labels(japanese)).toContain("前身頃");

    const oldSource = "nui 4\nconst old: number = 1\nconst value: number = @old";
    const oldCompiled = compileWithIds(oldSource, 3);
    const liveSource = "nui 4\nconst renamed: number = 1\nconst value: number = @ren";
    const stale = queryDslCompletion({
      source: { normalizedSource: liveSource, sourceRevision: 4 },
      position: liveSource.length,
      semantic: { sourceRevision: 3, compiled: oldCompiled }
    });
    expect(stale?.category).toBe("typedInitializer");
    expect(labels(stale)).not.toContain("old");
    expect(stale?.candidates.some((candidate) => candidate.kind === "binding")).toBe(false);

    const syntax = queryIncomplete("nui 4\nconst value: number = ");
    expect(labels(syntax)).toContain("abs");
  });

  it("returns null for unsupported CRLF input while keeping absolute LF ranges host-neutral", () => {
    expect(queryDslCompletion({
      source: { normalizedSource: "nui 4\r\npoi", sourceRevision: 1 },
      position: 9
    })).toBeNull();
  });
});
