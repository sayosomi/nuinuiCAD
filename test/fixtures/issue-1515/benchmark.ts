import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { compileCanonicalText, compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { RustEvaluationProcess } from "../../../src/node/rustEvaluationProcess";
import { buildEvaluationOptions } from "../../../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../../../src/geometry/rustEvaluationRunner";
import { evaluationPayloadToResult, type EvaluationPayload } from "../../../src/geometry/evaluationPayload";
import { calculateBenchmarkStatistics } from "../../../src/performance/benchmarkStatistics";
import { assertCompiled, assertResult, hash, manifest, sourceFor } from "../../issue1515PatternSupport";
import { probe, reset, stop, stages, filters, observeArrays } from "./probe";

const [id, label = "normal", mode = "timing", binaryArgument] = process.argv.slice(2);
const unit = manifest.units.find(u => u.id === id);
assert.ok(unit, id);
const sources = unit.checkpoints.map(sourceFor);
const binary = resolve(binaryArgument ?? "rust-evaluator/target/debug/evaluation_stdio");
const binarySha256 = hash(readFileSync(binary));
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;
const rustDurations: number[] = [];
let pendingDuration: ((ms: number) => void) | undefined;
let stderr = "";
const createdAt = performance.now();
const rust = new RustEvaluationProcess(binary, {
  reportDiagnostic: () => undefined,
  spawnProcess: ((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    spawns++;
    closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
      let newline: number;
      while ((newline = stderr.indexOf("\n")) >= 0) {
        const line = stderr.slice(0, newline); stderr = stderr.slice(newline + 1);
        const match = /^issue1515-eval-ns=(\d+)$/.exec(line);
        if (match) { const ms = Number(match[1]) / 1e6; rustDurations.push(ms); pendingDuration?.(ms); pendingDuration = undefined; }
        else if (line.trim()) throw new Error("Unexpected Rust stderr: " + line);
      }
    });
    return child;
  }) as typeof spawn
});
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { rust.dispose(); reject(new Error("#1515 benchmark request/close exceeded 15s")); }, 15000);
  })]); } finally { clearTimeout(timer); }
}
const samples: Record<string, unknown>[] = [];
const workRecords: unknown[] = [];
const instrumentedRust = Boolean(binaryArgument);
let coldStartMs: number;
try {
  // Fixture reads, binary build, baseline compilation and initial Rust request
  // are outside every edit timer. The first request records cold startup.
  const initial = compileFreshCanonicalText(sources[0]);
  const initialPrepared = prepareRustEvaluation(initial.doc.document.elements, buildEvaluationOptions({ compiledDocument: initial.doc, evaluationLimitIndex: undefined }));
  let durationPromise = instrumentedRust ? new Promise<number>(resolve => { pendingDuration = resolve; }) : undefined;
  requests++;
  await bounded(rust.request(initialPrepared.input));
  if (durationPromise) await bounded(durationPromise);
  durationPromise = undefined;
  coldStartMs = performance.now() - createdAt;
  const repeats = mode === "work" ? 1 : 26;
  for (let trial = 0; trial < repeats; trial++) {
    let current: TextCompileResult = compileFreshCanonicalText(sources[0]);
    const phases: Record<string, unknown>[] = [];
    for (let index = 1; index < unit.checkpoints.length; index++) {
      const cp = unit.checkpoints[index], previous = current;
      reset(mode === "work");
      const cpu = process.cpuUsage(), start = performance.now();
      const compile = () => probe("canonicalCompile", () => compileCanonicalText(previous, sources[index]));
      current = mode === "work" ? observeArrays(compile) : compile();
      let payload: EvaluationPayload | undefined;
      let ready: ReturnType<typeof evaluationPayloadToResult> | undefined;
      let requestMs = 0, rustMs: number | undefined;
      let preparedInput: unknown;
      if (!cp.invalid) {
        const lower = () => {
          const options = probe("contextLowering", () => buildEvaluationOptions({ compiledDocument: current.doc, evaluationLimitIndex: undefined }));
          return probe("requestLowering", () => prepareRustEvaluation(current.doc.document.elements, options));
        };
        const prepared = mode === "work" ? observeArrays(lower) : lower();
        assert.equal(prepared.rustEligible, true);
        preparedInput = prepared.input;
        durationPromise = instrumentedRust ? new Promise<number>(resolve => { pendingDuration = resolve; }) : undefined;
        const requestStart = performance.now();
        requests++;
        payload = await bounded(rust.request(prepared.input)) as EvaluationPayload;
        requestMs = performance.now() - requestStart;
        ready = probe("responseConversion", () => evaluationPayloadToResult(payload!));
      }
      const totalMs = performance.now() - start, used = process.cpuUsage(cpu);
      const stageRecord = structuredClone(stages);
      const filterRecord = [...filters];
      stop();
      const payloadBytes = preparedInput ? Buffer.byteLength(JSON.stringify(preparedInput)) : 0;
      if (durationPromise) { rustMs = await bounded(durationPromise); durationPromise = undefined; }
      const fresh = compileFreshCanonicalText(sources[index]);
      assertCompiled(current, fresh, cp, unit, previous);
      const evidence = ready ? assertResult(current, ready, cp, unit) : { diagnosticCodes: current.diagnostics.map(d => d.code), lastGoodRevision: current.doc.statementMap.sourceRevision };
      const record = { index, file: cp.file, invalid: cp.invalid, sourceRevision: current.currentCompiled.spans.sourceMap.sourceRevision,
        totalMs, nodeCpuMs: (used.user + used.system) / 1000, requestMs, rustMs, stages: stageRecord,
        statements: current.currentCompiled.statements.length, runtimeEntries: current.doc.document.elements.length,
        graphEdges: current.typedDependencyGraph?.edges.length ?? 0, payloadBytes, ...evidence };
      phases.push(record);
      if (mode === "work") workRecords.push({ ...record, filters: filterRecord });
    }
    samples.push({ trial, warmup: trial < 5, phases });
  }
} finally { rust.dispose(); if (closed) await bounded(closed); }
assert.equal(spawns, 1);
const metrics: Record<string, number[]> = {};
for (const sample of samples.filter(s => !s.warmup)) {
  for (const phase of sample.phases as Record<string, unknown>[]) {
    const prefix = `revision${phase.index}.`;
    for (const key of ["totalMs", "nodeCpuMs", "requestMs", "rustMs"]) if (typeof phase[key] === "number") (metrics[prefix + key] ??= []).push(phase[key] as number);
    for (const [name, stage] of Object.entries(phase.stages as Record<string, { wallMs: number; cpuMs: number }>)) {
      (metrics[prefix + name + ".wallMs"] ??= []).push(stage.wallMs);
      (metrics[prefix + name + ".cpuMs"] ??= []).push(stage.cpuMs);
    }
  }
}
const output = { id, label, mode, sourceHashes: unit.checkpoints.map(c => c.sha256), oracleSeal: JSON.parse(readFileSync("test/fixtures/issue-1515/seal-v2.json", "utf8")),
  node: process.version, platform: process.platform, architecture: process.arch, binary, binarySha256,
  spawns, requests, coldStartIncludingBaselineCompilationMs: coldStartMs,
  warmups: mode === "work" ? 0 : 5, trials: mode === "work" ? 1 : 21,
  samples, workRecords, rustDurations, statistics: Object.fromEntries(Object.entries(metrics).map(([k, values]) => [k, calculateBenchmarkStatistics(values)])) };
const directory = process.env.ISSUE1515_MEASUREMENT_DIR ?? "test/fixtures/issue-1515/measurements-v2";
mkdirSync(directory, { recursive: true });
writeFileSync(`${directory}/${label}-${id}.json.gz`, gzipSync(JSON.stringify(output) + "\n"));
console.log(JSON.stringify({ id, label, mode, spawns, requests, summary: Object.fromEntries(Object.entries(output.statistics).map(([k,v]) => [k, { p50: v.p50, p95: v.p95, max: v.max }])) }));
