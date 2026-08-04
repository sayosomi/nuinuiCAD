import { describe, expect, it } from "vitest";
import { effectiveElementActivityById } from "../src/model/elementActivity";
import type { CadElement } from "../src/types/geometry";
import {
  expectFiniteMeasurement,
  logBaselineMeasurement,
  measureWorkerCpuScaling,
  type FixtureCounts
} from "./typedVariablesPerformanceMeasurement";

const activityChain = (count: number): CadElement[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `group-${index}`,
    name: `group-${index}`,
    type: "group" as const,
    activity: index % 5 === 2 ? "disabled" as const : index % 3 === 1 ? "hidden" as const : "visible" as const,
    ...(index ? { parentGroupId: `group-${index - 1}` } : {})
  }));

const counts = (elements: CadElement[]): FixtureCounts => ({
  statementCount: elements.length,
  bindingCount: 0,
  geometryStatementCount: 0,
  computedGeometryCount: 0,
  generatedRowCount: 0
});

describe("element activity performance measurements", () => {
  it("records cached 250/1000-element state composition", () => {
    const small = activityChain(250);
    const large = activityChain(1_000);
    const measurement = measureWorkerCpuScaling({
      small: { run: () => effectiveElementActivityById(small), counts: () => counts(small) },
      large: { run: () => effectiveElementActivityById(large), counts: () => counts(large) },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 20
    });

    expect(measurement.small.statementCount).toBe(250);
    expect(measurement.large.statementCount).toBe(1_000);
    expectFiniteMeasurement(measurement);
    logBaselineMeasurement("elementActivityComposition", measurement);
  }, 90_000);
});
