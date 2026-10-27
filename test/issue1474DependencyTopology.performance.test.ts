import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluatePreparedRust, prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { actualValues, checkValues, compile, hash, initial, loadCheckpoint, manifest, metrics, sensitivity } from "./issue1474DependencyTopologySupport";
import graphSeal from "./fixtures/issue-1474/compiled-graph-seal.json";
import compilerReducerSource from "./fixtures/issue-1474/continuation-2/R3-source.json";
import reducers from "./fixtures/issue-1474/continuation-2/reducers.json";

// Opt-in campaign: the staged corrected C3 safety gate must pass before a full
// replay. Historical unsafe Base binaries must never be selected here.
// This file is excluded by the repository's existing performance-suite policy.
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;
let childPid: number | undefined;
let peakRustRssKiB = 0;
let monitor: ReturnType<typeof setInterval> | undefined;
let resourceFailure: Error | undefined;

async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust.dispose(); reject(new Error("#1474 request/close deadline 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}

beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      childPid = child.pid;
      closed = new Promise<void>(resolve => {
        child.once("close", () => resolve()); child.once("error", () => resolve());
      });
      return child;
    }) as typeof spawn
  });
  monitor = setInterval(() => {
    if (!childPid) return;
    try {
      const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(childPid)], { encoding: "utf8", timeout: 1000 }).trim());
      peakRustRssKiB = Math.max(peakRustRssKiB, rss);
      if (rss > 2 * 1024 * 1024) { resourceFailure = new Error("#1474 Rust RSS exceeded 2GiB"); rust.dispose(); }
    } catch { /* A closed child has no ps row; close is awaited separately. */ }
  }, 500);
}, 125000);

afterAll(async () => {
  clearInterval(monitor);
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1474_RECORD) writeFileSync(process.env.ISSUE1474_RECORD, JSON.stringify({
    base: manifest.base, spawns, requests, childPid, peakRustRssKiB, workerResourceUsage: process.resourceUsage(), observations
  }, null, 2) + "\n");
  assert.equal(spawns, 1);
  if (resourceFailure) throw resourceFailure;
});

describe("#1474 sealed dependency topology through production persistent Rust", () => {
  it.each([...manifest.units, ...reducers.units])("$id independent integer/geometry oracle and source transitions", async unit => {
    let current = initial();
    let previousValues: ReturnType<typeof actualValues> | undefined;
    let previousOracle: ReturnType<typeof loadCheckpoint>["oracle"] | undefined;
    let previousIds: Map<string, string> | undefined;
    for (const checkpoint of unit.checkpoints) {
      const { source, oracle } = loadCheckpoint(checkpoint);
      if (unit.id === "R3") {
        assert.equal(source, compilerReducerSource.source);
        assert.equal(hash(source), compilerReducerSource.sourceSha256);
      }
      assert.equal(current.doc.statementMap.sourceRevision, checkpoint.sourceRevisionBefore);
      const compiled = compile(source, current);
      current = compiled;
      assert.equal(compiled.doc.statementMap.sourceRevision, checkpoint.sourceRevisionAfter);
      const graph = metrics(compiled);
      const sealed = [...graphSeal, ...reducers.graphSeal].find(row => row.file === checkpoint.file)!;
      for (const [key, value] of Object.entries(graph)) assert.equal(value, sealed[key as keyof typeof graph]);
      const options = buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined });
      const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
      assert.equal(prepared.rustEligible, true, "normal production eligibility");
      const result = await evaluatePreparedRust(prepared, async input => {
        requests++;
        return await bounded(rust.request(input)) as EvaluationPayload;
      });
      const values = actualValues(compiled, result);
      checkValues(values, oracle);
      sensitivity(values, oracle);
      const reference = actualValues(compiled, evaluationPayloadToResult(evaluateElementsReferencePayload(compiled.doc.document.elements, options)));
      checkValues(reference, oracle);
      sensitivity(reference, oracle);
      // Verify all and only analytically changed declarations, including reachable
      // declarations with invariant endpoints and disjoint sibling controls.
      const changed = (a: typeof values, b: typeof values) => Object.keys({ ...a.scalars, ...a.geometry })
        .filter(name => JSON.stringify(a.scalars[name] ?? a.geometry[name]) !== JSON.stringify(b.scalars[name] ?? b.geometry[name])).sort();
      if (previousValues && previousOracle) {
        assert.deepEqual(changed(previousValues, values), changed(previousOracle, oracle));
        if (changed(previousOracle, oracle).length) assert.throws(() => checkValues(values, previousOracle!), assert.AssertionError);
      }
      const ids = new Map(compiled.doc.document.elements.map(e => [e.name, e.id]));
      if (previousIds && unit.id !== "C4") assert.deepEqual(ids, previousIds);
      observations.push({ unit: unit.id, file: checkpoint.file, sha256: checkpoint.sha256,
        sourceRevision: compiled.doc.statementMap.sourceRevision, graph,
        payloadBytes: Buffer.byteLength(JSON.stringify(prepared.input)),
        scalarCount: Object.keys(values.scalars).length, geometryCount: Object.keys(values.geometry).length,
        outputSha256: hash(JSON.stringify(values)),
        wrongResultRejected: true, staleResultRejected: previousOracle ? changed(previousOracle, oracle).length > 0 : null,
        status: "PASS" });
      previousValues = values; previousOracle = oracle; previousIds = ids;
      console.log(`#1474 ${checkpoint.file} PASS (${graph.V} nodes, ${graph.E} edges)`);
    }
  }, 120000);
});
