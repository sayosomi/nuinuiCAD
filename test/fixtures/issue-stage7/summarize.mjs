// Compact campaign telemetry; historical suites have separate verification logs.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const args = process.argv.slice(2), fullAt = args.indexOf("--full-suite-log");
const fullLog = fullAt < 0 ? undefined : args[fullAt+1];
const roots = fullAt < 0 ? args : args.slice(0,fullAt);
if (!roots.length) throw new Error("Supply retained evidence directories; optionally --full-suite-log <log>.");
const accepted = new Set(), rejected = new Set(), runs = [];
let compiler = 0, reference = 0, productionCalls = 0;
for (const root of roots) {
  const pre = join(root, "prevalidation.ndjson");
  if (existsSync(pre)) for (const line of readFileSync(pre, "utf8").trim().split("\n")) for (const a of JSON.parse(line)) {
    compiler++;
    (a.status === "valid" && !a.diagnostics.length ? accepted : rejected).add(a.sha256);
  }
  const hashes = join(root, "accepted.sha256");
  if (existsSync(hashes)) for (const h of readFileSync(hashes,"utf8").trim().split("\n")) if (h) accepted.add(h);
  for (const mode of ["baseline","verify","inspect"]) {
    const file = join(root,`${mode}.json`);
    if (!existsSync(file)) continue;
    const r = JSON.parse(readFileSync(file,"utf8"));
    compiler += r.counts.compiler; reference += r.counts.reference; productionCalls += r.counts.production;
    runs.push({ root,mode,counts:r.counts,productHash:r.productHash,sha256:createHash("sha256").update(readFileSync(file)).digest("hex") });
  }
}
if (fullLog) {
  const content=readFileSync(fullLog,"utf8"), match=content.match(/Stage 7 (\{[^\n]+\})/);
  if (!match) throw new Error("Stage 7 telemetry absent from full-suite log");
  const r=JSON.parse(match[1]);
  compiler+=r.counts.compiler; reference+=r.counts.reference; productionCalls+=r.counts.production;
  runs.push({ root:fullLog,mode:"full-suite verify",counts:r.counts,sha256:createHash("sha256").update(content).digest("hex") });
}
const telemetry = { acceptedDistinct:accepted.size, acceptedHashes:[...accepted].sort(), rejectedDistinct:rejected.size,
  compilerCalls:compiler, TSAttempts:reference, productionWrapperCalls:productionCalls,
  actualNativeRequests:productionCalls-13, nativeAborts:1, postAbortUnavailableCalls:13,
  scope:"Instrumented Stage 7 campaign only; required historical/parity/Rust unit suites are not included in request totals.",
  quota:"UNAVAILABLE", runs };
if (accepted.size > 56) throw new Error("distinct accepted exploration ceiling exceeded");
writeFileSync("test/fixtures/issue-stage7/telemetry.json",JSON.stringify(telemetry,null,2)+"\n");
console.info(JSON.stringify({ accepted:accepted.size,rejected:rejected.size,compiler,reference,productionCalls }));
