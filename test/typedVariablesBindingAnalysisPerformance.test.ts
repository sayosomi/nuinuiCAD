import { describe, expect, it } from "vitest";
import { buildDslBindingAdapterSeeds } from "../src/dsl/bindingCatalogAdapter";
import { parseDsl } from "../src/dsl/dslParser";
import { analyzeBindings, type InitializerReference } from "../src/scalars/bindingAnalysis";
import { buildBindingCatalog } from "../src/scalars/bindingCatalog";
import { resolveInitializerReferences } from "../src/scalars/bindingResolution";
import { buildLexicalScopeIndex } from "../src/scalars/lexicalScopeIndex";
import { BASELINE_SIZES, buildMixedBindingAnalysisBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 13R-5 performance sanity: reuses Task 00's worker-CPU scaling helper
// (100 warm-up runs, 21 trials per decisions.md D19) to record - not gate on
// an invented absolute threshold - the 250->1000 analyzeBindings cost.
//
// This is the production-equivalent binding pipeline: scope preparation,
// adapter, catalog, canonical batch resolution, analysis, and eligibility are
// all inside the measured closure. It deliberately has no absolute time gate.
const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const prepare = (bindingBudget: number) => {
  const { source, scale, references } = buildMixedBindingAnalysisBaselineSource(bindingBudget);
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("binding analysis baseline fixture must parse without diagnostics");
  }
  const statements = parsed.statements;
  const stableIds = new Map(statements.map((_, index) => [index, `stmt${index}`]));
  return { statements, stableIds, scale, references, statementCount: statements.length };
};

const runPipeline = (prepared: ReturnType<typeof prepare>) => {
  const scopeIndex = buildLexicalScopeIndex(prepared.statements, (index) => prepared.stableIds.get(index)!);
  const adapter = buildDslBindingAdapterSeeds({ statements: prepared.statements, scopeIndex, stableStatementIdByIndex: prepared.stableIds });
  const catalog = buildBindingCatalog({ scopeIndex, stableStatementIdByIndex: prepared.stableIds, legacyBindings: adapter.legacyBindings, iterationBindings: adapter.iterationBindings });
  const typedBindingsByName = new Map(catalog.bindings.filter((binding) => binding.kind === "typed").map((binding) => [binding.name, binding]));
  const requests = prepared.references.map(({ ownerName, name }) => {
    const owner = typedBindingsByName.get(ownerName);
    if (!owner) throw new Error(`mixed binding analysis fixture is missing typed owner ${ownerName}`);
    return {
      fromBindingId: owner.id,
      occurrenceIndex: 0,
      name,
      site: { scopeId: scopeIndex.scopeOfStatement.get(owner.statementIndex) ?? scopeIndex.rootScopeId, statementIndex: owner.statementIndex }
    };
  });
  const initializerReferences: InitializerReference[] = resolveInitializerReferences(catalog, requests).map(({ fromBindingId, occurrenceIndex, name, resolution }) => ({ fromBindingId, occurrenceIndex, name, span: null, resolution }));
  const analysis = analyzeBindings({ catalog, initializerReferences });
  return {
    catalogBindingCount: catalog.bindings.length,
    referenceCount: initializerReferences.length,
    duplicateReferenceCount: initializerReferences.filter((reference) => reference.resolution.kind === "duplicate").length,
    eligibleBindingCount: analysis.compiledProgram.bindingIds.length
  };
};

const fixtureCounts = (statementCount: number, bindingCount: number): FixtureCounts => ({
  statementCount,
  bindingCount,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("binding analysis performance baseline", () => {
  it("records the mixed full binding pipeline worker CPU measurements for 250/1000 bindings", () => {
    const small = prepare(SMALL_SIZE);
    const large = prepare(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: {
        run: () => runPipeline(small),
        counts: (result) => fixtureCounts(small.statementCount, result.catalogBindingCount)
      },
      large: {
        run: () => runPipeline(large),
        counts: (result) => fixtureCounts(large.statementCount, result.catalogBindingCount)
      },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small.bindingCount).toBe(small.scale.bindingCount);
    expect(measurement.large.bindingCount).toBe(large.scale.bindingCount);
    expect(runPipeline(small).referenceCount).toBe(small.scale.referenceCount);
    expect(runPipeline(large).duplicateReferenceCount).toBe(large.scale.duplicateReferenceCount);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("bindingPipeline", measurement);
  }, 150_000);
});
