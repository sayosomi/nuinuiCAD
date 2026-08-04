import { describe, expect, it } from "vitest";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { isElementDslStatement, parseDsl } from "../dsl/dslParser";
import type { CadElementType } from "../types/geometry";
import { reconcileStatements, type ReconcileInput } from "./statementReconciler";

/**
 * This guards reconciliation complexity, not end-to-end UI latency. Wall-clock
 * samples include worker descheduling under Vitest's parallel suite, so measure
 * the current worker's CPU time instead. GC and allocation work remain included.
 */
const WARM_UP_RUNS = 100;
const TRIALS = 21;
const RUNS_PER_TRIAL = 20;
const MAX_1000_ELEMENT_CPU_MS = 5;
const MAX_250_TO_1000_SCALING_RATIO = 8;

type ChangeKind = "attribute" | "rename";

type Measurement = {
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

type CpuUsage = { user: number; system: number };

// The app tsconfig intentionally omits Node globals; this test runs only in
// Vitest's Node worker, so keep that boundary local instead of widening it.
const nodeProcess = (globalThis as unknown as {
  process: { cpuUsage: (previous?: CpuUsage) => CpuUsage };
}).process;
const cpuUsage = nodeProcess.cpuUsage.bind(nodeProcess);

const createBenchmarkId = (type: CadElementType) => `benchmark-${type}`;

const buildElements = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `old-${index}`,
    name: `P${index}`,
    type: "freePoint" as const,
    activity: "visible" as const,
    x: index,
    y: index % 97
  }));

const prepareInput = (elementCount: number, kind: ChangeKind): ReconcileInput => {
  const elements = buildElements(elementCount);
  const middleIndex = Math.floor(elementCount / 2);
  const oldSource = dslTextForElements(elements);
  const newSource = dslTextForElements(elements.map((element, index) => {
    if (index !== middleIndex) return element;
    return kind === "attribute"
      ? { ...element, y: 42 }
      : { ...element, name: `Q${middleIndex}renamed` };
  }));
  expect(newSource).not.toBe(oldSource);

  const old = parseDsl(oldSource);
  const next = parseDsl(newSource);
  const oldElementIds = new Map<number, string>();
  old.statements.forEach((statement, index) => {
    if (isElementDslStatement(statement)) oldElementIds.set(index, `old-${index}`);
  });

  return {
    oldStatements: old.statements,
    oldLines: oldSource.split("\n"),
    oldElementIds,
    newStatements: next.statements,
    newLines: newSource.split("\n")
  };
};

const reconcile = (input: ReconcileInput) => reconcileStatements(input, { createId: createBenchmarkId });

const measureCpuMsPerReconcile = (input: ReconcileInput): number => {
  const started = cpuUsage();
  for (let index = 0; index < RUNS_PER_TRIAL; index += 1) reconcile(input);
  const elapsed = cpuUsage(started);
  return (elapsed.user + elapsed.system) / 1_000 / RUNS_PER_TRIAL;
};

const stats = (samples: readonly number[]): Measurement => {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    maxMs: sorted[sorted.length - 1]
  };
};

const assertCorrectResult = (input: ReconcileInput, elementCount: number) => {
  const result = reconcile(input);
  expect(result.inheritedCount).toBe(elementCount);
  expect(result.createdIds.size).toBe(0);
  expect(result.vanishedIds).toEqual([]);
};

const measureScaling = (kind: ChangeKind) => {
  const small = prepareInput(250, kind);
  const large = prepareInput(1_000, kind);
  assertCorrectResult(small, 250);
  assertCorrectResult(large, 1_000);

  for (let index = 0; index < WARM_UP_RUNS; index += 1) {
    reconcile(small);
    reconcile(large);
  }

  const smallSamples: number[] = [];
  const largeSamples: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const firstIsSmall = trial % 2 === 0;
    const first = measureCpuMsPerReconcile(firstIsSmall ? small : large);
    const second = measureCpuMsPerReconcile(firstIsSmall ? large : small);
    (firstIsSmall ? smallSamples : largeSamples).push(first);
    (firstIsSmall ? largeSamples : smallSamples).push(second);
  }

  const smallStats = stats(smallSamples);
  const largeStats = stats(largeSamples);
  return {
    small: smallStats,
    large: largeStats,
    scalingRatio: largeStats.medianMs / Math.max(smallStats.medianMs, 0.001)
  };
};

describe("statementReconciler performance regression guard", () => {
  for (const kind of ["attribute", "rename"] as const) {
    it(`${kind}: keeps 250→1000-element reconciliation linear in worker CPU time`, () => {
      const measurement = measureScaling(kind);
      console.log(
        `[statementReconciler perf] ${kind}: ` +
          `250 median=${measurement.small.medianMs.toFixed(3)}ms p95=${measurement.small.p95Ms.toFixed(3)}ms; ` +
          `1000 median=${measurement.large.medianMs.toFixed(3)}ms p95=${measurement.large.p95Ms.toFixed(3)}ms; ` +
          `ratio=${measurement.scalingRatio.toFixed(2)}x`
      );

      expect(Number.isFinite(measurement.small.medianMs)).toBe(true);
      expect(Number.isFinite(measurement.small.p95Ms)).toBe(true);
      expect(Number.isFinite(measurement.large.medianMs)).toBe(true);
      expect(Number.isFinite(measurement.large.p95Ms)).toBe(true);
      expect(measurement.large.medianMs).toBeLessThan(MAX_1000_ELEMENT_CPU_MS);
      expect(measurement.scalingRatio).toBeLessThan(MAX_250_TO_1000_SCALING_RATIO);
    }, 20_000);
  }
});
