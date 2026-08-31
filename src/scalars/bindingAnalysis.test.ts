import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../dsl/bindingCatalogAdapter";
import { compileDslToElements } from "../dsl/dslCompiler";
import { parseDsl } from "../dsl/dslParser";
import type { DslStatement } from "../dsl/dslTypes";
import { analyzeBindings, buildInitializerGraph, type InitializerReference } from "./bindingAnalysis";
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

describe("analyzeBindings", () => {
  it("reports self-initialization for a direct self reference with no visible outer, and creates no edge", () => {
    const catalog = catalogFor("const x: number = @x");
    const resolution = resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 0 }, bindingId(0));
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "x", span: null, resolution };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    expect(analysis.graph.edgesByFromBindingId.has(bindingId(0))).toBe(false);
    expect(analysis.issues).toEqual([
      expect.objectContaining({ code: "self-initialization", bindingId: bindingId(0) })
    ]);
    expect(analysis.entriesById.get(bindingId(0))).toEqual({
      bindingId: bindingId(0),
      status: { kind: "invalid", reason: "self-initialization" },
      programEligibility: { kind: "ineligible", reason: "direct-invalid" }
    });
  });

  it("classifies a 2-node forward/resolved cycle as binding-cycle and suppresses the forward issue", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = @a"].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const bToA = resolveBindingReferenceForTests(catalog, "a", { scopeId: "root", statementIndex: 1 });
    expect(aToB.kind).toBe("forward");
    expect(bToA.kind).toBe("resolved");

    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB },
      { fromBindingId: bindingId(1), occurrenceIndex: 0, name: "a", span: null, resolution: bToA }
    ];
    const analysis = analyzeBindings({ catalog, initializerReferences: references });

    const cycleComponent = analysis.components.find((component) => component.isCycle);
    expect(cycleComponent?.bindingIds).toEqual([bindingId(0), bindingId(1)]);
    expect(analysis.issues).toEqual([
      expect.objectContaining({ code: "binding-cycle", bindingId: bindingId(0) }),
      expect.objectContaining({ code: "binding-cycle", bindingId: bindingId(1) })
    ]);
    expect(analysis.issues.some((issue) => issue.code === "forward-binding-reference")).toBe(false);
  });

  it("classifies a 3-node forward/forward/resolved cycle and suppresses every internal forward issue", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = @c", "const c: number = @a"].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const bToC = resolveBindingReferenceForTests(catalog, "c", { scopeId: "root", statementIndex: 1 });
    const cToA = resolveBindingReferenceForTests(catalog, "a", { scopeId: "root", statementIndex: 2 });
    expect(aToB.kind).toBe("forward");
    expect(bToC.kind).toBe("forward");
    expect(cToA.kind).toBe("resolved");

    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB },
      { fromBindingId: bindingId(1), occurrenceIndex: 0, name: "c", span: null, resolution: bToC },
      { fromBindingId: bindingId(2), occurrenceIndex: 0, name: "a", span: null, resolution: cToA }
    ];
    const analysis = analyzeBindings({ catalog, initializerReferences: references });

    const cycleComponent = analysis.components.find((component) => component.isCycle);
    expect(cycleComponent?.bindingIds).toEqual([bindingId(0), bindingId(1), bindingId(2)]);
    expect(analysis.issues.filter((issue) => issue.code === "binding-cycle")).toHaveLength(3);
    expect(analysis.issues.some((issue) => issue.code === "forward-binding-reference")).toBe(false);
  });

  it("keeps a non-cycle forward chain classified as forward-binding-reference, not binding-cycle", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = @c", "const c: number = 0"].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const bToC = resolveBindingReferenceForTests(catalog, "c", { scopeId: "root", statementIndex: 1 });
    expect(aToB.kind).toBe("forward");
    expect(bToC.kind).toBe("forward");

    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB },
      { fromBindingId: bindingId(1), occurrenceIndex: 0, name: "c", span: null, resolution: bToC }
    ];
    const analysis = analyzeBindings({ catalog, initializerReferences: references });

    expect(analysis.components.every((component) => !component.isCycle)).toBe(true);
    expect(analysis.issues).toEqual([
      expect.objectContaining({ code: "forward-binding-reference", bindingId: bindingId(0) }),
      expect.objectContaining({ code: "forward-binding-reference", bindingId: bindingId(1) })
    ]);
  });

  it("reports undefined-binding for a reference with no matching declaration and creates no edge", () => {
    const catalog = catalogFor("const a: number = @nope");
    const resolution = resolveBindingReferenceForTests(catalog, "nope", { scopeId: "root", statementIndex: 0 });
    expect(resolution.kind).toBe("undefined");
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "nope", span: null, resolution };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    expect(analysis.graph.edgesByFromBindingId.has(bindingId(0))).toBe(false);
    expect(analysis.issues).toEqual([expect.objectContaining({ code: "undefined-binding", bindingId: bindingId(0) })]);
  });

  it("reports one declaration-origin duplicate-binding issue per same-scope same-name declaration, sharing relatedBindingIds", () => {
    const catalog = catalogFor(["const x: number = 1", "const x: number = 2", "const x: number = 3"].join("\n"));

    const analysis = analyzeBindings({ catalog, initializerReferences: [] });

    const duplicateIssues = analysis.issues.filter((issue) => issue.code === "duplicate-binding");
    expect(duplicateIssues).toHaveLength(3);
    expect(duplicateIssues.map((issue) => issue.bindingId)).toEqual([bindingId(0), bindingId(1), bindingId(2)]);
    expect(duplicateIssues[0].relatedBindingIds).toBe(duplicateIssues[1].relatedBindingIds);
    expect(duplicateIssues[1].relatedBindingIds).toBe(duplicateIssues[2].relatedBindingIds);
    for (const issue of duplicateIssues) expect(issue.origin).toEqual({ kind: "declaration" });
  });

  it("emits declaration duplicate issues only for catalog namespace buckets", () => {
    // Two separate forGroup loops each declare an iteration binding named
    // "i" - different effectiveScopeId, so they must not be flagged as
    // duplicates of each other even though only "x" (same root scope) is a
    // genuine same-scope collision.
    const catalog = catalogFor([
      "const x: number = 1",
      "const x: number = 2",
      "for i in range(from: 0, count: 2) {",
      "  const bodyA: number = 0",
      "}",
      "for i in range(from: 0, count: 2) {",
      "  const bodyB: number = 0",
      "}"
    ].join("\n"));

    const analysis = analyzeBindings({ catalog, initializerReferences: [] });
    const duplicateIssues = analysis.issues.filter((issue) => issue.code === "duplicate-binding");

    expect(duplicateIssues).toHaveLength(2);
    expect(duplicateIssues.map((issue) => issue.bindingId)).toEqual([bindingId(0), bindingId(1)]);
    expect(duplicateIssues[0].relatedBindingIds).toEqual([bindingId(0), bindingId(1)]);
    expect(duplicateIssues[0].relatedBindingIds).toBe(duplicateIssues[1].relatedBindingIds);
    expect(catalog.declarationDuplicateBuckets.map((bucket) => bucket.map((binding) => binding.id)))
      .toEqual([[bindingId(0), bindingId(1)]]);
  });

  it("reports a reference-origin duplicate-binding issue for a binding that references an ambiguous name, without duplicating the declaration-origin issues", () => {
    const catalog = catalogFor([
      "const x: number = 1",
      "const x: number = 2",
      "const x: number = 3",
      "const d: number = @x"
    ].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "x", { scopeId: "root", statementIndex: 3 });
    expect(resolution.kind).toBe("duplicate");
    const reference: InitializerReference = { fromBindingId: bindingId(3), occurrenceIndex: 0, name: "x", span: null, resolution };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    const duplicateIssues = analysis.issues.filter((issue) => issue.code === "duplicate-binding");
    expect(duplicateIssues).toHaveLength(4);
    const referenceIssue = duplicateIssues.find((issue) => issue.bindingId === bindingId(3));
    expect(referenceIssue?.origin.kind).toBe("reference");
    expect(analysis.entriesById.get(bindingId(3))).toMatchObject({ status: { kind: "invalid", reason: "duplicate-binding" } });
  });

  it("does not classify an inner initializer resolving to a visible outer binding as a cycle", () => {
    const catalog = catalogFor(["const x: number = 1", "group G {", "  const x: number = @x", "}"].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "x", { scopeId: "group:stable-1", statementIndex: 2 }, bindingId(2));
    expect(resolution.kind).toBe("resolved");
    const reference: InitializerReference = { fromBindingId: bindingId(2), occurrenceIndex: 0, name: "x", span: null, resolution };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    expect(analysis.components.every((component) => !component.isCycle)).toBe(true);
    expect(analysis.issues).toEqual([]);
    expect(analysis.entries.every((entry) => entry.status.kind === "valid")).toBe(true);
  });

  it("picks the highest-priority reason when a binding has both a duplicate declaration and a forward reference", () => {
    const catalog = catalogFor(["const a: number = @b", "const a: number = 1", "const b: number = 2"].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    expect(aToB.kind).toBe("forward");
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    const issuesForA = analysis.issues.filter((issue) => issue.bindingId === bindingId(0));
    expect(issuesForA.map((issue) => issue.code)).toEqual(["duplicate-binding", "forward-binding-reference"]);
    expect(analysis.entriesById.get(bindingId(0))).toMatchObject({ status: { kind: "invalid", reason: "duplicate-binding" } });
  });

  it("classifies a synthetic resolved self-edge as a 1-node cycle, distinct from self-initialization", () => {
    const catalog = catalogFor("const x: number = 1");
    const selfBinding = catalog.bindingsById.get(bindingId(0))!;
    // This resolution could never come from resolveInitializerReferences
    // itself (direct self-name references always resolve to "self" || an
    // outer binding - see bindingResolution.ts's runSweep). It is
    // constructed directly here to defend the general SCC algorithm against
    // the classic "singleton SCC without a self-loop is not a cycle" pitfall.
    const resolution = { kind: "resolved" as const, binding: selfBinding };
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "x", span: null, resolution };

    const analysis = analyzeBindings({ catalog, initializerReferences: [reference] });

    const component = analysis.components.find((item) => item.bindingIds.includes(bindingId(0)));
    expect(component).toEqual({ bindingIds: [bindingId(0)], isCycle: true });
    expect(analysis.issues).toEqual([expect.objectContaining({ code: "binding-cycle", bindingId: bindingId(0) })]);
    expect(analysis.issues.some((issue) => issue.code === "self-initialization")).toBe(false);
  });

  it("produces identical output when the initializerReferences array order is shuffled", () => {
    const catalog = catalogFor([
      "const a: number = @b",
      "const b: number = @a",
      "const c: number = @missing",
      "const d: number = @e",
      "const e: number = 0"
    ].join("\n"));
    const aToB = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const bToA = resolveBindingReferenceForTests(catalog, "a", { scopeId: "root", statementIndex: 1 });
    const cToMissing = resolveBindingReferenceForTests(catalog, "missing", { scopeId: "root", statementIndex: 2 });
    const dToE = resolveBindingReferenceForTests(catalog, "e", { scopeId: "root", statementIndex: 3 });

    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution: aToB },
      { fromBindingId: bindingId(1), occurrenceIndex: 0, name: "a", span: null, resolution: bToA },
      { fromBindingId: bindingId(2), occurrenceIndex: 0, name: "missing", span: null, resolution: cToMissing },
      { fromBindingId: bindingId(3), occurrenceIndex: 0, name: "e", span: null, resolution: dToE }
    ];
    const shuffled = [references[3], references[1], references[2], references[0]];

    const first = analyzeBindings({ catalog, initializerReferences: references });
    const second = analyzeBindings({ catalog, initializerReferences: shuffled });

    expect(second.issues).toEqual(first.issues);
    expect(second.components).toEqual(first.components);
    expect(second.entries).toEqual(first.entries);
    for (const binding of catalog.bindings) {
      expect(second.graph.edgesByFromBindingId.get(binding.id)).toEqual(first.graph.edgesByFromBindingId.get(binding.id));
    }
  });

  it("shares a single relatedBindingIds array across every issue in a large duplicate bucket", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `const dup: number = ${index}`);
    const catalog = catalogFor(lines.join("\n"));

    const analysis = analyzeBindings({ catalog, initializerReferences: [] });

    const duplicateIssues = analysis.issues.filter((issue) => issue.code === "duplicate-binding");
    expect(duplicateIssues).toHaveLength(50);
    const [first, ...rest] = duplicateIssues;
    for (const issue of rest) expect(issue.relatedBindingIds).toBe(first.relatedBindingIds);
  });

  it("throws on a duplicate occurrenceIndex within the same binding", () => {
    const catalog = catalogFor("const a: number = @b + @c");
    const resolution = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution },
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "c", span: null, resolution }
    ];
    expect(() => analyzeBindings({ catalog, initializerReferences: references })).toThrow(/occurrenceIndex/);
    expect(() => buildInitializerGraph(catalog, references)).toThrow(/occurrenceIndex/);
  });

  it("throws on a non-contiguous occurrenceIndex within the same binding", () => {
    const catalog = catalogFor("const a: number = @b + @c");
    const resolution = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    const references: InitializerReference[] = [
      { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution },
      { fromBindingId: bindingId(0), occurrenceIndex: 2, name: "c", span: null, resolution }
    ];
    expect(() => analyzeBindings({ catalog, initializerReferences: references })).toThrow(/occurrenceIndex/);
  });

  it("keeps a forward reference's multiple graph edges in catalog rank order", () => {
    const catalog = catalogFor(["const a: number = @b", "const b: number = 1", "const b: number = 2"].join("\n"));
    const resolution = resolveBindingReferenceForTests(catalog, "b", { scopeId: "root", statementIndex: 0 });
    expect(resolution).toMatchObject({ kind: "forward", bindingIds: [bindingId(1), bindingId(2)] });
    const reference: InitializerReference = { fromBindingId: bindingId(0), occurrenceIndex: 0, name: "b", span: null, resolution };

    const graph = buildInitializerGraph(catalog, [reference]);

    expect(graph.edgesByFromBindingId.get(bindingId(0))?.map((edge) => edge.toBindingId)).toEqual([bindingId(1), bindingId(2)]);
  });
});
