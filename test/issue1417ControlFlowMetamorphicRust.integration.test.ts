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
import { optionsFor, runtimeDiagnosticsFor } from "./evaluationParitySupport";
import manifest from "./fixtures/issue1417/manifest.json";
import rejected from "./fixtures/issue1417/generator-rejections.json";
import { checkCompiler, checkValues, checkError } from "./fixtures/issue1417/assertions";
import { configuration, emit, iterationCount, jsonValue, makePair, oracle, ref, replaySeed, selectedErrorControl, slotFor, ModelRuntimeError, type Program } from "./fixtures/issue1417/model";

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
type PairEvidence = { sourceA: string; sourceB: string; expected: string; trace: string };

const selected = process.env.ISSUE1417_IDS?.split(",");
const evidence = process.env.ISSUE1417_EVIDENCE;
const replayPath = process.env.ISSUE1417_PATH;
if (selected?.some(id => !manifest.includes(id))) throw new Error("unknown Stage-2 replay ID");
if (replayPath && selected?.length !== 1) throw new Error("native shrink replay requires exactly one ISSUE1417_IDS ID");

describe("Issue #1417 deterministic control-flow metamorphic Stage 2", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed: Promise<void> | undefined;
  let watchdog: ReturnType<typeof setTimeout>;
  let disposing = false;
  let closeError: Error | undefined;
  let resourceError: Error | undefined;
  const accepted = new Set<string>();
  const dispositions: ({ id: string; status: string; seed: number; path?: string | null; shrinks?: number } & Partial<PairEvidence>)[] = [];
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
            if (!disposing) closeError = new Error(`unexpected Rust close ${code}/${signal}`);
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
    watchdog = setTimeout(() => { resourceError = new Error("Stage-2 Rust process lifetime exceeded 10 minutes"); rust.dispose(); }, 600_000);
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
      console.info(`Stage-2 metrics ${JSON.stringify({ counts, uniqueAccepted: accepted.size, elapsedMs: report.elapsedMs, pairs: dispositions.length, passed: dispositions.filter(d => d.status === "PASS").length })}`);
    }
    if (closeError) throw closeError;
    if (resourceError) throw resourceError;
  }, 10_000);

  it("retains the complete pre-execution 512-ID manifest", () => {
    const expected = [..."CVSX"].flatMap(suite => [1, 2].flatMap(shape => [..."abcd"].flatMap(op =>
      Array.from({ length: 16 }, (_, seed) => `${suite}${shape}-${op}-${String(seed).padStart(2, "0")}`))));
    expect(manifest).toEqual(expected);
    expect(new Set(manifest).size).toBe(512);
    const ledger = readFileSync(join(process.cwd(), "test/fixtures/issue1417/coverage.tsv"), "utf8").trim().split("\n").slice(1).map(row => row.split("\t"));
    expect(ledger.map(row => row[0])).toEqual(manifest);
    expect(ledger.every(row => row[1] === "PARTIAL" && row.slice(2).every(Boolean))).toBe(true);
    for (const suite of "CVSX") for (const shape of [1, 2]) for (const operation of "abcd") {
      const sources = manifest.filter(id => id.startsWith(`${suite}${shape}-${operation}-`)).map(id => {
        const slot = slotFor(id), config = fc.sample(configuration, { seed: replaySeed(slot), numRuns: 1 })[0];
        return makePair(slot, config)[0].source;
      });
      expect(new Set(sources).size, `distinct seed configurations ${suite}${shape}-${operation}`).toBe(16);
    }
  });

  const evaluate = async (program: Program, errorBinding?: string) => {
    // Infrastructure failures stop new exploration, including native shrinking.
    if (resourceError || closeError) throw resourceError ?? closeError;
    const hash = hashText(program.source);
    if (!accepted.has(hash) && accepted.size >= 1400) throw new Error("exploration capacity exhausted; preserve incomplete IDs");
    counts.compiler++;
    const compiled = compileCanonicalText(initial, program.source);
    const errors = compiled.diagnostics.filter(d => d.severity === "error");
    if (compiled.status === "valid" && !errors.length && !accepted.has(hash)) {
      accepted.add(hash);
      if (evidence) appendFileSync(join(evidence, "accepted.sha256"), hash + "\n");
    }
    if (evidence) appendFileSync(join(evidence, "attempts.ndjson"), JSON.stringify({ hash, source: program.source, status: compiled.status, diagnostics: compiled.diagnostics }) + "\n");
    expect(compiled.diagnostics, program.source).toEqual([]);
    expect(compiled.status, program.source).toBe("valid");
    const fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
    const options = optionsFor(fixture);
    const prepared = prepareRustEvaluation(fixture.elements, options);
    expect(prepared.rustEligible).toBe(true);
    const identities = checkCompiler(program, compiled, prepared.input);
    const checkDiagnostics = (payload: EvaluationPayload) => {
      const diagnostics = runtimeDiagnosticsFor(fixture, payload);
      if (!errorBinding) expect(diagnostics).toEqual([]);
      else {
        const bindingId = identities.identities.get(errorBinding)!;
        const binding = compiled.doc.bindingAnalysis!.catalog.bindingsById.get(bindingId)!;
        expect(diagnostics).toContainEqual(expect.objectContaining({
          code: "evaluation-divide-by-zero", bindingId,
          line: compiled.doc.statements[binding.statementIndex].line,
          navigationTarget: { kind: "binding", bindingId }
        }));
        expect(diagnostics.every(d => d.code === "evaluation-divide-by-zero")).toBe(true);
      }
    };
    counts.reference++;
    const reference = evaluateElementsReferencePayload(fixture.elements, options);
    if (errorBinding) checkError(program, identities, reference, errorBinding);
    else checkValues(program, identities, reference);
    checkDiagnostics(reference);
    counts.production++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const production = await Promise.race([
      rust.request(prepared.input),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { resourceError = new Error("persistent Rust request timeout"); rust.dispose(); reject(resourceError); }, 10_000); })
    ]).catch(error => { resourceError = error; throw error; }).finally(() => clearTimeout(timer)) as EvaluationPayload;
    checkDiagnostics(production);
    if (errorBinding) { checkError(program, identities, production, errorBinding); return []; }
    return checkValues(program, identities, production);
  };

  it("anchors simultaneous snapshots to independently hand-calculated transitions", async () => {
    const program = emit({
      roots: [{ name: "p", type: "number", expression: 3 }, { name: "q", type: "number", expression: 11 }, { name: "items", type: "number[]", expression: { kind: "array", members: [2, 5] } }],
      loop: { binder: "tick", source: { collection: "items" }, carries: [
        { name: "total", initial: ref("p"), next: { op: "+", left: ref("otherTotal"), right: ref("tick") } },
        { name: "otherTotal", initial: ref("q"), next: { op: "-", left: ref("total"), right: ref("tick") } }
      ], body: [{ name: "incomingTotal", type: "number", expression: ref("total") }, { name: "incomingOther", type: "number", expression: ref("otherTotal") }] },
      outputs: [{ name: "result", type: "number", expression: ref("total") }, { name: "otherResult", type: "number", expression: ref("otherTotal") }], observations: ["result", "otherResult"]
    });
    expect(oracle(program).trace.map(step => [[...step.incoming.values()], [...step.next.values()]])).toEqual([
      [[3n, 11n], [13n, 1n]], [[13n, 1n], [6n, 8n]]
    ]);
    expect(await evaluate(program)).toEqual([6, 8]);
  });

  it("preserves rejected generator attempts and uses legal collection literal/reference controls", async () => {
    for (const attempt of [...rejected.attempts, ...rejected.reductions]) {
      if ("sha256" in attempt) expect(hashText(attempt.source)).toBe(attempt.sha256);
      counts.compiler++;
      const compiled = compileCanonicalText(initial, attempt.source);
      expect(compiled.status).toBe("fatal");
      expect([...new Set(compiled.diagnostics.filter(d => d.severity === "error").map(d => d.code))]).toEqual(attempt.codes);
    }
    // The collection contract explicitly permits scalar literals/references and
    // a typed empty literal. Unary minus is authored in a scalar initializer.
    for (const value of [1, -1, undefined]) {
      const program = emit({
        roots: [...(value === -1 ? [{ name: "seed", type: "number", expression: -1 }] : []), {
          name: "items", type: "number[]", expression: { kind: "array", members: value === undefined ? [] : [value === -1 ? ref("seed") : value] }
        }],
        outputs: [{ name: "length", type: "number", expression: { kind: "length", source: "items" } }, ...(value === undefined ? [] : [{
          name: "result", type: "number", expression: { kind: "index" as const, source: "items", index: 0 }
        }])], observations: value === undefined ? ["length"] : ["length", "result"]
      });
      expect(await evaluate(program)).toEqual(value === undefined ? [0] : [1, value]);
    }
  });

  // One bounded pair per test; one persistent production child for the run.
  for (const id of manifest.filter(id => !selected || selected.includes(id))) it(id, async () => {
    const slot = slotFor(id), seed = replaySeed(slot);
    let pairEvidence: PairEvidence | undefined;
    const result = await fc.check(fc.asyncProperty(configuration, async config => {
      const [original, transformed] = makePair(slot, config);
      expect(original.source).not.toBe(transformed.source);
      const a = oracle(original), b = oracle(transformed);
      expect(original.observations.map(name => a.values.get(name))).toEqual(transformed.observations.map(name => b.values.get(name)));
      expect(a.trace.map(step => [step.binder, [...step.incoming.values()], [...step.next.values()], step.branches])).toEqual(b.trace.map(step => [step.binder, [...step.incoming.values()], [...step.next.values()], step.branches]));
      if (original.loop) expect(a.trace).toHaveLength(iterationCount(slot));
      pairEvidence = {
        sourceA: hashText(original.source), sourceB: hashText(transformed.source),
        expected: hashText(JSON.stringify([...a.values].map(([name, value]) => [name, jsonValue(value)]))),
        trace: hashText(JSON.stringify(a.trace.map(step => ({ binder: jsonValue(step.binder), incoming: [...step.incoming].map(([name, value]) => [name, jsonValue(value)]), next: [...step.next].map(([name, value]) => [name, jsonValue(value)]), branches: step.branches }))))
      };
      expect(await evaluate(original)).toEqual(await evaluate(transformed));
      if (["C", "X"].includes(slot.suite) && slot.operation === "d") {
        const control = selectedErrorControl(transformed, slot);
        let failure: ModelRuntimeError | undefined;
        try { oracle(control); } catch (error) { if (!(error instanceof ModelRuntimeError)) throw error; failure = error; }
        expect(failure, "selected contrast must fail independently before evaluation").toBeDefined();
        await evaluate(control, failure!.binding);
      }
    }), { seed, numRuns: 1, ...(replayPath ? { path: replayPath } : {}), interruptAfterTimeLimit: 25_000, markInterruptAsFailure: true });
    dispositions.push({ id, status: result.failed ? "unresolved" : "PASS", seed, ...pairEvidence, ...(result.failed ? { path: result.counterexamplePath, shrinks: result.numShrinks } : {}) });
    if (result.failed) throw new Error(`${id}: native fast-check replay seed=${seed} path=${result.counterexamplePath}; shrinks=${result.numShrinks}; model=${JSON.stringify(result.counterexample)}\n${String(result.errorInstance)}`, { cause: result.errorInstance });
  }, 30_000);
});
