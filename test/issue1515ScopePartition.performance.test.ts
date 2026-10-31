// @vitest-environment node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, describe, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { assertCompiled, hash, manifest, sourceFor } from "./issue1515PatternSupport";

const acceptanceBytes = readFileSync("test/fixtures/issue-1515/work-acceptance-v3.json");
assert.equal(hash(acceptanceBytes), JSON.parse(readFileSync("test/fixtures/issue-1515/work-seal-v3.json", "utf8")).sha256);
const workOracle = JSON.parse(acceptanceBytes.toString("utf8")) as { units: { id: string; entries: number; bound: number }[] };

const records: unknown[] = [];
afterAll(() => {
  if (process.env.ISSUE1515_WORK_RECORD) writeFileSync(process.env.ISSUE1515_WORK_RECORD, gzipSync(JSON.stringify(records, null, 2) + "\n"));
});
describe("#1515 materialized scope partition work", () => {
  for (const id of ["S-P", "M-P", "L-P", "R1", "X1"]) it(id, () => {
    const unit = manifest.units.find(u => u.id === id)!;
    const previous = compileFreshCanonicalText(sourceFor(unit.checkpoints[0]));
    const cp = unit.checkpoints[1];
    const source = sourceFor(cp);
    const calls: { method: string; length: number; visits: number; caller: string }[] = [];
    const methods = ["map", "filter", "forEach"] as const;
    const descriptors = methods.map(key => [key, Object.getOwnPropertyDescriptor(Array.prototype, key)!] as const);
    let current;
    try {
      for (const [method, descriptor] of descriptors) Object.defineProperty(Array.prototype, method, {
        ...descriptor,
        value: function(this: unknown[], callback: (...args: unknown[]) => unknown, receiver: unknown) {
          const first = this[0];
          if (!first || typeof first !== "object" || !("id" in first) || !("type" in first)) return Reflect.apply(descriptor.value, this, [callback, receiver]);
          const caller = new Error().stack?.split("\n").find(line => line.includes("/packages/nui-language/src/")) ?? "";
          if (!caller.includes("/dsl/moduleExecutionCompiler.ts")) return Reflect.apply(descriptor.value, this, [callback, receiver]);
          const call = { method, length: this.length, visits: 0, caller };
          calls.push(call);
          return Reflect.apply(descriptor.value, this, [function(this: unknown, ...args: unknown[]) {
            call.visits++;
            return Reflect.apply(callback, this, args);
          }, receiver]);
        }
      });
      current = compileCanonicalText(previous, source);
    } finally { for (const [method, descriptor] of descriptors) Object.defineProperty(Array.prototype, method, descriptor); }
    assertCompiled(current, compileFreshCanonicalText(source), cp, unit, previous);
    const entries = current.doc.document.elements.length;
    const visits = calls.reduce((n, c) => n + c.visits, 0);
    const oracle = workOracle.units.find(u => u.id === id)!;
    assert.equal(entries, oracle.entries);
    records.push({ id, file: cp.file, sourceSha256: cp.sha256, entries, calls, visits, outputSizedBound: oracle.bound });
    assert.ok(calls.length > 0, "Instrumentation must see the actual production owner");
    // Two ordered scope partitions, one parent-resolution output map and one
    // compiled-element output map, and one selected-ID output map. Scope
    // membership reuses compiler-owned keys. The v1 four-pass mistake and
    // its failed evidence are retained; this is the Human-adjudicated v3 gate.
    // Count actual callback visits across all three array forms so a change
    // from filter to forEach/map cannot conceal the same repeated work.
    assert.ok(visits <= oracle.bound, `${id}: ${visits} direct CAD-array visits exceed five output-sized passes (${oracle.bound})`);
  }, 30000);
});
