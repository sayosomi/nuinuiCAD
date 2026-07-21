import { describe, expect, it } from "vitest";
import { parseDsl } from "./dslParser";
import { buildLexicalScopeIndex } from "../scalars/lexicalScopeIndex";
import { buildLexicalScopeIndexFromSource, buildStructuralStatementIds } from "./lexicalScopeIndexAdapter";

describe("buildStructuralStatementIds", () => {
  it("inherits an existing scope id after an unrelated statement is inserted earlier in the document", () => {
    const before = ["group Outer {", "  const x: number = 1", "}"].join("\n");
    const after = ["const Unrelated: number = 99", "group Outer {", "  const x: number = 1", "}"].join("\n");

    const indexBefore = buildLexicalScopeIndexFromSource(before);
    const indexAfter = buildLexicalScopeIndexFromSource(after);

    const outerScopeIdBefore = [...indexBefore.scopes.entries()].find(([, scope]) => scope.kind === "group")?.[0];
    const outerScopeIdAfter = [...indexAfter.scopes.entries()].find(([, scope]) => scope.kind === "group")?.[0];
    expect(outerScopeIdBefore).toBeDefined();
    expect(outerScopeIdAfter).toBe(outerScopeIdBefore);

    // The declaration's containing scope inherits the same id too, even
    // though its statementIndex shifted from 1 to 2 (indexAfter's
    // allDeclarations[0] is "Unrelated" itself, declared first).
    const declBefore = indexBefore.allDeclarations.find((decl) => decl.name === "x");
    const declAfter = indexAfter.allDeclarations.find((decl) => decl.name === "x");
    expect(declBefore?.statementIndex).toBe(1);
    expect(declAfter?.statementIndex).toBe(2);
    expect(declAfter?.scopeId).toBe(declBefore?.scopeId);
  });

  it("disambiguates genuinely duplicate same-name siblings by occurrence, deterministically", () => {
    const source = ["group A {", "}", "group A {", "}"].join("\n");
    const parsed = parseDsl(source);
    const resolve = buildStructuralStatementIds(parsed.statements);
    const firstId = resolve(0, parsed.statements[0]);
    const secondId = resolve(2, parsed.statements[2]);
    expect(firstId).not.toBe(secondId);
    // Deterministic across repeated calls / rebuilds of the same source.
    const parsedAgain = parseDsl(source);
    const resolveAgain = buildStructuralStatementIds(parsedAgain.statements);
    expect(resolveAgain(0, parsedAgain.statements[0])).toBe(firstId);
    expect(resolveAgain(2, parsedAgain.statements[2])).toBe(secondId);
  });
});

describe("buildLexicalScopeIndexFromSource", () => {
  it("matches the core built directly from the same parsed statements and resolver", () => {
    const source = ["group Outer {", "  if 分岐 (1) {", "    const x: number = 1", "  } else {", "    const x: number = 2", "  }", "}"].join(
      "\n"
    );
    const parsed = parseDsl(source);
    const direct = buildLexicalScopeIndex(parsed.statements, buildStructuralStatementIds(parsed.statements));
    const viaAdapter = buildLexicalScopeIndexFromSource(source);

    expect([...viaAdapter.scopes.keys()].sort()).toEqual([...direct.scopes.keys()].sort());
    expect(viaAdapter.allDeclarations).toEqual(direct.allDeclarations);
  });
});
