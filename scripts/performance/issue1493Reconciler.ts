import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { assertCanonicalEdit, assertReconciled, canonicalEdit, hash, reconcile, reconcilerCases, reconcilerFixture, residueWork, scopeWork } from "../../test/issue1493ReconcilerSupport";

const folder = "test/fixtures/issue-1493/R";
mkdirSync(folder, { recursive: true });
const fixtures = reconcilerCases.map(c => reconcilerFixture(c.shape, c.scale));
const frozen = fixtures.map(f => ({ id: f.id, oldSource: f.oldSource, newSource: f.newSource,
  oldSha256: f.oldSha256, newSha256: f.newSha256, expected: f.expected, vanished: f.vanished }));
if (process.argv[2] === "freeze") {
  writeFileSync(`${folder}/oracle.json.gz`, gzipSync(JSON.stringify(frozen)));
  console.log(`Frozen ${fixtures.length} R units before reconciliation measurements`);
} else {
  const sealed = JSON.parse(gunzipSync(readFileSync(`${folder}/oracle.json.gz`)).toString());
  if (existsSync(`${folder}/oracle-extensions.json.gz`)) sealed.push(...JSON.parse(gunzipSync(readFileSync(`${folder}/oracle-extensions.json.gz`)).toString()));
  assert.deepEqual(sealed, JSON.parse(JSON.stringify(frozen)));
  const measure = (run: () => unknown, repetitions: number) => {
    for (let i = 0; i < 20; i++) run();
    const samples = Array.from({ length: 21 }, () => {
      const start = process.cpuUsage();
      for (let i = 0; i < repetitions; i++) run();
      const used = process.cpuUsage(start);
      return (used.user + used.system) / 1000 / repetitions;
    });
    const sorted = [...samples].sort((a, b) => a - b);
    return { samples, medianMs: sorted[10], p95Ms: sorted[19] };
  };
  const selected = process.env.ISSUE1493_ONLY?.split(",");
  const records = fixtures.filter(f => !selected || selected.includes(f.id)).map(f => {
    const edit = canonicalEdit(f);
    assertCanonicalEdit(f, edit());
    const observed = scopeWork(f);
    const residual = residueWork(f);
    assertReconciled(f, residual.result);
    assertReconciled(f, observed.result);
    assertReconciled(f, reconcile(f));
    const record = { id: f.id, disposition: "SEMANTIC_PASS", oldSha256: f.oldSha256, newSha256: f.newSha256,
      identities: f.expected.length, inherited: observed.result.inheritedCount,
      created: observed.result.createdIds.size, vanished: observed.result.vanishedIds.length,
      stageCounts: Object.fromEntries([1, 2, 3, 4, 5, 6].map(stage => [stage, f.expected.filter(e => e.stage === stage).length])),
      scopeReads: observed.reads, residueIterationVisits: residual.visits, numericSetMembershipChecks: residual.membershipChecks, maximumScopeDepth: observed.maximumScopeDepth,
      isolatedCpu: measure(() => reconcile(f), 10), canonicalEditCpu: measure(edit, 1) };
    console.log(JSON.stringify(record)); return record;
  });
  const label = process.argv[2]; assert.match(label, /^[a-z0-9-]+$/);
  const path = "packages/nui-language/src/document/statementReconciler.ts";
  writeFileSync(`${folder}/${label}.json.gz`, gzipSync(JSON.stringify({
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    admittedBase: "7d08c98aca4ae7982679a55f50358ec6f8eaa63b",
    implementationSha256: hash(readFileSync(path, "utf8")), node: process.version,
    warmups: 20, trials: 21, isolatedRepetitions: 10, canonicalRepetitions: 1, records
  })));
}
