import { describe, expect, it } from "vitest";
import { parseDsl } from "../src/dsl/dslParser";
import type { DslStatement } from "../src/dsl/dslTypes";
import { buildLexicalScopeIndex, type ResolveStatementId } from "../src/scalars/lexicalScopeIndex";
import { BASELINE_SIZES, buildLexicalScopeBaselineSource } from "./typedVariablesBaselineFixtures";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

// Task 11 performance sanity: reuses Task 00's worker-CPU scaling helper
// (100 warm-up runs, 21 trials per decisions.md D19) to record - not gate on
// an invented absolute threshold - the 250->1000 scope index build cost.
//
// This measures ONLY buildLexicalScopeIndex's own construction cost: source
// parsing and id resolution are done once, outside the measured closures.
//
// The production adapter (src/dsl/lexicalScopeIndexAdapter.ts) requires a
// real reconciled statementIndex -> stable id map, which this fixture has no
// way to produce (there is no previous document snapshot to reconcile
// against here). So, like the fixture generator itself, the id resolver
// below is test-only: it is NOT a stable identity (it is keyed by array
// index, which shifts under any edit) and exists purely to give
// buildLexicalScopeIndex something to call at this fixture's scale.
const unstableIndexKeyedIdsForTesting = (statements: readonly DslStatement[]): ResolveStatementId => {
  const ids = statements.map((_, index) => `stmt${index}`);
  return (index) => ids[index];
};

const [SMALL_SIZE, LARGE_SIZE] = BASELINE_SIZES;

const prepare = (scopeCount: number) => {
  const { source } = buildLexicalScopeBaselineSource(scopeCount);
  const parsed = parseDsl(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("scope index baseline fixture must parse without diagnostics");
  }
  return { statements: parsed.statements, resolveStatementId: unstableIndexKeyedIdsForTesting(parsed.statements) };
};

const fixtureCounts = (statementCount: number): FixtureCounts => ({
  statementCount,
  bindingCount: 0,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("lexical scope index performance baseline", () => {
  it("records buildLexicalScopeIndex worker CPU measurements for 250/1000 scopes", () => {
    const small = prepare(SMALL_SIZE);
    const large = prepare(LARGE_SIZE);

    const measurement = measureWorkerCpuScaling({
      small: {
        run: () => buildLexicalScopeIndex(small.statements, small.resolveStatementId).scopes.size,
        counts: () => fixtureCounts(small.statements.length)
      },
      large: {
        run: () => buildLexicalScopeIndex(large.statements, large.resolveStatementId).scopes.size,
        counts: () => fixtureCounts(large.statements.length)
      },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small.statementCount).toBe(small.statements.length);
    expect(measurement.large.statementCount).toBe(large.statements.length);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("lexicalScopeIndex", measurement);
  }, 150_000);
});
