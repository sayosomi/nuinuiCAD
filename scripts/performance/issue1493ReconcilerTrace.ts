import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { assertReconciled, hash, reconcilerCases, reconcilerFixture } from "../../test/issue1493ReconcilerSupport";
import type { reconcileStatements } from "../../packages/nui-language/src/document/statementReconciler";

// Diagnostic-only counters in a temporary bundle of the exact owner. No
// production API/branch is added, and these timings are never benchmark data.
const owner = "packages/nui-language/src/document/statementReconciler.ts";
const original = readFileSync(owner, "utf8");
const replaceOnce = (text: string, from: string, to: string) => {
  assert.equal(text.split(from).length, 2, from); return text.replace(from, to);
};
let source = `export let issue1493Trace = { phase: 1, scopeCalls: Array(7).fill(0), scopeReads: Array(7).fill(0), residueVisits: Array(7).fill(0), rangeVisits: Array(7).fill(0), waves: Array(7).fill(0) };\n` + original;
source = replaceOnce(source, "  const createId = options.createId", "  issue1493Trace = { phase: 1, scopeCalls: Array(7).fill(0), scopeReads: Array(7).fill(0), residueVisits: Array(7).fill(0), rangeVisits: Array(7).fill(0), waves: Array(7).fill(0) };\n  const createId = options.createId");
source = replaceOnce(source, '  const scopeKey = (side: "old" | "new", index: number): string => {', '  const scopeKey = (side: "old" | "new", index: number): string => {\n    issue1493Trace.scopeCalls[issue1493Trace.phase]++;');
source = replaceOnce(source, "    const enclosing = statements[index].enclosing;", "    issue1493Trace.scopeReads[issue1493Trace.phase]++;\n    const enclosing = statements[index].enclosing;");
source = replaceOnce(source, "  const residueList = (residue: Set<number>) => [...residue].sort((a, b) => a - b);", "  const residueList = (residue: Set<number>) => { issue1493Trace.residueVisits[issue1493Trace.phase] += residue.size; return [...residue].sort((a, b) => a - b); };");
source = source.replace(/ {2}\/\/ ==== 段階([1-6]):/g, (_text, stage: string) => `  issue1493Trace.phase = ${stage};\n  // ==== 段階${stage}:`);
assert.equal(source.split("while (progress) {").length, 4);
source = source.replaceAll("while (progress) {", "while (progress) {\n      issue1493Trace.waves[issue1493Trace.phase]++;");
source = source.replace(/for \(let index = hunk\.(old|new)Start; index < hunk\.\1End; index \+= 1\) \{/g,
  text => text + "\n          issue1493Trace.rangeVisits[issue1493Trace.phase]++;");
const temporary = mkdtempSync(join(tmpdir(), "issue1493-trace-"));
try {
  const outfile = join(temporary, "trace.mjs");
  await build({ stdin: { contents: source, sourcefile: resolve(owner), resolveDir: dirname(resolve(owner)), loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
  const instrumented = await import(pathToFileURL(outfile).href) as {
    reconcileStatements: typeof reconcileStatements;
    issue1493Trace: { phase: number; scopeCalls: number[]; scopeReads: number[]; residueVisits: number[]; rangeVisits: number[]; waves: number[] };
  };
  const records = reconcilerCases.map(c => {
    const f = reconcilerFixture(c.shape, c.scale);
    let created = 0;
    const result = instrumented.reconcileStatements(f.input, { createId: type => `created:${type}:${++created}` });
    assertReconciled(f, result);
    return { id: f.id, ...structuredClone(instrumented.issue1493Trace) };
  });
  const label = process.argv[2]; assert.match(label, /^[a-z0-9-]+$/);
  writeFileSync(`test/fixtures/issue-1493/R/${label}-trace.json.gz`, gzipSync(JSON.stringify({ ownerSha256: hash(original), instrumentationSha256: hash(source), records })));
  console.log(`${label}: exact-oracle diagnostic replay passed for ${records.length} R units`);
} finally { rmSync(temporary, { recursive: true }); }
