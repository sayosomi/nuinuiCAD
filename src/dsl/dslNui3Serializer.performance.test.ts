import { describe, expect, it } from "vitest";
import { applyLineSplices } from "../document/textPatch";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "./dslDocumentTestUtils";
import { buildNui3StatementPatch, serializeNui3Document } from "./dslNui3Serializer";

const WARM_UP_RUNS = 30;
const TRIALS = 11;
const RUNS_PER_TRIAL = 5;

type CpuUsage = { user: number; system: number };
const nodeProcess = (globalThis as unknown as { process: { cpuUsage: (previous?: CpuUsage) => CpuUsage } }).process;
const cpuUsage = nodeProcess.cpuUsage.bind(nodeProcess);

const sourceFor = (statementCount: number) => {
  const lines = ["nui 3"];
  for (let index = 0; lines.length - 1 < statementCount; index += 1) {
    lines.push(`let   value${index} : number = ${index}`);
    if (lines.length - 1 >= statementCount) break;
    lines.push(`set   value${index} = ${index} + 1`);
    if (lines.length - 1 >= statementCount) break;
    lines.push(`point P${index} = coordinate(x: ${index}, y: 0, state: hidden)`);
  }
  return lines.join("\n");
};

const currentFor = (statementCount: number) => {
  const base = regenerateCanonicalFromModel(emptyDocument(), 3);
  const current = compileCanonicalText(base, sourceFor(statementCount));
  if (current.status === "fatal") throw new Error("failed to prepare serializer performance fixture");
  return current;
};

const median = (samples: readonly number[]) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)];
const p95 = (samples: readonly number[]) => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

const measure = (run: () => void) => {
  for (let index = 0; index < WARM_UP_RUNS; index += 1) run();
  const samples: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = cpuUsage();
    for (let runIndex = 0; runIndex < RUNS_PER_TRIAL; runIndex += 1) run();
    const elapsed = cpuUsage(started);
    samples.push((elapsed.user + elapsed.system) / 1_000 / RUNS_PER_TRIAL);
  }
  return { medianMs: median(samples), p95Ms: p95(samples) };
};

describe("nui 3 serializer performance record", () => {
  it("records separate 1000-statement full serialization and one-statement patch costs", () => {
    const current = currentFor(1_000);
    const target = current.doc.statementMap.statements.find((info) => info.kind === "set");
    if (!target) throw new Error("missing set target");
    const statementId = current.doc.statementMap.statementIdByStatementIndex?.get(target.statementIndex);
    if (!statementId) throw new Error("missing set identity");

    const full = measure(() => {
      const result = serializeNui3Document(current);
      if (result.status !== "serialized") throw new Error(result.reason);
    });
    const patch = measure(() => {
      const result = buildNui3StatementPatch(current, statementId);
      if (result.status !== "ready") throw new Error(result.reason);
      applyLineSplices(current.sourceText, result.splices);
    });

    console.log(
      `[nui3 serializer perf] 1000 statements: full median=${full.medianMs.toFixed(3)}ms p95=${full.p95Ms.toFixed(3)}ms; ` +
      `one-patch median=${patch.medianMs.toFixed(3)}ms p95=${patch.p95Ms.toFixed(3)}ms`
    );
    expect(Number.isFinite(full.medianMs)).toBe(true);
    expect(Number.isFinite(full.p95Ms)).toBe(true);
    expect(Number.isFinite(patch.medianMs)).toBe(true);
    expect(Number.isFinite(patch.p95Ms)).toBe(true);
  }, 30_000);
});
