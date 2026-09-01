import { describe, expect, it } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../src/document/canonicalDocument";
import { emptyDocument } from "../src/dsl/dslDocumentTestUtils";
import { evaluateElements } from "../src/geometry/evaluate";
import { buildForGroupMutationOwners, forGroupMutationOwnerByElementId } from "../src/scalars/forGroupMutationControl";
import {
  expectPerformanceRegressionGate,
  logPerformanceGateMeasurement,
  measureWorkerCpuScaling,
  type FixtureCounts
} from "./typedVariablesPerformanceMeasurement";

const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const buildCase = (generatedRows: number) => {
  const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), [
    "nui 1",
    "let total: number = 0",
    `for i in range(from: 0, count: ${generatedRows}, step: 1) {`,
    "  set total = @total + 1",
    "  point P = coordinate(x: 0, y: 0)",
    "}"
  ].join("\n"));
  if (compiled.status === "fatal") throw new Error("forGroup mutation performance fixture must compile");
  const bindingVersions = compiled.doc.bindingVersions!;
  const options = {
    bindingVersions,
    statementInfoByElementId: compiled.doc.statementMap.byElementId,
    statementIdByStatementIndex: compiled.doc.statementMap.statementIdByStatementIndex,
    forGroupMutationOwnerByElementId: forGroupMutationOwnerByElementId(buildForGroupMutationOwners(
      bindingVersions,
      compiled.doc.document.elements,
      compiled.doc.statementMap.byElementId,
      compiled.doc.statementMap.statementIdByStatementIndex
    ))
  };
  return {
    run: () => evaluateElements(compiled.doc.document.elements, options),
    counts: (result: ReturnType<typeof evaluateElements>): FixtureCounts => ({
      statementCount: 4,
      bindingCount: 1,
      geometryStatementCount: 1,
      computedGeometryCount: result.computedGeometry.size,
      generatedRowCount: result.forGroupGeneratedRows?.length ?? 0
    })
  };
};

describePerformanceGates("forGroup mutation production performance baseline", () => {
  it("records TS scheduler CPU for 250/1000 generated rows", () => {
    const small = buildCase(250);
    const large = buildCase(1_000);
    const measurement = measureWorkerCpuScaling({
      small: { run: small.run, counts: small.counts },
      large: { run: large.run, counts: large.counts },
      warmUpRuns: 100,
      trials: 21,
      runsPerTrial: 5
    });
    expect(measurement.small).toMatchObject({ computedGeometryCount: 250, generatedRowCount: 250 });
    expect(measurement.large).toMatchObject({ computedGeometryCount: 1_000, generatedRowCount: 1_000 });
    expectPerformanceRegressionGate(measurement);
    logPerformanceGateMeasurement("forGroupMutation", measurement);
  }, 90_000);
});
