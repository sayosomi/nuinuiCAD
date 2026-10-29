import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { materializeModuleExecution } from "../../packages/nui-language/src/dsl/moduleMaterialization";
import { assertMaterialization, compileModule, hash, materializationInput, moduleCases, moduleFixture, runtimeArrayWork } from "../../test/issue1493ModuleSupport";

const folder = "test/fixtures/issue-1493/M";
mkdirSync(folder, { recursive: true });
const fixtures = moduleCases.map(c => moduleFixture(c.shape, c.count));
const frozen = fixtures.map(f => ({ id: f.id, source: f.source, sourceSha256: f.sourceSha256, entries: f.entries, snapshots: f.snapshots, units: f.units }));
if (process.argv[2] === "freeze") {
  writeFileSync(`${folder}/oracle.json.gz`, gzipSync(JSON.stringify(frozen)));
  console.log(`Frozen ${fixtures.length} M units before product measurements`);
} else {
  assert.deepEqual(JSON.parse(gunzipSync(readFileSync(`${folder}/oracle.json.gz`)).toString()), JSON.parse(JSON.stringify(frozen)));
  const measure = (run: () => unknown, repetitions: number) => {
    for (let i = 0; i < 12; i++) run();
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
    const compiled = compileModule(f);
    const input = materializationInput(f, compiled);
    const observed = runtimeArrayWork(() => materializeModuleExecution(input));
    assertMaterialization(f, observed.result);
    const record = { id: f.id, disposition: "SEMANTIC_PASS", sourceSha256: f.sourceSha256,
      runtimeCount: f.entries.length, instanceCount: f.snapshots.length,
      descendantMemberships: f.snapshots.reduce((n, s) => n + s.descendantIds.length, 0),
      runtimeArrayCallbackVisits: observed.visits(),
      isolatedCpu: measure(() => materializeModuleExecution(input), 5),
      compileCpu: measure(() => compileModule(f), 1) };
    console.log(JSON.stringify(record));
    return record;
  });
  const label = process.argv[2];
  assert.match(label, /^[a-z0-9-]+$/);
  const implementation = "packages/nui-language/src/dsl/moduleMaterialization.ts";
  writeFileSync(`${folder}/${label}.json`, JSON.stringify({
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    implementationSha256: hash(readFileSync(implementation, "utf8")), node: process.version,
    warmups: 12, trials: 21, isolatedRepetitions: 5, compileRepetitions: 1, records
  }, null, 2) + "\n");
}
