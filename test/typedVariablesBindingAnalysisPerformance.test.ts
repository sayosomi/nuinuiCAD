import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../src/dsl/bindingCatalogAdapter";
import { parseDsl } from "../src/dsl/dslParser";
import { analyzeBindings, type InitializerReference } from "../src/scalars/bindingAnalysis";
import { buildBindingCatalog } from "../src/scalars/bindingCatalog";
import { resolveBindingReference } from "../src/scalars/bindingResolution";
import { buildLexicalScopeIndex } from "../src/scalars/lexicalScopeIndex";
import { BASELINE_SIZES, buildBindingAnalysisChainBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 13 performance sanity: reuses Task 00's worker-CPU scaling helper
// (100 warm-up runs, 21 trials per decisions.md D19) to record - not gate on
// an invented absolute threshold - the 250->1000 analyzeBindings cost.
//
// This measures ONLY analyzeBindings's own cost: parsing, catalog/scope-index
// construction, and per-reference resolveBindingReference calls all happen
// once in the prep phase, outside the measured closures. The fixture is a
// simple resolved-only linear chain (see typedVariablesBaselineFixtures.ts's
// comment) - cycle/duplicate/forward-suppression correctness is already
// covered by src/scalars/bindingAnalysis.test.ts's small, targeted fixtures;
// this file's job is only to record the O(bindings+references) scaling.
const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const prepare = (bindingCount: number) => {
  const { source, scale } = buildBindingAnalysisChainBaselineSource(bindingCount);
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("binding analysis baseline fixture must parse without diagnostics");
  }
  const statements = parsed.statements;
  const stableIds = new Map(statements.map((_, index) => [index, `stmt${index}`]));
  const scopeIndex = buildLexicalScopeIndex(statements, (index) => stableIds.get(index)!);
  const adapter = buildDslBindingAdapterSeeds({ statements, scopeIndex, stableStatementIdByIndex: stableIds });
  const catalog = buildBindingCatalog({
    scopeIndex,
    stableStatementIdByIndex: stableIds,
    legacyBindings: adapter.legacyBindings,
    iterationBindings: adapter.iterationBindings
  });

  const typedStatementIndices = statements
    .map((statement, index) => ({ statement, index }))
    .filter(({ statement }) => statement.kind === "typedDeclaration")
    .map(({ index }) => index);

  const initializerReferences: InitializerReference[] = [];
  for (let position = 1; position < typedStatementIndices.length; position += 1) {
    const statementIndex = typedStatementIndices[position];
    const referencedName = `V${position - 1}`;
    const resolution = resolveBindingReference(catalog, referencedName, { scopeId: scopeIndex.rootScopeId, statementIndex });
    initializerReferences.push({
      fromBindingId: `binding:stmt${statementIndex}`,
      occurrenceIndex: 0,
      name: referencedName,
      span: null,
      resolution
    });
  }
  if (initializerReferences.some((reference) => reference.resolution.kind !== "resolved")) {
    throw new Error("binding analysis baseline fixture must resolve every chained reference");
  }

  return { catalog, initializerReferences, scale, statementCount: statements.length };
};

const fixtureCounts = (statementCount: number, bindingCount: number): FixtureCounts => ({
  statementCount,
  bindingCount,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("binding analysis performance baseline", () => {
  it("records analyzeBindings worker CPU measurements for 250/1000 chained bindings", () => {
    const small = prepare(SMALL_SIZE);
    const large = prepare(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: {
        run: () => analyzeBindings({ catalog: small.catalog, initializerReferences: small.initializerReferences }).entries.length,
        counts: () => fixtureCounts(small.statementCount, small.scale.bindingCount)
      },
      large: {
        run: () => analyzeBindings({ catalog: large.catalog, initializerReferences: large.initializerReferences }).entries.length,
        counts: () => fixtureCounts(large.statementCount, large.scale.bindingCount)
      },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small.bindingCount).toBe(small.scale.bindingCount);
    expect(measurement.large.bindingCount).toBe(large.scale.bindingCount);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("bindingAnalysis", measurement);
  }, 150_000);
});
