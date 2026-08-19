import { describe, expect, it } from "vitest";
import { compileFreshCanonicalText, type LastGoodDslDocument } from "../document/canonicalDocument";
import { sourceOwnerByRuntimeElementId } from "./sourceOwnership";
import {
  queryDslCanvasSourceDefinition,
  queryDslCanvasSourceTarget
} from "./dslNavigationQuery";
import type { CompiledDslDocument } from "./dslDocument";

const compiledFor = (sourceText: string): LastGoodDslDocument => {
  const result = compileFreshCanonicalText(sourceText);
  if (result.status === "fatal") throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
  return result.doc;
};

const snapshotFor = (compiled: CompiledDslDocument) => ({
  normalizedSource: compiled.spans.sourceMap.source,
  sourceRevision: compiled.spans.sourceMap.sourceRevision
});

const targetFor = (source: string, token: string, offset = 0) => {
  const compiled = compiledFor(source);
  const snapshot = snapshotFor(compiled);
  return {
    compiled,
    target: queryDslCanvasSourceTarget({
      source: snapshot,
      compiled,
      position: source.indexOf(token) + offset
    })
  };
};

describe("DSL Canvas navigation queries", () => {
  it("resolves named and unnamed runtimes to exact identifier/keyword spans", () => {
    const source = [
      "nui 4",
      "point Named = coordinate(x: 0, y: 0)",
      "point = coordinate(x: 1, y: 1)"
    ].join("\n");
    const compiled = compiledFor(source);
    const snapshot = snapshotFor(compiled);
    const owners = sourceOwnerByRuntimeElementId(compiled);
    const named = compiled.document.elements.find((element) => element.name === "Named")!;
    const unnamed = compiled.document.elements.find((element) => element.name === "")!;

    expect(queryDslCanvasSourceDefinition({
      source: snapshot,
      compiled,
      runtimeElementId: named.id
    })).toEqual({
      from: source.indexOf("Named"),
      to: source.indexOf("Named") + "Named".length
    });
    expect(queryDslCanvasSourceDefinition({
      source: snapshot,
      compiled,
      runtimeElementId: unnamed.id
    })).toEqual({
      from: source.indexOf("point ="),
      to: source.indexOf("point =") + "point".length
    });
    expect(owners.get(named.id)?.sourceStatementIndex).toBeDefined();
  });

  it("maps an instance to its call site and repeated module bodies to one authored definition", () => {
    const source = [
      "nui 4",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "instance A = M()",
      "instance B = M()"
    ].join("\n");
    const compiled = compiledFor(source);
    const snapshot = snapshotFor(compiled);
    const instance = compiled.document.elements.find((element) => element.name === "A")!;
    expect(queryDslCanvasSourceDefinition({
      source: snapshot,
      compiled,
      runtimeElementId: instance.id
    })).toEqual({
      from: source.indexOf("A"),
      to: source.indexOf("A") + 1
    });

    const bodyTarget = queryDslCanvasSourceTarget({
      source: snapshot,
      compiled,
      position: source.indexOf("P =")
    });
    expect(bodyTarget).not.toBeNull();
    const owners = sourceOwnerByRuntimeElementId(compiled);
    const matching = compiled.document.elements.filter((element) =>
      owners.get(element.id)?.sourceStatementIndex === bodyTarget!.sourceStatementIndex
    );
    expect(matching.filter((element) => element.name === "P")).toHaveLength(2);
  });

  it("targets nested module bodies without attributing them to the enclosing module", () => {
    const source = [
      "nui 4",
      "module Inner() {",
      "  point InnerPoint = coordinate(x: 1, y: 1)",
      "}",
      "module Outer() {",
      "  instance Child = Inner()",
      "}",
      "instance Root = Outer()"
    ].join("\n");
    const { target, compiled } = targetFor(source, "InnerPoint");
    expect(target).toEqual({
      sourceStatementIndex: compiled.statements.findIndex((statement) => statement.name === "InnerPoint")
    });
  });

  it("uses only exact authored statement fragments and fails closed for non-runtime/stale/unsafe input", () => {
    const source = [
      "nui 4",
      "// comment",
      "point Base = coordinate(x: 0, y: 0)",
      "let value: number = 1",
      "set value = 2",
      "module M() {",
      "  point P = coordinate(x: 0, y: 0)",
      "}",
      "point Use = offset(from: @Base, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compiledFor(source);
    const snapshot = snapshotFor(compiled);
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: source.indexOf("comment") })).toBeNull();
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: source.indexOf("value") })).toBeNull();
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: source.indexOf("module M") })).toBeNull();
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: source.indexOf("@Base") + 1 })).toEqual({
      sourceStatementIndex: compiled.statements.findIndex((statement) => statement.name === "Use")
    });
    expect(queryDslCanvasSourceTarget({
      source: { ...snapshot, sourceRevision: snapshot.sourceRevision + 1 },
      compiled,
      position: source.indexOf("Use")
    })).toBeNull();

    const element = compiled.document.elements.find((candidate) => candidate.name === "Use")!;
    const unsafe = {
      ...compiled,
      statements: compiled.statements.map((statement) => statement.name === "Use"
        ? { ...statement, namePhysicalSpan: { sourceRevision: snapshot.sourceRevision, segments: [{ from: Number.NaN, to: Number.POSITIVE_INFINITY }] } }
        : statement)
    } as CompiledDslDocument;
    expect(queryDslCanvasSourceDefinition({ source: snapshot, compiled: unsafe, runtimeElementId: element.id })).toBeNull();
  });

  it.each([
    ["stale physicalSpan.sourceRevision", (revision: number, sourceLength: number) => ({ sourceRevision: revision, segments: [{ from: 0, to: Math.min(5, sourceLength) }] }), 1],
    ["negative segment offset", () => ({ sourceRevision: 0, segments: [{ from: -1, to: 5 }] }), 0],
    ["out-of-source segment offset", (...parameters: [number, number]) => ({ sourceRevision: 0, segments: [{ from: 0, to: parameters[1] + 1 }] }), 0],
    ["inverted segment offset", () => ({ sourceRevision: 0, segments: [{ from: 8, to: 8 }] }), 0]
  ] as const)("fails closed for %s", (_label, physicalSpanFor, revisionDelta) => {
    const source = [
      "nui 4",
      "point Base = coordinate(x: 0, y: 0)",
      "point Use = offset(from: @Base, dx: 1, dy: 0)"
    ].join("\n");
    const compiled = compiledFor(source);
    const snapshot = snapshotFor(compiled);
    const useIndex = compiled.statements.findIndex((statement) => statement.name === "Use");
    const unsafe = {
      ...compiled,
      statements: compiled.statements.map((statement, statementIndex) => statementIndex === useIndex
        ? {
            ...statement,
            physicalSpan: physicalSpanFor(snapshot.sourceRevision + revisionDelta, source.length)
          }
        : statement)
    } as CompiledDslDocument;

    expect(queryDslCanvasSourceTarget({
      source: snapshot,
      compiled: unsafe,
      position: source.indexOf("Use")
    })).toBeNull();
  });

  it("matches only real physical code segments in a multi-segment statement", () => {
    const source = "nui 4\npoint Base = coordinate(x: 0, /* gap */ y: 0)";
    const compiled = compiledFor(source);
    const snapshot = snapshotFor(compiled);
    const statement = compiled.statements.find((candidate) => candidate.name === "Base")!;
    expect(statement.physicalSpan.segments.length).toBeGreaterThan(1);

    const [first, second] = statement.physicalSpan.segments;
    for (let position = first!.to; position < second!.from; position += 1) {
      expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position })).toBeNull();
    }
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: first!.from })).toEqual({
      sourceStatementIndex: compiled.statements.indexOf(statement)
    });
    expect(queryDslCanvasSourceTarget({ source: snapshot, compiled, position: second!.from })).toEqual({
      sourceStatementIndex: compiled.statements.indexOf(statement)
    });
  });
});
