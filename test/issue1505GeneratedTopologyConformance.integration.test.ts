// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import type { EvaluationResult } from "../src/types/geometry";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import manifest from "./fixtures/issue-1505/manifest.json";

type Geometry = Record<string, unknown>;
type Row = { template: string; instances: string[]; path: [string, number][]; value: number; geometry: Geometry | null };
type Checkpoint = { source: string; sha256: string; rows: Row[]; geometry: Record<string, Geometry>;
  invalid: { owner: string; code: string; token: string } | null;
  refs: { consumer: string; target: string; index?: number }[]; scalars: Record<string, number>;
  hiddenInstances?: string[]; disabledInstances?: string[];
};
type Unit = { id: string; oracle: string; checkpoints: Checkpoint[] };
const primary = manifest.units as Unit[];
const units = [...primary, ...manifest.reducers as Unit[]];
const validateOnly = process.env.ISSUE1505_VALIDATE_ONLY === "1";
const observations: Record<string, unknown>[] = [];
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let cleaned = false;
let spawns = 0, requests = 0;
let builtRustBinary: { path: string; sha256: string } | undefined;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1505 Rust request/cleanup exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}
beforeAll(() => {
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  const path = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  builtRustBinary = { path, sha256: sha(readFileSync(path)) };
  rust = new RustEvaluationProcess(path, {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      if (args[0] !== path) throw new Error("Rust executable differs from Cargo output");
      spawns++;
      const child = spawn(...args);
      // Observe completion before the first request or any teardown transition.
      closed = new Promise<void>(resolveClose => {
        child.once("close", () => { cleaned = true; resolveClose(); });
        child.once("error", () => resolveClose());
      });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1505_RECORD) writeFileSync(process.env.ISSUE1505_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    manifestSha256: sha(readFileSync("test/fixtures/issue-1505/manifest.json")),
    testSha256: sha(readFileSync("test/issue1505GeneratedTopologyConformance.integration.test.ts")),
    validateOnly, spawns, requests, builtRustBinary, cleaned, observations
  }, null, 2) + "\n");
  if (!validateOnly) { expect(spawns).toBe(1); expect(cleaned).toBe(true); }
});

// Names here only normalize compiler-owned identities for comparison. They do
// not resolve authored references or replace the compiler's dependency graph.
function owners(c: TextCompileResult) {
  const doc = c.currentCompiled;
  const sourceName = (index: number): string => {
    const s = doc.statements[index];
    if (!s) throw new Error(`Unknown source statement ${index}`);
    const name = s.kind === "element" && s.type === "forGroup" ? required(s.attrs.find(a => a.key === "variable")?.value, "iterator")
      : s.kind === "element" && s.type === "conditionalGroup" ? "if" : s.name || s.kind;
    if (!s.enclosing) return name;
    const parent = sourceName(s.enclosing.statementIndex);
    // Else shares the conditional owner and has its own lexical branch.
    const enclosing = s.enclosing as typeof s.enclosing & { branch?: string };
    return `${enclosing.branch === "else" ? parent.replace(/if$/, "else") : parent}/${name}`;
  };
  const byId = new Map([...doc.statementMap?.statementIdByStatementIndex ?? []].map(([i, id]) => [id, sourceName(i)]));
  const elementOwner = (id: string): { template: string; instances: string[] } => {
    const origin = c.doc.moduleMaterialization?.originByRuntimeElementId.get(id);
    if (origin) return { template: required(byId.get(origin.sourceStatementId), id), instances: origin.instancePath.map(i => required(byId.get(i), i)) };
    const statement = c.doc.statementMap.byElementId.get(id);
    return { template: required(statement && byId.get(c.doc.statementMap.statementIdByStatementIndex.get(statement.statementIndex)!), id), instances: [] };
  };
  return { byId, elementOwner };
}
function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Missing canonical owner: ${name}`);
  return value;
}
const key = (r: Pick<Row, "template" | "instances" | "path">) => [...r.instances, r.template, JSON.stringify(r.path)].join("|");
const rootKey = (owner: { template: string; instances: string[] }) => [...owner.instances, owner.template].join("|");
function compare(actual: unknown, expected: unknown, label: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, label).toBe("number");
    expect(Math.abs(Number(actual) - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(manifest.coordinateTolerance);
  } else if (expected && typeof expected === "object") {
    expect(actual, label).toBeTruthy();
    for (const [k, v] of Object.entries(expected)) compare((actual as Geometry)[k], v, `${label}.${k}`);
  } else expect(actual, label).toEqual(expected);
}
function normalized(c: TextCompileResult, result: EvaluationResult) {
  const n = owners(c);
  const rows = (result.forGroupGeneratedRows ?? []).map(row => ({
    ...n.elementOwner(row.templateElementId),
    path: row.occurrencePath.map(step => [n.elementOwner(step.templateForGroupId).template, step.iterationIndex] as [string, number]),
    value: row.variableValue,
    geometry: result.computedGeometry.get(row.generatedElementId) ?? null,
    generatedId: row.generatedElementId
  }));
  const rowById = new Map(rows.map(row => [row.generatedId, row]));
  const geometry = new Map([...result.computedGeometry].map(([id, g]) => [rowById.has(id) ? key(rowById.get(id)!) : rootKey(n.elementOwner(id)), g]));
  return { rows, geometry };
}
function dependencySignature(c: TextCompileResult) {
  const endpoint = (node: NonNullable<TextCompileResult["typedDependencyGraph"]>["edges"][number]["from"]) => {
    const id = node.kind === "geometry-stage" ? node.ownerId : node.id;
    const origin = c.doc.moduleMaterialization?.originByRuntimeElementId.get(id);
    const names = owners(c).byId;
    return { kind: node.kind, statementIndex: node.statementIndex,
      ...(node.kind === "geometry-stage" ? { stagePath: node.stagePath } : {}),
      ...(origin ? { source: names.get(origin.sourceStatementId), instances: origin.instancePath.map(i => names.get(i)) } : {}) };
  };
  return (c.typedDependencyGraph?.edges ?? []).map(e => JSON.stringify({ kind: e.kind, from: endpoint(e.from), to: endpoint(e.to), requiredness: e.requiredness })).sort();
}

describe("#1505 sealed dynamic generated topology", () => {
  it("seals exactly 16 primary sequences of four to six checkpoints", () => {
    expect(primary.map(u => u.id)).toEqual(["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4", "M1", "M2", "M3", "M4", "N1", "N2", "N3", "N4"]);
    for (const u of units) {
      expect(u.checkpoints.length).toBeGreaterThanOrEqual(4);
      expect(u.checkpoints.length).toBeLessThanOrEqual(6);
      for (const cp of u.checkpoints) expect(sha(cp.source)).toBe(cp.sha256);
    }
  });
  it.each(units)("$id incremental/fresh × TS/persistent production Rust", async unit => {
    let current: TextCompileResult | undefined;
    const failures: string[] = [];
    const initialIds = new Map<string, string>();
    for (const [index, cp] of unit.checkpoints.entries()) {
      expect(sha(cp.source)).toBe(cp.sha256);
      current = current ? compileCanonicalText(current, cp.source) : compileFreshCanonicalText(cp.source);
      const fresh = compileFreshCanonicalText(cp.source);
      const record: Record<string, unknown> = { id: unit.id, index, sourceSha256: cp.sha256, diagnostics: current.diagnostics, bindingIssueDiagnostics: current.bindingIssueDiagnostics };
      observations.push(record);
      const check = (label: string, run: () => void) => {
        try { run(); } catch (error) { failures.push(`${unit.id}/${index}/${label}: ${String(error)}`); }
      };
      const errors = [...current.diagnostics, ...current.bindingIssueDiagnostics].filter(d => d.severity === "error");
      check("current source compilation", () => {
        expect(current!.sourceText).toBe(cp.source); expect(current!.docText).toBe(cp.source);
        expect(current!.status).not.toBe("fatal"); expect(errors).toEqual([]);
        expect(fresh.status).not.toBe("fatal"); expect([...fresh.diagnostics, ...fresh.bindingIssueDiagnostics]).toEqual([]);
        expect(current!.doc.statementMap.sourceRevision).toBe(current!.currentCompiled.spans.sourceMap.sourceRevision);
      });
      if (current.status === "fatal" || errors.length) continue;
      const n = owners(current);
      check("surviving source identities", () => {
        for (const [id, name] of n.byId) {
          const prior = initialIds.get(name);
          if (prior) expect(id, name).toBe(prior);
          initialIds.set(name, id);
        }
      });
      check("fresh/incremental typed dependencies", () => expect(dependencySignature(current!)).toEqual(dependencySignature(fresh)));
      record.dependencies = dependencySignature(current);
      if (validateOnly) {
        record.owners = [...n.byId.values()];
        continue;
      }
      for (const [mode, compiled] of [["incremental", current], ["fresh", fresh]] as const) {
        const options = buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined });
        const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
        const nc = owners(compiled);
        check(`${mode} compiled reference ownership`, () => {
          for (const ref of cp.refs) {
            const entries = [...options.geometryInputTargetsByElementId ?? []].filter(([id]) => nc.elementOwner(id).template === ref.consumer);
            expect(entries.length, ref.consumer).toBeGreaterThan(0);
            for (const [, parameters] of entries) {
              const targets = [...parameters.values()].flatMap(t => Array.isArray(t) ? t : [t]);
              const selected = targets.filter(t => t.kind === "forGroupOccurrence");
              expect(selected.some(t => t.kind === "forGroupOccurrence" && nc.elementOwner(t.templateElementId).template === ref.target), JSON.stringify(targets)).toBe(true);
              for (const target of selected) if (target.kind === "forGroupOccurrence" && ref.index !== undefined) compare(target.index, { kind: "numberLiteral", value: ref.index }, "selected index");
            }
          }
        });
        const payloads: [string, EvaluationPayload][] = [["TS", evaluateElementsReferencePayload(compiled.doc.document.elements, options)]];
        // Invalid observations are never passed as normal accepted programs.
        // Compiler-valid runtime-invalid indexes may still be Rust eligible;
        // they use the same diagnostic oracle, explicitly labelled invalid.
        check(`${mode} eligibility`, () => expect(prepared.rustEligible).toBe(true));
        if (prepared.rustEligible) {
          requests++;
          try {
            payloads.push([cp.invalid ? "Rust-invalid" : "Rust", await bounded(rust.request(prepared.input)) as EvaluationPayload]);
          } catch (error) {
            const message = String(error);
            observations.push({ id: unit.id, index, mode, host: "Rust", transportError: message });
            failures.push(`${unit.id}/${index}/${mode}/Rust request: ${message}`);
            if (message.includes("exceeded 15s") || message.includes("not available")) throw error;
          }
        }
        for (const [host, payload] of payloads) {
          const result = evaluationPayloadToResult(payload);
          const actual = normalized(compiled, result);
          observations.push({ id: unit.id, index, mode, host, rows: actual.rows, geometry: Object.fromEntries(actual.geometry), errors: result.errors, geometryValueErrors: result.geometryValueErrors, warnings: result.warnings });
          check(`${mode}/${host} unaffected and nearby positive controls`, () => {
            compare(actual.geometry.get("Control"), cp.geometry.Control, "Control");
            if (cp.geometry.Selected) compare(actual.geometry.get("Selected"), cp.geometry.Selected, "Selected");
          });
          check(`${mode}/${host} independent oracle`, () => {
            expect(new Set(actual.rows.map(key)).size).toBe(actual.rows.length);
            expect(actual.rows.map(key).sort()).toEqual(cp.rows.map(key).sort());
            for (const expected of cp.rows) {
              const found = required(actual.rows.find(r => key(r) === key(expected)), key(expected));
              expect(found.value).toBe(expected.value);
              compare(found.geometry, expected.geometry, key(expected));
              // Static templates must not leak as extra computed geometry.
              const templateId = compiled.doc.document.elements.find(e => {
                const owner = nc.elementOwner(e.id);
                return owner.template === expected.template && JSON.stringify(owner.instances) === JSON.stringify(expected.instances);
              })?.id;
              expect(result.computedGeometry.has(required(templateId, expected.template))).toBe(false);
            }
            for (const template of new Set(cp.rows.map(r => rootKey(r)))) {
              expect(actual.rows.filter(r => rootKey(r) === template).map(r => r.path)).toEqual(cp.rows.filter(r => rootKey(r) === template).map(r => r.path));
            }
            const expectedKeys = [...Object.keys(cp.geometry), ...cp.rows.filter(r => r.geometry).map(key)].sort();
            expect([...actual.geometry.keys()].sort()).toEqual(expectedKeys);
            for (const [name, geometry] of Object.entries(cp.geometry)) compare(actual.geometry.get(name), geometry, name);
            expect(result.geometryValueErrors ?? []).toEqual([]); expect(result.warnings).toEqual([]);
            if (cp.invalid) {
              expect(result.errors).toHaveLength(1);
              expect(result.errors[0].elementName).toBe(cp.invalid.owner);
              expect(result.errors[0].message).toContain(cp.invalid.code);
              const statement = compiled.doc.statements.find(s => s.name === cp.invalid!.owner)!;
              const from = cp.source.indexOf(cp.invalid.token);
              expect(from).toBeGreaterThan(0);
              expect(statement.physicalSpan.segments.some(s => s.from <= from && s.to >= from + cp.invalid!.token.length)).toBe(true);
            } else expect(result.errors).toEqual([]);
            for (const [name, expected] of Object.entries(cp.scalars)) {
              const id = [...compiled.doc.bindingAnalysis!.catalog.bindingsById].find(([, b]) => b.name === name)?.[0];
              compare(result.computedScalarBindings?.get(required(id, name)), { status: "ok", value: { kind: "number", value: expected } }, name);
            }
            for (const row of actual.rows) if (row.geometry && cp.hiddenInstances?.some(i => row.instances.includes(i))) expect(result.effectiveVisibleElementIds?.has(row.generatedId)).toBe(false);
            for (const instance of cp.disabledInstances ?? []) expect(actual.rows.some(r => r.instances.includes(instance))).toBe(false);
          });
        }
      }
    }
    observations.push({ id: unit.id, phase: "unit-result", status: failures.length ? "FAIL" : "PASS", failures });
    expect(failures).toEqual([]);
  }, 60000);
});
