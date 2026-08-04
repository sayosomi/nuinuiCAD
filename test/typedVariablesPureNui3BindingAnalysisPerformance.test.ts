import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../src/dsl/dslDocument";
import { PURE_NUI3_BINDING_SIZES, buildPureNui3BindingSource } from "./pureNui3BindingFixtures";
import {
  expectPerformanceRegressionGate,
  logPerformanceGateMeasurement,
  measureWorkerCpuScaling,
  type FixtureCounts
} from "./typedVariablesPerformanceMeasurement";

const [SMALL_SIZE, LARGE_SIZE] = PURE_NUI3_BINDING_SIZES;
const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const prepare = (bindingCount: number) => {
  const fixture = buildPureNui3BindingSource(bindingCount);
  return {
    ...fixture,
    assignedStatementIds: new Map(
      Array.from({ length: bindingCount }, (_, index) => [index + 1, `task50:pure:${index}`])
    )
  };
};

const runBindingAnalysis = (prepared: ReturnType<typeof prepare>) => {
  const compiled = compileDslDocument(prepared.source, {
    assignedStatementIds: prepared.assignedStatementIds
  });
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("pure nui 3 binding analysis fixture must compile without diagnostics");
  }
  if (!compiled.bindingAnalysis || !compiled.scalarProgram) {
    throw new Error("pure nui 3 binding analysis fixture must produce binding analysis and a scalar program");
  }
  return {
    catalogBindingCount: compiled.bindingAnalysis.catalog.bindings.length,
    referenceCount: [...compiled.bindingAnalysis.graph.edgesByFromBindingId.values()]
      .reduce((total, edges) => total + edges.length, 0),
    eligibleBindingCount: compiled.bindingAnalysis.compiledProgram.bindingIds.length,
    scalarProgramStatementCount: compiled.scalarProgram.statements.length
  };
};

const counts = (bindingCount: number): FixtureCounts => ({
  statementCount: bindingCount,
  bindingCount,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describePerformanceGates("pure nui 3 binding analysis performance", () => {
  it("gates 250/1000 typed const/let binding analysis without runtime evaluation", () => {
    const small = prepare(SMALL_SIZE);
    const large = prepare(LARGE_SIZE);
    const measurement = measureWorkerCpuScaling({
      small: { run: () => runBindingAnalysis(small), counts: () => counts(SMALL_SIZE) },
      large: { run: () => runBindingAnalysis(large), counts: () => counts(LARGE_SIZE) },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    const smallResult = runBindingAnalysis(small);
    const largeResult = runBindingAnalysis(large);
    expect(smallResult).toMatchObject({
      catalogBindingCount: SMALL_SIZE,
      referenceCount: small.scale.referenceCount,
      eligibleBindingCount: SMALL_SIZE,
      scalarProgramStatementCount: SMALL_SIZE
    });
    expect(largeResult).toMatchObject({
      catalogBindingCount: LARGE_SIZE,
      referenceCount: large.scale.referenceCount,
      eligibleBindingCount: LARGE_SIZE,
      scalarProgramStatementCount: LARGE_SIZE
    });
    logPerformanceGateMeasurement("pureNui3BindingAnalysis", measurement);
    expectPerformanceRegressionGate(measurement);
  }, 150_000);
});
