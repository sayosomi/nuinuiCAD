import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { compileCanonicalText, type CanonicalDocumentValue } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { actualValues, checkValues, compile, hash, initial, loadCheckpoint, manifest, metrics, type Oracle } from "./issue1474DependencyTopologySupport";

type Case = { id: string; source: string; previous: CanonicalDocumentValue; oracle?: Oracle };
type Stage = { wallMs: number; workerCpuMs: number };
const records: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let pid: number | undefined;
let spawns = 0, requests = 0, peakRustRssKiB = 0;
let setupWallMs = 0;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust.dispose(); reject(new Error("#1474 timing request/close deadline 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}

function sampleChild() {
  const row = execFileSync("ps", ["-p", String(pid), "-o", "time=", "-o", "rss="], { encoding: "utf8", timeout: 1000 }).trim().split(/\s+/);
  const time = row[0].split(":").map(Number);
  const cpuSeconds = time.reduce((total, part) => total * 60 + part, 0);
  const rssKiB = Number(row[1]);
  peakRustRssKiB = Math.max(peakRustRssKiB, rssKiB);
  assert.ok(rssKiB < 2 * 1024 * 1024, "owned Rust RSS must remain bounded");
  return { cpuSeconds, rssKiB };
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)! };
}

function measure<T>(run: () => T): [T, Stage] {
  const cpu = process.cpuUsage(), wall = performance.now();
  const value = run();
  const wallMs = performance.now() - wall, used = process.cpuUsage(cpu);
  return [value, { wallMs, workerCpuMs: (used.user + used.system) / 1000 }];
}

function caseFor(id: string, revision = 0): Case {
  const unit = manifest.units.find(u => u.id === id)!;
  let previous = initial();
  for (const checkpoint of unit.checkpoints.slice(0, revision)) previous = compile(loadCheckpoint(checkpoint).source, previous);
  const { source, oracle } = loadCheckpoint(unit.checkpoints[revision]);
  return { id: `${id}-r${revision + 1}`, source, oracle, previous };
}

function controlFor(name: string): Case {
  return { id: name, source: readFileSync(`performance/fixtures/${name}.nui`, "utf8"), previous: initial() };
}

async function runCase(testCase: Case) {
  const [compiled, compileStage] = measure(() => compileCanonicalText(testCase.previous, testCase.source));
  assert.notEqual(compiled.status, "fatal", testCase.id + JSON.stringify(compiled.diagnostics));
  assert.deepEqual([...compiled.diagnostics, ...compiled.bindingIssueDiagnostics], []);
  const [prepared, lowering] = measure(() => prepareRustEvaluation(compiled.doc.document.elements,
    buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined })));
  assert.equal(prepared.rustEligible, true, "normal production Rust eligibility");
  const [encoded, encodingProbe] = measure(() => JSON.stringify(prepared.input));
  const cpu = process.cpuUsage(), wall = performance.now();
  requests++;
  const payload = await bounded(rust.request(prepared.input)) as EvaluationPayload;
  const requestWall = performance.now() - wall, requestCpu = process.cpuUsage(cpu);
  const [result, decode] = measure(() => evaluationPayloadToResult(payload));
  if (testCase.oracle) checkValues(actualValues(compiled, result), testCase.oracle);
  else assert.deepEqual(result.errors, [], testCase.id);
  return {
    compile: compileStage, lowering, encodingProbe,
    rustTransport: { wallMs: requestWall, workerCpuMs: (requestCpu.user + requestCpu.system) / 1000 }, decode,
    graph: metrics(compiled), sourceBytes: Buffer.byteLength(testCase.source), payloadBytes: Buffer.byteLength(encoded),
    computedGeometryCount: result.computedGeometry.size, scalarOutputCount: result.computedScalarBindings?.size ?? 0,
    generatedRowCount: result.forGroupGeneratedRows?.length ?? 0,
    sourceRevision: compiled.doc.statementMap.sourceRevision, sourceHash: hash(testCase.source),
    predecessorHash: hash(testCase.previous.sourceText)
  };
}

beforeAll(async () => {
  const start = performance.now();
  if (!process.env.ISSUE1474_BINARY) execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess(process.env.ISSUE1474_BINARY ?? "rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args); pid = child.pid;
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
  console.log(`#1474 timing owned pid=${pid}`);
  setupWallMs = performance.now() - start;
  records.push({ label: "cold first source/request (excluded from steady state)", observation: await runCase(caseFor("A1")) });
}, 125000);

afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1474_TIMING_RECORD) writeFileSync(process.env.ISSUE1474_TIMING_RECORD, JSON.stringify({
    protocol: "five warmups / 21 alternating paired trials; encoding probe is additional, transport includes actual encoding/JSON decode",
    originalBase: manifest.base, setupWallMs, spawns, requests, pid, peakRustRssKiB,
    workerResourceUsage: process.resourceUsage(), records
  }, null, 2) + "\n");
  assert.equal(spawns, 1);
});

const frozenPairs = ["A1:A2", "A2:A3", "B1:B2", "B2:B3", "C1:C2", "C2:C3", "D1:D2", "D2:D3", "A3:B3", "B3:C3", "C3:D3", "A4:edit", "B4:edit", "C4:edit", "D4:edit", "chain250:chain1000", "B3:broad", "D3:chain1000"];

const selectedPairs = process.env.ISSUE1474_TIMING_PAIRS?.split(",") ?? frozenPairs;
assert.ok(selectedPairs.every(pair => frozenPairs.includes(pair)), "only frozen timing pairs");
const blocks = Number(process.env.ISSUE1474_TIMING_BLOCKS ?? 1);
assert.ok(Number.isInteger(blocks) && blocks >= 1 && blocks <= 3);

describe("#1474 opt-in frozen paired stage timing (no machine-time CI threshold)", () => {
  for (let block = 1; block <= blocks; block++) for (const pair of selectedPairs) {
    let cases: Case[];
    let before: ReturnType<typeof sampleChild>;
    const samples: Awaited<ReturnType<typeof runCase>>[][] = [[], []];
    describe(`${pair} block ${block}`, () => {
      it("five warmups per case", async () => {
        const [left, right] = pair.split(":");
        cases = right === "edit" ? [caseFor(left), caseFor(left, 1)]
          : pair === "chain250:chain1000" ? [controlFor("dependency-chain-250-v1"), controlFor("dependency-chain-1000-v1")]
          : right === "broad" ? [caseFor(left), controlFor("interactive-large-v2")]
          : right === "chain1000" ? [caseFor(left), controlFor("dependency-chain-1000-v1")]
          : [caseFor(left), caseFor(right)];
        for (let i = 0; i < 5; i++) for (const testCase of cases) await runCase(testCase);
        before = sampleChild();
      }, 120000);
      // The protocol still has 21 consecutive alternating paired trials.
      // Test boundaries merely bound batches; each source request stays at 15s.
      for (let chunk = 0; chunk < 7; chunk++) it(`paired trials ${chunk * 3 + 1}-${chunk * 3 + 3}`, async () => {
        for (let trial = chunk * 3; trial < chunk * 3 + 3; trial++) {
          for (const index of trial % 2 === 0 ? [0, 1] : [1, 0]) samples[index].push(await runCase(cases[index]));
          sampleChild();
        }
        console.log(`#1474 timing progress ${pair} block=${block} trials=${samples[0].length}/21`);
        if (chunk !== 6) return;
        const after = sampleChild();
        const summaries = samples.map((values, index) => ({
          id: cases[index].id, ...values[0],
          stageStats: Object.fromEntries((["compile", "lowering", "encodingProbe", "rustTransport", "decode"] as const)
            .map(stage => [stage, { wallMs: stats(values.map(v => v[stage].wallMs)), workerCpuMs: stats(values.map(v => v[stage].workerCpuMs)) }]))
        }));
        records.push({ pair, block, warmups: 5, trials: 21, alternating: true, summaries, samples,
          child: { before, after, batchCpuSeconds: after.cpuSeconds - before.cpuSeconds, cpuResolutionSeconds: .01 } });
        console.log(`#1474 timing ${pair} block=${block} ${JSON.stringify(summaries.map(v => ({ id: v.id, graph: v.graph, stageStats: v.stageStats })))}`);
      }, 120000);
    });
  }
});
