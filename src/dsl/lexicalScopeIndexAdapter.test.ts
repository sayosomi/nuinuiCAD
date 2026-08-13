import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import type { DslStatement } from "./dslTypes";
import { buildLexicalScopeIndexFromStatements } from "./lexicalScopeIndexAdapter";

// Test-only helper: assigns each statement its own array index as a string.
// This is NOT a stable identity (it shifts under any edit) && exists only
// to exercise buildLexicalScopeIndexFromStatements's wiring in these tests;
// production callers must supply a real reconciled statementIndex -> stable
// id map instead (see lexicalScopeIndexAdapter.ts's own header comment).
const unstableIndexKeyedIdsForTesting = (statements: readonly DslStatement[]): Map<number, string> =>
  new Map(statements.map((_, index) => [index, `stmt${index}`]));

describe("buildLexicalScopeIndexFromStatements", () => {
  it("requires a caller-supplied stable id for every statement the core resolves", () => {
    const statements = parseDsl("group A {\n}").statements;
    expect(() => buildLexicalScopeIndexFromStatements(statements, new Map())).toThrow(/no stable statement id/);
  });

  it("wires a caller-supplied stable id map straight through to scope ids", () => {
    const statements = parseDsl("group A {\n}").statements;
    const index = buildLexicalScopeIndexFromStatements(statements, unstableIndexKeyedIdsForTesting(statements));
    expect(index.scopes.has("group:stmt0")).toBe(true);
  });

  it("does not collide scope ids for identically-named, identically-shaped sibling blocks, given distinct injected ids", () => {
    const statements = parseDsl(["group A {", "}", "group A {", "}"].join("\n")).statements;
    // Simulates two real, distinct reconciled elements that both happen to
    // be named/shaped "group A { }" - their real stable ids differ, which is
    // the only thing that must be true for the resulting scope ids to differ.
    const stableIds = new Map<number, string>([
      [0, "elem-1"],
      [1, "elem-1"],
      [2, "elem-2"],
      [3, "elem-2"]
    ]);
    const index = buildLexicalScopeIndexFromStatements(statements, stableIds);
    expect(index.scopes.has("group:elem-1")).toBe(true);
    expect(index.scopes.has("group:elem-2")).toBe(true);
    expect(index.scopes.size).toBe(3); // root + the two distinct group scopes
  });

  it("inherits an existing scope id when the opener's name/content changes but its injected stable id does not", () => {
    const before = parseDsl("group A {\n  const x: number = 1\n}").statements;
    const after = parseDsl("group Renamed {\n  const x: number = 2\n}").statements;
    const sameStableIdEachTime = new Map<number, string>([
      [0, "elem-1"],
      [1, "elem-1-body-decl"]
    ]);

    const indexBefore = buildLexicalScopeIndexFromStatements(before, sameStableIdEachTime);
    const indexAfter = buildLexicalScopeIndexFromStatements(after, sameStableIdEachTime);

    expect(indexBefore.scopes.has("group:elem-1")).toBe(true);
    expect(indexAfter.scopes.has("group:elem-1")).toBe(true);
  });

  it("inherits an existing scope id across a forward insertion, as long as the injected mapping tracks the shift", () => {
    const before = parseDsl("group Outer {\n  const x: number = 1\n}").statements;
    const after = parseDsl("const Unrelated: number = 99\ngroup Outer {\n  const x: number = 1\n}").statements;

    // "Outer" is statement 0 in `before` && statement 1 in `after` - the
    // caller's reconciliation is responsible for recognizing it is still the
    // same real element and mapping both positions to the same stable id.
    // This module's only job is to use whatever the caller supplies.
    const stableIdsBefore = new Map<number, string>([
      [0, "elem-outer"],
      [1, "elem-x"]
    ]);
    const stableIdsAfter = new Map<number, string>([
      [0, "elem-unrelated"],
      [1, "elem-outer"],
      [2, "elem-x"]
    ]);

    const indexBefore = buildLexicalScopeIndexFromStatements(before, stableIdsBefore);
    const indexAfter = buildLexicalScopeIndexFromStatements(after, stableIdsAfter);

    expect(indexBefore.scopes.has("group:elem-outer")).toBe(true);
    expect(indexAfter.scopes.has("group:elem-outer")).toBe(true);

    const declBefore = indexBefore.allDeclarations.find((decl) => decl.name === "x");
    const declAfter = indexAfter.allDeclarations.find((decl) => decl.name === "x");
    expect(declBefore?.statementIndex).toBe(1);
    expect(declAfter?.statementIndex).toBe(2);
    expect(declAfter?.scopeId).toBe(declBefore?.scopeId);
  });
});
