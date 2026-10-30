// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { assertCompiled, assertResult, hash, manifest, runtimeOwners, sourceFor } from "./issue1515PatternSupport";
import assert from "node:assert/strict";

let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0;
let binaryEvidence: { path: string; sha256: string } | undefined;
const observations: unknown[] = [];
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1515 request/close exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  const binary = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug/evaluation_stdio");
  binaryEvidence = { path: binary, sha256: hash(readFileSync(binary)) };
  rust = new RustEvaluationProcess(binary, { spawnProcess: ((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    spawns++;
    closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
    return child;
  }) as typeof spawn });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1515_RECORD) writeFileSync(process.env.ISSUE1515_RECORD, JSON.stringify({ spawns, binaryEvidence, observations }, null, 2) + "\n");
  assert.equal(spawns, 1);
});
describe("#1515 frozen pattern source revisions × persistent production Rust", () => {
  it.each(manifest.units)("$id incremental/fresh and independent analytic geometry", async unit => {
    let current: TextCompileResult | undefined;
    for (const cp of unit.checkpoints) {
      const previous = current;
      current = previous ? compileCanonicalText(previous, sourceFor(cp)) : compileFreshCanonicalText(sourceFor(cp));
      const fresh = compileFreshCanonicalText(sourceFor(cp));
      assertCompiled(current, fresh, cp, unit, previous);
      if (cp.invalid) {
        observations.push({ unit: unit.id, file: cp.file, status: "EXPECTED_FATAL_LAST_GOOD_DISTINCT", diagnostics: current.diagnostics });
        continue;
      }
      for (const [mode, c] of [["incremental", current], ["fresh", fresh]] as const) {
        const options = buildEvaluationOptions({ compiledDocument: c.doc, evaluationLimitIndex: undefined });
        const prepared = prepareRustEvaluation(c.doc.document.elements, options);
        assert.equal(prepared.rustEligible, true);
        const payload = await bounded(rust.request(prepared.input)) as EvaluationPayload;
        // Preserve the actual production evidence before an oracle can throw.
        observations.push({ unit: unit.id, file: cp.file, mode, sourceSha256: cp.sha256,
          sourceRevision: c.currentCompiled.spans.sourceMap.sourceRevision,
          compiledSourceRevision: c.doc.statementMap.sourceRevision,
          owners: [...runtimeOwners(c)], input: prepared.input, payload });
        const evidence = assertResult(c, evaluationPayloadToResult(payload), cp, unit);
        assertResult(c, evaluationPayloadToResult(evaluateElementsReferencePayload(c.doc.document.elements, options)), cp, unit);
        observations.push({ unit: unit.id, file: cp.file, mode, disposition: "PASS", ...evidence });
      }
    }
  }, 120000);
});
