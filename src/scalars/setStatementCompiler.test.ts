import { describe, expect, it } from "vitest";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DiagnosticSpanContext } from "../dsl/dslDiagnosticSpan";
import type { DslStatement } from "../dsl/dslTypes";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { Binding, BindingId } from "./bindingCatalog";
import {
  compileSetStatements,
  CONST_ASSIGNMENT_CODE,
  INVALID_SET_TARGET_CODE,
  MISSING_SET_STATEMENT_IDENTITY_CODE,
  SET_RHS_INVALID_REFERENCE_CODE,
  SET_RHS_UNRESOLVED_CODE
} from "./setStatementCompiler";
import { analyzeTypedDeclarations } from "./typedDeclarationAnalysis";

/** Mirrors compileDslDocument's own pipeline (dsl/dslDocument.ts) up to the
 * point Task 29 hooks in, so this module is tested against the same shapes
 * production actually produces - not a lighter reinvented harness (matches
 * propertyBindingCompiler.test.ts's own compileFor helper). */
const compileFor = (
  source: string
): {
  statements: readonly DslStatement[];
  stableStatementIdByIndex: ReadonlyMap<number, string>;
  bindingAnalysis: BindingAnalysis | undefined;
  spans: DiagnosticSpanContext;
} => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const statements = parsed.statements;
  const spans: DiagnosticSpanContext = { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom };
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 4 });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const elementIdByStatementIndex = compiled.elementIdsByStatementIndex ?? new Map();
  const stableStatementIdByIndex = new Map<number, string>(statements.map((_, index) => [index, `stable-${index}`]));
  for (const [statementIndex, elementId] of elementIdByStatementIndex) stableStatementIdByIndex.set(statementIndex, elementId);
  const scalarAnalysisCompilation = analyzeTypedDeclarations({
    statements,
    stableStatementIdByIndex,
    reconciledContainers: { elementIdByStatementIndex, elements: compiled.elements },
    spans
  });
  expect(scalarAnalysisCompilation.diagnostics).toEqual([]);
  return {
    statements,
    stableStatementIdByIndex,
    // Only const/let declarations trigger analyzeTypedDeclarations's own
    // catalog build (see typedDeclarationAnalysis.ts) - a document with only
    // legacy var/iteration bindings and no const/let has no catalog at all,
    // exactly the "no catalog" case compileSetStatements must handle.
    bindingAnalysis: scalarAnalysisCompilation.analysis?.bindingAnalysis,
    spans
  };
};

/**
 * Identity-based deep replacement across every Map/array/plain-object in a
 * BindingCatalog-shaped value, swapping any object reference `=== target`
 * for `replacement`. This is the only reliable way to simulate "what if a
 * `let` binding reached the catalog with an unresolved declared type" - real
 * DSL source can never produce this state (a malformed type annotation is
 * always a hard document-level compile error before bindingAnalysis exists
 * at all - see setStatementCompiler.ts's own header comment on this
 * defensive branch), so this patches a real, fully-consistent catalog rather
 * than guessing which of the catalog's several internal lookup structures
 * the resolver actually reads from.
 */
const deepReplace = <T>(value: T, target: object, replacement: object, seen = new Map<object, unknown>()): T => {
  if (value === null || typeof value !== "object") return value;
  if (value === target) return replacement as T;
  if (seen.has(value as object)) return seen.get(value as object) as T;
  if (value instanceof Map) {
    const next = new Map();
    seen.set(value as object, next);
    for (const [key, entry] of value) next.set(key, deepReplace(entry, target, replacement, seen));
    return next as T;
  }
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value as object, next);
    for (const entry of value) next.push(deepReplace(entry, target, replacement, seen));
    return next as T;
  }
  const next: Record<string, unknown> = {};
  seen.set(value as object, next);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    next[key] = deepReplace(entry, target, replacement, seen);
  }
  return next as T;
};

const withPatchedBinding = (
  bindingAnalysis: BindingAnalysis,
  bindingId: BindingId,
  patch: Partial<Binding>
): BindingAnalysis => {
  const original = bindingAnalysis.catalog.bindingsById.get(bindingId);
  if (!original) throw new Error(`test fixture: unknown binding ${bindingId}`);
  const patched: Binding = { ...original, ...patch };
  return deepReplace(bindingAnalysis, original, patched);
};

describe("compileSetStatements: target resolution", () => {
  it("accepts a valid let target across all four scalar types", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let a: number = 1",
      'let b: string = "x"',
      "let c: boolean = true",
      "let d: choice(x, y) = x",
      "set a = 2",
      'set b = "y"',
      "set c = false",
      "set d = y"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(diagnostics).toEqual([]);
    expect(setsByStatementIndex.size).toBe(4);
    expect(setsByStatementIndex.get(4)).toMatchObject({ targetName: "a", targetBindingId: "binding:stable-0" });
    expect(setsByStatementIndex.get(5)).toMatchObject({ targetName: "b", targetBindingId: "binding:stable-1" });
    expect(setsByStatementIndex.get(6)).toMatchObject({ targetName: "c", targetBindingId: "binding:stable-2" });
    expect(setsByStatementIndex.get(7)).toMatchObject({ targetName: "d", targetBindingId: "binding:stable-3" });
  });

  it("resolves to the innermost visible let when shadowed", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let x: number = 1",
      "group G {",
      "  let x: number = 2",
      "  set x = 3",
      "}"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(diagnostics).toEqual([]);
    const setIndex = statements.findIndex((statement) => statement.kind === "set");
    expect(setsByStatementIndex.get(setIndex)).toMatchObject({ targetBindingId: "binding:stable-2" });
  });

  it("rejects a const target with const-assignment", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "const x: number = 1",
      "set x = 2"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: CONST_ASSIGNMENT_CODE })]);
    // Task 48: exact-span regression check - points at the `x` target name
    // on the `set` line, not the whole `set x = 2` statement or the `const`
    // declaration line above it.
    const [diagnostic] = diagnostics;
    expect(diagnostic.exactSpanOnly).toBe(true);
    const source = ["const x: number = 1", "set x = 2"].join("\n");
    const [segment] = diagnostic.physicalSpan!.segments;
    expect(source.slice(segment.from, segment.to)).toBe("x");
    expect(segment.from).toBeGreaterThan(source.indexOf("set"));
  });

  it("rejects an undefined target with invalid-set-target (real catalog, name genuinely absent)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor(
      ["let unrelated: number = 1", "set x = 2"].join("\n")
    );
    expect(bindingAnalysis).toBeDefined();
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: INVALID_SET_TARGET_CODE })]);
  });

  it("rejects a forGroup iteration binding target with invalid-set-target (mutability check, not the no-catalog branch)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let unrelated: number = 1",
      "for i in range(from: 0, count: 2) {",
      "  set i = 2",
      "}"
    ].join("\n"));
    expect(bindingAnalysis).toBeDefined();
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: INVALID_SET_TARGET_CODE })]);
  });

  it("produces no analysis and no diagnostic when the document has no set statements", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor(["let x: number = 1"].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it("fails closed with invalid-set-target when there is no catalog at all (zero typed declarations)", () => {
    const parsed = parseDsl("set x = 1");
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const stableStatementIdByIndex = new Map<number, string>([[0, "stable-0"]]);
    const { setsByStatementIndex, diagnostics } = compileSetStatements({
      statements: parsed.statements,
      stableStatementIdByIndex,
      bindingAnalysis: undefined,
      spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom }
    });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: INVALID_SET_TARGET_CODE })]);
  });

  it("still reports a malformed RHS even with no catalog at all", () => {
    const parsed = parseDsl("set x = 1 +");
    expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const stableStatementIdByIndex = new Map<number, string>([[0, "stable-0"]]);
    const { diagnostics } = compileSetStatements({
      statements: parsed.statements,
      stableStatementIdByIndex,
      bindingAnalysis: undefined,
      spans: { sourceMap: parsed.sourceMap, logicalStatementByRangeFrom: parsed.logicalStatementByRangeFrom }
    });
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe("compileSetStatements: RHS typecheck", () => {
  it("rejects a type-mismatched RHS", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let x: number = 1",
      'set x = "not a number"'
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: "scalar-type-mismatch" })]);
  });

  it("rejects an RHS referencing an undefined binding", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let x: number = 1",
      "set x = @missing + 1"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: SET_RHS_UNRESOLVED_CODE })]);
  });

  it("rejects an RHS parse failure with no legacy fallback", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let x: number = 1",
      "set x = 1 +"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("resolves multiple set statements in one document via a single batch call", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let a: number = 1",
      "let b: number = 2",
      "set a = @b + 1",
      "set b = @a + 1"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(diagnostics).toEqual([]);
    expect(setsByStatementIndex.size).toBe(2);
  });
});

describe("compileSetStatements: two distinct invalid-let categories", () => {
  it("accepts a let whose own initializer failed as a recovery target (declared type known)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let broken: number = @missing",
      "set broken = 5"
    ].join("\n"));
    expect(bindingAnalysis).toBeDefined();
    const brokenBindingId = bindingAnalysis!.catalog.bindingsById.get("binding:stable-0")?.id;
    expect(bindingAnalysis!.entriesById.get(brokenBindingId!)?.status.kind).toBe("invalid");
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(diagnostics).toEqual([]);
    expect(setsByStatementIndex.size).toBe(1);
    const setIndex = statements.findIndex((statement) => statement.kind === "set");
    expect(setsByStatementIndex.get(setIndex)).toMatchObject({ targetName: "broken", targetBindingId: "binding:stable-0" });
  });

  it("accepts a let whose dependency failed transitively as a recovery target (declared type known)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let broken: number = @missing",
      "let dependent: number = @broken + 1",
      "set dependent = 5"
    ].join("\n"));
    expect(bindingAnalysis).toBeDefined();
    const dependentBindingId = bindingAnalysis!.catalog.bindingsById.get("binding:stable-1")?.id;
    expect(bindingAnalysis!.entriesById.get(dependentBindingId!)?.programEligibility.kind).toBe("ineligible");
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(diagnostics).toEqual([]);
    expect(setsByStatementIndex.size).toBe(1);
  });

  it("rejects a let whose declared type itself is unresolved, even though it is otherwise a normal let (declared type unknown)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis: base, spans } = compileFor([
      "let x: number = 1",
      "set x = 2"
    ].join("\n"));
    expect(base).toBeDefined();
    const bindingAnalysis = withPatchedBinding(base!, "binding:stable-0", { declaredType: null });
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: INVALID_SET_TARGET_CODE })]);
  });

  it("rejects an RHS reference to a binding whose declared type itself is unresolved", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis: base, spans } = compileFor([
      "let a: number = 1",
      "let b: number = 2",
      "set b = @a + 1"
    ].join("\n"));
    expect(base).toBeDefined();
    const bindingAnalysis = withPatchedBinding(base!, "binding:stable-0", { declaredType: null });
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: SET_RHS_INVALID_REFERENCE_CODE })]);
  });

  it("rejects an RHS reference to an invalid-status binding (distinct from the target-recovery rule)", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor([
      "let broken: number = @missing",
      "let other: number = 1",
      "set other = @broken + 1"
    ].join("\n"));
    const { setsByStatementIndex, diagnostics } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: SET_RHS_INVALID_REFERENCE_CODE })]);
  });
});

describe("compileSetStatements: statement identity contract", () => {
  it("fails closed with missing-stable-statement-identity, producing no analysis entry, when the reconciler map lacks an entry", () => {
    const { statements, stableStatementIdByIndex: full, bindingAnalysis, spans } = compileFor([
      "let x: number = 1",
      "set x = 2"
    ].join("\n"));
    const setIndex = statements.findIndex((statement) => statement.kind === "set");
    const incomplete = new Map(full);
    incomplete.delete(setIndex);
    const { setsByStatementIndex, diagnostics } = compileSetStatements({
      statements,
      stableStatementIdByIndex: incomplete,
      bindingAnalysis,
      spans
    });
    expect(setsByStatementIndex.size).toBe(0);
    expect(diagnostics).toEqual([expect.objectContaining({ code: MISSING_SET_STATEMENT_IDENTITY_CODE })]);
  });

  it("carries the exact reconciler-issued statementId through into the analysis entry, never a fabricated one", () => {
    const { statements, stableStatementIdByIndex, bindingAnalysis, spans } = compileFor(["let x: number = 1", "set x = 2"].join("\n"));
    const setIndex = statements.findIndex((statement) => statement.kind === "set");
    const { setsByStatementIndex } = compileSetStatements({ statements, stableStatementIdByIndex, bindingAnalysis, spans });
    expect(setsByStatementIndex.get(setIndex)?.statementId).toBe(stableStatementIdByIndex.get(setIndex));
  });
});
