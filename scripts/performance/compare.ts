import { compareBenchmarkResults } from "../../src/performance/benchmarkComparison";
import { readBenchmarkResultFile } from "./benchmarkResultIo";

const formatNumber = (value: number): string => String(value);

const formatComparison = (baselinePath: string, candidatePath: string, comparison: ReturnType<typeof compareBenchmarkResults>): string => {
  const lines = [
    `baseline: ${baselinePath}`,
    `candidate: ${candidatePath}`,
    `fixture: ${comparison.fixture.id}`
  ];
  for (const [scenarioId, scenario] of Object.entries(comparison.scenarios)) {
    lines.push(`scenario ${scenarioId}`);
    for (const [metricId, metric] of Object.entries(scenario.metrics)) {
      lines.push(
        `  ${metricId}: baseline p50=${formatNumber(metric.baseline.p50)} p95=${formatNumber(metric.baseline.p95)} max=${formatNumber(metric.baseline.max)}; ` +
        `candidate p50=${formatNumber(metric.candidate.p50)} p95=${formatNumber(metric.candidate.p95)} max=${formatNumber(metric.candidate.max)}; ` +
        `p95 ratio=${metric.p95Ratio === "n/a" ? "n/a" : formatNumber(metric.p95Ratio)}`
      );
    }
  }
  return lines.join("\n");
};

const main = (): void => {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new Error("usage: npm run bench:compare -- <baseline-result.json> <candidate-result.json>");
  }
  const [baselinePath, candidatePath] = args;
  const comparison = compareBenchmarkResults(
    readBenchmarkResultFile(baselinePath!),
    readBenchmarkResultFile(candidatePath!)
  );
  process.stdout.write(`${formatComparison(baselinePath!, candidatePath!, comparison)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`bench:compare: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
