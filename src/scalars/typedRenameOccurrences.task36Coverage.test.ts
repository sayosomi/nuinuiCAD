import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { collectInitializerOccurrences, collectSiteBatchOccurrences } from "./typedRenameOccurrences";

// Task 37's completion condition requires that every reference Task 36's
// typedDependencyGraph already knows about has a matching rename occurrence
// with an exact span - otherwise Task 38 could not build an atomic patch
// from this task's output alone. This test exercises all four
// TypedDependencyKind edge kinds in one document, plus `set` targets (which
// Task 36 does not model as an edge kind at all, so it is checked directly).
const source = [
  "nui 4",
  "const base: number = 1",
  "let derived: number = @base",
  "let counter: number = 0",
  "set counter = @derived + 1",
  "let flag: boolean = true",
  "group G (printEnabled: @flag) {",
  "}",
  'text T = label(text: "${@base}", anchor: none, size: 3)'
].join("\n");

const compile = () => {
  const parsed = parseDsl(source);
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const assignedStatementIds = new Map(parsed.statements.map((_, index) => [index, `statement:,test:${index}`]));
  const compiled = compileDslDocument(source, { assignedStatementIds, preparsed: parsed });
  expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return compiled;
};

describe("typed rename occurrence coverage against Task 36's dependency graph", () => {
  it("has a matching rename occurrence for every resolved typed dependency edge, across all four edge kinds", () => {
    const compiled = compile();
    const graph = compiled.typedDependencyGraph!;
    expect(graph.edges.length).toBeGreaterThan(0);

    const occurrences = [
      ...collectInitializerOccurrences(compiled.scalarProgram, compiled.bindingAnalysis!.catalog),
      ...collectSiteBatchOccurrences({
        scopeIndex: compiled.bindingAnalysis!.catalog.scopeIndex,
        statements: compiled.statements,
        setStatements: compiled.setStatements,
        propertyBindings: compiled.propertyBindings,
        textTemplates: compiled.textTemplates
      })
    ];

    const edgeKindsSeen = new Set<string>();
    for (const edge of graph.edges) {
      // A clean, resolved dependency - the only kind of edge a rename
      // occurrence can meaningfully correspond to (missing/invalid/late/
      // disabled edges point at problems that predate any candidate rename).
      if (edge.reason !== undefined) continue;
      if (!edge.span) continue;
      edgeKindsSeen.add(edge.kind);
      // Task 36 edges carry the whole `@name` token span (including `@`),
      // while a rename occurrence's span is deliberately the bare identifier
      // only (Task 38 must splice just the name, keeping `@` intact) - the
      // two always share the same END offset regardless of kind, so that is
      // the correct coverage check here, not exact span equality.
      const matching = occurrences.find(
        (occurrence) => occurrence.kind === edge.kind && occurrence.span.end === edge.span!.end
      );
      expect(matching, `no rename occurrence covers ${edge.kind} edge at span ${JSON.stringify(edge.span)}`).toBeDefined();
    }
    expect(edgeKindsSeen).toEqual(new Set(["initializer", "set-rhs", "property-binding", "template-hole"]));
  });

  it("covers every `set` statement's own target name, which Task 36 does not model as an edge kind at all", () => {
    const compiled = compile();
    const occurrences = collectSiteBatchOccurrences({
      scopeIndex: compiled.bindingAnalysis!.catalog.scopeIndex,
      statements: compiled.statements,
      setStatements: compiled.setStatements,
      propertyBindings: compiled.propertyBindings,
      textTemplates: compiled.textTemplates
    });
    const setStatement = compiled.statements.find((statement) => statement.kind === "set")!;
    const targetOccurrence = occurrences.find(
      (occurrence) => occurrence.kind === "set-target" && occurrence.currentName === setStatement.name
    );
    expect(targetOccurrence).toBeDefined();
    expect(targetOccurrence!.span).toEqual(setStatement.nameSpan);
  });

  it("uses BindingCatalog statement identity for Module-aware initializer sites", () => {
    const moduleSource = [
      "nui 4",
      "const width: number = 10",
      "const result: number = @width + 5",
      "module Measure(input: number) {",
      "  const local: number = @input + 1",
      "}",
      "instance Call = Measure(input: @width)"
    ].join("\n");
    const parsed = parseDsl(moduleSource);
    const compiled = compileDslDocument(moduleSource, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `statement:module:${index}`]))
    });
    const catalog = compiled.bindingAnalysis!.catalog;
    const result = catalog.bindings.find((binding) => binding.name === "result")!;
    const scalarStatement = compiled.scalarProgram!.statements.find((statement) => statement.bindingId === result.id)!;
    const occurrence = collectInitializerOccurrences(compiled.scalarProgram, catalog)
      .find((candidate) => candidate.initializerOwner?.fromBindingId === result.id && candidate.currentName === "width");

    expect(occurrence).toBeDefined();
    expect(occurrence!.site.statementIndex).toBe(result.statementIndex);
    expect(occurrence!.site.statementIndex).not.toBe(scalarStatement.sourceOrder);
  });
});
