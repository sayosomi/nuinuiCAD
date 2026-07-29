import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";

type Measurement = { medianMs: number; p95Ms: number };
const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const sourceFor = (count: number) => [
  "nui 3",
  ...Array.from({ length: count }, (_, index) =>
    index === 0 ? "const v0: number = 0" : `const v${index}: number = @v${index - 1}`
  )
].join("\n");

const identitiesFor = (count: number) => new Map(
  Array.from({ length: count }, (_, index) => [index + 1, `perf:v${index}`])
);

const compileGraph = (count: number) => {
  const compiled = compileDslDocument(sourceFor(count), { assignedStatementIds: identitiesFor(count) });
  if (!compiled.typedDependencyGraph) throw new Error("typed dependency graph was not built");
  return compiled.typedDependencyGraph.edges.length;
};

const measure = (count: number): Measurement => {
  for (let warmup = 0; warmup < 100; warmup += 1) compileGraph(count);
  const samples: number[] = [];
  for (let trial = 0; trial < 21; trial += 1) {
    const started = performance.now();
    compileGraph(count);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
  };
};

describePerformanceGates("Task 36 typed dependency graph performance", () => {
  it("records 250/1000 dense initializer graph construction", () => {
    const small = measure(250);
    const large = measure(1000);
    const scaling = large.medianMs / Math.max(small.medianMs, 0.001);
    console.log(
      `[Task 36 dependency graph] 250 median=${small.medianMs.toFixed(3)}ms p95=${small.p95Ms.toFixed(3)}ms; ` +
      `1000 median=${large.medianMs.toFixed(3)}ms p95=${large.p95Ms.toFixed(3)}ms; scaling=${scaling.toFixed(3)}x`
    );
    expect(compileGraph(1000)).toBe(999);
    expect(Number.isFinite(scaling)).toBe(true);
  }, 150_000);
});
