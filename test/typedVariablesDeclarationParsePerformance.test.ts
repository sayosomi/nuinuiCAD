import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../src/dsl/dslDocument";
import { BASELINE_SIZES, buildTypedDeclarationBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 10 performance sanity: reuses Task 00's worker-CPU scaling helper
// (100 warm-up runs, 21 trials per decisions.md D19) to record - not gate on
// an invented absolute threshold - the 250->1000 declaration parse cost.
// This is the "1000 declaration parse sanity" required by
// docs/typed-variables/tasks/10-typed-declaration-syntax.md section 12.

const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const declarationStatementIds = (declarationCount: number) =>
  new Map(
    Array.from({ length: declarationCount }, (_, index) => [index + 1, `benchmark:typed:${index}`])
  );

const compileDeclarations = (source: string, declarationCount: number) => {
  // 本番ではreconcilerから供給されるidentityを、ベンチ用fixtureでは明示する。
  const compiled = compileDslDocument(source, {
    assignedStatementIds: declarationStatementIds(declarationCount)
  });
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("declaration baseline fixture must compile without diagnostics");
  }
  return compiled;
};

const counts = (declarationCount: number): FixtureCounts => ({
  statementCount: declarationCount,
  bindingCount: declarationCount,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("typed declaration parse performance baseline", () => {
  it("records compileDslDocument worker CPU measurements for 250/1000 const/let declarations", () => {
    const small = buildTypedDeclarationBaselineSource(SMALL_SIZE);
    const large = buildTypedDeclarationBaselineSource(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: {
        run: () => {
          const compiled = compileDeclarations(small.source, small.scale.declarationCount);
          return compiled.statements.filter((statement) => statement.kind === "typedDeclaration").length;
        },
        counts
      },
      large: {
        run: () => {
          const compiled = compileDeclarations(large.source, large.scale.declarationCount);
          return compiled.statements.filter((statement) => statement.kind === "typedDeclaration").length;
        },
        counts
      },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small).toMatchObject({ statementCount: small.scale.declarationCount });
    expect(measurement.large).toMatchObject({ statementCount: large.scale.declarationCount });
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("typedDeclarationParse", measurement);
  }, 150_000);
});
