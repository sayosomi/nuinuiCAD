type CpuUsage = { user: number; system: number };

export type FixtureCounts = {
  statementCount: number;
  bindingCount: number;
  geometryStatementCount: number;
  computedGeometryCount: number;
  generatedRowCount: number;
};

export type TimingStats = {
  medianMs: number;
  p95Ms: number;
};

export type ScalingMeasurement = {
  warmUpRuns: number;
  trials: number;
  runsPerTrial: number;
  small: FixtureCounts & TimingStats;
  large: FixtureCounts & TimingStats;
  scalingRatio: number;
};

type BenchmarkCase<T> = {
  run: () => T;
  counts: (result: T) => FixtureCounts;
};

// Vitest runs this helper in a Node worker, while the app tsconfig deliberately
// excludes Node globals. Keep that boundary in this test-only module.
const nodeProcess = (globalThis as unknown as {
  process: { cpuUsage: (previous?: CpuUsage) => CpuUsage };
}).process;
const cpuUsage = nodeProcess.cpuUsage.bind(nodeProcess);

const timingStats = (samples: readonly number[]): TimingStats => {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
  };
};

const measureCpuMs = <T>(benchmark: BenchmarkCase<T>, runsPerTrial: number) => {
  const started = cpuUsage();
  let result: T | undefined;
  for (let index = 0; index < runsPerTrial; index += 1) result = benchmark.run();
  const elapsed = cpuUsage(started);
  if (result === undefined) throw new Error("benchmark did not run");
  return {
    elapsedMs: (elapsed.user + elapsed.system) / 1_000 / runsPerTrial,
    result
  };
};

export const measureWorkerCpuScaling = <T>({
  small,
  large,
  warmUpRuns,
  trials,
  runsPerTrial
}: {
  small: BenchmarkCase<T>;
  large: BenchmarkCase<T>;
  warmUpRuns: number;
  trials: number;
  runsPerTrial: number;
}): ScalingMeasurement => {
  const smallCorrectness = small.run();
  const largeCorrectness = large.run();

  for (let index = 0; index < warmUpRuns; index += 1) {
    small.run();
    large.run();
  }

  const smallSamples: number[] = [];
  const largeSamples: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const firstIsSmall = trial % 2 === 0;
    const first = measureCpuMs(firstIsSmall ? small : large, runsPerTrial);
    const second = measureCpuMs(firstIsSmall ? large : small, runsPerTrial);
    (firstIsSmall ? smallSamples : largeSamples).push(first.elapsedMs);
    (firstIsSmall ? largeSamples : smallSamples).push(second.elapsedMs);
  }

  const smallStats = timingStats(smallSamples);
  const largeStats = timingStats(largeSamples);
  return {
    warmUpRuns,
    trials,
    runsPerTrial,
    small: { ...small.counts(smallCorrectness), ...smallStats },
    large: { ...large.counts(largeCorrectness), ...largeStats },
    scalingRatio: largeStats.medianMs / Math.max(smallStats.medianMs, 0.001)
  };
};

export const logBaselineMeasurement = (
  area: string,
  measurement: ScalingMeasurement
) => console.log(`[typedVariables baseline] ${JSON.stringify({ area, metric: "workerCpuMs", ...measurement })}`);

export const expectFiniteMeasurement = (measurement: ScalingMeasurement) => {
  for (const value of [
    measurement.small.medianMs,
    measurement.small.p95Ms,
    measurement.large.medianMs,
    measurement.large.p95Ms,
    measurement.scalingRatio
  ]) {
    if (!Number.isFinite(value)) throw new Error("performance measurement must be finite");
  }
};
