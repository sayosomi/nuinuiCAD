import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDslDocument, parseDslSnapshot } from "@nuinuicad/nui-language";
import { cpuUsage } from "node:process";
import { vi } from "vitest";

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

const measureGeometry = (count: number): Measurement => {
  for (let warmup = 0; warmup < 10; warmup += 1) compileGeometryGraph(count);
  const samples: number[] = [];
  for (let trial = 0; trial < 11; trial += 1) {
    const started = performance.now();
    compileGeometryGraph(count);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
  };
};

type TimingSummary = {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  standardDeviationMs: number;
};

type ModuleSnapshotCase = {
  name: string;
  source: string;
  sourceSha256: string;
  expectedRuntimeElements: number;
  parsed: ReturnType<typeof parseDslSnapshot>;
  assignedStatementIds: ReadonlyMap<number, string>;
};

const moduleSnapshotCases: readonly ModuleSnapshotCase[] = [
  ["S-P", "test/fixtures/issue-1515/S-P-0.nui", 32],
  ["M-P", "test/fixtures/issue-1515/M-P-0.nui", 128],
  ["L-P", "test/fixtures/issue-1515/L-P-0.nui", 512]
].map(([name, path, expectedRuntimeElements]) => {
  const source = readFileSync(path as string, "utf8");
  const sourceRevision = 31;
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return {
    name: name as string,
    source,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    expectedRuntimeElements: expectedRuntimeElements as number,
    parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [
      index,
      `module-seed-performance:${name}:statement:${index}`
    ] as const))
  };
});

const compileModuleSnapshotCase = (input: ModuleSnapshotCase) => {
  const compiled = compileDslDocument(input.source, {
    sourceRevision: 31,
    assignedStatementIds: input.assignedStatementIds,
    preparsed: input.parsed
  });
  if (!compiled.typedDependencyGraph || !compiled.document) {
    throw new Error(`${input.name} Module graph did not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return {
    runtimeElementCount: compiled.document.elements.filter((element) => element.type !== "moduleInstance").length,
    documentElementCount: compiled.document.elements.length,
    snapshotCount: compiled.moduleMaterialization?.instanceBaseGeometrySnapshots.length ?? 0,
    edgeCount: compiled.typedDependencyGraph.edges.length
  };
};

const summarizeTimings = (samples: readonly number[]): TimingSummary => {
  const ordered = [...samples].sort((left, right) => left - right);
  const meanMs = ordered.reduce((total, sample) => total + sample, 0) / ordered.length;
  const varianceMsSquared = ordered.reduce((total, sample) => total + (sample - meanMs) ** 2, 0) / ordered.length;
  return {
    p50Ms: ordered[Math.floor(ordered.length / 2)],
    p95Ms: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)],
    maxMs: ordered[ordered.length - 1],
    meanMs,
    standardDeviationMs: Math.sqrt(varianceMsSquared)
  };
};

const measureModuleSnapshotCase = (input: ModuleSnapshotCase) => {
  for (let warmup = 0; warmup < 5; warmup += 1) compileModuleSnapshotCase(input);
  const wallSamples: number[] = [];
  const cpuSamples: number[] = [];
  let graphShape: ReturnType<typeof compileModuleSnapshotCase> | undefined;
  for (let trial = 0; trial < 21; trial += 1) {
    const cpuStarted = cpuUsage();
    const wallStarted = performance.now();
    graphShape = compileModuleSnapshotCase(input);
    wallSamples.push(performance.now() - wallStarted);
    const cpuElapsed = cpuUsage(cpuStarted);
    cpuSamples.push((cpuElapsed.user + cpuElapsed.system) / 1000);
  }
  return {
    graphShape: graphShape!,
    compileWallClock: summarizeTimings(wallSamples),
    compileCpu: summarizeTimings(cpuSamples)
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
    const small = measureGeometry(250);
    const large = measureGeometry(1000);
    const scaling = large.medianMs / Math.max(small.medianMs, 0.001);
    console.log(
      `[Task 36 geometry dependency graph] 250 median=${small.medianMs.toFixed(3)}ms p95=${small.p95Ms.toFixed(3)}ms; ` +
      `1000 median=${large.medianMs.toFixed(3)}ms p95=${large.p95Ms.toFixed(3)}ms; scaling=${scaling.toFixed(3)}x`
    );
    expect(compileGeometryGraph(250)).toMatchObject({ edgeCount: 752, orderCount: 251 });
    expect(compileGeometryGraph(1000)).toMatchObject({ edgeCount: 3002, orderCount: 1001 });
    expect(Number.isFinite(small.medianMs)).toBe(true);
    expect(Number.isFinite(large.medianMs)).toBe(true);
    expect(Number.isFinite(scaling)).toBe(true);
  }, 150_000);

  it("records controlled Module snapshot compilation for 32/128/512 runtime elements", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const input of moduleSnapshotCases) {
        const measurement = measureModuleSnapshotCase(input);
        expect(measurement.graphShape.runtimeElementCount).toBe(input.expectedRuntimeElements);
        console.log(
          `[Module snapshot compile] case=${input.name} sourceSha256=${input.sourceSha256} ` +
          `elements=${measurement.graphShape.runtimeElementCount} documentElements=${measurement.graphShape.documentElementCount} ` +
          `snapshots=${measurement.graphShape.snapshotCount} ` +
          `edges=${measurement.graphShape.edgeCount} warmups=5 trials=21 ` +
          `wall[p50=${measurement.compileWallClock.p50Ms.toFixed(3)},p95=${measurement.compileWallClock.p95Ms.toFixed(3)},` +
          `max=${measurement.compileWallClock.maxMs.toFixed(3)},mean=${measurement.compileWallClock.meanMs.toFixed(3)},` +
          `sd=${measurement.compileWallClock.standardDeviationMs.toFixed(3)}]ms ` +
          `cpu[p50=${measurement.compileCpu.p50Ms.toFixed(3)},p95=${measurement.compileCpu.p95Ms.toFixed(3)},` +
          `max=${measurement.compileCpu.maxMs.toFixed(3)},mean=${measurement.compileCpu.meanMs.toFixed(3)},` +
          `sd=${measurement.compileCpu.standardDeviationMs.toFixed(3)}]ms requests=not-measured`
        );
      }
    } finally {
      vi.useRealTimers();
    }
  }, 150_000);
});
