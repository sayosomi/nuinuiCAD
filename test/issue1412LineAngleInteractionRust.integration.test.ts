import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import type { EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import { optionsFor } from "./evaluationParitySupport";
import adjacent from "./fixtures/issue1412/adjacent.json";
import { cells, type Cell } from "./fixtures/issue1412/cases";

const root = process.cwd();
const evidence = process.env.ISSUE1412_EVIDENCE;
const recordsIn = (v: unknown): Record<string, unknown>[] => !v || typeof v !== "object" ? [] :
  Array.isArray(v) ? v.flatMap(recordsIn) : [v as Record<string, unknown>, ...Object.values(v).flatMap(recordsIn)];
// Follow compiler products only. Both selected operands must reach the intended
// owner/stage, even where directionless angles could hide a wrong parallel path.
const reachableTargets = (value: unknown, input: EvaluateDocumentInput, seen = new Set<string>()): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.flatMap(v => reachableTargets(v, input, seen));
  if (!value || typeof value !== "object") return [];
  const target = value as Record<string, unknown>;
  let dependency: unknown;
  let key: string | undefined;
  if (target.kind === "geometryCarry") {
    key = `carry:${target.bindingId}`;
    dependency = input.bindingVersions?.immutableForGroups?.flatMap(g => g.geometryCarries ?? []).find(c => c.bindingId === target.bindingId);
  } else if (target.kind === "geometryValue") {
    key = `value:${JSON.stringify(target.occurrence)}`;
    dependency = input.geometryValueProgram?.find(entry => JSON.stringify(entry.occurrence) === JSON.stringify(target.occurrence));
  } else if (target.kind === "geometryCollectionIndex") {
    key = `collection:${target.collectionValueId}`;
    dependency = input.geometryCollectionNodes?.find(node => node.collectionValueId === target.collectionValueId);
  }
  if (key && seen.has(key)) return [];
  if (key) seen.add(key);
  return [target, ...Object.values(target).flatMap(v => reachableTargets(v, input, seen)),
    ...reachableTargets(dependency, input, seen)];
};
const admitted: Cell[] = [...(adjacent as Cell[]), ...cells.flatMap(c => [c, ...(c.contrastSource ? [{ ...c, id: `C-${c.id}`, suite: "adjacent", source: c.contrastSource, expected: 40, identity: { ...c.identity, stages: ["selected"] } }] : [])])];
const selected = process.env.ISSUE1412_IDS ? admitted.filter(c => process.env.ISSUE1412_IDS!.split(",").includes(c.id)) : admitted;

describe("Issue #1412 finite lineAngle interaction closure", () => {
  let rust: RustEvaluationProcess;
  let child: ChildProcessWithoutNullStreams;
  let writes: ReturnType<typeof vi.spyOn>;
  let closed: Promise<unknown>;
  const accepted = new Set<string>();
  beforeAll(() => {
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      try { for (const s of readFileSync(join(evidence, "accepted.ndjson"), "utf8").trim().split("\n")) if (s) accepted.add(JSON.parse(s).hash); } catch { /* first bounded session */ }
    }
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { cwd: root, timeout: 120_000, stdio: "inherit" });
    rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(root), {
      spawnProcess: ((...args: Parameters<typeof spawn>) => {
        child = spawn(...args) as ChildProcessWithoutNullStreams;
        closed = new Promise(resolve => { child.once("close", (code, signal) => resolve({ code, signal })); child.once("error", resolve); });
        writes = vi.spyOn(child.stdin, "write");
        return child;
      }) as typeof spawn
    });
  }, 130_000);
  afterAll(async () => {
    rust?.dispose();
    if (closed) await closed;
    writes?.mockRestore();
  });
  it("retains the original 768 stable Cartesian slots", () => {
    expect(cells).toHaveLength(768);
    expect(new Set(cells.map(c => c.id)).size).toBe(768);
    const union = JSON.parse(readFileSync(join(root, "test/fixtures/issue1412/coverage-union.json"), "utf8"));
    expect(union.slots.map((row: { id: string }) => row.id)).toEqual(cells.map(c => c.id));
    for (const c of admitted) {
      const row = [...union.slots, ...union.adjacent].find((row: { id: string }) => row.id === c.id);
      expect(row?.sourceSha256, c.id).toBe(createHash("sha256").update(c.source).digest("hex"));
      expect(["ALREADY-COVERED", "CONTRACT-INVALID"], c.id).toContain(row.classification);
    }
    expect(union.preExecution.novelCompilerProgramsBeforePersistence).toBe(0);
    expect(union.adjacent).toHaveLength(154);
    expect(union.uncovered).toEqual([]);
    expect(union.unresolved).toEqual([]);
    expect(union.exploration.distinctAccepted).toBeLessThanOrEqual(2400);
  });
  for (const c of selected) it(`${c.id} ${JSON.stringify(c.factors)}`, async () => {
    const record: Record<string, unknown> = { id: c.id, source: c.source, expected: c.expected, factors: c.factors };
    try {
      const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), c.source);
      const diagnostics = compiled.diagnostics.filter(d => d.severity === "error");
      record.diagnostics = diagnostics;
      if (evidence) record.semantic = compiled.currentCompiled.moduleSemanticAnalysis?.definitions.map(d => ({ name: d.name, carries: d.immutableCarries }));
      if (c.expected === "diagnostic" && c.factors.boundary === "stage") {
        expect(diagnostics.length, c.id).toBeGreaterThan(0);
        expect(diagnostics.some(d => d.code?.includes("geometry") && d.physicalSpan?.segments.length), c.id).toBe(true);
        record.status = "CONTRACT-INVALID";
        return;
      }
      expect(diagnostics, c.id).toEqual([]);
      if (!c.historical) {
        const hash = createHash("sha256").update(c.source).digest("hex");
        if (!accepted.has(hash)) {
          accepted.add(hash);
          if (evidence) appendFileSync(join(evidence, "accepted.ndjson"), JSON.stringify({ hash, id: c.id, source: c.source }) + "\n");
        }
        expect(accepted.size).toBeLessThanOrEqual(2400);
      }
      const fixture = { compiled, elements: compiled.doc.document.elements, evaluationLimitIndex: compiled.doc.document.evaluationLimitIndex };
      const options = optionsFor(fixture);
      const prepared = prepareRustEvaluation(fixture.elements, options);
      expect(prepared.rustEligible, c.id).toBe(true);
      const endpoints = recordsIn(compiled.doc.scalarProgram).filter(r => r.kind === "geometryEndpoint");
      expect(endpoints.length, c.id).toBeGreaterThanOrEqual(2);
      for (const endpoint of endpoints) expect(endpoint.target, c.id).toBeTruthy();
      const serialized = JSON.parse(JSON.stringify(prepared.input));
      const wireRecords = recordsIn(serialized);
      for (const endpoint of endpoints) expect(wireRecords, c.id).toContainEqual(endpoint);
      for (const target of wireRecords.filter(r => r.kind === "forGroupOccurrence")) {
        expect(fixture.elements.some(e => e.id === target.templateElementId), c.id).toBe(true);
      }
      const carryIds = new Set(prepared.input.bindingVersions?.immutableForGroups?.flatMap(g =>
        (g.geometryCarries ?? []).map(carry => carry.bindingId)));
      for (const target of wireRecords.filter(r => r.kind === "geometryCarry")) {
        expect(carryIds.has(String(target.bindingId)), `${c.id}: exact carry binding`).toBe(true);
      }
      const valueOccurrences = new Set(prepared.input.geometryValueProgram?.map(entry => JSON.stringify(entry.occurrence)));
      for (const target of wireRecords.filter(r => r.kind === "geometryValue" && r.occurrence)) {
        expect(valueOccurrences.has(JSON.stringify(target.occurrence)), `${c.id}: exact value occurrence`).toBe(true);
      }
      for (const name of c.identity.owners) expect(fixture.elements.some(e => e.name === name), `${c.id}: owner ${name}`).toBe(true);
      for (const stage of c.identity.stages) expect(wireRecords.some(r =>
        Array.isArray(r.stagePath) && r.stagePath.includes(stage)), `${c.id}: stage ${stage}`).toBe(true);
      const resultBinding = compiled.doc.bindingAnalysis!.catalog.bindings.find(b => b.kind === "typed" && b.name === "result")!;
      const call = compiled.doc.scalarProgram!.statements.find(statement => statement.bindingId === resultBinding.id)!.declaration.initializer;
      if (call?.kind !== "call") throw new Error(`${c.id}: missing measurement`);
      const selectedOperands = call.args.filter(arg => arg.kind === "geometryEndpoint");
      if (c.suite !== "adjacent") {
        const expected = c.suite === "P"
          ? [["A", "selected"], ["B", "chosen"]]
          : c.suite === "D" ? [["First", String(c.factors.stage)], ["Second", String(c.factors.stage)]]
            : [["Generated", c.identity.stages[0]]];
        for (const [index, [name, stage]] of expected.entries()) {
          const operand = selectedOperands[c.suite === "P" ? index : 0];
          const reachable = reachableTargets(operand, prepared.input);
          expect(reachable.some(target => fixture.elements.some(element => element.name === name &&
            (element.id === target.templateElementId || element.id === target.statementId || element.id === target.elementId)) &&
            Array.isArray(target.stagePath) && target.stagePath.join(".") === stage), `${c.id}: selected ${name}.${stage}`).toBe(true);
        }
        const instanceName = c.suite === "M" ? `Sibling${Number(c.factors.siblings) - 1}`
          : c.suite === "D" && c.factors.origin === "module-number" ? "Two"
            : c.suite === "B" && c.factors.forwarding === "module" ? "Chosen" : undefined;
        if (instanceName) {
          const instance = fixture.elements.find(e => e.type === "moduleInstance" && e.name === instanceName)!;
          const path = prepared.input.moduleMaterialization!.instances.find(i => i.instanceId === instance.id)!.instancePath;
          expect(path.every(part => JSON.stringify(selectedOperands[0]).includes(part)), `${c.id}: selected Module instance`).toBe(true);
        }
      }
      record.input = serialized;
      const ts = evaluateElementsReferencePayload(fixture.elements, options);
      record.ts = ts;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const production = await Promise.race([
        rust.request(prepared.input),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error(`${c.id}: persistent Rust timeout`)); }, 10_000); })
      ]).finally(() => clearTimeout(timer)) as EvaluationPayload;
      record.rust = production;
      const write = writes.mock.calls.at(-1)?.[0];
      expect(typeof write).toBe("string");
      const envelope = JSON.parse(String(write));
      expect(envelope.input, c.id).toEqual(serialized);
      record.wire = envelope;
      for (const payload of [ts, production]) checkResult(c, compiled, payload);
      record.status = "PASS";
    } catch (e) { record.status = "FAIL"; record.failure = String(e); throw e; }
    finally { if (evidence) writeFileSync(join(evidence, `${c.id}.json`), JSON.stringify(record, null, 2) + "\n"); }
  }, 20_000);
});
function checkResult(c: Cell, compiled: ReturnType<typeof compileCanonicalText>, payload: EvaluationPayload) {
  const result = evaluationPayloadToResult(payload);
  const binding = (name: string) => compiled.doc.bindingAnalysis!.catalog.bindings.find(b => b.kind === "typed" && b.name === name)!;
  const value = result.computedScalarBindings?.get(binding("result").id);
  if (c.expected === "diagnostic") {
    expect(value, c.id).toMatchObject({ status: "error" });
    expect(result.errors.length, c.id).toBeGreaterThan(0);
    return;
  }
  expect(result.errors, c.id).toEqual([]);
  expect(payload.geometryValueErrors ?? [], c.id).toEqual([]);
  if (c.suite === "N") {
    const owner = compiled.doc.document.elements.find(e => e.name === "Generated")!;
    const depth = Number(c.factors.depth), cardinality = Number(c.factors.cardinality);
    const rows = (payload.forGroupGeneratedRows ?? []).filter(row => row.templateElementId === owner.id);
    expect(rows, `${c.id}: flattened cardinality`).toHaveLength(cardinality ** depth);
    for (const [ordinal, row] of rows.entries()) expect(row.occurrencePath?.map(part => part.iterationIndex), c.id).toEqual(
      Array.from({ length: depth }, (_, level) => Math.floor(ordinal / cardinality ** (depth - level - 1)) % cardinality)
    );
  }
  const checks = { result: c.expected, ...c.checks };
  for (const [name, expected] of Object.entries(checks)) {
    const scalar = result.computedScalarBindings?.get(binding(name).id);
    if (scalar?.status !== "ok" || scalar.value.kind !== "number") throw new Error(`${c.id} ${name}: ${JSON.stringify(scalar)}`);
    expect(scalar.value.value, `${c.id} ${name}: ${c.oracle}`).toBeCloseTo(expected, 6);
  }
}
