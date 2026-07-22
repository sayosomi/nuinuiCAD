import { describe, expect, it } from "vitest";
import { parseScalarExpression } from "../src/scalars/expressionParser";
import { BASELINE_SIZES, buildScalarExpressionBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 14 performance sanity: reuses Task 00's worker-CPU scaling helper
// (100 warm-up runs, 21 trials per decisions.md D19) to record - not gate on
// an invented absolute threshold - the 250->1000 flat-expression parse cost.
// This is the "expression length is linear" sanity required by
// docs/typed-variables/tasks/14-ts-expression-parser.md section 12: a flat
// `1 + 1 + 1 + ...` chain exercises only the same-tier chaining while-loop
// (see BINARY_PRECEDENCE_TIERS in src/scalars/expressionParser.ts), which is
// the part of the parser whose cost should scale with expression length.

const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const parseFully = (source: string) => {
  const result = parseScalarExpression(source, { start: 0, end: source.length });
  if (!result.ast || result.diagnostics.length !== 0) {
    throw new Error("scalar expression baseline fixture must parse without diagnostics");
  }
  return result.ast;
};

// There is no DSL statement here (parseScalarExpression takes a bare
// expression, not a document) - operatorCount is logged via statementCount
// as the closest available "size dimension" field, matching how sibling
// baselines reuse this shape's fields for their own primary size metric.
const counts = (operatorCount: number): FixtureCounts => ({
  statementCount: operatorCount,
  bindingCount: 0,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("scalar expression parse performance baseline", () => {
  it("records parseScalarExpression worker CPU measurements for 250/1000 chained operators", () => {
    const small = buildScalarExpressionBaselineSource(SMALL_SIZE);
    const large = buildScalarExpressionBaselineSource(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: { run: () => parseFully(small.source), counts: () => counts(small.scale.operatorCount) },
      large: { run: () => parseFully(large.source), counts: () => counts(large.scale.operatorCount) },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small.statementCount).toBe(small.scale.operatorCount);
    expect(measurement.large.statementCount).toBe(large.scale.operatorCount);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("scalarExpressionParse", measurement);
  }, 150_000);
});
