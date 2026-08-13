import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { buildSourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";
import { resolveSourceLexicalPath } from "./sourceLexicalNamespaceIndex";
import { parseDslReferenceToken } from "./dslReferenceTokens";
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
        "nui 4",
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
      "nui 4",
      "module M() {",
      "  point M = coordinate(x: 0, y: 0)",
      "}",
      "const M: number = 1",
      "instance M = M()"
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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

  it("indexes anonymous conditional and for containers without treating them as named collisions", () => {
    const source = [
      "nui 4",
      "module A() {",
      "}",
      "if (true) {",
      "}",
      "for i in range(from: 0, count: 1) {",
      "}",
      "instance A = A()"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.code === "source-namespace-collision")).toEqual([
      expect.objectContaining({ line: 8 })
    ]);
    expect(compiled.sourceLexicalNamespace?.allDeclarations.map((declaration) => declaration.kind)).toEqual([
      "moduleDefinition",
      "moduleInstance"
    ]);
  });

  it("allows equal names in different lexical scopes and exposes the index through document compilation", () => {
    const source = [
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
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
      "nui 4",
      "module Outer() {",
      "  const value: number = 1",
      "  set value = 2",
      "  module Inner() {",
      "  }",
      "  instance Instance = Inner()",
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

  it("uses one collision namespace across scalar, geometry, group, module definition, and module instance kinds", () => {
    const source = [
      "nui 4",
      "point X = coordinate(x: 0, y: 0)",
      "const X: number = 1",
      "group G {",
      "}",
      "point G = coordinate(x: 1, y: 1)",
      "module M() {",
      "}",
      "const M: number = 2",
      "instance I = M()",
      "point I = coordinate(x: 2, y: 2)"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);
    const collisions = index.collisions.map(({ name, declarations }) => [
      name,
      declarations.map((declaration) => declaration.kind)
    ]);

    expect(collisions).toEqual(expect.arrayContaining([
      ["X", ["geometry", "typedDeclaration"]],
      ["G", ["group", "geometry"]],
      ["M", ["moduleDefinition", "typedDeclaration"]],
      ["I", ["moduleInstance", "geometry"]]
    ]));
  });

  it("keeps nested shadowing source-ordered without allowing a later local to shadow an outer declaration", () => {
    const { parsed, stableIds } = parseWithStableIds([
      "nui 4",
      "const X: number = 1",
      "group G {",
      "  const before: number = 0",
      "  point X = coordinate(x: 0, y: 0)",
      "  const after: number = 0",
      "}"
    ].join("\n"));
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);

    const before = resolveSourceLexicalPath(index, 3, parseDslReferenceToken("X"));
    const after = resolveSourceLexicalPath(index, 5, parseDslReferenceToken("X"));

    expect(before).toMatchObject({ kind: "resolved", declaration: { kind: "typedDeclaration", name: "X", statementId: "stable-1" } });
    expect(after).toMatchObject({ kind: "resolved", declaration: { kind: "geometry", name: "X", statementId: "stable-4" } });
  });

  it("reports later same-scope declarations as forward rather than falling through when no outer declaration exists", () => {
    const { parsed, stableIds } = parseWithStableIds([
      "nui 4",
      "group G {",
      "  const use: number = 0",
      "  point Later = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n"));
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);
    const lookup = resolveSourceLexicalPath(index, 2, parseDslReferenceToken("G::Later"));

    expect(lookup).toMatchObject({ kind: "forward", scopeId: "group:stable-1" });
    if (lookup.kind === "forward") expect(lookup.declarations.map((declaration) => declaration.statementId)).toEqual(["stable-3"]);
  });

  it("resolves nested qualified group paths and rejects traversal through a non-container", () => {
    const { parsed, stableIds } = parseWithStableIds([
      "nui 4",
      "const Scalar: number = 1",
      "group Outer {",
      "  group Inner {",
      "    point P = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "point Use = offset(from: @Outer::,Inner::P, dx: 0, dy: 0)"
    ].join("\n"));
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);

    expect(resolveSourceLexicalPath(index, 7, parseDslReferenceToken("Outer::Inner::P"))).toMatchObject({
      kind: "resolved",
      declaration: { kind: "geometry", name: "P", statementId: "stable-4" }
    });
    expect(resolveSourceLexicalPath(index, 7, parseDslReferenceToken("Scalar::member"))).toMatchObject({
      kind: "invalidTraversal",
      declaration: { kind: "typedDeclaration", statementId: "stable-1" },
      segment: "member"
    });
  });

  it("distinguishes qualified missing, forward, and ambiguous intermediate results", () => {
    const { parsed, stableIds } = parseWithStableIds([
      "nui 4",
      "group G {",
      "  const before: number = 0",
      "  point Later = coordinate(x: 0, y: 0)",
      "}",
      "group A {",
      "}",
      "group A {",
      "}",
      "point Use = coordinate(x: 0, y: 0)"
    ].join("\n"));
    const index = buildSourceLexicalNamespaceIndex(parsed.statements, stableIds);

    expect(resolveSourceLexicalPath(index, 9, parseDslReferenceToken("G::Missing"))).toEqual({ kind: "undefined" });
    expect(resolveSourceLexicalPath(index, 2, parseDslReferenceToken("G::Later"))).toMatchObject({ kind: "forward" });
    expect(resolveSourceLexicalPath(index, 9, parseDslReferenceToken("A::member"))).toMatchObject({ kind: "ambiguous" });
  });

  it("lets a scalar consumer fail on an inner geometry instead of selecting an outer scalar", () => {
    const source = [
      "nui 4",
      "const X: number = 5",
      "group G {",
      "  point X = coordinate(x: 0, y: 0)",
      "  const Value: number = @X",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "scalar-namespace-type-mismatch", message: expect.stringContaining("geometry") })
    ]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "undefined-binding", message: expect.stringContaining("X") })
    ]));
  });

  it("lets a geometry consumer fail on an inner scalar instead of selecting an outer geometry", () => {
    const source = [
      "nui 4",
      "point X = coordinate(x: 0, y: 0)",
      "group G {",
      "  const X: number = 1",
      "  point Use = offset(from: @X, dx: 0, dy: 0)",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });

    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-source-reference", message: expect.stringContaining("geometryではありません") })
    ]));
    expect(compiled.document).toBeNull();
  });

  it("keeps a qualified typed scalar forward result in the canonical namespace", () => {
    const source = [
      "nui 4",
      "group G {",
      "  const use: number = @G::X",
      "  const X: number = 1",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });
    const reference = compiled.bindingAnalysis?.initializerReferences.find((candidate) => candidate.name === "G::X");

    expect(reference?.resolution).toMatchObject({ kind: "namespace", reason: "forward" });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "forward-binding-reference" })]));
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "undefined-binding", message: expect.stringContaining("G::X") })
    ]));
  });

  it("keeps a qualified typed scalar ambiguity in the canonical namespace", () => {
    const source = [
      "nui 4",
      "group G {",
      "  const X: number = 1",
      "  let X: number = 2",
      "  const use: number = @G::X",
      "}"
    ].join("\n");
    const { parsed, stableIds } = parseWithStableIds(source);
    const compiled = compileDslDocument(source, { preparsed: parsed, assignedStatementIds: stableIds });
    const reference = compiled.bindingAnalysis?.initializerReferences.find((candidate) => candidate.name === "G::X");

    expect(reference?.resolution).toMatchObject({ kind: "namespace", reason: "ambiguous" });
    expect(compiled.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "undefined-binding", message: expect.stringContaining("G::X") })
    ]));
  });
});
