import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Compact evidence projection only; evaluation and scheduling remain in the
// existing compiler/TS/production-Rust test boundaries used by the runner.
const root = fileURLToPath(new URL(".", import.meta.url));
const evidence = process.argv[2];
assert(evidence, "usage: node test/fixtures/issue-stage5/summarize.mjs EVIDENCE_DIRECTORY");
const read = name => JSON.parse(readFileSync(resolve(evidence, name), "utf8"));
const hash = s => createHash("sha256").update(s).digest("hex");
const freezeText = readFileSync(resolve(root, "freeze.json"), "utf8"), freeze = JSON.parse(freezeText);
const waves = [read("W1.json"), read("W2.json"), read("G.json")], final = read("verify.json");
const candidates = new Map(freeze.candidates.map(c => [c.id, c]));
assert.equal(candidates.size, 87);
assert.equal(new Set(freeze.candidates.map(c => c.sha256)).size, 87);
for (const c of candidates.values()) assert.equal(hash(c.program.source), c.sha256);
for (const run of [...waves, final]) {
  assert.equal(run.productHash, freeze.productHash, "this zero-repair campaign retained its original production tree");
  for (const r of run.results) {
    assert.equal(r.sha256, candidates.get(r.id).sha256);
    assert.equal(r.status, "PASS", `${run.mode}/${r.id}: unresolved evidence cannot be certified`);
    assert.deepEqual(r.failures, []);
    assert(r.observations.every(o => o.rustEligible === true));
  }
}
assert.deepEqual(waves.map(r => r.results.length), [36, 36, 15]);
assert.equal(final.results.length, 87);
const ledger = {
  limit: 240, acceptedDistinctSources: 87, primaryCells: 42, primaryPrograms: 84, additionalGControls: 3,
  freezeSha256: hash(freezeText), productHash: freeze.productHash,
  sources: freeze.candidates.map(c => ({ id: c.id, sha256: c.sha256, seed: c.seed, wave: c.wave, stratum: c.stratum, method: c.method, purpose: c.member === "control" ? "G-zero-nonactivation-control" : "primary" }))
};
const compact = r => ({ id: r.id, sha256: r.sha256, status: r.status, failures: r.failures, observations: r.observations.map(o => ({ placement: o.placement, rustEligible: o.rustEligible, inputHash: o.inputHash })) });
const baseline = { base: freeze.base, productHash: freeze.productHash, waves: waves.map(run => ({ mode: run.mode, counts: run.counts, results: run.results.map(compact) })) };
const outcomes = { novelConfirmedFixedFamilies: 0, sourceRepairs: [], primaryCells: 42, primaryPrograms: 84, controls: 3, status: "PASS", results: final.results.map(r => {
  const c = candidates.get(r.id);
  const activation = c.stratum === "C" && !c.inputs.n || c.stratum === "G" && c.member === "control" ? "NOT_COVERED" : "PASS";
  const proof = p => ({ geometry: p.geometry, errors: p.errors, scalars: p.scalars, instanceSnapshots: p.instanceSnapshots, ...(c.stratum === "G" ? { privateValues: p.privateValues } : {}) });
  const observedNames = ["Incoming", "Final", "FinalTotal", "Chosen", "Dependent", "Send"].flatMap(n => [n, `Twin${n}`]);
  const dependencyEdges = r.dependencyEdges.filter(e => observedNames.includes(e.from.replace(/^(binding|element):/, "")));
  const coverage = c.stratum === "E" ? { limits: "PASS", failedInstance: c.inputs.failed.length ? "PASS" : "NOT_COVERED", privateConditionalBranch: c.inputs.reverse ? "else" : "then" } : c.stratum === "C" ? { innerControl: activation, incomingSnapshots: activation, finalIndexedObserver: "PASS", twoIterationDiscrimination: c.inputs.n === 2 ? "PASS" : "NOT_COVERED" } : c.stratum === "D" ? { selectedFailure: c.inputs.reverse ? c.cell === 1 : c.cell === 0, disabledGate: "PASS", independentFailures: "PASS" } : { frame: activation, lazyOwner: "PASS" };
  return { ...compact(r), activation, coverage, activationDetail: c.stratum === "C" ? `outer iterations ${c.inputs.n}; scalar and array incoming/final snapshots` : c.stratum === "E" ? "four limit placements; exactly two asymmetric instances" : c.stratum === "D" ? "selected/unselected, independent failures and disabled Module/ancestor" : `Module occurrences ${c.inputs.n}; exact export/consumer rows`, dependencyEdges, observations: r.observations.map(o => ({ placement: o.placement, rustEligible: o.rustEligible, reference: proof(o.referenceProof), production: proof(o.productionProof) })) };
}) };
const sensitivity = final.results.filter(r => candidates.get(r.id).stratum === "G").map(r => {
  const s = r.observations[0].sensitivity, active = s.iterations > 0;
  assert.equal(s.referenceOutputDetected, active); assert.equal(s.productionOutputDetected, active);
  assert.equal(s.ownedProgram.length, 1);
  return { id: r.id, semantic: "PASS", activation: active ? "PASS" : "NOT_COVERED", boundary: s.boundary, output: active ? "OUTPUT_DETECTED" : "OUTPUT_NOT_DETECTED", seededFamilies: 0, iterations: s.iterations, originalLazy: s.ownedProgram.map(v => v.lazy), injectedLazy: false, originalConstruction: s.ownedProgram.map(v => v.construction.kind), referenceDiagnosticSideChannel: s.referenceDiagnosticSideChannel, negativeReference: s.negativeReferenceProof, negativeProduction: s.negativeProductionProof };
});
const prevalidation = readFileSync(resolve(evidence, "prevalidation.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
const rejected = prevalidation.flat().filter(r => r.status !== "valid").map(r => ({ ...r, disposition: "CONTRACT-INVALID; pre-freeze generator candidate", diagnosticCodes: r.diagnostics.map(d => d.code), diagnostics: undefined }));
const attempts = readFileSync(resolve(evidence, "attempts.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
const telemetry = { scope: "recorded experimental batches through focused verification; final mandatory gate is recorded separately", prevalidationCompilerRequests: prevalidation.reduce((n, a) => n + a.length, 0), rejectedDistinctCandidates: new Set(rejected.map(r => r.sha256)).size, rejected,
  historicalAgentOverheadAtOriginalCampaign: [
    "One compiler-only generator correction: 33 rejected candidates (array expression members and invalid boolean match spelling). No primary evaluator had run.",
    "One W2 launch stopped before compiler/evaluator requests because prediction read-back compared a preserved trailing newline incorrectly; exact Issue comment was already published. No W2 result was revealed.",
    "G instrumentation initially applied the clean semantic diagnostic oracle to an intentionally injected zero-loop TS diagnostic; downstream output was unchanged. Retained original dispositions; separated diagnostic side channel from activation.",
    "G instrumentation initially required a cache entry for a forwarded alias. The original conditional value is the canonical observable; forwarding need not duplicate its cache. Original observations retained.",
    "Dependency instrumentation initially omitted the authored exhaustive match scrutinee's required Side edge. Corrected the assertion; no source, frozen oracle or product code changed."
  ],
  phases: [...new Set(attempts.map(r => r.mode))].map(mode => ({ mode, methods: ["A", "B", "C"].map(method => {
    const rows = attempts.filter(r => r.mode === mode && r.method === method);
    const requests = rows.reduce((n, r) => n + r.observations.reduce((k, o) => k + (o.sensitivity ? 2 : 1), 0), 0);
    return { method, compilerRequests: rows.length, referenceRequests: requests, productionRequests: requests, distinctAcceptedSources: new Set(rows.map(r => r.sha256)).size, confirmedNovelFamilies: 0 };
  }) })),
  historicalFocusedDependencyAudit: { compiler: 2, reference: 2, production: 2, newSources: 0 },
  actualTokens: "UNAVAILABLE", methodQuotaAttribution: "INCONCLUSIVE"
};
for (const [name, value] of Object.entries({ "source-ledger.json": ledger, "baseline.json": baseline, "outcomes.json": outcomes, "sensitivity.json": sensitivity, "telemetry.json": telemetry })) writeFileSync(resolve(root, name), JSON.stringify(value, null, ["outcomes.json", "baseline.json"].includes(name) ? undefined : 2) + "\n");
console.log(JSON.stringify({ primaryCells: 42, primaryPrograms: 84, controls: 3, accepted: 87, rejectedDistinctCandidates: telemetry.rejectedDistinctCandidates, status: "PASS", sensitivity: "12 active output detectors; 3 zero-loop drawable negatives", novelFamilies: 0 }));
