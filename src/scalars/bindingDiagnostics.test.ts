import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { analyzeBindings, type InitializerReference } from "./bindingAnalysis";
import { buildBindingCatalog } from "./bindingCatalog";
import { buildBindingDiagnosticMessages, formatBindingIssue } from "./bindingDiagnostics";
import { buildLexicalScopeIndex } from "./lexicalScopeIndex";
import { resolveBindingReferenceForTests } from "./bindingResolution";

const parsedStatements = (source: string): readonly DslStatement[] => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  return parsed.statements;
};

const catalogFor = (source: string) => {
  const statements = parsedStatements(source);
  const stableIds = new Map(statements.map((_, index) => [index, `stable-${index}`]));
  const scopeIndex = buildLexicalScopeIndex(statements, (index) => stableIds.get(index)!);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds });
  return buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex: stableIds,
    legacyBindings: adapter.legacyBindings,
    iterationBindings: adapter.iterationBindings
  });
};

const bindingId = (statementIndex: number) => `binding:stable-${statementIndex}`;

describe("bindingDiagnostics", () => {
  it("formats duplicate-binding (declaration origin)", () => {
    const catalog = catalogFor(["const x: number = 1", "const x: number = 2"].join("\n"));
    const analysis = analyzeBindings({ catalog, initializerReferences: [] });
    const issue = analysis.issues[0];
    const formatted = formatBindingIssue(analysis, issue);
    expect(formatted.code).toBe("duplicate-binding");
    expect(formatted.message).toContain("x");
    expect(formatted.message).toContain("複数回宣言");
  });

  it("formats duplicate-binding (reference origin) using the referenced name", () => {
    const catalog = catalogFor([
      "const x: number = 1",
      "const x: number = 2",
      "const d: number = @x"
    ].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 2 });
    const reference: InitializerReference = { fromBindingId: bindingId(2), occurrenceIndex: 0, name: "x", span: null, resolution };
    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });
    const issue = analysis.issues.find((item) => item.bindingId === bindingId(2))!;
    const formatted = formatBindingIssue(analysis, issue);
    expect(formatted.message).toContain("x");
    expect(formatted.message).toContain("一意に解決");
  });

  it("formats binding-cycle with all cycle member names in bindingRank order", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = @a"].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const bToA = resolveBindingReferenceForTests(catalog, "a", { scopeId: "root", statementIndex: 1 });
    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB },
      { fromBindingId: bindingId(1), occurrenceIndex: 0, name: "a", span: null, resolution: bToA }
    ];
    const analysis = analyzeBindings({ catalog, initializerReferences: references });
    const issue = analysis.issues.find((item) => item.bindingId === bindingId(0))!;
    const formatted = formatBindingIssue(analysis, issue);
    expect(formatted.code).toBe("binding-cycle");
    expect(formatted.message).toContain("a");
    expect(formatted.message).toContain("b");
    expect(formatted.message.indexOf("a")).toBeLessThan(formatted.message.indexOf("b"));
    expect(formatted.relatedBindingNames).toEqual(["b"]);
  });

  it("formats self-initialization", () => {
    const catalog = catalogFor("const x: number = @x");
    const resolution = resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 0 }, bindingId(0));
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "x", span: null, resolution };
    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });
    const formatted = formatBindingIssue(analysis, analysis.issues[0]);
    expect(formatted.code).toBe("self-initialization");
    expect(formatted.message).toContain("x");
  });

  it("formats undefined-binding using the referenced name", () => {
    const catalog = catalogFor("const a: number = @nope");
    const resolution = resolveBindingReferenceForTests(catalog, "nope", { scopeId: "root", statementIndex: 0 });
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "nope", span: null, resolution };
    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });
    const formatted = formatBindingIssue(analysis, analysis.issues[0]);
    expect(formatted.code).toBe("undefined-binding");
    expect(formatted.message).toContain("nope");
  });

  it("formats forward-binding-reference using the referenced name", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = 0"].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution };
    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });
    const formatted = formatBindingIssue(analysis, analysis.issues[0]);
    expect(formatted.code).toBe("forward-binding-reference");
    expect(formatted.message).toContain("b");
  });

  it("buildBindingDiagnosticMessages preserves analysis.issues order 1:1", () => {
    const catalog = catalogFor([
      "const x: number = 1",
      "const x: number = 2",
      "const a: number = @nope"
    ].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "nope", { scopeId: "root", statementIndex: 2 });
    const reference: InitializerReference = { fromBindingId: bindingId(2), occurrenceIndex: 0, name: "nope", span: null, resolution };
    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    const messages = buildBindingDiagnosticMessages(analysis);
    expect(messages.map((message) => message.code)).toEqual(analysis.issues.map((issue) => issue.code));
    expect(messages.map((message) => message.bindingId)).toEqual(analysis.issues.map((issue) => issue.bindingId));
  });
});
