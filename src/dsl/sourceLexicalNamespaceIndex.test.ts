import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import { parseDsl } from "./dslParser";

const parseWithStableIds = (source: string) => {
  const parsed = parseDsl(source);
  const stableIds = new Map(parsed.statements.map((_, index) => [index, `stable-${index}`]));
  return { parsed, stableIds };
};

describe("source lexical namespace index", () => {
  it("indexes module, group, geometry, and typed declarations in their enclosing lexical scopes", () => {
    const { parsed, stableIds } = parseWithStableIds(
      [
        "nui 3",
        "module M() {",
        "  point M = coordinate(x: 0, y: 0)",
        "  group Body {",
        "  }",
        "}",
        "const M: number = 1"
      ].join("\n")
    );
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);

    expect(index.allDeclarations.map((declaration) => declaration.kind)).toEqual([
      "moduleDefinition",
      "geometry",
      "group",
      "typedDeclaration"
    ]);
    expect(index.declarationsByScope.get("module:stable-1")?.map((declaration) => declaration.name)).toEqual([
      "M",
      "Body"
    ]);
    expect(index.allDeclarations.find((declaration) => declaration.name === "M" && declaration.kind === "geometry")?.statementId).toBe(
      "stable-2"
    );
  });

  it("reports module-related same-scope collisions without duplicating geometry or scalar owners", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  point M = coordinate(x: 0, y: 0)",
      "}",
      "const M: number = 1",
      "module M = M()"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);

    expect(index.collisions).toHaveLength(2);
    expect(index.diagnostics).toHaveLength(2);
    expect(index.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "source-namespace-collision", line: 5 }),
        expect.objectContaining({ code: "source-namespace-collision", line: 6 })
      ])
    );
  });

  it("reports duplicate geometry declarations inside an inert module body", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point A = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "source-namespace-collision", line: 4 })]);
  });

  it("reports group/geometry collisions inside an inert module body", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  group A {",
      "  }",
      "  point A = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "source-namespace-collision", line: 5 })]);
  });

  it("reports duplicate typed declarations inside an inert module body", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  const A: number = 1",
      "  let A: number = 2",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "source-namespace-collision", line: 4 })]);
    expect(compiled.bindingAnalysis).toBeUndefined();
  });

  it("includes named conditional and for containers in module collisions", () => {
    const source = [
      "nui 3",
      "module A() {",
      "}",
      "if A (1) {",
      "}",
      "for A (i, from: 0, count: 1) {",
      "}",
      "module A = A()"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "source-namespace-collision")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 4 }),
        expect.objectContaining({ line: 6 }),
        expect.objectContaining({ line: 8 })
      ])
    );
    expect(compiled.sourceLexicalNamespace?.allDeclarations.map((declaration) => declaration.kind)).toEqual([
      "moduleDefinition",
      "conditionalGroup",
      "forGroup",
      "moduleInstance"
    ]);
  });

  it("allows equal names in different lexical scopes and exposes the index through document compilation", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  group G {",
      "    point X = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "group G {",
      "  point X = coordinate(x: 1, y: 1)",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "source-namespace-collision")).toEqual([]);
    expect(compiled.sourceLexicalNamespace?.allDeclarations.map((declaration) => declaration.name)).toEqual([
      "M",
      "G",
      "X",
      "G",
      "X"
    ]);
    expect(compiled.statementMap?.statementIdByStatementIndex?.get(1)).toBe("stable-1");
    expect(compiled.statementMap?.statementIdByStatementIndex?.get(3)).toBe("stable-3");
    expect(compiled.statementMap?.elementIdByStatementIndex.has(3)).toBe(false);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["G", "X"]);
  });

  it("does not add a second diagnostic to the existing CAD geometry namespace owner", () => {
    const source = [
      "nui 3",
      "group G {",
      "}",
      "point G = coordinate(x: 0, y: 0)"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.message.includes("同名の要素"))).toHaveLength(1);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "source-namespace-collision")).toEqual([]);
  });

  it("keeps regular root duplicates with their existing diagnostic owners", () => {
    const source = [
      "nui 3",
      "point A = coordinate(x: 0, y: 0)",
      "point A = coordinate(x: 1, y: 1)",
      "const Scalar: number = 1",
      "let Scalar: number = 2"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.message.includes("同名の要素"))).toHaveLength(1);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "source-namespace-collision")).toEqual([]);
  });

  it("keeps module source statements out of runtime geometry and scalar analysis", () => {
    const source = [
      "nui 3",
      "module M() {",
      "  point Hidden = coordinate(x: 0, y: 0)",
      "  const hidden: number = 1",
      "  set hidden = 2",
      "}",
      "point Root = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.document?.elements.map((element) => element.name)).toEqual(["Root"]);
    expect(compiled.bindingAnalysis).toBeUndefined();
    expect(compiled.sourceLexicalNamespace?.allDeclarations.map((declaration) => declaration.name)).toEqual([
      "M",
      "Hidden",
      "hidden",
      "Root"
    ]);
  });

  it("retains source-only identities for module const, set, and nested module statements", () => {
    const source = [
      "nui 3",
      "module Outer() {",
      "  const value: number = 1",
      "  set value = 2",
      "  module Inner() {",
      "  }",
      "  module Instance = Inner()",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });
    const statementMap = compiled.statementMap!;
    const sourceOnlyKinds = new Set(["typedDeclaration", "set", "moduleDefinition", "moduleInstance"]);

    for (const [statementIndex, statement] of parsed.statements.entries()) {
      if (!sourceOnlyKinds.has(statement.kind)) continue;
      expect(statementMap.statementIdByStatementIndex?.get(statementIndex)).toBe(`stable-${statementIndex}`);
      expect(statementMap.elementIdByStatementIndex.has(statementIndex)).toBe(false);
    }
  });
});
