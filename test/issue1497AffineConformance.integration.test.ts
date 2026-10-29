import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import manifest from "./fixtures/issue-1497/manifest.json";

type Unit = {
  id: string; file: string; sha256: string; expected: Record<string, unknown>;
  errors?: Record<string, string>; pureErrors?: Record<string, string>; pure?: string[];
  unchanged?: Record<string, unknown>; edit?: Partial<Unit> & { file: string; sha256: string };
};
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1497_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let requests = 0, spawns = 0;
async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1497 Rust exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}
beforeAll(() => {
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      // Subscribe before a request or disposal can trigger termination.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1497_RECORD) writeFileSync(process.env.ISSUE1497_RECORD,
    JSON.stringify({ base: manifest.base, validateOnly, spawns, requests, observations }, null, 2) + "\n");
});
function compare(actual: unknown, expected: unknown, path: string, tolerance = manifest.coordinateTolerance): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const delta = Math.abs(Number(actual) - expected);
    const error = path.endsWith("AngleDeg") ? Math.min(delta, Math.abs(delta - 360)) : delta;
    expect(error, `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(path.endsWith("length") ? tolerance : manifest.coordinateTolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, `${path}[${i}]`, tolerance));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    const object = expected as Record<string, unknown>;
    const localTolerance = typeof object.lengthTolerance === "number" ? object.lengthTolerance : tolerance;
    for (const [k, v] of Object.entries(object)) if (k !== "lengthTolerance") compare((actual as Record<string, unknown>)[k], v, `${path}.${k}`, localTolerance);
  } else expect(actual, path).toEqual(expected);
}
function identityFree(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(value).not.toHaveProperty("elementId");
  expect(value).not.toHaveProperty("name");
  for (const child of Object.values(value)) identityFree(child);
}

describe("#1497 sealed affine-copy mathematical conformance", () => {
  it.each(units)("$id compiler/legal production/reference oracle", async unit => {
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const failures: string[] = [];
    const priorIds = new Map<string, string>();
    for (const checkpoint of [unit, ...(unit.edit ? [{ ...unit, ...unit.edit }] : [])]) {
      const source = readFileSync(`test/fixtures/issue-1497/${checkpoint.file}`, "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      const compiled = compileCanonicalText(current, source);
      observations.push({ id: unit.id, file: checkpoint.file, phase: "compile", diagnostics: compiled.diagnostics });
      expect(compiled.status).not.toBe("fatal");
      expect(compiled.diagnostics).toEqual([]);
      current = compiled;
      if (validateOnly) continue;
      const options = buildEvaluationOptions({ compiledDocument: compiled.doc });
      const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
      expect(prepared.rustEligible).toBe(true);
      requests++;
      const payloads = [
        ["Rust", await bounded(rust.request(prepared.input)) as EvaluationPayload],
        ["TS", evaluateElementsReferencePayload(compiled.doc.document.elements, options)]
      ] as const;
      const statements = new Map(compiled.doc.statements.map((s, i) => [compiled.doc.statementMap.statementIdByStatementIndex.get(i), s.name]));
      for (const [host, payload] of payloads) {
        const result = evaluationPayloadToResult(payload);
        const record: Record<string, unknown> = { id: unit.id, file: checkpoint.file, host, payload };
        observations.push(record);
        const byName: Record<string, unknown> = {};
        const ids = new Map<string, string>();
        for (const g of result.computedGeometry.values()) {
          const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(g.elementId);
          const name = [...(origin?.instancePath ?? []).map(id => statements.get(id)), g.name].join("::");
          byName[name] = g; ids.set(name, g.elementId);
        }
        const pureByName = new Map<string, unknown>();
        const pureErrorByName = new Map<string, string>();
        for (const entry of result.computedGeometryValues?.values() ?? []) {
          const name = [...entry.occurrence.instancePath.map(id => statements.get(id)), statements.get(entry.occurrence.sourceStatementId)].join("::");
          pureByName.set(name, entry.value);
          byName[name] = entry.value;
        }
        for (const error of result.geometryValueErrors ?? []) {
          const name = [...error.occurrence.instancePath.map(id => statements.get(id)), statements.get(error.occurrence.sourceStatementId)].join("::");
          pureErrorByName.set(name, error.message);
        }
        try {
          expect(result.errors).toHaveLength(Object.keys(checkpoint.errors ?? {}).length);
          for (const [name, message] of Object.entries(checkpoint.errors ?? {})) {
            const element = compiled.doc.document.elements.find(e => e.name === name)!;
            expect(result.errors.find(e => e.elementId === element.id)?.message).toContain(message);
            expect(byName[name]).toBeUndefined();
          }
          expect(result.geometryValueErrors ?? []).toHaveLength(Object.keys(checkpoint.pureErrors ?? {}).length);
          for (const [name, message] of Object.entries(checkpoint.pureErrors ?? {})) {
            expect(pureErrorByName.get(name)).toContain(message);
            expect(pureByName.has(name)).toBe(false);
          }
          expect(result.warnings).toEqual([]);
          compare(byName.Control, { start: { x: 201, y: -103 }, end: { x: 238, y: -103 }, length: 37 }, "unaffected sibling");
          for (const [name, expected] of Object.entries(checkpoint.expected)) compare(byName[name], expected, `${host}.${name}`);
          for (const [name, expected] of Object.entries(checkpoint.unchanged ?? {})) compare(byName[name], expected, `${host}.original.${name}`);
          for (const name of [...(checkpoint.pure ?? []), ...Object.keys(checkpoint.pureErrors ?? {})]) {
            if (checkpoint.pureErrors?.[name]) continue;
            expect(pureByName.has(name), name).toBe(true);
            expect(ids.has(name), name + " must not allocate drawable identity").toBe(false);
          }
          for (const value of pureByName.values()) identityFree(value);
          if (unit.id === "V2") {
            expect(ids.get("First::Copy")).not.toBe(ids.get("Second::Copy"));
            expect(ids.get("First::Copy")).toBeTruthy(); expect(ids.get("Second::Copy")).toBeTruthy();
          }
          for (const [name, value] of Object.entries(checkpoint.expected)) {
            if (!value || typeof value !== "object" || !("segments" in value)) continue;
            const geometry = byName[name] as { length: number; segments: { kind: string; start: { x: number; y: number }; end: { x: number; y: number }; length: number }[] };
            expect(Number.isFinite(geometry.length) && geometry.length >= 0).toBe(true);
            compare(geometry.length, geometry.segments.reduce((sum, s) => sum + s.length, 0), "sum.length");
            geometry.segments.forEach((s, i) => {
              expect(Number.isFinite(s.length) && s.length > 0).toBe(true);
              if (i) compare(s.start, { x: geometry.segments[i - 1].end.x, y: geometry.segments[i - 1].end.y }, name + " authored continuity");
            });
          }
          // Same compiler document through invalid -> valid revisions keeps sibling identity.
          if (priorIds.has(host)) expect(ids.get("Control")).toBe(priorIds.get(host));
          priorIds.set(host, ids.get("Control")!);
          record.status = "PASS";
        } catch (error) { record.status = "FAIL"; record.failure = String(error); failures.push(`${host} ${checkpoint.file}: ${String(error)}`); }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});
