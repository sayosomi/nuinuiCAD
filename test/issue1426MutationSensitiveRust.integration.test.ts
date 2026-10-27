import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import type { EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { resolveRustEvaluationBinaryPath, RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { optionsFor, runtimeDiagnosticsFor } from "./evaluationParitySupport";
import { checkCompiler, checkValues, recordsIn } from "./fixtures/issue1419/assertions";
import { json } from "./fixtures/issue1419/model";
import { campaign, renamed, type Candidate } from "./fixtures/issue-stage6/model";
import { independentOracle } from "./fixtures/issue-stage6/oracles";

const root = "test/fixtures/issue-stage6", mode = process.env.ISSUE1426_MODE ?? "verify";
const evidence = process.env.ISSUE1426_EVIDENCE, all = campaign();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const freezeFile = join(root, "freeze.json"), initial = regenerateCanonicalFromModel(emptyDocument(), 1);
const owners = ["packages/nui-language/src/dsl/", "packages/nui-language/src/scalars/", "src/scalars/", "src/geometry/", "rust-evaluator/src/evaluation/"];
const productHash = () => hash(execFileSync("git", ["ls-files", "-z", "--", ...owners], { encoding: "utf8" }).split("\0").filter(Boolean).map(p => `${p}\0${readFileSync(p, "utf8")}`).join("\0"));
const frozenCandidates = () => JSON.parse(json(all.map((c, order) => ({ ...c, order, sha256: hash(c.program.source), independentOracle: independentOracle(c) }))));
const counts = { compiler: 0, reference: 0, production: 0 }, accepted = new Set<string>(), results: Record<string, unknown>[] = [];
let rust: RustEvaluationProcess, child: ChildProcessWithoutNullStreams | undefined, closed: Promise<void> | undefined;
let disposing = false, resourceError: Error | undefined, watchdog: ReturnType<typeof setTimeout>;
function compile(c: Candidate) {
  counts.compiler++;
  const result = compileCanonicalText(initial, c.program.source);
  if (result.status === "valid" && !result.diagnostics.length) accepted.add(hash(c.program.source));
  expect(accepted.size, "distinct accepted exploratory source ceiling").toBeLessThanOrEqual(160);
  return result;
}
beforeAll(() => {
  expect(["freeze", "prevalidate", "baseline", "verify"], "explicit campaign phase").toContain(mode);
  if (mode === "baseline" && evidence) expect(existsSync(join(evidence, "baseline.json")), "retain original baseline; choose a fresh evidence directory for replay").toBe(false);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    if (existsSync(join(evidence, "accepted.sha256"))) for (const h of readFileSync(join(evidence, "accepted.sha256"), "utf8").trim().split("\n")) if (h) accepted.add(h);
  }
  if (["freeze", "prevalidate"].includes(mode)) return;
  const frozen = JSON.parse(readFileSync(freezeFile, "utf8"));
  expect(frozen.candidates).toEqual(frozenCandidates());
  if (mode === "baseline") expect(productHash(), "unchanged initial product before all 51 executions").toBe(frozen.productHash);
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
  watchdog = setTimeout(() => { resourceError = new Error("Stage 6 process exceeded 10 minutes"); rust.dispose(); }, 600_000);
}, 130_000);
afterAll(async () => {
  clearTimeout(watchdog); disposing = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { if (closed) timer = setTimeout(() => { child?.kill("SIGKILL"); reject(new Error("Rust teardown exceeded 5 seconds")); }, 5_000); });
    rust?.dispose(); if (closed) await Promise.race([closed, timeout]);
  } finally {
    clearTimeout(timer);
    const report = { mode, revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), productHash: productHash(), counts, accepted: accepted.size, results };
    if (evidence) {
      writeFileSync(join(evidence, "accepted.sha256"), [...accepted].sort().join("\n") + "\n");
      writeFileSync(join(evidence, `${mode}.json`), json(report) + "\n");
    }
    console.info(`Stage 6 ${json({ mode, counts, accepted: accepted.size, programs: results.length, unresolved: results.filter(r => r.status !== "PASS").map(r => r.id) })}`);
  }
  if (resourceError) throw resourceError;
}, 10_000);
async function request(wire: EvaluateDocumentInput) {
  counts.production++; let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race([rust.request(wire), new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("Rust request exceeded 20 seconds")); }, 20_000); })]).finally(() => clearTimeout(timer)) as EvaluationPayload;
}
it("compiler-prevalidates and freezes 48 primary sources plus three controls before evaluation", () => {
  expect(all).toHaveLength(51); expect(new Set(all.map(c => hash(c.program.source))).size).toBe(51);
  for (const c of all.filter(c => c.stratum === "S")) {
    const oracle = independentOracle(c);
    if (!("states" in oracle) || !oracle.states) throw new Error("S oracle missing");
    for (let i = 0; i < c.inputs.n; i++) expect(c.program.trace[i].incoming).toEqual({ Total: oracle.states[i].s, Values: [oracle.states[i].a, oracle.states[i].b], Tick: i + 1 });
    expect(JSON.parse(json(c.program.scalars))).toEqual(oracle.scalars);
    if (c.inputs.n) for (const model of Object.values(oracle.countermodels!)) expect({ scalar: model.scalar, values: model.values }).not.toEqual({ scalar: oracle.states.at(-1)!.s, values: [oracle.states.at(-1)!.a, oracle.states.at(-1)!.b] });
  }
  if (!["freeze", "prevalidate"].includes(mode)) return;
  const attempts = all.map(c => { const r = compile(c); return { id: c.id, sha256: hash(c.program.source), source: c.program.source, status: r.status, diagnostics: r.diagnostics }; });
  if (evidence) appendFileSync(join(evidence, "prevalidation.ndjson"), json(attempts) + "\n");
  expect(attempts.filter(a => a.status !== "valid" || a.diagnostics.length), "compiler-only legality; no evaluator feedback").toEqual([]);
  if (mode === "freeze") {
    expect(existsSync(freezeFile), "never overwrite the initial freeze").toBe(false);
    writeFileSync(freezeFile, json({ issue: 1426, base: "38a00dc7d3b8f6cf90633b87f3fc383561bb85b7", frozenAt: new Date().toISOString(), productHash: productHash(), candidates: frozenCandidates() }) + "\n");
  }
});
function namesFor(compiled: TextCompileResult, payload: EvaluationPayload) {
  const elements = compiled.doc.document.elements, snapshots = compiled.doc.moduleMaterialization?.instanceBaseGeometrySnapshots ?? [];
  return (id: string) => {
    const row = payload.forGroupGeneratedRows?.find(r => r.generatedElementId === id), sourceId = row?.templateElementId ?? id;
    const element = elements.find(e => e.id === sourceId), owner = snapshots.find(s => s.descendantIds.includes(sourceId));
    return `${owner ? `${elements.find(e => e.id === owner.instanceId)?.name}::` : ""}${element?.name ?? id}${row ? `[${row.occurrencePath.map(s => s.iterationIndex)}]` : ""}`;
  };
}
function proof(compiled: TextCompileResult, payload: EvaluationPayload) {
  const name = namesFor(compiled, payload);
  return { geometry: payload.computedGeometry.map(g => ({ owner: name(g.elementId), kind: g.kind, ...(g.kind === "point" ? { x: g.x, y: g.y } : {}) })).sort((a,b) => a.owner.localeCompare(b.owner)),
    errors: payload.errors.map(e => ({ owner: name(e.elementId), dependency: name(e.missingDependencyId) })),
    diagnostics: runtimeDiagnosticsFor({ compiled, elements: compiled.doc.document.elements }, payload).map(d => ({ code: d.code, bindingId: d.bindingId })),
    privateValues: payload.computedGeometryValues ?? [], privateErrors: payload.geometryValueErrors ?? [], instances: (payload.instanceBaseGeometry ?? []).map(s => ({ owner: name(s.instanceId), geometry: s.geometry.map(g => name(g.elementId)) })),
    rows: payload.forGroupGeneratedRows ?? [], scalars: payload.computedScalarBindings ?? [] };
}
const cases = ["freeze", "prevalidate"].includes(mode) ? [] : all.filter(c => !process.env.ISSUE1426_IDS || process.env.ISSUE1426_IDS.split(",").includes(c.id));
for (const c of cases) it(c.id, async () => {
  const failures: string[] = [], observations: Record<string, unknown>[] = [];
  const capture = (boundary: string, f: () => void) => { try { f(); } catch (e) { failures.push(`${boundary}: ${String(e)}`); } };
  const compiled = compile(c), p = c.program, oracle = independentOracle(c), rename = (n: string) => renamed(c, n);
  expect(compiled.status).toBe("valid"); expect(compiled.diagnostics).toEqual([]);
  const elements = compiled.doc.document.elements, fixture = { compiled, elements };
  const limits = "limits" in oracle && oracle.limits ? oracle.limits : [{ placement: "full", through: undefined }];
  for (const limit of limits) {
    const index = limit.through ? elements.findIndex(e => e.name === limit.through) + 1 : 0;
    if (limit.through) expect(index).toBeGreaterThan(0);
    const options = optionsFor({ ...fixture, evaluationLimitIndex: c.stratum === "X" ? index : undefined });
    const prepared = prepareRustEvaluation(elements, options), wire = prepared.input;
    expect(prepared.rustEligible, "normal production eligibility; no bypass or fallback").toBe(true);
    capture("compiler/payload", () => {
      expect(compiled.doc.bindingAnalysis!.issues).toEqual([]); expect(compiled.doc.typedDependencyGraph!.cycles).toEqual([]);
      if (c.stratum === "S") {
        checkCompiler(p, compiled, wire);
        const plans = wire.bindingVersions!.immutableForGroups!;
        expect(plans).toHaveLength(1); expect(plans[0].carries).toHaveLength(1); expect(plans[0].collectionCarries).toHaveLength(1);
        const binding = (n: string) => compiled.doc.bindingAnalysis!.catalog.bindings.find(b => b.name === rename(n))!.id;
        for (const graph of [compiled.doc.typedDependencyGraph!, wire.scalarExpressionPayload!.conditionalDependencyGraph!]) {
          for (const [owner, targets] of [["Incoming", ["Total"]], ["Indexed", ["Tick"]], ["Final", ["Final0", "FinalTotal"]]] as const) {
            const id = elements.find(e => e.name === rename(owner))!.id;
            expect(graph.edges.filter(e => e.from.kind === "element" && e.from.id === id && e.to.kind === "binding").map(e => e.to.id).sort()).toEqual(targets.map(binding).sort());
          }
        }
        const scalar = plans[0].carries[0], array = plans[0].collectionCarries![0];
        const nextRecords = recordsIn(scalar.nextExpression);
        expect(nextRecords.filter(r => r.kind === "collectionIndex").map(r => r.collectionValueId)).toEqual([array.collectionValueId]);
        expect(nextRecords.some(r => r.kind === "reference" && r.bindingId === scalar.bindingId)).toBe(true);
        const mapped = wire.bindingVersions!.collectionValues!.find(v => recordsIn(v).some(r => r.kind === "reference" && r.bindingId === scalar.bindingId));
        expect(mapped, "array next reads the same incoming scalar identity").toBeDefined();
        const records = recordsIn(wire.bindingVersions);
        expect(records.some(r => r.bindingId === plans[0].carries[0].bindingId)).toBe(true);
        expect(records.some(r => r.collectionValueId === plans[0].collectionCarries![0].collectionValueId)).toBe(true);
      }
    });
    const check = (payload: EvaluationPayload) => {
      if (c.stratum !== "X") { checkValues(p, compiled, payload); return; }
      if (!("geometry" in limit)) throw new Error("X limit oracle missing");
      const name = namesFor(compiled, payload), result = evaluationPayloadToResult(payload);
      expect(payload.computedGeometry.map(g => ({ name: name(g.elementId), ...(g.kind === "point" ? { x: g.x, y: g.y } : {}) })).sort((a,b) => a.name.localeCompare(b.name))).toEqual([...limit.geometry].sort((a,b) => a.name.localeCompare(b.name)));
      expect((payload.instanceBaseGeometry ?? []).filter(s => s.geometry.length).map(s => name(s.instanceId)).sort()).toEqual([...limit.instances].sort());
      expect(payload.errors.map(e => name(e.elementId)).sort()).toEqual(limit.failureActive ? [`${oracle.failed}::${rename("Mark")}`] : []);
      // Module-local runtime errors live on canonical computed bindings. The
      // UI diagnostic projection intentionally omits Module source-local rows.
      const failedMark = elements.find(e => e.name === rename("Mark") && compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.some(s => name(s.instanceId) === oracle.failed && s.descendantIds.includes(e.id)));
      const use = wire.scalarExpressionPayload!.numericBindings.find(b => b.elementId === failedMark?.id && b.parameterKey === "x");
      const target = use?.references[0]?.bindingId;
      const scope = target && compiled.doc.bindingAnalysis!.catalog.bindingsById.get(target)?.effectiveScopeId;
      const expectedIds = compiled.doc.bindingAnalysis!.catalog.bindings.filter(b => b.effectiveScopeId === scope && [rename("Risk"), rename("Send")].includes(b.name)).map(b => b.id);
      const actualCodes = (payload.computedScalarBindings ?? []).filter(b => payload.errors.length > 0 && b.evaluation.status === "error" && b.evaluation.issueCode !== "poisoned-binding").map(b => [b.bindingId, b.evaluation.status === "error" ? b.evaluation.issueCode : ""]).sort();
      expect(actualCodes, "exact Module-owned selected diagnostic codes; disabled frames never evaluate invalid inputs").toEqual(limit.failureActive ? expectedIds.map(id => [id, "evaluation-divide-by-zero"]).sort() : []);
      if (limit.failureActive) expect(expectedIds).toHaveLength(c.member === "T" ? 2 : 1);
      for (const error of payload.errors) expect(error.missingDependencyId).toBe(`@${rename(c.member === "T" ? "Send" : "Risk")}`);
      // Cached private scalar evaluations can exist outside the drawable limit;
      // they are preserved in proof(), not counted as emitted Module errors.
      expect(payload.geometryValueErrors ?? []).toEqual([]);
      const dormant = elements.find(e => e.type === "moduleInstance" && e.name === rename("Dormant"))!;
      const dormantSnapshot = compiled.doc.moduleMaterialization!.instanceBaseGeometrySnapshots.find(s => s.instanceId === dormant.id)!;
      for (const id of dormantSnapshot.descendantIds) expect(result.computedGeometry.has(id)).toBe(false);
    };
    counts.reference++; const reference = evaluateElementsReferencePayload(elements, options), actual = await request(wire);
    capture(`TS/${limit.placement}`, () => check(reference)); capture(`Rust/${limit.placement}`, () => check(actual));
    const observation: Record<string, unknown> = { placement: limit.placement, rustEligible: true, inputHash: hash(json(wire)), referenceProof: proof(compiled, reference), productionProof: proof(compiled, actual) };
    observations.push(observation);
    if (evidence) appendFileSync(join(evidence, "raw.ndjson"), json({ mode, id: c.id, placement: limit.placement, wire, reference, actual }) + "\n");
    if (c.stratum === "O") {
      const owned = (wire.geometryValueProgram ?? []).filter(v => v.occurrence.instancePath.length > 0 && ["if", "match"].includes(v.construction.kind));
      capture("O/ownership", () => {
        expect(elements.filter(e => e.type === "moduleInstance")).toHaveLength(1);
        const instance = elements.find(e => e.type === "moduleInstance")!;
        expect(elements.find(e => e.id === instance.parentGroupId)?.type).toBe("forGroup");
        expect(owned).toHaveLength(1); expect(owned[0].lazy).toBe(true); expect(owned[0].occurrence.instancePath).toHaveLength(1);
        expect(owned[0].occurrence.instancePath).toEqual(wire.moduleMaterialization!.instances.find(i => i.instanceId === instance.id)!.instancePath);
        for (const payload of [reference, actual]) {
          const rows = payload.forGroupGeneratedRows ?? [];
          expect(rows).toHaveLength(3 * c.inputs.n);
          for (let i = 0; i < c.inputs.n; i++) {
            const occurrence = rows.filter(r => r.occurrencePath.length === 1 && r.occurrencePath[0].iterationIndex === i);
            expect(occurrence.map(r => r.templateElementId).sort()).toEqual(elements.filter(e => [instance.id, ...wire.moduleMaterialization!.instances[0].descendantIds, elements.find(e => e.name === rename("Consumer"))!.id].includes(e.id)).map(e => e.id).sort());
            expect(new Set(occurrence.map(r => r.generatedElementId)).size).toBe(3);
          }
        }
        for (const payload of [reference, actual]) {
          expect(payload.computedGeometryValues ?? []).toHaveLength(c.inputs.n ? owned.length : 0);
          if (c.inputs.n) expect(payload.computedGeometryValues![0]).toMatchObject({ occurrence: owned[0].occurrence, value: { kind: "point", x: (c.inputs.negative ? -1 : 1) * (c.inputs.u + (c.inputs.n - 1) * c.inputs.d) + c.inputs.f, y: c.inputs.d } });
        }
      });
      const negative = structuredClone(wire);
      for (const entry of negative.geometryValueProgram ?? []) if (owned.some(o => json(o.occurrence) === json(entry.occurrence))) entry.lazy = false;
      counts.reference++; const negativeReference = evaluateElementsReferencePayload(elements, { ...options, geometryValueProgram: negative.geometryValueProgram });
      const negativeActual = await request(negative);
      const lost = (clean: EvaluationPayload, mutated: EvaluationPayload) => clean.computedGeometry.filter(g => !mutated.computedGeometry.some(m => m.elementId === g.elementId)).map(g => namesFor(compiled, clean)(g.elementId));
      const referenceLoss = lost(reference, negativeReference), productionLoss = lost(actual, negativeActual);
      observation.sensitivity = { boundary: c.inputs.n ? "BOUNDARY_DETECTED" : "NOT_COVERED", referenceLoss, productionLoss,
        referenceOutput: referenceLoss.length ? "OUTPUT_DETECTED" : "OUTPUT_NOT_DETECTED", productionOutput: productionLoss.length ? "OUTPUT_DETECTED" : "OUTPUT_NOT_DETECTED",
        referenceDiagnosticNoise: json(reference.geometryValueErrors ?? []) !== json(negativeReference.geometryValueErrors ?? []),
        negativeReferenceProof: proof(compiled, negativeReference), negativeProductionProof: proof(compiled, negativeActual) };
      capture("O/mutation output", () => {
        for (const payload of [negativeReference, negativeActual]) {
          expect(payload.computedGeometry).toHaveLength(1); expect(payload.computedGeometry[0]).toMatchObject({ kind: "point", x: c.inputs.u + c.inputs.d, y: 0 });
          if (!c.inputs.n) { expect(payload.errors).toEqual([]); expect(payload.forGroupGeneratedRows ?? []).toEqual([]); }
        }
        expect(referenceLoss).toHaveLength(2 * c.inputs.n); expect(productionLoss).toHaveLength(2 * c.inputs.n);
      });
      if (evidence) appendFileSync(join(evidence, "mutations.ndjson"), json({ mode, id: c.id, owned, negativeReference, negativeActual }) + "\n");
    }
  }
  const record = { id: c.id, sha256: hash(p.source), stratum: c.stratum, methods: c.methods, status: failures.length ? "UNRESOLVED" : "PASS", failures,
    activation: c.member === "control" ? (c.stratum === "X" ? "disabled-and-unselected-NONACTIVATION" : "body-NOT_COVERED") : "ACTIVE",
    oracle, compiler: { elements, bindingCatalog: compiled.doc.bindingAnalysis!.catalog.bindings, dependencies: compiled.doc.typedDependencyGraph!.edges }, observations };
  results.push(record);
  if (evidence) appendFileSync(join(evidence, "attempts.ndjson"), json({ mode, productHash: productHash(), ...record }) + "\n");
  if (mode === "verify") expect(failures, c.id).toEqual([]);
}, 60_000);
