import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument } from "../src/dsl/dslDocument";
import { evaluateElements } from "../src/geometry/evaluate";
import type { EvaluationResult } from "../src/types/geometry";
import {
  BASELINE_SIZES,
  buildForGroupBaselineSource,
  buildStandardBaselineSource,
  type ForGroupFixtureScale,
  type StandardFixtureScale
} from "./typedVariablesBaselineFixtures";
import {
  expectFiniteMeasurement,
  logBaselineMeasurement,
  measureWorkerCpuScaling,
  type FixtureCounts
} from "./typedVariablesPerformanceMeasurement";

const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const compileDocument = (source: string) => {
  const compiled = compileDslDocument(source);
  if (!compiled.document || compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("baseline fixture must compile without diagnostics");
  }
  return compiled;
};

const compiledCounts = (compiled: CompiledDslDocument): FixtureCounts => ({
  statementCount: compiled.statements.filter((statement) => statement.kind !== "version").length,
  bindingCount: compiled.document?.elements.filter((element) => element.type === "variable").length ?? 0,
  geometryStatementCount: compiled.document?.elements.filter((element) => element.type === "freePoint").length ?? 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

const evaluationCounts = (
  result: EvaluationResult,
  scale: StandardFixtureScale | ForGroupFixtureScale
): FixtureCounts => ({
  statementCount: scale.statementCount,
  bindingCount: scale.bindingCount,
  geometryStatementCount: scale.geometryStatementCount,
  computedGeometryCount: result.computedGeometry.size,
  generatedRowCount: result.forGroupGeneratedRows?.length ?? 0
});

const expectStandardCounts = (counts: FixtureCounts, scale: StandardFixtureScale) => {
  expect(counts).toMatchObject({
    statementCount: scale.statementCount,
    bindingCount: scale.bindingCount,
    geometryStatementCount: scale.geometryStatementCount,
    computedGeometryCount: scale.expectedComputedGeometryCount,
    generatedRowCount: scale.expectedGeneratedRowCount
  });
};

const expectCompiledStandardCounts = (counts: FixtureCounts, scale: StandardFixtureScale) => {
  expect(counts).toMatchObject({
    statementCount: scale.statementCount,
    bindingCount: scale.bindingCount,
    geometryStatementCount: scale.geometryStatementCount,
    computedGeometryCount: 0,
    generatedRowCount: 0
  });
};

const expectForGroupCounts = (counts: FixtureCounts, scale: ForGroupFixtureScale) => {
  expect(counts).toMatchObject({
    statementCount: scale.statementCount,
    bindingCount: scale.bindingCount,
    geometryStatementCount: scale.geometryStatementCount,
    computedGeometryCount: scale.expectedComputedGeometryCount,
    generatedRowCount: scale.generatedRowCount
  });
};

describe("typed-variable baseline performance measurements", () => {
  it("records compiler worker CPU measurements for 250/1000 source statements", () => {
    const small = buildStandardBaselineSource(SMALL_SIZE);
    const large = buildStandardBaselineSource(LARGE_SIZE);
    const measurement = measureWorkerCpuScaling({
      small: { run: () => compileDocument(small.source), counts: compiledCounts },
      large: { run: () => compileDocument(large.source), counts: compiledCounts },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expectCompiledStandardCounts(measurement.small, small.scale);
    expectCompiledStandardCounts(measurement.large, large.scale);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("bindingAnalysisBaseline", measurement);
  }, 150_000);

  it("records TS reference evaluation worker CPU measurements for 250/1000 source statements", () => {
    const small = buildStandardBaselineSource(SMALL_SIZE);
    const large = buildStandardBaselineSource(LARGE_SIZE);
    const smallDocument = compileDocument(small.source).document!;
    const largeDocument = compileDocument(large.source).document!;
    const measurement = measureWorkerCpuScaling({
      small: { run: () => evaluateElements(smallDocument.elements), counts: (result) => evaluationCounts(result, small.scale) },
      large: { run: () => evaluateElements(largeDocument.elements), counts: (result) => evaluationCounts(result, large.scale) },
      warmUpRuns: 20,
      trials: 21,
      runsPerTrial: 5
    });

    expectStandardCounts(measurement.small, small.scale);
    expectStandardCounts(measurement.large, large.scale);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("tsReferenceEvaluation", measurement);
  }, 90_000);

  it("records TS forGroup worker CPU measurements for 250/1000 generated rows", () => {
    const small = buildForGroupBaselineSource(SMALL_SIZE);
    const large = buildForGroupBaselineSource(LARGE_SIZE);
    const smallDocument = compileDocument(small.source).document!;
    const largeDocument = compileDocument(large.source).document!;
    const measurement = measureWorkerCpuScaling({
      small: { run: () => evaluateElements(smallDocument.elements), counts: (result) => evaluationCounts(result, small.scale) },
      large: { run: () => evaluateElements(largeDocument.elements), counts: (result) => evaluationCounts(result, large.scale) },
      warmUpRuns: 20,
      trials: 21,
      runsPerTrial: 5
    });

    expectForGroupCounts(measurement.small, small.scale);
    expectForGroupCounts(measurement.large, large.scale);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("tsForGroupMutation", measurement);
  }, 90_000);
});
