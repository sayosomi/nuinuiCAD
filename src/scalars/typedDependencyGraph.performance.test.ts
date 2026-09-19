import { describe, expect, it } from "vitest";
import { compileDslDocument } from "@nuinuicad/nui-language";

type Measurement = { medianMs: number; p95Ms: number };
const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

const sourceFor = (count: number) => [
  "nui 1",
  ...Array.from({ length: count }, (_, index) =>
    index === 0 ? "const v0: number = 0" : `const v${index}: number = @v${index - 1}`
  )
].join("\n");

const identitiesFor = (count: number) => new Map(
  Array.from({ length: count }, (_, index) => [index + 1, `perf:v${index}`])
);

const geometrySourceFor = (count: number) => [
  "nui 1",
  "point P0 = coordinate(x: 0, y: 0)",
  ...Array.from({ length: count }, (_, index) =>
    index === 0
      ? "line L0 = segment(start: @P0, end: (1, 0))"
      : `line L${index} = segment(start: @L${index - 1}.start, end: (${index + 1}, 0))`
  )
].join("\n");

const compileGraph = (count: number) => {
  const compiled = compileDslDocument(sourceFor(count), { assignedStatementIds: identitiesFor(count) });
  if (!compiled.typedDependencyGraph) throw new Error("typed dependency graph was not built");
  return compiled.typedDependencyGraph.edges.length;
};

const compileGeometryGraph = (count: number) => {
  const compiled = compileDslDocument(geometrySourceFor(count));
  if (!compiled.typedDependencyGraph) throw new Error("geometry typed dependency graph was not built");
  return {
    edgeCount: compiled.typedDependencyGraph.edges.filter((edge) => edge.kind === "geometry").length,
    orderCount: compiled.typedDependencyGraph.evaluationOrder.length
  };
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

  it("records a 1,000-node structured geometry chain through graph construction", () => {
    for (let warmup = 0; warmup < 10; warmup += 1) compileGeometryGraph(1000);
    const samples: number[] = [];
    for (let trial = 0; trial < 11; trial += 1) {
      const started = performance.now();
      compileGeometryGraph(1000);
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const medianMs = samples[Math.floor(samples.length / 2)];
    console.log(`[Task 36 geometry dependency graph] 1000-node chain median=${medianMs.toFixed(3)}ms`);
    expect(compileGeometryGraph(1000)).toMatchObject({ edgeCount: 3002, orderCount: 1001 });
    expect(Number.isFinite(medianMs)).toBe(true);
  }, 150_000);
});
