import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../src/dsl/dslDocument";
import { evaluateScalarProgram, type ResolveExternalScalarBinding } from "../src/scalars/declarationEvaluator";
import { BASELINE_SIZES, buildBindingAnalysisChainBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 20 performance sanity (docs/typed-variables/tasks/20-ts-const-evaluation.md
// section 12: "program+ASTに線形。250/1000 reference測定を記録する"). Reuses
// Task 00's worker-CPU scaling helper (100 warm-up runs, 21 trials per
// decisions.md D19) purely to *record* the cost - never as a wall-clock
// pass/fail gate. Absolute thresholds and scaling-ratio gates are Task 50's
// job; this test only fixes correctness (the chained value is right at both
// scales) and linear structure (every binding in the chain produced a
// result - no truncation), reusing the same chained-reference fixture
// already used for Task 13R's binding-analysis performance baseline.

const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const declarationStatementIds = (bindingCount: number) =>
  new Map(
    Array.from({ length: bindingCount }, (_, index) => [index + 1, `benchmark:chain:${index}`])
  );

const neverResolveExternal: ResolveExternalScalarBinding = (bindingId) => {
  throw new Error(`unexpected external binding lookup: ${bindingId}`);
};

const compileChainProgram = (bindingCount: number) => {
  const { source } = buildBindingAnalysisChainBaselineSource(bindingCount);
  const compiled = compileDslDocument(source, { assignedStatementIds: declarationStatementIds(bindingCount) });
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("binding analysis chain fixture must compile without diagnostics");
  }
  if (!compiled.scalarProgram || compiled.scalarProgram.statements.length !== bindingCount) {
    throw new Error("chain fixture must lower every binding into the scalar program");
  }
  return compiled.scalarProgram;
};

const counts = (bindingCount: number): FixtureCounts => ({
  statementCount: bindingCount,
  bindingCount,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("typed declaration const evaluation performance baseline", () => {
  it("records evaluateScalarProgram worker CPU measurements for a 250/1000-binding reference chain", () => {
    const smallProgram = compileChainProgram(SMALL_SIZE);
    const largeProgram = compileChainProgram(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: {
        run: () => evaluateScalarProgram(smallProgram, neverResolveExternal),
        counts: () => counts(SMALL_SIZE)
      },
      large: {
        run: () => evaluateScalarProgram(largeProgram, neverResolveExternal),
        counts: () => counts(LARGE_SIZE)
      },
      warmUpRuns: 20,
      trials: 21,
      runsPerTrial: 5
    });

    // Correctness: `const V_i = @V_{i-1} + 1` starting from `V0 = 0`, so the
    // last binding's value is exactly `size - 1` at both scales.
    const smallResult = evaluateScalarProgram(smallProgram, neverResolveExternal);
    const largeResult = evaluateScalarProgram(largeProgram, neverResolveExternal);
    const lastValueOf = (program: typeof smallProgram, result: ReturnType<typeof evaluateScalarProgram>) => {
      const lastStatement = program.statements[program.statements.length - 1];
      const evaluation = result.resultsByBindingId.get(lastStatement.bindingId);
      if (evaluation?.status !== "ok" || evaluation.value.kind !== "number") {
        throw new Error("expected the chain's last binding to evaluate to a number");
      }
      return evaluation.value.value;
    };
    expect(lastValueOf(smallProgram, smallResult)).toBe(SMALL_SIZE - 1);
    expect(lastValueOf(largeProgram, largeResult)).toBe(LARGE_SIZE - 1);

    // Linear structure: every binding in the chain produced a result - no
    // partial/truncated evaluation at either scale.
    expect(smallResult.resultsByBindingId.size).toBe(SMALL_SIZE);
    expect(largeResult.resultsByBindingId.size).toBe(LARGE_SIZE);

    expect(measurement.small).toMatchObject({ bindingCount: SMALL_SIZE });
    expect(measurement.large).toMatchObject({ bindingCount: LARGE_SIZE });
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("declarationEvaluatorChain", measurement);
  }, 90_000);
});
