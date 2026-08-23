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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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

  it("keeps multiline in-progress punctuation, indentation, and comments inside the owner envelope", () => {
    const source = [
      "nui 4",
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
    const source = "nui 4\npoint A = coordinate(x: 0, y: 0)";
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
