import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import manifest from "./fixtures/issue1415/manifest.json";
import { checkCompiler, checkValues } from "./fixtures/issue1415/assertions";
import { configuration, makePair, oracle, replaySeed, slotFor, type Program } from "./fixtures/issue1415/model";

const selected = process.env.ISSUE1415_IDS?.split(",");
const evidence = process.env.ISSUE1415_EVIDENCE;
const replayPath = process.env.ISSUE1415_PATH;
if (selected?.some(id => !manifest.includes(id))) throw new Error("unknown Stage-1 replay ID");
if (replayPath && selected?.length !== 1) throw new Error("native shrink replay requires exactly one ISSUE1415_IDS ID");

describe("Issue #1415 deterministic scalar metamorphic Stage 1", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed: Promise<void> | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  let disposing = false;
  let closeError: Error | undefined;
  const accepted = new Set<string>();
  const dispositions: { id: string; status: string; seed: number; path?: string; shrinks?: number }[] = [];
  const counts = { compiler: 0, reference: 0, production: 0 };
  const started = Date.now();
  // One empty canonical setup; exploratory compile counts below count source
  // submissions, not this fixed existing empty-document initialization.
  const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
  beforeAll(() => {
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      try {
        for (const hash of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (hash) accepted.add(hash);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
    rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args) as ChildProcessWithoutNullStreams;
        // Install completion/error listeners BEFORE any request or teardown.
        closed = new Promise(resolve => {
          child!.once("close", (code, signal) => {
            if (!disposing && (code !== 0 || signal)) closeError = new Error(`unexpected Rust close ${code}/${signal}`);
            resolve();
          });
          child!.once("error", error => { closeError = error; });
        });
        child.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (!disposing || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) closeError = error;
        });
        return child;
      }) as typeof spawn
    });
    // A process safety timeout, independent of request counts or exploration capacity.
    watchdog = setTimeout(() => { closeError = new Error("Stage-1 Rust process lifetime exceeded 10 minutes"); rust.dispose(); }, 600_000);
  }, 130_000);
  afterAll(async () => {
    clearTimeout(watchdog);
    disposing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000);
    });
    try {
      rust?.dispose();
      if (closed) await Promise.race([closed, stopped]);
    } finally {
      clearTimeout(timer);
      const report = { counts, uniqueAccepted: accepted.size, elapsedMs: Date.now() - started, dispositions };
      if (evidence) appendFileSync(join(evidence, "runs.ndjson"), JSON.stringify(report) + "\n");
      console.info(`Stage-1 metrics ${JSON.stringify(report)}`);
    }
    if (closeError) throw closeError;
  }, 10_000);

  it("retains the complete pre-execution 256-ID manifest", () => {
    const expected = ["R", "M"].flatMap(suite => [1, 2].flatMap(shape => [..."abcd"].flatMap(op =>
      Array.from({ length: 16 }, (_, seed) => `${suite}${shape}-${op}-${String(seed).padStart(2, "0")}`))));
    expect(manifest).toEqual(expected);
    expect(new Set(manifest).size).toBe(256);
  });

  const evaluate = async (program: Program) => {
    const hash = createHash("sha256").update(program.source).digest("hex");
    if (!accepted.has(hash) && accepted.size >= 640) throw new Error("exploration capacity exhausted; preserve incomplete IDs");
    counts.compiler++;
    const compiled = compileCanonicalText(initial, program.source);
    const errors = compiled.diagnostics.filter(d => d.severity === "error");
    if (compiled.status === "valid" && !errors.length && !accepted.has(hash)) {
      accepted.add(hash);
      if (evidence) appendFileSync(join(evidence, "accepted.sha256"), hash + "\n");
    }
    expect(errors, program.source).toEqual([]);
    expect(compiled.status, program.source).toBe("valid");
    const fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
    const options = optionsFor(fixture);
    const prepared = prepareRustEvaluation(fixture.elements, options);
    expect(prepared.rustEligible).toBe(true);
    const identities = checkCompiler(program, compiled, prepared.input);
    counts.reference++;
    const reference = evaluateElementsReferencePayload(fixture.elements, options);
    checkValues(program, identities, reference);
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const production = await Promise.race([
      rust.request(prepared.input),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("persistent Rust request timeout")); }, 10_000); })
    ]).finally(() => clearTimeout(timer)) as EvaluationPayload;
    return checkValues(program, identities, production);
  };

  // One bounded pair per test; one persistent production child for the run.
  for (const id of manifest.filter(id => !selected || selected.includes(id))) it(id, async () => {
    const slot = slotFor(id), seed = replaySeed(slot);
    const result = await fc.check(fc.asyncProperty(configuration, async config => {
      const [original, transformed] = makePair(slot, config);
      expect(original.source).not.toBe(transformed.source);
      expect(original.observations.map(name => oracle(original).get(name))).toEqual(transformed.observations.map(name => oracle(transformed).get(name)));
      expect(await evaluate(original)).toEqual(await evaluate(transformed));
    }), { seed, numRuns: 1, ...(replayPath ? { path: replayPath } : {}), interruptAfterTimeLimit: 25_000, markInterruptAsFailure: true });
    dispositions.push({ id, status: result.failed ? "unresolved" : "PASS", seed, ...(result.failed ? { path: result.counterexamplePath, shrinks: result.numShrinks } : {}) });
    if (result.failed) throw new Error(`${id}: native fast-check replay seed=${seed} path=${result.counterexamplePath}; shrinks=${result.numShrinks}; model=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`, { cause: result.errorInstance });
  }, 30_000);
});
