import { describe, expect, it } from "vitest";
import { createForGroupMutationEnvironment } from "../src/scalars/forGroupMutationCore";
import { expectFiniteMeasurement, logBaselineMeasurement, measureWorkerCpuScaling, type FixtureCounts } from "./typedVariablesPerformanceMeasurement";

const counts = (iterationCount: number): FixtureCounts => ({
  statementCount: 1, bindingCount: 1, geometryStatementCount: 0, computedGeometryCount: 0, generatedRowCount: iterationCount
});

const run = (iterationCount: number) => {
  const environment = createForGroupMutationEnvironment<number>(new Map([["sum", 0]]));
  environment.run({
    loopScopeId: "scope:benchmark", iterationBindingId: "binding:iteration:i",
    iterationValues: Array.from({ length: iterationCount }, (_, index) => index), generatedStatements: ["sum"]
  }, (frame) => frame.set("sum", (frame.read("sum") as number) + frame.iterationValue));
  return environment.finalSlots().get("sum");
};

describe("forGroup mutation performance baseline", () => {
  it("records 100/1000 iteration in-place loop measurements", () => {
    const measurement = measureWorkerCpuScaling({
      small: { run: () => run(100), counts: () => counts(100) },
      large: { run: () => run(1000), counts: () => counts(1000) },
      warmUpRuns: 20, trials: 21, runsPerTrial: 5
    });
    expect(run(100)).toBe(4950);
    expect(run(1000)).toBe(499500);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("forGroupMutationCore", measurement);
  }, 90_000);
});
