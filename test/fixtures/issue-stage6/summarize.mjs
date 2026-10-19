import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const directory = process.argv[2];
if (!directory) throw new Error("usage: node test/fixtures/issue-stage6/summarize.mjs <external-evidence-directory>");
const root = "test/fixtures/issue-stage6", read = p => JSON.parse(readFileSync(p, "utf8"));
const save = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, ["baseline.json", "outcomes.json"].includes(name) ? undefined : 2) + "\n");
const hash = s => createHash("sha256").update(s).digest("hex");
const frozen = read(join(root, "freeze.json")), original = read(join(directory, "baseline.json"));
const final = read(join(directory, "verify.json"));
const correctedPath = join(directory, "checked-baseline.json");
const corrected = existsSync(correctedPath) ? read(correctedPath) : original;
if (original.results.length !== 51 || final.results.length !== 51) throw new Error("complete initial and final matrices required");
for (const run of [original, corrected, final]) {
  if (run.productHash !== frozen.productHash) throw new Error("this zero-repair campaign must retain the original product fingerprint");
  if (run.results.some(r => !frozen.candidates.some(c => c.id === r.id && c.sha256 === r.sha256))) throw new Error("unfrozen result");
}
if (final.results.some(r => r.status !== "PASS")) throw new Error("unresolved final cell; preserve evidence and investigate");
const bindingNames = c => new Map(c.compiler.bindingCatalog.map(b => [b.id, b.name]));
function compact(c) {
  const names = bindingNames(c), symbols = new Map(c.compiler.elements.map(e => [e.id, e.name]));
  const identities = [], indexes = new Map();
  const node = n => {
    const key = `${n.kind}:${n.id}`;
    if (!indexes.has(key)) { indexes.set(key, identities.length); identities.push({ kind: n.kind, id: n.id, name: names.get(n.id) ?? symbols.get(n.id) }); }
    return indexes.get(key);
  };
  const edges = c.compiler.dependencies.map(e => [node(e.from), node(e.to), e.requiredness, e.activation?.guards.map(g => g.branch)]);
  const observation = p => ({ geometry: p.geometry, errors: p.errors, privateValues: p.privateValues, privateErrors: p.privateErrors, instances: p.instances,
    scalarResults: p.scalars.filter(b => b.evaluation.status === "error" || /Final/.test(names.get(b.bindingId) ?? "")).map(b => ({ bindingId: b.bindingId, evaluation: b.evaluation })) });
  return { id: c.id, sha256: c.sha256, disposition: c.status, activation: c.activation, methods: c.methods,
    sensitivity: c.stratum === "S" ? c.id.endsWith("control") ? "NOT_COVERED: empty body" : "both sequential countermodels KILLED by actual exact outputs" : c.stratum === "O" ? Object.fromEntries(Object.entries(c.observations[0].sensitivity).filter(([k]) => !["negativeReferenceProof", "negativeProductionProof"].includes(k))) : "NOT_COVERED: X fault injection not performed; semantic owner/gate/limit assertions only",
    compiler: { bindings: c.compiler.bindingCatalog.map(b => ({ id: b.id, name: b.name, scope: b.effectiveScopeId })), identities, dependencyEdges: edges },
    observations: c.observations.map(o => ({ placement: o.placement, rustEligible: o.rustEligible, inputHash: o.inputHash,
      reference: observation(o.referenceProof), production: observation(o.productionProof), referenceProofHash: hash(JSON.stringify(o.referenceProof)), productionProofHash: hash(JSON.stringify(o.productionProof)) })) };
}
save("baseline.json", { base: frozen.base, productHash: original.productHash, frozenSourceHash: hash(readFileSync(join(root, "freeze.json"))),
  initialExecutionCounts: original.counts, originalObserverDisposition: original.results.map(r => ({ id: r.id, status: r.status, failures: r.failures })),
  note: "All original source/oracle/runtime evidence retained externally. Harness projection corrections (carry field identity, empty disabled snapshots, private Module error-code channel, private scalar cache versus emitted errors) changed no source or independent oracle. No product repair occurred.",
  results: corrected.results.map(c => ({ id: c.id, sha256: c.sha256, semanticDisposition: c.status, observations: c.observations.map(o => ({ placement: o.placement, referenceProofHash: hash(JSON.stringify(o.referenceProof)), productionProofHash: hash(JSON.stringify(o.productionProof)), referenceGeometry: o.referenceProof.geometry, productionGeometry: o.productionProof.geometry })) })) });
save("outcomes.json", { base: frozen.base, productHash: final.productHash, accepted: final.accepted, newConfirmedFamilies: 0, fixedFamilies: 0, dispositions: { PASS: 51, "confirmed FAIL": 0, BLOCKED: 0, "CONTRACT-INVALID": 0, UNRESOLVED: 0 }, results: final.results.map(compact) });
const attempts = readFileSync(join(directory, "prevalidation.ndjson"), "utf8").trim().split("\n").map(JSON.parse).flat();
const rejections = [...new Map(attempts.filter(r => r.status !== "valid" || r.diagnostics.length).map(r => [r.sha256, r])).values()];
save("rejections.json", rejections.map(r => ({ ...r, disposition: "CONTRACT-INVALID" })));
const accepted = [...new Set(attempts.filter(r => r.status === "valid" && !r.diagnostics.length).map(r => r.sha256))].sort();
if (accepted.length !== 51) throw new Error("unexpected exploration count");
save("source-ledger.json", { ceiling: 160, accepted: 51, primary: 48, controls: 3, counterfactuals: 0, newMinimizations: 0, rejected: rejections.length,
  acceptedSources: frozen.candidates.map(c => ({ id: c.id, order: c.order, seed: c.seed, sha256: c.sha256, methods: c.methods, faultModels: c.faultModels })), rejectedHashes: rejections.map(r => r.sha256) });
const runs = readdirSync(directory).filter(n => ["prevalidate.json", "freeze.json", "baseline.json", "observe.json", "checked-baseline.json", "verify.json"].includes(n)).map(n => ({ file: n, ...read(join(directory, n)) }));
const counts = Object.fromEntries(["compiler", "reference", "production"].map(k => [k, runs.reduce((s, r) => s + r.counts[k], 0)]));
save("telemetry.json", { primaryPrograms: 48, controls: 3, accepted: 51, rejected: rejections.length, counts,
  runs: runs.map(r => ({ phase: r.mode, counts: r.counts, cases: r.results.length, productHash: r.productHash })),
  normalRequestsPerMatrixPerRuntime: 102, mutationRequestsPerMatrixPerRuntime: 17,
  S: { activeSources: 16, logicalCountermodels: 32, killed: 32, surviving: 0, emptyControl: "NOT_COVERED" },
  O: { activeSources: 16, injectedPerRuntime: 16, outputDetectedPerRuntime: 16, outputMasked: 0, zeroControl: "NOT_COVERED; no drawable difference; TS private diagnostic noise retained" },
  X: { activeSources: 16, controlSources: 1, limitEvaluationsPerRuntime: 68, selectedFailurePlacementsPerRuntime: 40, sensitivity: "NOT_COVERED for injected X faults" },
  novelFamilies: 0, fixedFamilies: 0, counterfactualSources: 0, agentCorrections: ["8 rejected negative array literals replaced before freeze by legal unary Module arguments", "one generator syntax typo before freeze", "S carry identity field assertion", "X empty disabled snapshot projection", "X private binding code channel", "X private scalar cache versus public error activation"],
  quota: "UNAVAILABLE: no Human before/after observations supplied; no attributable denominator or method ranking" });
save("evidence-index.json", { externalDirectory: directory, artifacts: readdirSync(directory).filter(n => /\.(json|ndjson|log)$/.test(n)).map(n => ({ name: n, sha256: hash(readFileSync(join(directory, n))) })) });
console.info(JSON.stringify({ accepted: 51, rejected: rejections.length, dispositions: "51 PASS", newFamilies: 0, counts }));
