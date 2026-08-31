import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { analyzeTypedBindingRenameInDocument } from "../document/typedRenameAnalysis";

type Measurement = { medianMs: number; p95Ms: number };
const runPerformanceGates = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.VITE_RUN_PERFORMANCE_GATES === "1";
const describePerformanceGates = runPerformanceGates ? describe : describe.skip;

// Dense fan-out, matching the property test's shape: `count` distinct `let`
// declarations each directly referencing one shared binding - the shape most
// relevant to rename safety (every occurrence the rename must replay).
const sourceFor = (count: number) => [
  "nui 1",
  "const Target: number = 0",
  ...Array.from({ length: count }, (_, index) => `let v${index}: number = @Target`)
].join("\n");

// Statement 0 is "nui 1"; statement 1 is "const Target...", followed by
// `count` `let v{i}` declarations at statements 2..count+1 - every
// declaration needs a stable identity, "nui 1" does not.
const identitiesFor = (count: number) => new Map(
  Array.from({ length: count + 1 }, (_, index) => [index + 1, `perf:decl${index}`])
);

const analyzeRenameOnce = (count: number) => {
  const compiled = compileDslDocument(sourceFor(count), { assignedStatementIds: identitiesFor(count) });
  const target = compiled.bindingAnalysis!.catalog.bindings.find(
    (binding) => binding.kind === "typed" && binding.name === "Target"
  )!;
  const analysis = analyzeTypedBindingRenameInDocument({ compiled, targetBindingId: target.id, newName: "Renamed" });
  if (analysis.verdict !== "ok") throw new Error(`expected an ok verdict, got ${analysis.verdict}:${(analysis as { reason?: string }).reason}`);
  return analysis.occurrences.length;
};

const measure = (count: number): Measurement => {
  for (let warmup = 0; warmup < 100; warmup += 1) analyzeRenameOnce(count);
  const samples: number[] = [];
  for (let trial = 0; trial < 21; trial += 1) {
    const started = performance.now();
    analyzeRenameOnce(count);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
  };
};

describePerformanceGates("Task 37 typed rename analysis performance", () => {
  it("records 250/1000 dense fan-out rename analysis cost", () => {
    const small = measure(250);
    const large = measure(1000);
    const scaling = large.medianMs / Math.max(small.medianMs, 0.001);
    console.log(
      `[Task 37 rename analysis] 250 median=${small.medianMs.toFixed(3)}ms p95=${small.p95Ms.toFixed(3)}ms; ` +
      `1000 median=${large.medianMs.toFixed(3)}ms p95=${large.p95Ms.toFixed(3)}ms; scaling=${scaling.toFixed(3)}x`
    );
    expect(analyzeRenameOnce(1000)).toBe(1000);
    expect(Number.isFinite(scaling)).toBe(true);
  }, 150_000);
});
