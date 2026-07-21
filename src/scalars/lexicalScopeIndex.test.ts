import { describe, expect, it } from "vitest";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { buildLexicalScopeIndex, scopeChain, type ResolveStatementId } from "./lexicalScopeIndex";

// Test-local stable id stub: keyed by name (unique across every fixture
// below), never by statementIndex. This exercises the injection contract -
// the module under test must never fall back to array position on its own -
// while staying much simpler than the real src/dsl/lexicalScopeIndexAdapter.ts
// structural-path resolver, which has its own dedicated tests.
const byName: ResolveStatementId = (_index, statement) => statement.name || `${statement.kind}@${statement.line}`;

const parse = (source: string): readonly DslStatement[] => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return parsed.statements;
};

// For the malformed-brace-recovery fixtures below, which intentionally
// produce parser diagnostics; we only care that `enclosing` is still
// deterministically assigned, not that parsing was clean.
const parseAllowingDiagnostics = (source: string): readonly DslStatement[] => parseDsl(source).statements;

describe("buildLexicalScopeIndex", () => {
  it("builds a parent/child chain for nested groups", () => {
    const statements = parse(["group Outer {", "  group Inner {", "    const x: number = 1", "  }", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);

    const outerId = "group:Outer";
    const innerId = "group:Inner";
    expect(index.scopes.get(outerId)).toMatchObject({ kind: "group", parentId: index.rootScopeId });
    expect(index.scopes.get(innerId)).toMatchObject({ kind: "group", parentId: outerId });
    expect(index.scopes.get(outerId)?.childIds).toEqual([innerId]);
    expect(scopeChain(index, innerId)).toEqual([innerId, outerId, index.rootScopeId]);

    const declaration = index.allDeclarations[0];
    expect(declaration).toMatchObject({ scopeId: innerId, name: "x" });
    expect(index.declarationsByScope.get(innerId)).toEqual([declaration]);
  });

  it("models if/else as siblings, not parent/child", () => {
    const statements = parse(
      ["if 分岐 (1) {", "  let x: boolean = true", "} else {", "  let x: boolean = false", "}"].join("\n")
    );
    const index = buildLexicalScopeIndex(statements, byName);

    const thenId = "if:分岐:then";
    const elseId = "if:分岐:else";
    const then = index.scopes.get(thenId);
    const elseScope = index.scopes.get(elseId);
    expect(then).toBeDefined();
    expect(elseScope).toBeDefined();
    expect(then?.parentId).toBe(index.rootScopeId);
    expect(elseScope?.parentId).toBe(index.rootScopeId);
    // Siblings, not parent/child of each other.
    expect(index.scopes.get(index.rootScopeId)?.childIds).toEqual([thenId, elseId]);

    const [thenDecl, elseDecl] = index.allDeclarations;
    expect(thenDecl).toMatchObject({ scopeId: thenId, name: "x" });
    expect(elseDecl).toMatchObject({ scopeId: elseId, name: "x" });
  });

  it("creates only a then scope when there is no else branch", () => {
    const statements = parse(["if 分岐 (1) {", "  const x: number = 1", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);
    expect(index.scopes.has("if:分岐:then")).toBe(true);
    expect(index.scopes.has("if:分岐:else")).toBe(false);
  });

  it("records the forGroup iteration binding slot, including unnamed loops", () => {
    const named = parse(["for 繰返し (i from: 0 count: 5 step: 1) {", "  const y: number = 1", "}"].join("\n"));
    const namedIndex = buildLexicalScopeIndex(named, byName);
    const namedScopeId = "for:繰返し";
    expect(namedIndex.forGroupIterationSlots.get(namedScopeId)).toMatchObject({ name: "i", scopeId: namedScopeId });
    expect(namedIndex.declarationsByScope.get(namedScopeId)?.[0]).toMatchObject({ name: "y" });

    const unnamed = parse(["for (i from: 0 count: 3) {", "}"].join("\n"));
    const unnamedByLine: ResolveStatementId = (_index, statement) => `for@${statement.line}`;
    const unnamedIndex = buildLexicalScopeIndex(unnamed, unnamedByLine);
    const unnamedScopeId = "for:for@1";
    expect(unnamedIndex.forGroupIterationSlots.get(unnamedScopeId)).toMatchObject({ name: "i" });
  });

  it("gives an empty block a sentinel entry and a real exit", () => {
    const statements = parse(["group A {", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);
    const scope = index.scopes.get("group:A");
    expect(scope?.entryStatementIndex).toBe(1); // the blockEnd is the only member
    expect(scope?.exitStatementIndex).toBe(1);
  });

  it("stays deterministic through an unclosed block", () => {
    const statements = parseAllowingDiagnostics("group A {");
    const index = buildLexicalScopeIndex(statements, byName);
    const scope = index.scopes.get("group:A");
    expect(scope).toBeDefined();
    expect(scope?.exitStatementIndex).toBe(statements.length);
  });

  it("stays deterministic through a stray closing brace", () => {
    const statements = parseAllowingDiagnostics("}");
    expect(() => buildLexicalScopeIndex(statements, byName)).not.toThrow();
    const index = buildLexicalScopeIndex(statements, byName);
    expect(index.scopeOfStatement.get(0)).toBe(index.rootScopeId);
  });

  it("stays deterministic and does not corrupt an unrelated scope when else is misused outside if/then", () => {
    const statements = parseAllowingDiagnostics(["group A {", "} else {", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);
    const scope = index.scopes.get("group:A");
    expect(scope).toBeDefined();
    // The invalid `} else {` cannot become group A's closer - only the real
    // trailing `}` does, exactly matching the parser's own recovery.
    expect(scope?.exitStatementIndex).toBe(2);
    expect(index.scopes.has("if:A:then")).toBe(false);
  });

  it("stays deterministic when a statement cannot open a block", () => {
    const statements = parseAllowingDiagnostics("point A = coordinate(x: 0 y: 0) {");
    expect(() => buildLexicalScopeIndex(statements, byName)).not.toThrow();
  });

  it("never derives a scope id from statementIndex - only from the injected resolver", () => {
    const withoutPadding = parse(["group Outer {", "  const x: number = 1", "}"].join("\n"));
    const withPadding = parse(
      ["const Unrelated: number = 99", "group Outer {", "  const x: number = 1", "}"].join("\n")
    );
    const indexA = buildLexicalScopeIndex(withoutPadding, byName);
    const indexB = buildLexicalScopeIndex(withPadding, byName);
    const scopeA = indexA.scopes.get("group:Outer");
    const scopeB = indexB.scopes.get("group:Outer");
    expect(scopeA).toBeDefined();
    expect(scopeB).toBeDefined();
    // "Outer" shifted from statementIndex 0 to 1 once the unrelated leading
    // statement was inserted, yet the scope id string stayed identical -
    // proof the id came from the resolver's output, never from position.
    expect(scopeA?.openingStatementIndex).toBe(0);
    expect(scopeB?.openingStatementIndex).toBe(1);
  });

  it("collects legacy var records without resolving or deduplicating them", () => {
    const statements = parse(["var Legacy = 1", "group A {", "  var Scoped = 2", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);
    expect(index.legacyVariablesByScope.get(index.rootScopeId)).toEqual([
      { scopeId: index.rootScopeId, statementIndex: 0, name: "Legacy", nameSpan: statements[0].nameSpan }
    ]);
    expect(index.legacyVariablesByScope.get("group:A")).toEqual([
      { scopeId: "group:A", statementIndex: 2, name: "Scoped", nameSpan: statements[2].nameSpan }
    ]);
  });

  it("collects long-form legacy vars so visibility adapters can read scope attrs without source reparsing", () => {
    const statements = parse(["group A {", "  var Scoped = expression(value: 2 scope: group)", "}"].join("\n"));
    const index = buildLexicalScopeIndex(statements, byName);
    expect(index.legacyVariablesByScope.get("group:A")).toEqual([
      { scopeId: "group:A", statementIndex: 1, name: "Scoped", nameSpan: statements[1].nameSpan }
    ]);
  });

  it("maps every statement to a scope across 1000 statements", () => {
    const lines: string[] = [];
    for (let i = 0; i < 250; i += 1) {
      lines.push(`group G${i} {`);
      lines.push(`  const V${i}: number = ${i}`);
      lines.push(`}`);
      lines.push(`const Top${i}: number = ${i}`);
    }
    const statements = parse(lines.join("\n"));
    expect(statements.length).toBe(1000);
    const index = buildLexicalScopeIndex(statements, byName);
    expect(index.scopeOfStatement.size).toBe(1000);
    for (let i = 0; i < 250; i += 1) {
      expect(index.scopes.has(`group:G${i}`)).toBe(true);
    }
    expect(index.allDeclarations).toHaveLength(500);
  });
});
