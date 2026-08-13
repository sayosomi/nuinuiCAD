import { describe, expect, it } from "vitest";
import type { BindingAnalysis } from "./bindingAnalysis";
import type { BindingCatalog } from "./bindingCatalog";
import { isScalarTypeAssignable } from "./scalarAssignability";
import { typedDeclarationAnalysisFor } from "./testSupport/typedDeclarationAnalysisFixture";
import {
  resolvePrecedingOperandType,
  scalarExpressionCandidates,
  scalarLiteralCandidates,
  scalarOperatorCandidates,
  scalarPrefixOperatorCandidates,
  templateHoleScalarCandidates,
  typedBindingReferenceCandidates
} from "./typedValueCandidates";
import { tokenizeScalarExpression } from "./expressionTokenizer";
import { scalarExpressionCompletionContextAt } from "./scalarExpressionPositionClassifier";

const compileFor = (source: string): { catalog: BindingCatalog; entriesById: BindingAnalysis["entriesById"] } => {
  const { bindingAnalysis } = typedDeclarationAnalysisFor(source);
  return { catalog: bindingAnalysis.catalog, entriesById: bindingAnalysis.entriesById };
};

const bindingIdByName = (catalog: BindingCatalog, name: string) => {
  const binding = catalog.bindings.find((candidate) => candidate.name === name && candidate.kind === "typed");
  if (!binding) throw new Error(`no typed binding named ${name}`);
  return binding;
};

describe("scalarLiteralCandidates", () => {
  it("boolean: true then false", () => {
    expect(scalarLiteralCandidates({ kind: "boolean" })).toEqual([{ label: "true" }, { label: "false" }]);
  });
  it("choice: declared option order", () => {
    expect(scalarLiteralCandidates({ kind: "choice", options: ["right", "left"] })).toEqual([{ label: "right" }, { label: "left" }]);
  });
  it("number/string: no literal candidates", () => {
    expect(scalarLiteralCandidates({ kind: "number" })).toEqual([]);
    expect(scalarLiteralCandidates({ kind: "string" })).toEqual([]);
  });
});

describe("scalarOperatorCandidates", () => {
  it("number: arithmetic + comparison + equality", () => {
    expect(scalarOperatorCandidates({ kind: "number" }).map((c) => c.label)).toEqual(["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!="]);
  });
  it("boolean: logical + equality", () => {
    expect(scalarOperatorCandidates({ kind: "boolean" }).map((c) => c.label)).toEqual([" and ", " or ", "==", "!="]);
  });
  it("string/choice: equality only", () => {
    expect(scalarOperatorCandidates({ kind: "string" }).map((c) => c.label)).toEqual(["==", "!="]);
    expect(scalarOperatorCandidates({ kind: "choice", options: ["a"] }).map((c) => c.label)).toEqual(["==", "!="]);
  });
  it("unknown operand type: no operators", () => {
    expect(scalarOperatorCandidates(null)).toEqual([]);
  });
});

describe("scalarPrefixOperatorCandidates", () => {
  it("boolean or unknown expected type: unary !", () => {
    expect(scalarPrefixOperatorCandidates({ kind: "boolean" })).toEqual([{ label: "!" }]);
    expect(scalarPrefixOperatorCandidates(null)).toEqual([{ label: "!" }]);
  });
  it("number/string/choice: no prefix operator", () => {
    expect(scalarPrefixOperatorCandidates({ kind: "number" })).toEqual([]);
    expect(scalarPrefixOperatorCandidates({ kind: "string" })).toEqual([]);
    expect(scalarPrefixOperatorCandidates({ kind: "choice", options: [] })).toEqual([]);
  });
});

describe("resolvePrecedingOperandType", () => {
  const { catalog, entriesById } = compileFor(["nui 4", "const flag: boolean = true", "const n: number = 1"].join("\n"));
  const site = { scopeId: catalog.scopeIndex.rootScopeId, statementIndex: bindingIdByName(catalog, "n").statementIndex };

  it("null preceding token -> null", () => {
    expect(resolvePrecedingOperandType({ precedingToken: null, catalog, entriesById, site, rootType: { kind: "number" } })).toBeNull();
  });

  it("literal tokens resolve directly by kind", () => {
    const numberToken = tokenizeScalarExpression("5", { start: 0, end: 1 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: numberToken, catalog, entriesById, site, rootType: null })).toEqual({ kind: "number" });
    const stringToken = tokenizeScalarExpression('"a"', { start: 0, end: 3 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: stringToken, catalog, entriesById, site, rootType: null })).toEqual({ kind: "string" });
    const boolToken = tokenizeScalarExpression("true", { start: 0, end: 4 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: boolToken, catalog, entriesById, site, rootType: null })).toEqual({ kind: "boolean" });
  });

  it("reference token resolves the binding's declared type via the catalog", () => {
    const referenceToken = tokenizeScalarExpression("@flag", { start: 0, end: 5 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: referenceToken, catalog, entriesById, site, rootType: null })).toEqual({ kind: "boolean" });
  });

  it("reference to an undefined name resolves to null", () => {
    const referenceToken = tokenizeScalarExpression("@nope", { start: 0, end: 5 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: referenceToken, catalog, entriesById, site, rootType: null })).toBeNull();
  });

  it("rightParen falls back to the caller-supplied root type approximation", () => {
    const rightParen = tokenizeScalarExpression(")", { start: 0, end: 1 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: rightParen, catalog, entriesById, site, rootType: { kind: "boolean" } })).toEqual({ kind: "boolean" });
  });
});

describe("resolvePrecedingOperandType: implicit-number binding and invalid exclusion", () => {
  it("forGroup iteration binding reference resolves to implicit number", () => {
    const { catalog, entriesById } = compileFor(
      ["nui 4", "for i in range(from: 0, count: 2) {", "  const n: number = @i", "}"].join("\n")
    );
    const n = bindingIdByName(catalog, "n");
    const site = { scopeId: n.effectiveScopeId, statementIndex: n.statementIndex };
    const referenceToken = tokenizeScalarExpression("@i", { start: 0, end: 2 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: referenceToken, catalog, entriesById, site, rootType: null })).toEqual({ kind: "number" });
  });

  it("reference to a self-initializing (invalid) binding resolves to null", () => {
    const { catalog, entriesById } = compileFor(["nui 4", "const a: number = @a", "const b: number = @a"].join("\n"));
    const site = { scopeId: catalog.scopeIndex.rootScopeId, statementIndex: bindingIdByName(catalog, "b").statementIndex };
    const referenceToken = tokenizeScalarExpression("@a", { start: 0, end: 2 }).tokens[0];
    expect(resolvePrecedingOperandType({ precedingToken: referenceToken, catalog, entriesById, site, rootType: null })).toBeNull();
  });
});

describe("typedBindingReferenceCandidates: pre-declaration visibility", () => {
  const accepts = () => true;

  it("excludes the binding's own not-yet-declared self", () => {
    const { catalog, entriesById } = compileFor(["nui 4", "const a: number = 1"].join("\n"));
    const a = bindingIdByName(catalog, "a");
    const site = { scopeId: a.effectiveScopeId, statementIndex: a.statementIndex };
    const names = typedBindingReferenceCandidates({ catalog, entriesById, site, accepts }).map((c) => c.name);
    expect(names).not.toContain("a");
  });

  it("keeps an outer same-name binding visible even before its own inner declaration line", () => {
    const source = ["nui 4", "const outer: number = 1", "group G {", "const inner: number = @outer", "}"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const inner = bindingIdByName(catalog, "inner");
    const site = { scopeId: inner.effectiveScopeId, statementIndex: inner.statementIndex };
    const names = typedBindingReferenceCandidates({ catalog, entriesById, site, accepts }).map((c) => c.name);
    expect(names).toContain("outer");
  });

  it("excludes a same-scope forward declaration", () => {
    const source = ["nui 4", "group G {", "const b: number = 1", "const c: number = 1", "}"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const b = bindingIdByName(catalog, "b");
    const site = { scopeId: b.effectiveScopeId, statementIndex: b.statementIndex };
    const names = typedBindingReferenceCandidates({ catalog, entriesById, site, accepts }).map((c) => c.name);
    expect(names).not.toContain("c");
  });

  it("excludes an ambiguous same-scope duplicate name entirely", () => {
    const source = ["nui 4", "const x: number = 1", "const x: number = 2", "const y: number = 1"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const y = bindingIdByName(catalog, "y");
    const site = { scopeId: y.effectiveScopeId, statementIndex: y.statementIndex };
    const names = typedBindingReferenceCandidates({ catalog, entriesById, site, accepts }).map((c) => c.name);
    expect(names).not.toContain("x");
  });

  it("excludes an invalid (self-initializing) binding even though it is structurally visible", () => {
    const source = ["nui 4", "const a: number = @a", "const b: number = 1"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const b = bindingIdByName(catalog, "b");
    const site = { scopeId: b.effectiveScopeId, statementIndex: b.statementIndex };
    const names = typedBindingReferenceCandidates({ catalog, entriesById, site, accepts }).map((c) => c.name);
    expect(names).not.toContain("a");
  });
});

describe("typedBindingReferenceCandidates: type filtering", () => {
  it("exact-type accepts only same-kind bindings", () => {
    const source = ["nui 4", "const flag: boolean = true", "const label: string = \"x\"", "const n: number = 1"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const n = bindingIdByName(catalog, "n");
    const site = { scopeId: n.effectiveScopeId, statementIndex: n.statementIndex };
    const names = typedBindingReferenceCandidates({
      catalog,
      entriesById,
      site,
      accepts: (type) => type !== null && isScalarTypeAssignable(type, { kind: "boolean" })
    }).map((c) => c.name);
    expect(names).toEqual(["flag"]);
  });

  it("requires exact choice schema equality for a property binding", () => {
    const source = ["nui 4", "const side: choice(right) = right", "const n: number = 1"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const n = bindingIdByName(catalog, "n");
    const site = { scopeId: n.effectiveScopeId, statementIndex: n.statementIndex };
    const names = typedBindingReferenceCandidates({
      catalog,
      entriesById,
      site,
      accepts: (type) => type !== null && isScalarTypeAssignable(type, { kind: "choice", options: ["right", "left"] })
    }).map((c) => c.name);
    expect(names).toEqual([]);
  });

  it("exact-type equality rejects a choice binding whose options differ (even as a subset target)", () => {
    const source = ["nui 4", "const side: choice(right, left, center) = right", "const n: number = 1"].join("\n");
    const { catalog, entriesById } = compileFor(source);
    const n = bindingIdByName(catalog, "n");
    const site = { scopeId: n.effectiveScopeId, statementIndex: n.statementIndex };
    const names = typedBindingReferenceCandidates({
      catalog,
      entriesById,
      site,
      accepts: (type) => type !== null && isScalarTypeAssignable(type, { kind: "choice", options: ["right", "left"] })
    }).map((c) => c.name);
    expect(names).toEqual([]);
  });
});

describe("scalarExpressionCandidates: end-to-end operand/operator wiring", () => {
  // The compiled catalog reflects a last-good, valid document; the classifier
  // is then run against a separate, independently-constructed in-progress
  // text - exactly like the real dirty-buffer flow, where the precomputed
  // catalog (Tier B) can lag behind whatever the user is currently typing
  // (Tier A).
  const { catalog, entriesById } = compileFor(["nui 4", "const flagA: boolean = true", "const numA: number = 1", "const target: boolean = true"].join("\n"));
  const target = bindingIdByName(catalog, "target");
  const site = { scopeId: target.effectiveScopeId, statementIndex: target.statementIndex };

  const contextFor = (initializer: string) => {
    const prefix = "const target: boolean = ";
    const line = `${prefix}${initializer}`;
    const span = { start: prefix.length, end: line.length };
    const context = scalarExpressionCompletionContextAt(line, span.end, span, { kind: "boolean" });
    if (!context) throw new Error("expected a completion context");
    return context;
  };

  it("reference operand position offers boolean-typed bindings only", () => {
    const context = contextFor("");
    const candidates = scalarExpressionCandidates(context, { catalog, entriesById, site, includeOperators: true });
    const referenceNames = candidates.filter((c) => c.kind === "reference").map((c) => (c as { name: string }).name);
    expect(referenceNames).toContain("flagA");
    expect(referenceNames).not.toContain("numA");
  });

  it("boolean literal candidates and the unary ! prefix appear at a clean operand start", () => {
    const context = contextFor("");
    const candidates = scalarExpressionCandidates(context, { catalog, entriesById, site, includeOperators: true });
    const labels = candidates.filter((c) => c.kind !== "reference").map((c) => (c as { label: string }).label);
    expect(labels).toEqual(expect.arrayContaining(["true", "false", "!"]));
  });

  it("a completed boolean reference operand offers boolean operators next", () => {
    const context = contextFor("@flagA ");
    expect(context.kind).toBe("operator");
    const candidates = scalarExpressionCandidates(context, { catalog, entriesById, site, includeOperators: true });
    expect(candidates).toEqual([
      { kind: "operator", label: " and " },
      { kind: "operator", label: " or " },
      { kind: "operator", label: "==" },
      { kind: "operator", label: "!=" }
    ]);
  });

  it("a completed number reference operand offers number operators next", () => {
    const context = contextFor("@numA ");
    expect(context.kind).toBe("operator");
    const candidates = scalarExpressionCandidates(context, { catalog, entriesById, site, includeOperators: true });
    expect(candidates.map((c) => (c as { label: string }).label)).toEqual(["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!="]);
  });

  it("includeOperators: false suppresses operator candidates entirely (property scalar value contract)", () => {
    const context = contextFor("@flagA ");
    expect(scalarExpressionCandidates(context, { catalog, entriesById, site, includeOperators: false })).toEqual([]);
  });
});

describe("templateHoleScalarCandidates: string/number union, boolean/choice excluded", () => {
  const source = [
    "nui 4",
    "const label: string = \"x\"",
    "const count: number = 1",
    "const flag: boolean = true",
    "const side: choice(right, left) = right",
    "point A = coordinate(x: 0, y: 0)"
  ].join("\n");
  const { catalog, entriesById } = compileFor(source);
  // Site well after every declaration above (all are root-scope, so any later statementIndex sees them all).
  const statements = source.split("\n");
  const site = { scopeId: catalog.scopeIndex.rootScopeId, statementIndex: statements.length - 1 };

  it("offers both string- and number-typed bindings, excludes boolean/choice", () => {
    const text = "@l";
    const contentSpan = { start: 0, end: text.length };
    const candidates = templateHoleScalarCandidates(text, contentSpan, text.length, { catalog, entriesById, site, includeOperators: true });
    const names = candidates.filter((c) => c.kind === "reference").map((c) => (c as { name: string }).name);
    expect(names).toContain("label");
  });

  it("unions candidates across both root-type guesses without duplicates", () => {
    const text = "";
    const contentSpan = { start: 0, end: 0 };
    const candidates = templateHoleScalarCandidates(text, contentSpan, 0, { catalog, entriesById, site, includeOperators: true });
    const names = candidates.filter((c) => c.kind === "reference").map((c) => (c as { name: string }).name);
    expect(names).toContain("label");
    expect(names).toContain("count");
    expect(names).not.toContain("flag");
    expect(names).not.toContain("side");
    expect(new Set(names).size).toBe(names.length); // no duplicate entries from the two-root union
  });

  it("offers number operators after a completed number reference", () => {
    const text = "@count ";
    const contentSpan = { start: 0, end: text.length };
    const candidates = templateHoleScalarCandidates(text, contentSpan, text.length, { catalog, entriesById, site, includeOperators: true });
    expect(candidates.map((c) => (c as { label: string }).label)).toEqual(["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!="]);
  });
});
