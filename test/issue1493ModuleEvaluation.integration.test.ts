import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import { compileModule, moduleCases, moduleFixture } from "./issue1493ModuleSupport";

let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      closed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 120_000);
afterAll(async () => { rust?.dispose(); await closed; });

describe("#1493 authored module geometry in TS and persistent production Rust", () => {
  for (const c of moduleCases) it(`${c.shape}-${c.count}`, async () => {
    const f = moduleFixture(c.shape, c.count);
    const doc = compileModule(f);
    const options = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: undefined });
    const prepared = prepareRustEvaluation(doc.document.elements, options);
    assert.equal(prepared.rustEligible, true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = await Promise.race([
        rust.request(prepared.input) as Promise<EvaluationPayload>,
        new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("#1493 Rust request exceeded 15 seconds")); }, 15_000); })
      ]);
      const reference = evaluateElementsReferencePayload(doc.document.elements, options);
      for (const p of [reference, payload]) {
        const result = evaluationPayloadToResult(p);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.geometryValueErrors ?? [], []);
        for (const entry of f.entries.filter(e => e.geometry)) {
          const actual = result.computedGeometry.get(entry.id);
          assert.ok(actual, entry.id);
          // Production points/lines may carry additional derived metadata.
          expect(actual).toMatchObject(entry.geometry!);
        }
        for (const snapshot of f.snapshots) {
          const actual = result.instanceBaseGeometry?.get(snapshot.instanceId);
          assert.ok(actual, snapshot.instanceId);
          assert.deepEqual(actual, snapshot.descendantIds.map(id => result.computedGeometry.get(id)));
        }
      }
    } finally { clearTimeout(timer); }
  }, 120_000);
});
