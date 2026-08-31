import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import {
  analyzeBindings,
  selectCompiledProgramBindings,
  type BindingAnalysis,
  type InitializerReference
} from "./bindingAnalysis";
import { buildBindingCatalog } from "./bindingCatalog";
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
  const compiled = compileDslToElements(source, { elements: [], mode: "document", majorVersion: 1 });
  const reconciledContainers = { elements: compiled.elements, elementIdByStatementIndex: compiled.elementIdsByStatementIndex ?? new Map() };
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds, reconciledContainers });
  return buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex: stableIds,
    iterationBindings: adapter.iterationBindings,
    containerIndex: adapter.containerIndex
  });
};

const bindingId = (statementIndex: number) => `binding:stable-${statementIndex}`;

// Every reference here genuinely belongs to `fromStatementIndex`'s own
// initializer, so the owner is always passed - self only actually fires
// when the referenced name matches that binding's own name.
const referenceFor = (
  catalog: ReturnType<typeof catalogFor>,
  fromStatementIndex: number,
  occurrenceIndex: number,
  name: string
): InitializerReference => ({
  fromBindingId: bindingId(fromStatementIndex),
  occurrenceIndex,
  name,
  span: null,
  resolution: resolveBindingReferenceForTests(catalog, name, { scopeId: "root", statementIndex: fromStatementIndex }, bindingId(fromStatementIndex))
});

const programEligibilityById = (analysis: BindingAnalysis) =>
  analysis.entries.map((entry) => [entry.bindingId, entry.programEligibility] as const);

describe("binding compiled-program eligibility", () => {
  it("keeps the missing-name source issue direct and marks its dependent unavailable without a new issue", () => {
    const catalog = catalogFor(["const bad: number = @missing", "const dependent: number = @bad"].join("\n"));
    const analysis = analyzeBindings({
      catalog,
      initializerReferences: [referenceFor(catalog, 0, 0, "missing"), referenceFor(catalog, 1, 0, "bad")]
    });

    expect(analysis.entriesById.get(bindingId(0))).toMatchObject({
      status: { kind: "invalid", reason: "undefined-binding" },
      programEligibility: { kind: "ineligible", reason: "direct-invalid" }
    });
    expect(analysis.entriesById.get(bindingId(1))).toEqual({
      bindingId: bindingId(1),
      status: { kind: "valid" },
      programEligibility: {
        kind: "ineligible",
        reason: "invalid-dependency",
        invalidDependencyBindingIds: [bindingId(0)]
      }
    });
    expect(analysis.issues.filter((issue) => issue.bindingId === bindingId(1))).toEqual([]);
  });

  it("propagates invalidity through a chain while leaving an independent valid chain eligible", () => {
    const catalog = catalogFor([
      "const bad: number = @missing",
      "const first: number = @bad",
      "const last: number = @first",
      "const good: number = 1",
      "const goodDependent: number = @good"
    ].join("\n"));
    const analysis = analyzeBindings({
      catalog,
      initializerReferences: [
        referenceFor(catalog, 0, 0, "missing"),
        referenceFor(catalog, 1, 0, "bad"),
        referenceFor(catalog, 2, 0, "first"),
        referenceFor(catalog, 4, 0, "good")
      ]
    });

    expect(analysis.entriesById.get(bindingId(1))?.programEligibility).toEqual({
      kind: "ineligible",
      reason: "invalid-dependency",
      invalidDependencyBindingIds: [bindingId(0)]
    });
    expect(analysis.entriesById.get(bindingId(2))?.programEligibility).toEqual({
      kind: "ineligible",
      reason: "invalid-dependency",
      invalidDependencyBindingIds: [bindingId(1)]
    });
    expect(analysis.entriesById.get(bindingId(3))?.programEligibility).toEqual({ kind: "eligible" });
    expect(analysis.entriesById.get(bindingId(4))?.programEligibility).toEqual({ kind: "eligible" });
  });

  it("records every directly unavailable outgoing target in canonical edge order", () => {
    const catalog = catalogFor([
      "const badA: number = @missingA",
      "const badB: number = @missingB",
      "const good: number = 1",
      "const mixed: number = @badA + @good + @badB"
    ].join("\n"));
    const analysis = analyzeBindings({
      catalog,
      initializerReferences: [
        referenceFor(catalog, 0, 0, "missingA"),
        referenceFor(catalog, 1, 0, "missingB"),
        referenceFor(catalog, 3, 0, "badA"),
        referenceFor(catalog, 3, 1, "good"),
        referenceFor(catalog, 3, 2, "badB")
      ]
    });

    expect(analysis.entriesById.get(bindingId(3))?.programEligibility).toEqual({
      kind: "ineligible",
      reason: "invalid-dependency",
      invalidDependencyBindingIds: [bindingId(0), bindingId(1)]
    });
  });

  it.each([
    {
      label: "duplicate",
      source: ["const duplicate: number = 0", "const duplicate: number = 1", "const bad: number = @duplicate", "const dependent: number = @bad"].join("\n"),
      references: (catalog: ReturnType<typeof catalogFor>) => [referenceFor(catalog, 2, 0, "duplicate"), referenceFor(catalog, 3, 0, "bad")]
    },
    {
      label: "self",
      source: ["const bad: number = @bad", "const dependent: number = @bad"].join("\n"),
      references: (catalog: ReturnType<typeof catalogFor>) => [referenceFor(catalog, 0, 0, "bad"), referenceFor(catalog, 1, 0, "bad")]
    },
    {
      label: "undefined",
      source: ["const bad: number = @missing", "const dependent: number = @bad"].join("\n"),
      references: (catalog: ReturnType<typeof catalogFor>) => [referenceFor(catalog, 0, 0, "missing"), referenceFor(catalog, 1, 0, "bad")]
    },
    {
      label: "forward",
      source: ["const bad: number = @later", "const later: number = 0", "const dependent: number = @bad"].join("\n"),
      references: (catalog: ReturnType<typeof catalogFor>) => [referenceFor(catalog, 0, 0, "later"), referenceFor(catalog, 2, 0, "bad")]
    }
  ])("uses a direct $label invalid binding as an invalid-dependency propagation seed", ({ source, references }) => {
    const catalog = catalogFor(source);
    const dependentStatementIndex = source.includes("const duplicate") ? 3 : source.includes("const later") ? 2 : 1;
    const analysis = analyzeBindings({ catalog, initializerReferences: references(catalog) });

    expect(analysis.entriesById.get(bindingId(dependentStatementIndex))).toMatchObject({
      status: { kind: "valid" },
      programEligibility: { kind: "ineligible", reason: "invalid-dependency" }
    });
  });

  it("treats cycle members as direct-invalid while a cycle dependent remains issue-free and dependency-derived", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = @a", "const dependent: number = @a"].join("\n"));
    const analysis = analyzeBindings({
      catalog,
      initializerReferences: [referenceFor(catalog, 0, 0, "b"), referenceFor(catalog, 1, 0, "a"), referenceFor(catalog, 2, 0, "a")]
    });

    expect(analysis.entriesById.get(bindingId(0))?.programEligibility).toEqual({ kind: "ineligible", reason: "direct-invalid" });
    expect(analysis.entriesById.get(bindingId(1))?.programEligibility).toEqual({ kind: "ineligible", reason: "direct-invalid" });
    expect(analysis.entriesById.get(bindingId(2))).toMatchObject({
      status: { kind: "valid" },
      programEligibility: {
        kind: "ineligible",
        reason: "invalid-dependency",
        invalidDependencyBindingIds: [bindingId(0)]
      }
    });
    expect(analysis.issues.filter((issue) => issue.bindingId === bindingId(2))).toEqual([]);
  });

  it("keeps every original edge for eligible sources and proves none points to an ineligible target", () => {
    const catalog = catalogFor([
      "const bad: number = @missing",
      "const dependent: number = @bad",
      "const good: number = 1",
      "const goodDependent: number = @good"
    ].join("\n"));
    const analysis = analyzeBindings({
      catalog,
      initializerReferences: [
        referenceFor(catalog, 0, 0, "missing"),
        referenceFor(catalog, 1, 0, "bad"),
        referenceFor(catalog, 3, 0, "good")
      ]
    });
    const selection = selectCompiledProgramBindings(analysis);

    expect(selection.bindingIds).toEqual([bindingId(2), bindingId(3)]);
    expect(selection.graph.edgesByFromBindingId.get(bindingId(3))).toBe(analysis.graph.edgesByFromBindingId.get(bindingId(3)));
    for (const fromBindingId of selection.graph.nodeIds) {
      for (const edge of analysis.graph.edgesByFromBindingId.get(fromBindingId) ?? []) {
        expect(selection.graph.edgesByFromBindingId.get(fromBindingId)).toContain(edge);
        expect(analysis.entriesById.get(edge.toBindingId)?.programEligibility.kind).toBe("eligible");
      }
    }
  });

  it("produces the same eligibility and program selection when references arrive in a different order", () => {
    const catalog = catalogFor([
      "const bad: number = @missing",
      "const dependent: number = @bad",
      "const good: number = 1",
      "const goodDependent: number = @good"
    ].join("\n"));
    const references = [
      referenceFor(catalog, 0, 0, "missing"),
      referenceFor(catalog, 1, 0, "bad"),
      referenceFor(catalog, 3, 0, "good")
    ];
    const first = analyzeBindings({ catalog, initializerReferences: references });
    const second = analyzeBindings({ catalog, initializerReferences: [references[2], references[0], references[1]] });

    expect(programEligibilityById(second)).toEqual(programEligibilityById(first));
    expect(selectCompiledProgramBindings(second)).toEqual(selectCompiledProgramBindings(first));
  });
});
