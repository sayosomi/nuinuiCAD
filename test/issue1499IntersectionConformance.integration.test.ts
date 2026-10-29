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
import { findLineIntersections } from "../src/geometry/lineIntersections";
import type { LineLikeGeometryInput } from "../src/geometry/linePaths";
import manifest from "./fixtures/issue-1499/manifest.json";

type Unit = {
  id: string; file: string; sha256: string; expected: Record<string, unknown>;
  pairs: { a: string; b: string; extensions: boolean; roots: { x: number; y: number; line1Distance: number; line2Distance: number; t?: number }[] }[];
  evidence: { controls?: number[][]; reversedControls?: number[][]; secondControls?: number[][] };
  errors?: Record<string, string>; pureErrors?: Record<string, string>; pure?: string[];
  unchanged?: Record<string, unknown>; edit?: Partial<Unit> & { file: string; sha256: string };
};
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1499_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let requests = 0, spawns = 0;
async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1499 Rust exceeded 15s")); }, 15000);
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
  if (process.env.ISSUE1499_RECORD) writeFileSync(process.env.ISSUE1499_RECORD,
    JSON.stringify({ base: manifest.base, candidateHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), validateOnly, spawns, requests, observations }, null, 2) + "\n");
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

// Independent primitive residuals at the sealed source parameters. No product
// projection/refinement helper participates in this correctness oracle.
type XY = { x: number; y: number };
type Primitive = { kind: string; start: XY; end: XY; center?: XY; radius?: number; startAngleDeg?: number; sweepAngleDeg?: number; control1?: XY; control2?: XY; segments?: Primitive[] };
function primitiveResidual(g: Primitive, q: XY, t: number | undefined, extensions: boolean): number {
  if (g.segments) return Math.min(...g.segments.map(s => primitiveResidual(s, q, t, extensions)));
  if (g.kind === "arcLine" || g.kind === "arc") {
    const c = g.center!, r = g.radius!, start = g.startAngleDeg!, sweep = g.sweepAngleDeg!;
    const angle = Math.atan2(q.y - c.y, q.x - c.x) * 180 / Math.PI;
    const travel = (((sweep > 0 ? angle - start : start - angle) % 360) + 360) % 360;
    if (travel > Math.abs(sweep) + 1e-6) return Infinity;
    return Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - r);
  }
  if (g.control1 && g.control2) {
    expect(t, "sealed cubic parameter").toBeDefined();
    const u = t!, v = 1 - u;
    const at = (k: "x" | "y") => v ** 3 * g.start[k] + 3 * v * v * u * g.control1![k] + 3 * v * u * u * g.control2![k] + u ** 3 * g.end[k];
    return Math.hypot(q.x - at("x"), q.y - at("y"));
  }
  const dx = g.end.x - g.start.x, dy = g.end.y - g.start.y;
  const f = ((q.x - g.start.x) * dx + (q.y - g.start.y) * dy) / (dx * dx + dy * dy);
  if (!extensions && (f < -1e-8 || f > 1 + 1e-8)) return Infinity;
  return Math.abs(dx * (q.y - g.start.y) - dy * (q.x - g.start.x)) / Math.hypot(dx, dy);
}

describe("#1499 sealed intersection mathematical conformance", () => {
  it.each(units)("$id compiler/legal production/reference oracle", async unit => {
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const failures: string[] = [];
    const priorIds = new Map<string, string>();
    for (const checkpoint of [unit, ...(unit.edit ? [{ ...unit, ...unit.edit }] : [])]) {
      const source = readFileSync(`test/fixtures/issue-1499/${checkpoint.file}`, "utf8");
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
          for (const [name, id] of ids) {
            expect(id).toBeTruthy();
            if (name.includes("::")) {
              const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(id);
              expect(origin?.instancePath.length).toBeGreaterThan(0);
              expect(origin?.sourceStatementId).toBeTruthy();
            }
          }
          // JSON payloads must contain finite numeric data, including unselected roots.
          const finite = (v: unknown): void => {
            if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
            else if (v && typeof v === "object") Object.values(v).forEach(finite);
          };
          finite(payload);
          if (unit.id === "N1") {
            const origin = compiled.doc.moduleMaterialization!.originByRuntimeElementId.get(ids.get("Draft::Hit")!)!;
            expect(statements.get(origin.moduleDefinitionStatementId)).toBe("Notch");
            expect(origin.instancePath.map(id => statements.get(id))).toEqual(["Draft"]);
          }
          if (unit.id === "N3") {
            expect(ids.get("First::Hit")).not.toBe(ids.get("Second::Hit"));
            expect(ids.get("First::Hit")).toBeTruthy(); expect(ids.get("Second::Hit")).toBeTruthy();
            const origins = ["First::Hit", "Second::Hit"].map(n => compiled.doc.moduleMaterialization!.originByRuntimeElementId.get(ids.get(n)!)!);
            expect(origins[0].sourceStatementId).toBe(origins[1].sourceStatementId);
            expect(origins[0].instancePath).not.toEqual(origins[1].instancePath);
            expect(origins.map(o => statements.get(o.moduleDefinitionStatementId))).toEqual(["Cut", "Cut"]);
            const occurrences = [...result.computedGeometryValues!.values()].filter(e => statements.get(e.occurrence.sourceStatementId) === "Pure");
            expect(occurrences).toHaveLength(2);
            expect(occurrences[0].occurrence.sourceStatementId).toBe(occurrences[1].occurrence.sourceStatementId);
            expect(occurrences[0].occurrence.instancePath).not.toEqual(occurrences[1].occurrence.instancePath);
          }
          const controls = checkpoint.evidence.reversedControls ?? checkpoint.evidence.controls;
          if (controls) {
            const segment = (byName.A as { segments: Primitive[] }).segments[0];
            ["start", "control1", "control2", "end"].forEach((key, i) => compare(segment[key as keyof Primitive], { x: controls[i][0], y: controls[i][1] }, "authored cubic controls"));
          }
          if (checkpoint.evidence.secondControls) {
            const segment = (byName.B as { segments: Primitive[] }).segments[0];
            ["start", "control1", "control2", "end"].forEach((key, i) => compare(segment[key as keyof Primitive], { x: checkpoint.evidence.secondControls![i][0], y: checkpoint.evidence.secondControls![i][1] }, "independent cubic controls"));
          }
          for (const pair of checkpoint.pairs ?? []) {
            const a = byName[pair.a] as LineLikeGeometryInput;
            const b = byName[pair.b] as LineLikeGeometryInput;
            expect(a, pair.a).toBeTruthy(); expect(b, pair.b).toBeTruthy();
            const direct = findLineIntersections(a, b, { useExtensions: pair.extensions });
            record[pair.a + "/" + pair.b] = direct;
            expect(direct.error).toBeUndefined();
            expect(direct.intersections).toHaveLength(pair.roots.length);
            pair.roots.forEach((root, i) => {
              const actual = direct.intersections[i];
              compare(actual, { x: root.x, y: root.y }, "direct root");
              expect(primitiveResidual(a as unknown as Primitive, actual, root.t, pair.extensions), "first primitive residual").toBeLessThanOrEqual(manifest.coordinateTolerance);
              const secondT = unit.id === "B2" ? (root.x + 10) / 140 : undefined;
              expect(primitiveResidual(b as unknown as Primitive, actual, secondT, pair.extensions), "second primitive residual").toBeLessThanOrEqual(manifest.coordinateTolerance);
              for (const key of ["line1Distance", "line2Distance"] as const) {
                expect(Math.abs(actual[key] - root[key]), key).toBeLessThanOrEqual(manifest.distanceTolerance);
              }
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
