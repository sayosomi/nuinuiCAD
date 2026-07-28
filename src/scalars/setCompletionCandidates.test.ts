import { describe, expect, it } from "vitest";
import type { Binding, BindingCatalog } from "./bindingCatalog";
import type { BindingAnalysis } from "./bindingAnalysis";
import { setRhsScalarCandidates, setTargetCandidates, type SetCompletionSiteDeps } from "./setCompletionCandidates";
import { typedDeclarationAnalysisFor } from "./testSupport/typedDeclarationAnalysisFixture";

const catalogFor = (source: string): { catalog: BindingCatalog; entriesById: BindingAnalysis["entriesById"] } => {
  const { bindingAnalysis } = typedDeclarationAnalysisFor(source);
  return { catalog: bindingAnalysis.catalog, entriesById: bindingAnalysis.entriesById };
};

const bindingByName = (catalog: BindingCatalog, name: string): Binding => {
  const binding = catalog.bindings.find((candidate) => candidate.name === name && candidate.kind === "typed");
  if (!binding) throw new Error(`no typed binding named ${name}`);
  return binding;
};

/**
 * Uses each binding's own compiled statementIndex as its "live position"
 * stand-in: this module only ever compares relative order, never real CM
 * character offsets, so statementIndex (source order for these fixtures) is
 * a faithful, simpler proxy - the real editor-layer position plumbing is
 * covered separately by statementRangeIndex.test.ts/cmAutocomplete.test.ts.
 */
const depsAt = (
  catalog: BindingCatalog,
  entriesById: BindingAnalysis["entriesById"],
  containingScopeId: string,
  cursorPosition: number
): SetCompletionSiteDeps => ({
  catalog,
  entriesById,
  containingScopeId,
  livePositionOf: (bindingId) => catalog.bindingsById.get(bindingId)?.statementIndex,
  cursorPosition
});

describe("setTargetCandidates", () => {
  it("includes a visible let with a known declared type", () => {
    const { catalog, entriesById } = catalogFor(["nui 3", "let a: number = 1"].join("\n"));
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 10);
    expect(setTargetCandidates(deps)).toEqual([{ name: "a", bindingId: bindingByName(catalog, "a").id, type: { kind: "number" } }]);
  });

  it("excludes const, and never consults BindingAnalysis status for a poisoned (self-initializing) let", () => {
    const source = ["nui 3", "const c: number = 1", "let poison: number = @poison"].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const poisonBinding = bindingByName(catalog, "poison");
    // Confirm the fixture really is invalid at the BindingAnalysis level -
    // this test must not silently pass because nothing was actually poisoned.
    expect(entriesById.get(poisonBinding.id)?.status).toEqual({ kind: "invalid", reason: "self-initialization" });

    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 10);
    const names = setTargetCandidates(deps).map((candidate) => candidate.name);
    expect(names).toEqual(["poison"]);
  });

  it("excludes legacy var, iteration, and elementLocal bindings", () => {
    const source = [
      "nui 3",
      "let a: number = 1",
      "var legacy = 2",
      "for Loop (i from: 0 count: 2) {",
      "}"
    ].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 100);
    expect(setTargetCandidates(deps).map((candidate) => candidate.name)).toEqual(["a"]);
  });

  it("excludes a forward-declared let (position after the cursor), even in the same scope", () => {
    const source = ["nui 3", "let a: number = 1", "let b: number = 2"].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const cursorPosition = bindingByName(catalog, "a").statementIndex;
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, cursorPosition);
    expect(setTargetCandidates(deps).map((candidate) => candidate.name)).toEqual(["a"]);
  });

  it("dedupes same-name shadowing to the innermost scope", () => {
    const source = [
      "nui 3",
      "let x: number = 1",
      "if C (true) {",
      "  let x: number = 2",
      "}"
    ].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const innerX = catalog.bindings.filter((b) => b.name === "x" && b.kind === "typed").find((b) => b.effectiveScopeId !== catalog.scopeIndex.rootScopeId)!;
    const deps = depsAt(catalog, entriesById, innerX.effectiveScopeId, innerX.statementIndex + 1);
    const candidates = setTargetCandidates(deps);
    expect(candidates.filter((c) => c.name === "x")).toEqual([{ name: "x", bindingId: innerX.id, type: { kind: "number" } }]);
  });

  it("outer scope stays visible before the inner shadow's own declaration", () => {
    const source = [
      "nui 3",
      "let x: number = 1",
      "if C (true) {",
      "  let x: number = 2",
      "}"
    ].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const outerX = bindingByName(catalog, "x");
    const innerX = catalog.bindings.filter((b) => b.name === "x" && b.kind === "typed").find((b) => b.id !== outerX.id)!;
    // Cursor inside the `then` scope, but before the inner `x`'s own declaration.
    const deps = depsAt(catalog, entriesById, innerX.effectiveScopeId, innerX.statementIndex - 1);
    const candidates = setTargetCandidates(deps);
    expect(candidates.filter((c) => c.name === "x")).toEqual([{ name: "x", bindingId: outerX.id, type: { kind: "number" } }]);
  });

  it("makes an outer let visible inside a nested then/forGroup scope", () => {
    const source = [
      "nui 3",
      "let outer: number = 1",
      "if C (true) {",
      "  for Loop (i from: 0 count: 2) {",
      "  }",
      "}"
    ].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const forScope = [...catalog.scopeIndex.scopes.values()].find((s) => s.kind === "forGroup")!;
    const deps = depsAt(catalog, entriesById, forScope.id, 1000);
    expect(setTargetCandidates(deps).map((c) => c.name)).toEqual(["outer"]);
  });

  it("makes a then-branch let invisible from the sibling else branch", () => {
    const source = [
      "nui 3",
      "if C (true) {",
      "  let onlyThen: number = 1",
      "} else {",
      "  let onlyElse: number = 2",
      "}"
    ].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const elseScope = [...catalog.scopeIndex.scopes.values()].find((s) => s.kind === "else")!;
    const deps = depsAt(catalog, entriesById, elseScope.id, 1000);
    expect(setTargetCandidates(deps).map((c) => c.name)).toEqual(["onlyElse"]);
  });
});

describe("setRhsScalarCandidates", () => {
  it("offers boolean literal and unary ! candidates at a clean operand start", () => {
    const { catalog, entriesById } = catalogFor(["nui 3", "let flag: boolean = true"].join("\n"));
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 10);
    const line = "set flag = ";
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, { kind: "boolean" }, deps);
    expect(candidates).toEqual(expect.arrayContaining([{ kind: "literal", label: "true" }, { kind: "literal", label: "false" }, { kind: "operator", label: "!" }]));
  });

  it("offers @name reference candidates filtered to the expected type, excluding a non-matching type", () => {
    const source = ["nui 3", "let flagA: boolean = true", "let numA: number = 1", "let target: boolean = false"].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const cursorPosition = bindingByName(catalog, "target").statementIndex + 1;
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, cursorPosition);
    const line = "set target = @f";
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, { kind: "boolean" }, deps);
    expect(candidates.some((c) => c.kind === "reference" && c.name === "flagA")).toBe(true);
    expect(candidates.some((c) => c.kind === "reference" && c.name === "numA")).toBe(false);
  });

  it("excludes an invalid (self-initializing) reference from RHS candidates, unlike the set target", () => {
    const source = ["nui 3", "let poison: number = @poison", "let target: number = 0"].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const cursorPosition = bindingByName(catalog, "target").statementIndex + 1;
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, cursorPosition);
    const line = "set target = ";
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, { kind: "number" }, deps);
    expect(candidates.some((c) => c.kind === "reference" && c.name === "poison")).toBe(false);
  });

  it("preserves declared choice option order", () => {
    const { catalog, entriesById } = catalogFor(["nui 3", "let side: choice(right, left) = right"].join("\n"));
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 10);
    const line = "set side = ";
    const type = { kind: "choice" as const, options: ["right", "left"] };
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, type, deps);
    expect(candidates.filter((c) => c.kind === "literal")).toEqual([{ kind: "literal", label: "right" }, { kind: "literal", label: "left" }]);
  });

  it("offers number operators right after a completed literal operand", () => {
    const { catalog, entriesById } = catalogFor(["nui 3", "let n: number = 0"].join("\n"));
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, 10);
    const line = "set n = 5 ";
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, { kind: "number" }, deps);
    expect(candidates.map((c) => (c.kind === "reference" ? c.name : c.label))).toEqual(["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!="]);
  });

  it("offers boolean operators right after a completed reference operand", () => {
    const source = ["nui 3", "let flagA: boolean = true", "let target: boolean = true"].join("\n");
    const { catalog, entriesById } = catalogFor(source);
    const cursorPosition = bindingByName(catalog, "target").statementIndex + 1;
    const deps = depsAt(catalog, entriesById, catalog.scopeIndex.rootScopeId, cursorPosition);
    const line = "set target = @flagA ";
    const candidates = setRhsScalarCandidates(line, { start: line.indexOf("=") + 1, end: line.length }, line.length, { kind: "boolean" }, deps);
    expect(candidates.map((c) => (c.kind === "reference" ? c.name : c.label))).toEqual(["&&", "||", "==", "!="]);
  });
});
