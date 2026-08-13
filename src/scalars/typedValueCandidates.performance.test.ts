import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { typedBindingReferenceCandidates } from "./typedValueCandidates";

type Measurement = { medianMs: number; p95Ms: number };

// Dense document-order chain of `count` typed number declarations, all
// visible from a final statement site - the shape most relevant to value
// completion: an in-progress reference at any position must scan every
// preceding visible binding once via visibleBindingsAt (a single bulk
// traversal, not one lookup per binding - see bindingResolution.ts).
const sourceFor = (count: number) => [
  "nui 4",
  ...Array.from({ length: count }, (_, index) => `const v${index}: number = ${index}`),
  "const cursor: number = 0"
].join("\n");

// Statement 0 is "nui 4"; statements 1..count are the v{i} declarations;
// the final statement (index count+1) is the "cursor" site declaration.
const identitiesFor = (count: number) => new Map(
  Array.from({ length: count + 1 }, (_, index) => [index + 1, `perf:decl${index}`])
);

/**
 * Builds the precomputed BindingCatalog/BindingAnalysis exactly once per
 * size - this is the Tier B artifact value completion reads on every
 * keystroke without ever rebuilding it. Only the candidate-generation call
 * itself is inside the measured loop below.
 */
const fixtureFor = (count: number) => {
  const compiled = compileDslDocument(sourceFor(count), { assignedStatementIds: identitiesFor(count) });
  const bindingAnalysis = compiled.bindingAnalysis!;
  const cursor = bindingAnalysis.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "cursor")!;
  const site = { scopeId: cursor.effectiveScopeId, statementIndex: cursor.statementIndex };
  return { catalog: bindingAnalysis.catalog, entriesById: bindingAnalysis.entriesById, site };
};

const RUNS_PER_TRIAL = 20;

const measure = (count: number): Measurement => {
  const { catalog, entriesById, site } = fixtureFor(count);
  const accepts = (type: { kind: string } | null) => type !== null && type.kind === "number";
  const candidatesOnce = () => typedBindingReferenceCandidates({ catalog, entriesById, site, accepts });

  for (let warmup = 0; warmup < 100; warmup += 1) candidatesOnce();

  const samples: number[] = [];
  for (let trial = 0; trial < 21; trial += 1) {
    const started = performance.now();
    for (let run = 0; run < RUNS_PER_TRIAL; run += 1) candidatesOnce();
    samples.push((performance.now() - started) / RUNS_PER_TRIAL);
  }
  samples.sort((left, right) => left - right);
  return {
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
  };
};

describe("Task 39 typed value completion performance", () => {
  it("records 250/1000 binding-catalog reference-candidate generation cost (precomputed catalog, no compile in the loop)", () => {
    const small = measure(250);
    const large = measure(1000);
    const scaling = large.medianMs / Math.max(small.medianMs, 0.001);
    console.log(
      `[Task 39 value completion] 250 median=${small.medianMs.toFixed(4)}ms p95=${small.p95Ms.toFixed(4)}ms; ` +
      `1000 median=${large.medianMs.toFixed(4)}ms p95=${large.p95Ms.toFixed(4)}ms; scaling=${scaling.toFixed(3)}x`
    );
    // Record-only per plan.md's performance section: no fixed absolute gate
    // is invented ahead of a baseline. Task 50 sets gates from this and CI
    // variance.
    expect(fixtureFor(1000).catalog.bindings.length).toBeGreaterThanOrEqual(1000);
    expect(Number.isFinite(scaling)).toBe(true);
  });
});
