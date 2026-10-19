import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument, geometryValueOccurrenceKey } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import type { EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import { json } from "./fixtures/issue1419/model";
import { reductions } from "./fixtures/issue-stage7/reductions";
import { campaign, type Cell } from "./fixtures/issue-stage7/model";
import { checkCompiler, checkGeometry, geometryProof, nameFor } from "./fixtures/issue-stage7/assertions";
import { independentOracle } from "./fixtures/issue-stage7/oracles";
const root = "test/fixtures/issue-stage7", mode = process.env.ISSUE1428_MODE ?? "verify";
const evidence = process.env.ISSUE1428_EVIDENCE, all = campaign();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const freezeFile = join(root,"freeze.json"), initial = regenerateCanonicalFromModel(emptyDocument(),1);
const owners = ["packages/nui-language/src/dsl/", "packages/nui-language/src/scalars/", "src/scalars/", "src/geometry/", "rust-evaluator/src/evaluation/"];
const productHash = () => hash(execFileSync("git", ["ls-files", "-z", "--", ...owners], { encoding: "utf8" }).split("\0").filter(Boolean).map(p => `${p}\0${readFileSync(p, "utf8")}`).join("\0"));
const frozenCandidates = () => JSON.parse(json(all.map((c,order)=>({ ...c,order,sha256:hash(c.source),independentOracle:independentOracle(c) }))));
const counts = { compiler:0,reference:0,production:0 }, accepted = new Set<string>(), results: Record<string,unknown>[] = [];
let rust: RustEvaluationProcess, child: ChildProcessWithoutNullStreams | undefined, closed: Promise<void> | undefined;
let disposing = false, resourceError: Error | undefined, watchdog: ReturnType<typeof setTimeout>;
function compile(c: Cell) {
  counts.compiler++;
  const result = compileCanonicalText(initial, c.source);
  if (result.status === "valid" && !result.diagnostics.length) accepted.add(hash(c.source));
  expect(accepted.size, "distinct accepted exploratory source ceiling").toBeLessThanOrEqual(56);
  return result;
}
beforeAll(() => {
  expect(["freeze", "prevalidate", "baseline", "verify", "inspect"], "explicit campaign phase").toContain(mode);
  if (mode === "baseline" && evidence) expect(existsSync(join(evidence, "baseline.json")), "retain original baseline; choose a fresh evidence directory for replay").toBe(false);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    if (existsSync(join(evidence, "accepted.sha256"))) for (const h of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (h) accepted.add(h);
  }
  if (["freeze", "prevalidate", "inspect"].includes(mode)) return;
  const frozen = JSON.parse(readFileSync(freezeFile, "utf8"));
  expect(frozen.candidates).toEqual(frozenCandidates());
  if (mode === "baseline") expect(productHash(), "unchanged initial product before all 20 executions").toBe(frozen.productHash);
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  // Proven Stage 5 persistent production process. Install close/error listeners
  // before requests and teardown; consume only explicitly allowed teardown errors.
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
  watchdog = setTimeout(() => { resourceError = new Error("Stage 7 process exceeded 10 minutes"); rust.dispose(); }, 600_000);
}, 130_000);
afterAll(async () => {
  clearTimeout(watchdog); disposing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { if (closed) timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000); });
    rust?.dispose(); if (closed) await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(timer);
    const report = { mode, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), productHash: productHash(),
      addedOwnerHashes: Object.fromEntries(["parameterDefinitions.ts", "parameterAccess.ts"].map(name => [name, hash(readFileSync(`packages/nui-language/src/parameters/${name}`, "utf8"))])),
      counts, accepted: accepted.size, results };
    if (evidence) {
      writeFileSync(join(evidence, "accepted.sha256"), [...accepted].sort().join("\n") + "\n");
      writeFileSync(join(evidence, `${mode}.json`), json(report) + "\n");
    }
    console.info(`Stage 7 ${json({ mode, counts, accepted: accepted.size, programs: results.length, unresolved: results.filter(r => r.status !== "PASS").map(r => r.id) })}`);
  }
  if (resourceError) throw resourceError;
}, 10_000);
async function request(wire: EvaluateDocumentInput) {
  if (resourceError) throw resourceError;
  counts.production++; let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([rust.request(wire), new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("Rust request exceeded 20 seconds")); }, 20_000); })]).catch(error => { resourceError = error instanceof Error ? error : new Error(String(error)); throw error; }).finally(() => clearTimeout(timer)) as EvaluationPayload;
}
it("prevalidates all 20 sources before any primary evaluation and freezes the independent oracle", () => {
  expect(all).toHaveLength(20); expect(new Set(all.map(c=>hash(c.source))).size).toBe(20);
  if (!["freeze","prevalidate"].includes(mode)) return;
  const attempts=all.map(c=>{ const r=compile(c); return { id:c.id,sha256:hash(c.source),source:c.source,status:r.status,diagnostics:r.diagnostics }; });
  if(evidence) appendFileSync(join(evidence,"prevalidation.ndjson"),json(attempts)+"\n");
  expect(attempts.filter(a=>a.status!=="valid" || a.diagnostics.length)).toEqual([]);
  if(mode==="freeze") {
    expect(existsSync(freezeFile)).toBe(false);
    writeFileSync(freezeFile,json({ issue:1428,base:"e08ff62174bc461661693173a27108f71c14de35",frozenAt:new Date().toISOString(),productHash:productHash(),candidates:frozenCandidates() })+"\n");
  }
});
for (const c of ["freeze", "prevalidate", "inspect"].includes(mode) ? [] : all.filter(c => !process.env.ISSUE1428_IDS || process.env.ISSUE1428_IDS.split(",").includes(c.id))) it(c.id, async () => {
  if (resourceError) {
    results.push({ id: c.id, sha256: hash(c.source), status: "BLOCKED", reason: "earlier resource failure; no further compilation or evaluation" });
    if (mode === "verify") throw resourceError;
    return;
  }
  const compiled = compile(c);
  expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
  const elements = compiled.doc.document.elements, options = optionsFor({ compiled, elements }), prepared = prepareRustEvaluation(elements, options);
  const failures: string[] = [];
  const capture = (boundary: string, f: () => void) => { try { f(); } catch (e) { failures.push(`${boundary}: ${String(e)}`); } };
  capture("compiler", () => checkCompiler(c, compiled, prepared.input));
  let reference: EvaluationPayload | undefined, actual: EvaluationPayload | undefined;
  let referenceException: string | undefined, productionException: string | undefined;
  counts.reference++;
  try { reference = evaluateElementsReferencePayload(elements, options); }
  catch (e) { referenceException = String(e); failures.push(`TS exception: ${e}`); }
  // Persist the exact request and TS observation BEFORE a native process can
  // abort. A resource failure is a hard stop, never a signal to restart Rust.
  if (evidence) appendFileSync(join(evidence, "raw.ndjson"), json({ mode, id: c.id, phase: "before-rust", wire: prepared.input, rustEligible: prepared.rustEligible, referenceException, reference }) + "\n");
  if (prepared.rustEligible) {
    try { actual = await request(prepared.input); }
    catch (e) { productionException = String(e); failures.push(`Rust exception: ${e}`); }
  } else failures.push("normal Rust eligibility FALSE; no production request or override");
  if (reference) capture("TS", () => checkGeometry(c, compiled, reference!));
  if (actual) capture("Rust", () => checkGeometry(c, compiled, actual!));
  if (evidence) appendFileSync(join(evidence, "raw.ndjson"), json({ mode, id: c.id, phase: "after-rust", productionException, actual }) + "\n");
  let sensitivity: Record<string, unknown> = { status:"NOT_COVERED", reason: failures.length ? "unresolved baseline" : "zero inner body or adjacent control" };
  if (!failures.length && prepared.rustEligible && (c.hypothesis === "H2" || (!c.control && c.inner > 0))) {
    const plans = new Map(options.bindingVersions!.immutableForGroups);
    for (const [id, plan] of plans) plans.set(id, { ...plan, geometryCollectionCarries: plan.geometryCollectionCarries?.map(carry => {
      if (c.hypothesis === "H2") return { ...carry, next:carry.initializer };
      const inner = [...plans.values()].flatMap(p=>p.geometryCollectionCarries ?? []).find(v=>v.bindingId.endsWith(":Inner"));
      return carry.bindingId.endsWith(":Outer") ? { ...carry, next:inner!.initializer } : carry;
    }) });
    const negativeOptions = { ...options, bindingVersions:{ ...options.bindingVersions!, immutableForGroups:plans } };
    const negativePrepared = prepareRustEvaluation(elements, negativeOptions);
    expect(negativePrepared.rustEligible).toBe(true);
    counts.reference++;
    const negativeReference = evaluateElementsReferencePayload(elements, negativeOptions), negativeActual = await request(negativePrepared.input);
    const owner = c.hypothesis === "H2" ? "Two::Mark" : `${c.module ? "Live::" : ""}Result0`;
    const selected = (p:EvaluationPayload) => geometryProof(compiled,p).find(g=>g.owner===owner && !g.at)?.shape;
    const referenceDetected = json(selected(reference!)) !== json(selected(negativeReference));
    const productionDetected = json(selected(actual!)) !== json(selected(negativeActual));
    capture("first-loss sensitivity",()=>{ expect(referenceDetected).toBe(true); expect(productionDetected).toBe(true); });
    sensitivity = { status:"OUTPUT_DETECTED", boundary:c.hypothesis === "H1" ? "outer consumes initializer instead of inner final" : "collection next loses swapped member identity",owner,referenceDetected,productionDetected };
    if (evidence) appendFileSync(join(evidence,"sensitivity.ndjson"),json({ id:c.id,...sensitivity,negativeReference,negativeActual })+"\n");
  }
  results.push({ id: c.id, sha256: hash(c.source), status: resourceError ? "BLOCKED" : failures.length ? "UNRESOLVED" : "PASS", failures,
    compiler: { elements, bindings: compiled.doc.bindingAnalysis!.catalog.bindings, dependencies: compiled.doc.typedDependencyGraph!.edges },
    rustEligible: prepared.rustEligible, referenceException, productionException, sensitivity, reference, actual });
  if (mode === "verify") expect(failures, c.id).toEqual([]);
}, 60_000);

if (mode === "inspect") it("retains compiler products and bounded TS reducer evidence without starting Rust", () => {
  for (const c of [...all.filter(c => process.env.ISSUE1428_IDS ? process.env.ISSUE1428_IDS.split(",").includes(c.id) : c.id === "H2-00" || c.id === "H1-00"), ...reductions.filter(c => !process.env.ISSUE1428_IDS || process.env.ISSUE1428_IDS.split(",").includes(c.id))]) {
    const compiled = compile(c as Cell), elements = compiled.doc.document.elements;
    expect(compiled.status, c.id).toBe("valid"); expect(compiled.diagnostics, c.id).toEqual([]);
    const inspectionOptions = optionsFor({ compiled, elements });
    const prepared = prepareRustEvaluation(elements, inspectionOptions);
    let reference: EvaluationPayload | undefined, exception: string | undefined;
    if ("expected" in c) {
      counts.reference++;
      try { reference = evaluateElementsReferencePayload(elements, optionsFor({ compiled, elements })); }
      catch (e) { exception = String(e); }
    }
    const record = { id: c.id, source: c.source, sha256: hash(c.source), rustEligible: prepared.rustEligible, wire: prepared.input,
      elements, geometryProgram: compiled.doc.geometryValueProgram, moduleProgram: compiled.doc.moduleGeometryRuntime,
      statements: compiled.doc.statements, bindingVersions: compiled.doc.bindingVersions, dependencyGraph: compiled.doc.typedDependencyGraph,
      numericBindingEntries: inspectionOptions.numericBindingEntries,
      geometryInputTargets: [...(inspectionOptions.geometryInputTargetsByElementId ?? [])].map(([id, targets]) => [id, [...targets]]),
      bindingIds: [...(inspectionOptions.bindingVersions?.versionIdsByBindingId.keys() ?? [])],
      reference, exception };
    if (evidence) appendFileSync(join(evidence, "inspection.ndjson"), json(record) + "\n");
    results.push({ id: c.id, status: exception ? "TS_EXCEPTION" : reference ? "OBSERVED" : "COMPILER_ONLY", exception });
  }
});

if (mode === "verify") for (const c of reductions.filter(c => !process.env.ISSUE1428_IDS || process.env.ISSUE1428_IDS.split(",").includes(c.id))) it(c.id, async () => {
  if (resourceError) throw resourceError;
  const compiled = compile(c as Cell), elements = compiled.doc.document.elements;
  expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
  const options = optionsFor({ compiled, elements }), prepared = prepareRustEvaluation(elements, options);
  if (c.id === "R-indexed-line-root") {
    const graph = compiled.doc.typedDependencyGraph!;
    const loop = elements.find(e => e.type === "forGroup")!;
    const program = compiled.doc.geometryValueProgram!;
    const seed = program.find(e => e.sourceStatementIndex === 1)!;
    const pick = program.find(e => e.sourceStatementIndex === 7)!;
    expect(graph.edges.some(e => e.from.kind === "element" && e.from.id === loop.id && e.to.kind === "geometry-value" && e.to.id === geometryValueOccurrenceKey(seed.occurrence))).toBe(true);
    expect(graph.edges.some(e => e.from.kind === "geometry-value" && e.to.kind === "element" && e.to.id === loop.id)).toBe(true);
    expect(seed.executionPosition).toBeLessThan(pick.executionPosition);
  }
  expect(prepared.rustEligible).toBe(true);
  counts.reference++;
  const reference = evaluateElementsReferencePayload(elements, options);
  if (evidence) appendFileSync(join(evidence, "reductions.ndjson"), json({ id: c.id, phase:"before-rust", source:c.source, sha256:hash(c.source), wire:prepared.input, reference }) + "\n");
  const actual = await request(prepared.input);
  if (evidence) appendFileSync(join(evidence, "reductions.ndjson"), json({ id: c.id, phase:"after-rust", sha256: hash(c.source), reference, actual }) + "\n");
  for (const payload of [reference, actual]) {
    if ("fail" in c) {
      expect(payload.errors.map(e => nameFor(compiled, e.elementId))).toEqual(c.fail ? ["Live::Out"] : []);
      expect(payload.computedGeometry.map(g => nameFor(compiled, g.elementId)).sort()).toEqual(c.fail ? ["Survivor"] : ["Live::Out", "Live::Prefix", "Survivor"]);
      continue;
    }
    expect(payload.errors).toEqual([]); expect(payload.geometryValueErrors ?? []).toEqual([]);
    if ("named" in c) {
      const out = payload.computedGeometry.find(g => nameFor(compiled,g.elementId) === "Live::Out")!;
      expect(out).toMatchObject({ kind:"polyline" });
      if (out.kind === "polyline") expect(out.segments.map(s => ({ start:s.start, end:s.end }))).toMatchObject([c.expected]);
      continue;
    }
    expect(payload.computedGeometry).toHaveLength("seedDrawable" in c && c.seedDrawable ? 2 : 1);
    expect(payload.computedGeometry.find(g => nameFor(compiled,g.elementId).endsWith("Out"))).toMatchObject({ kind: "start" in c.expected ? "line" : "point", ...c.expected });
  }
  results.push({ id: c.id, status: "PASS", sha256: hash(c.source) });
}, 60_000);
