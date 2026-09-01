import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "./dslDocument";
import { parseDslSnapshot } from "./dslParser";
import { queryDslCanvasRevealSourceTarget } from "./dslCanvasRevealQuery";

const compileWithIds = (source: string, sourceRevision = 11): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `reveal-test:${index}`]))
  });
};

const queryAt = (source: string, token: string, offset = 1, sourceRevision = 11) => {
  const compiled = compileWithIds(source, sourceRevision);
  return queryDslCanvasRevealSourceTarget({
    source: { normalizedSource: source, sourceRevision },
    compiled,
    position: source.indexOf(token) + offset
  });
};

describe("queryDslCanvasRevealSourceTarget", () => {
  it("prefers an ordinary geometry reference over its statement owner", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)"
    ].join("\n");
    const result = queryAt(source, "@A");

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.target.kind).toBe("semantic");
    if (result.target.kind !== "semantic") return;
    expect(result.target.semantic.kind).toBe("geometry-reference");
    expect(result.target.semantic.referenceText).toBe("@A");
    expect(result.target.ownerSourceStatementIndex).not.toBeNull();
  });

  it("does not treat a typed scalar reference as a geometry semantic target", () => {
    const source = [
      "nui 1",
      "const dx: number = 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: @dx, dy: 0)"
    ].join("\n");
    const result = queryAt(source, "@dx");

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.target).toEqual({ kind: "statement-owner", sourceStatementIndex: 3 });
  });

  it("keeps a module geometry parameter semantic identity for later materialization", () => {
    const source = [
      "nui 1",
      "module Shift(input: point) {",
      "  point Out = offset(from: @input, dx: 1, dy: 0)",
      "}",
      "point P1 = coordinate(x: 0, y: 0)",
      "point P2 = coordinate(x: 10, y: 0)",
      "instance S1 = Shift(input: @P1)",
      "instance S2 = Shift(input: @P2)"
    ].join("\n");
    const result = queryAt(source, "@input");

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved" || result.target.kind !== "semantic") return;
    expect(result.target.semantic.kind).toBe("geometry-reference");
    if (result.target.semantic.kind !== "geometry-reference") return;
    expect(result.target.semantic.reference.target?.kind).toBe("parameter");
    expect(result.target.ownerSourceStatementIndex).toBe(2);
  });

  it("uses the whole qualified module export reference as the semantic hit area", () => {
    const source = [
      "nui 1",
      "module Producer() {",
      "  export point Public = coordinate(x: 0, y: 0)",
      "}",
      "instance Source = Producer()",
      "point Use = offset(from: @Source::Public, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compileWithIds(source);
    const tokenStart = source.indexOf("@Source::Public");
    for (const offset of [0, 3, "@Source::".length, "@Source::Public".length - 1]) {
      const result = queryDslCanvasRevealSourceTarget({
        source: { normalizedSource: source, sourceRevision: 11 },
        compiled,
        position: tokenStart + offset
      });
      expect(result.status).toBe("resolved");
      if (result.status !== "resolved" || result.target.kind !== "semantic") continue;
      expect(result.target.semantic.referenceText).toBe("@Source::Public");
    }
  });

  it("recognizes geometry properties and keeps the base geometry target", () => {
    const source = [
      "nui 1",
      "line L = segment(start: (0, 0), end: (10, 0))",
      "const width: number = @L.length"
    ].join("\n");
    const result = queryAt(source, "@L.length", 3);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved" || result.target.kind !== "semantic") return;
    expect(result.target.semantic.kind).toBe("geometry-property");
    if (result.target.semantic.kind !== "geometry-property") return;
    expect(result.target.semantic.referenceText).toBe("@L.length");
    expect(result.target.semantic.reference.target?.kind).toBe("sourceGeometryProperty");
  });

  it("recognizes a geometry property in a root numeric element parameter across the full authored span", () => {
    const source = [
      "nui 1",
      "const distance: number = 5",
      "line Guide = segment(start: (0, 0), end: (10, 0))",
      "point P = coordinate(x: @Guide.length, y: @distance)"
    ].join("\n");
    const token = "@Guide.length";
    const tokenStart = source.indexOf(token);

    for (let offset = 0; offset < token.length; offset += 1) {
      const result = queryDslCanvasRevealSourceTarget({
        source: { normalizedSource: source, sourceRevision: 11 },
        compiled: compileWithIds(source),
        position: tokenStart + offset
      });

      expect(result.status).toBe("resolved");
      if (result.status !== "resolved" || result.target.kind !== "semantic") continue;
      expect(result.target.semantic.kind).toBe("geometry-property");
      if (result.target.semantic.kind !== "geometry-property") continue;
      expect(result.target.semantic.referenceText).toBe(token);
      expect(result.target.semantic.reference).toMatchObject({
        geometryName: "Guide",
        property: "length",
        target: {
          kind: "sourceGeometryProperty",
          statementIndex: 2,
          category: "line",
          property: "length"
        }
      });
    }
  });

  it("keeps a normal scalar reference in a root numeric element parameter on statement-owner fallback", () => {
    const source = [
      "nui 1",
      "const distance: number = 5",
      "line Guide = segment(start: (0, 0), end: (10, 0))",
      "point P = coordinate(x: @Guide.length, y: @distance)"
    ].join("\n");
    const result = queryAt(source, "@distance");

    expect(result).toEqual({ status: "resolved", target: { kind: "statement-owner", sourceStatementIndex: 3 } });
  });

  it("recognizes a choice-valued geometry property in a compiled property binding", () => {
    const source = [
      "nui 1",
      "const marker: number = 1",
      "arc Guide = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "arc Result = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: @Guide.direction)"
    ].join("\n");
    const token = "@Guide.direction";
    const tokenStart = source.indexOf(token);
    const compiled = compileWithIds(source);

    expect(compiled.propertyBindings).toBeDefined();
    for (let offset = 0; offset < token.length; offset += 1) {
      const result = queryDslCanvasRevealSourceTarget({
        source: { normalizedSource: source, sourceRevision: 11 },
        compiled,
        position: tokenStart + offset
      });

      expect(result.status).toBe("resolved");
      if (result.status !== "resolved" || result.target.kind !== "semantic") continue;
      expect(result.target.semantic.kind).toBe("geometry-property");
      if (result.target.semantic.kind !== "geometry-property") continue;
      expect(result.target.semantic.referenceText).toBe(token);
      expect(result.target.semantic.reference).toMatchObject({
        geometryName: "Guide",
        property: "direction",
        type: { kind: "choice", options: ["counterclockwise", "clockwise"] },
        target: { kind: "sourceGeometryProperty", statementIndex: 2, category: "arc", property: "direction" }
      });
    }
  });

  it("recognizes a geometry property in a set RHS", () => {
    const source = [
      "nui 1",
      "let direction: choice(counterclockwise, clockwise) = clockwise",
      "arc Guide = arc(center: (0, 0), radius: 10, start: 0, end: 90, direction: clockwise)",
      "set direction = @Guide.direction"
    ].join("\n");
    const token = "@Guide.direction";
    const tokenStart = source.indexOf(token);
    const compiled = compileWithIds(source);

    expect(compiled.setStatements).toBeDefined();
    for (let offset = 0; offset < token.length; offset += 1) {
      const result = queryDslCanvasRevealSourceTarget({
        source: { normalizedSource: source, sourceRevision: 11 },
        compiled,
        position: tokenStart + offset
      });

      expect(result.status).toBe("resolved");
      if (result.status !== "resolved" || result.target.kind !== "semantic") continue;
      expect(result.target.semantic.kind).toBe("geometry-property");
      if (result.target.semantic.kind !== "geometry-property") continue;
      expect(result.target.semantic.referenceText).toBe(token);
      expect(result.target.semantic.reference.target).toMatchObject({
        kind: "sourceGeometryProperty",
        statementIndex: 2,
        category: "arc",
        property: "direction"
      });
    }
  });

  it("keeps multiline in-progress punctuation, indentation, and comments inside the owner envelope", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(",
      "  // choose source",
      "  from: @A,",
      "  dx: 1,",
      "  dy: 0",
      ")   "
    ].join("\n");
    const compiled = compileWithIds(source);
    const snapshot = { normalizedSource: source, sourceRevision: 11 };
    for (const position of [
      source.indexOf("// choose source") + 3,
      source.indexOf("  dx: 1") + 1,
      source.indexOf("dx: 1") + "dx: 1".length
    ]) {
      const result = queryDslCanvasRevealSourceTarget({ source: snapshot, compiled, position });
      expect(result).toEqual({ status: "resolved", target: { kind: "statement-owner", sourceStatementIndex: 2 } });
    }

    const trailingWhitespace = source.lastIndexOf("   ") + 1;
    expect(queryDslCanvasRevealSourceTarget({ source: snapshot, compiled, position: trailingWhitespace }))
      .toEqual({ status: "failed", reason: "no-target" });
  });

  it("fails closed for a stale revision or same-revision source mismatch", () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const compiled = compileWithIds(source, 4);

    expect(queryDslCanvasRevealSourceTarget({
      source: { normalizedSource: source, sourceRevision: 5 },
      compiled,
      position: source.indexOf("point A")
    })).toEqual({ status: "failed", reason: "source-mismatch" });

    const changed = source.replace("A", "B");
    expect(queryDslCanvasRevealSourceTarget({
      source: { normalizedSource: changed, sourceRevision: 4 },
      compiled,
      position: changed.indexOf("point B")
    })).toEqual({ status: "failed", reason: "source-mismatch" });
  });
});
