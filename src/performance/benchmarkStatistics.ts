export type BenchmarkStatistics = {
  samples: number[];
  p50: number;
  p95: number;
  max: number;
};

const assertValidSamples = (samples: readonly number[]): void => {
  if (samples.length === 0) {
    throw new Error("Benchmark samples must not be empty");
  }

  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error("Benchmark samples must be finite and nonnegative");
    }
  }
};

/** Return the nearest-rank percentile without mutating the input samples. */
export const nearestRankPercentile = (
  samples: readonly number[],
  percentile: number
): number => {
  assertValidSamples(samples);
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error("Percentile must be finite and in the interval (0, 1]");
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil(sorted.length * percentile);
  return sorted[rank - 1]!;
};

export const calculateBenchmarkStatistics = (
  samples: readonly number[]
): BenchmarkStatistics => {
  assertValidSamples(samples);
  return {
    samples: [...samples],
    p50: nearestRankPercentile(samples, 0.5),
    p95: nearestRankPercentile(samples, 0.95),
    max: Math.max(...samples)
  };
};

export const summarizeSamples = calculateBenchmarkStatistics;
