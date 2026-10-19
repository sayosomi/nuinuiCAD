import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import { checkCompiler, checkValues } from "./fixtures/issue1419/assertions";
import { json } from "./fixtures/issue1419/model";
import { campaign, type Candidate } from "./fixtures/issue-stage5/model";
import { independentOracle, view } from "./fixtures/issue-stage5/oracles";

const root = "test/fixtures/issue-stage5", mode = process.env.ISSUE1423_MODE ?? "verify";
const evidence = process.env.ISSUE1423_EVIDENCE;
const all = campaign(), hash = (s: string) => createHash("sha256").update(s).digest("hex");
const freezeFile = join(root, "freeze.json");
const initial = regenerateCanonicalFromModel(emptyDocument(), 1);
const owners = ["packages/nui-language/src/dsl/", "packages/nui-language/src/scalars/", "src/scalars/", "src/geometry/", "rust-evaluator/src/evaluation/"];
const productHash = () => hash(execFileSync("git", ["ls-files", "-z", "--", ...owners], { encoding: "utf8" }).split("\0").filter(Boolean).map(p => `${p}\0${readFileSync(p, "utf8")}`).join("\0"));
const frozenCandidates = () => JSON.parse(json(all.map(c => ({ ...c, sha256: hash(c.program.source), independentOracle: independentOracle(c) }))));
const counts = { compiler: 0, reference: 0, production: 0 }, accepted = new Set<string>();
const results: Record<string, unknown>[] = [];
let rust: RustEvaluationProcess, child: ChildProcessWithoutNullStreams | undefined, closed: Promise<void> | undefined;
let disposing = false, resourceError: Error | undefined, watchdog: ReturnType<typeof setTimeout>;
const compile = (c: Candidate) => {
  counts.compiler++;
  const result = compileCanonicalText(initial, c.program.source);
  if (result.status === "valid") {
    accepted.add(hash(c.program.source));
    expect(accepted.size, "global distinct accepted-source ceiling").toBeLessThanOrEqual(240);
  }
  return result;
};

beforeAll(() => {
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    const ledger = join(evidence, "accepted.sha256");
    if (existsSync(ledger)) for (const h of readFileSync(ledger, "utf8").trim().split("\n")) if (h) accepted.add(h);
  }
  if (["freeze", "prevalidate"].includes(mode)) return;
  const frozen = JSON.parse(readFileSync(freezeFile, "utf8"));
  expect(frozen.candidates, "source, oracle, method, seed and order are immutable").toEqual(frozenCandidates());
  if (["W1", "W2", "G"].includes(mode)) expect(productHash(), "equal initial product tree before any repair").toBe(frozen.productHash);
  if (mode === "W2") {
    const prediction = JSON.parse(readFileSync(join(root, "prediction.json"), "utf8"));
    expect(prediction.freezeSha256).toBe(hash(readFileSync(freezeFile, "utf8")));
    expect(prediction.commentUrl).toMatch(/^https:\/\/github.com\/sayosomi\/nuinuiCAD\/issues\/1423#issuecomment-/);
  }
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  // Same production persistent client/lifecycle as Stage 4. Listeners precede
  // writes, disposal and close; expected teardown errors are consumed.
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      child = spawn(...args) as ChildProcessWithoutNullStreams;
      closed = new Promise(resolve => {
        child!.once("close", (code, signal) => { if (!disposing) resourceError = new Error(`unexpected Rust close ${code}/${signal}`); resolve(); });
        child!.once("error", error => { resourceError = error; });
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (!disposing || !["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? "")) resourceError = error;
      });
      return child;
    }) as typeof spawn
  });
  watchdog = setTimeout(() => { resourceError = new Error("Stage 5 process exceeded 10 minutes"); rust.dispose(); }, 600_000);
}, 130_000);

afterAll(async () => {
  clearTimeout(watchdog); disposing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { if (closed) timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000); });
    rust?.dispose(); if (closed) await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(timer);
    if (evidence) {
      writeFileSync(join(evidence, "accepted.sha256"), [...accepted].sort().join("\n") + "\n");
      writeFileSync(join(evidence, `${mode}.json`), json({ mode, productHash: productHash(), counts, accepted: accepted.size, results }) + "\n");
    }
    console.info(`Stage 5 ${json({ mode, counts, accepted: accepted.size, programs: results.length, unresolved: results.filter(r => r.status !== "PASS").map(r => r.id) })}`);
  }
  if (resourceError) throw resourceError;
}, 10_000);

it("prevalidates the complete model and freezes both waves and G before evaluation", () => {
  expect(all).toHaveLength(87); expect(new Set(all.map(c => hash(c.program.source))).size).toBe(87);
  for (const c of all) expect(c.limits ? c.limits.map(l => ({ ...view(l.expected), instances: l.instances })) : view(c.program), c.id).toEqual(independentOracle(c));
  if (!["freeze", "prevalidate"].includes(mode)) return;
  const attempts = all.map(c => {
    const result = compile(c);
    return { id: c.id, sha256: hash(c.program.source), status: result.status, diagnostics: result.diagnostics };
  });
  if (evidence) appendFileSync(join(evidence, "prevalidation.ndjson"), json(attempts) + "\n");
  expect(attempts.filter(a => a.status !== "valid" || a.diagnostics.length), "compiler-only legality; no runtime oracle feedback").toEqual([]);
  if (mode === "freeze") {
    expect(existsSync(freezeFile), "never overwrite frozen evidence").toBe(false);
    writeFileSync(freezeFile, json({ issue: 1423, base: "938b30ff9319106badef883a09f7292c707d821f", frozenAt: new Date().toISOString(), productHash: productHash(), candidates: frozenCandidates() }) + "\n");
  }
});

const cases = ["freeze", "prevalidate"].includes(mode) ? [] : all.filter(c => mode === "verify" || c.wave === mode);
for (const c of cases) it(c.id, async () => {
  const failures: string[] = [], observations: Record<string, unknown>[] = [];
  const capture = (boundary: string, f: () => void) => { try { f(); } catch (e) { failures.push(`${boundary}: ${String(e)}`); } };
  const compiled = compile(c), p = c.program;
  expect(compiled.status, c.id).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
  const elements = compiled.doc.document.elements, fixture = { compiled, elements };
  const placements = c.limits ?? [{ placement: "full", through: undefined, expected: p, instances: [] }];
  for (const limit of placements) {
    const index = limit.through ? elements.findIndex(e => e.name === limit.through) + 1 : 0;
    if (limit.through) expect(index).toBeGreaterThan(0);
    const options = optionsFor({ ...fixture, evaluationLimitIndex: c.limits ? index : undefined });
    const prepared = prepareRustEvaluation(elements, options), wire = prepared.input;
    expect(prepared.rustEligible, "normal production host eligibility").toBe(true);
    capture("compiler/payload", () => {
      expect(compiled.doc.bindingAnalysis!.issues).toEqual([]); expect(compiled.doc.typedDependencyGraph!.cycles).toEqual([]);
      if (c.stratum === "C") checkCompiler(p, compiled, wire);
    });
    const check = (payload: EvaluationPayload) => {
      if (!c.limits) { checkValues(p, compiled, payload); return; }
      const r = evaluationPayloadToResult(payload), snapshots = compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots;
      const name = (id: string) => {
        const element = elements.find(e => e.id === id)!;
        const owner = snapshots.find(s => s.descendantIds.includes(id));
        return owner ? `${elements.find(e => e.id === owner.instanceId)!.name}::${element.name}` : element.name;
      };
      expect([...r.computedGeometry.keys()].map(name).sort(), "exact exports and consumers").toEqual(limit.expected.geometry.map(g => g.name).sort());
      for (const g of limit.expected.geometry) expect([...r.computedGeometry].find(([id]) => name(id) === g.name)?.[1]).toMatchObject({ kind: "point", ...g.value });
      expect(r.errors.map(e => name(e.elementId)).sort(), "atomic failure owner").toEqual([...limit.expected.errors].sort());
      expect([...(r.instanceBaseGeometry?.keys() ?? [])].map(name).sort(), "atomic instance presence").toEqual([...limit.instances].sort());
      for (const snapshot of payload.instanceBaseGeometry ?? []) expect(snapshot.geometry.map(g => name(g.elementId)).sort()).toEqual(limit.expected.geometry.filter(g => g.name.startsWith(`${name(snapshot.instanceId)}::`)).map(g => g.name).sort());
      expect(payload.geometryValueErrors ?? [], "no leaked private Module failures").toEqual([]);
    };
    counts.reference++; const reference = evaluateElementsReferencePayload(elements, options);
    capture(`TS/${limit.placement}`, () => check(reference));
    let timer: ReturnType<typeof setTimeout> | undefined;
    counts.production++;
    const actual = await Promise.race([rust.request(wire), new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("Rust request exceeded 20 seconds")); }, 20_000); })]).finally(() => clearTimeout(timer)) as EvaluationPayload;
    capture(`Rust/${limit.placement}`, () => check(actual));
    const observation: Record<string, unknown> = { placement: limit.placement, rustEligible: prepared.rustEligible, inputHash: hash(json(wire)), reference, actual };
    observations.push(observation);
    if (c.stratum === "G") {
      const owned = (wire.geometryValueProgram ?? []).filter(v => v.occurrence.instancePath.length > 0);
      capture("G/ownership", () => {
        expect(elements.filter(e => e.type === "moduleInstance")).toHaveLength(1);
        const instance = elements.find(e => e.type === "moduleInstance")!;
        expect(elements.find(e => e.id === instance.parentGroupId)?.type).toBe("forGroup");
        expect(owned.length).toBeGreaterThan(0);
        for (const entry of owned) expect(entry.lazy, "F04 first-loss owner flag").toBe(true);
      });
      const negative = structuredClone(wire);
      for (const entry of negative.geometryValueProgram ?? []) if (owned.some(v => json(v.occurrence) === json(entry.occurrence))) entry.lazy = false;
      counts.reference++; const negativeReference = evaluateElementsReferencePayload(elements, { ...options, geometryValueProgram: negative.geometryValueProgram });
      counts.production++; const negativeActual = await Promise.race([rust.request(negative), new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("Rust mutation request exceeded 20 seconds")); }, 20_000); })]).finally(() => clearTimeout(timer)) as EvaluationPayload;
      const output = (payload: EvaluationPayload) => json({ geometry: payload.computedGeometry, errors: payload.errors, valueErrors: payload.geometryValueErrors ?? [] });
      observation.sensitivity = { boundary: c.inputs.n ? "BOUNDARY_DETECTED" : "NOT_COVERED", referenceOutputDetected: output(reference) !== output(negativeReference), productionOutputDetected: output(actual) !== output(negativeActual), iterations: c.inputs.n, ownedOccurrences: owned.map(v => v.occurrence), negativeReference, negativeActual };
      if (!c.inputs.n) capture("G/zero-control", () => { check(negativeReference); check(negativeActual); });
      // Runtime evidence, rather than static lazy flags alone, establishes
      // activation: exact per-iteration Module export and consumer rows above.
      observation.activation = c.inputs.n ? "PASS" : "NOT_COVERED";
    }
  }
  const record = { id: c.id, sha256: hash(p.source), method: c.method, stratum: c.stratum, status: failures.length ? "UNRESOLVED" : "PASS", failures, observations };
  results.push(record);
  if (evidence) appendFileSync(join(evidence, "attempts.ndjson"), json({ mode, ...record }) + "\n");
  if (mode === "verify") expect(failures, c.id).toEqual([]);
}, 60_000);
