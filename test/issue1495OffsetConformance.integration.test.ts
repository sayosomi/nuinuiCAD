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
import type { ComputedOffsetLineSegment, EvaluationResult } from "../src/types/geometry";
import manifest from "./fixtures/issue-1495/manifest.json";

type Point = { x: number; y: number };
type Cubic = number[][];
type Unit = {
  id: string; file: string; sha256: string; expected: Record<string, unknown>;
  errors?: Record<string, string>; warnings?: string[]; equal?: string[][];
  gaps?: string[]; pure?: string[]; pureErrors?: string[]; junction?: number[]; junctionTangents?: number[][];
  edit?: { file: string; sha256: string };
  residuals?: { path: string; cubics: Cubic[]; distance: number; skipEnds: boolean }[];
};
const units = manifest.units as unknown as Unit[];
const observations: unknown[] = [];
const validateOnly = process.env.ISSUE1495_VALIDATE_ONLY === "1";
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0;
let requests = 0;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1495 Rust exceeded 15s")); }, 15000);
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
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);

afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1495_RECORD) writeFileSync(process.env.ISSUE1495_RECORD,
    JSON.stringify({ base: manifest.base, spawns, requests, validateOnly, observations }, null, 2) + "\n");
});

function compare(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(manifest.tolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((value, i) => compare((actual as unknown[])[i], value, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    for (const [k, v] of Object.entries(expected)) compare((actual as Record<string, unknown>)[k], v, `${path}.${k}`);
  } else expect(actual, path).toEqual(expected);
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Independent de Casteljau evaluation, not production Bernstein/fitting code.
function casteljau(points: Point[], t: number): Point {
  if (points.length === 1) return points[0];
  return casteljau(points.slice(1).map((p, i) => ({ x: (1 - t) * points[i].x + t * p.x, y: (1 - t) * points[i].y + t * p.y })), t);
}
function offsetMesh(cubic: Cubic, d: number) {
  const ps = cubic.map(p => ({ x: p[0], y: p[1] }));
  const derivatives = ps.slice(1).map((p, i) => ({ x: 3 * (p.x - ps[i].x), y: 3 * (p.y - ps[i].y) }));
  return Array.from({ length: 8193 }, (_, i) => {
    const t = i / 8192, p = casteljau(ps, t), v = casteljau(derivatives, t), length = Math.hypot(v.x, v.y);
    return { t, x: p.x + d * v.y / length, y: p.y - d * v.x / length };
  });
}
function segmentShape(segments: ComputedOffsetLineSegment[]) {
  return segments.map(s => s.kind === "bezier" ? { kind: s.kind, start: { x: s.start.x, y: s.start.y }, end: { x: s.end.x, y: s.end.y }, control1: s.control1, control2: s.control2 }
    : s.kind === "arc" ? { kind: s.kind, start: { x: s.start.x, y: s.start.y }, end: { x: s.end.x, y: s.end.y }, center: { x: s.center.x, y: s.center.y }, radius: s.radius }
      : { kind: s.kind, start: { x: s.start.x, y: s.start.y }, end: { x: s.end.x, y: s.end.y } });
}

describe("#1495 sealed independent seam-offset matrix", () => {
  it.each(units)("$id legal source and independent geometry", async unit => {
    // Freeze mesh before invoking either production/reference evaluator.
    const meshes = unit.residuals?.map(r => ({ ...r, sourceMeshes: r.cubics.map(q => offsetMesh(q, r.distance)), mesh: r.cubics.flatMap(q => offsetMesh(q, r.distance)) })) ?? [];
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const failures: string[] = [];
    for (const checkpoint of [unit, ...(unit.edit ? [{ ...unit, ...unit.edit, errors: {} }] : [])]) {
      const source = readFileSync(`test/fixtures/issue-1495/${checkpoint.file}`, "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      const compiled = compileCanonicalText(current, source);
      observations.push({ id: unit.id, file: checkpoint.file, phase: "compile", status: compiled.status, diagnostics: compiled.diagnostics });
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
      for (const [host, payload] of payloads) {
        const result = evaluationPayloadToResult(payload);
        const record: Record<string, unknown> = { id: unit.id, file: checkpoint.file, host, payload };
        observations.push(record);
        const byName = Object.fromEntries([...result.computedGeometry.values()].map(g => [g.name, g]));
        const nameByStatementId = new Map(compiled.doc.statements.map((s, i) => [compiled.doc.statementMap.statementIdByStatementIndex.get(i), s.name]));
        const instanceIds: string[] = [];
        for (const g of result.computedGeometry.values()) {
          const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(g.elementId);
          if (!origin?.instancePath.length) continue;
          const qualified = [...origin.instancePath.map(id => nameByStatementId.get(id)), g.name].join("::");
          byName[qualified] = g;
          if (g.name === "Local") instanceIds.push(g.elementId);
        }
        const path = (name: string) => {
          const g = byName[name];
          expect(g, name).toBeTruthy();
          if (!g || !("segments" in g)) throw new Error(`expected path ${name}`);
          return g as { segments: ComputedOffsetLineSegment[]; length: number };
        };
        try {
          checkDiagnostics(result, checkpoint, compiled.doc.document.elements);
          if (unit.id === "C2") { expect(instanceIds).toHaveLength(2); expect(new Set(instanceIds).size).toBe(2); }
          compare(byName.ControlOffset, { start: { x: 201, y: -110 }, end: { x: 238, y: -110 }, length: 37 }, "unaffected control");
          expect(() => compare(byName.ControlOffset, { start: { y: -96 } }, "deliberately wrong side")).toThrow();
          record.wrongSideOracleRejected = true;
          for (const [name, expected] of Object.entries(checkpoint.expected)) compare(byName[name], expected, `${host}.${name}`);
          for (const name of [...(unit.pure ?? []), ...(unit.pureErrors ?? [])]) {
            const index = compiled.doc.statements.findIndex(s => s.name === name);
            const statementId = compiled.doc.statementMap.statementIdByStatementIndex.get(index)!;
            const value = [...(result.computedGeometryValues?.values() ?? [])].find(e => e.occurrence.sourceStatementId === statementId);
            expect(result.computedGeometry.has(statementId)).toBe(false);
            if (unit.pureErrors?.includes(name)) {
              expect(value).toBeUndefined();
              expect(result.geometryValueErrors?.find(e => e.occurrence.sourceStatementId === statementId)?.message).toContain("reverse");
            } else {
              expect(value?.value).toBeTruthy();
              const purePath = value!.value as { segments: ComputedOffsetLineSegment[] };
              compare(segmentShape(purePath.segments), segmentShape(path("Seam").segments), "pure geometry");
            }
          }
          for (const [a, b] of unit.equal ?? []) compare(segmentShape(path(a).segments), segmentShape(path(b).segments), `${a}=${b}`);
          if (unit.edit && checkpoint.file !== unit.file) compare(segmentShape(path("Invalid").segments), segmentShape(path("Seam").segments), "edit clears invalid sibling");
          for (const name of Object.keys(checkpoint.expected).filter(n => byName[n] && "segments" in byName[n])) {
            const g = path(name);
            expect(g.segments.length).toBeGreaterThan(0);
            let gaps = 0;
            g.segments.forEach((s, i) => {
              expect(Number.isFinite(s.length) && s.length > 0).toBe(true);
              if (s.kind === "line") compare(s.length, distance(s.start, s.end), "Euclidean line length");
              if (s.kind === "arc") compare(s.length, s.radius * Math.abs(s.sweepAngleDeg) * Math.PI / 180, "analytic arc length");
              if (s.kind === "bezier") {
                const chord = distance(s.start, s.end);
                const hull = distance(s.start, s.control1) + distance(s.control1, s.control2) + distance(s.control2, s.end);
                expect(s.length).toBeGreaterThanOrEqual(chord - 1e-7);
                expect(s.length).toBeLessThanOrEqual(hull + 1e-7);
              }
              for (const p of [s.start, s.end, ...(s.kind === "bezier" ? [s.control1, s.control2] : [])]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
              if (i && distance(g.segments[i - 1].end, s.start) > 1e-7) gaps++;
            });
            if (!(unit.gaps ?? []).includes(name)) expect(gaps, name + " continuity").toBe(0);
            compare(g.length, g.segments.reduce((n, s) => n + s.length, 0), name + " length sum");
          }
          for (const name of unit.gaps ?? []) {
            const ss = path(name).segments;
            expect(ss.some((s, i) => i && distance(ss[i - 1].end, s.start) > 1), "unsafe interior interval is removed").toBe(true);
          }
          if (unit.junction) {
            const target = { x: unit.junction[0], y: unit.junction[1] };
            const segments = path("Seam").segments;
            const i = segments.findIndex((s, i) => i < segments.length - 1 && distance(s.end, target) <= 1e-7);
            expect(i, "analytic tangent-miter junction exists").toBeGreaterThanOrEqual(0);
            compare(segments[i].end, target, "incoming tangent miter");
            compare(segments[i + 1].start, target, "outgoing tangent miter");
            const a = segments[i], b = segments[i + 1];
            const av = a.kind === "bezier" ? { x: a.end.x - a.control2.x, y: a.end.y - a.control2.y } : { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
            const bv = b.kind === "bezier" ? { x: b.control1.x - b.start.x, y: b.control1.y - b.start.y } : { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
            for (const [v, tangent] of [[av, unit.junctionTangents![0]], [bv, unit.junctionTangents![1]]] as const) {
              compare(v.x * tangent[1] - v.y * tangent[0], 0, "join control tangent preserved");
              expect(v.x * tangent[0] + v.y * tangent[1]).toBeGreaterThan(0);
            }
          }
          const residuals: unknown[] = [];
          for (const r of meshes) {
            let max = 0, samples = 0;
            const leaves = path(r.path).segments.filter(s => s.kind === "bezier");
            const sourceForLeaf = leaves.map(s => {
              if (s.kind !== "bezier") throw new Error("expected cubic leaf");
              const midpoint = casteljau([s.start, s.control1, s.control2, s.end], 0.5);
              const residuals = r.sourceMeshes.map(mesh => Math.min(...mesh.map(p => distance(p, midpoint))));
              return residuals.indexOf(Math.min(...residuals));
            });
            const joinLeaves = new Set<number>();
            // The original oracle explicitly exempts adjusted join leaves from
            // the unmodified-body residual. A parameter cutoff cannot identify
            // those leaves: one fitted leaf can span half the source curve.
            if (r.skipEnds) {
              const ends = unit.id === "B1" ? [["start"]] : unit.id === "B2" ? [["end"]] : [["end"], ["start"]];
              ends.forEach((keys, source) => {
                const indices = sourceForLeaf.flatMap((owner, i) => owner === source ? [i] : []);
                if (keys.includes("start")) joinLeaves.add(indices[0]);
                if (keys.includes("end")) joinLeaves.add(indices.at(-1)!);
              });
            }
            const adjustedResiduals: number[] = [];
            for (const [leafIndex, s] of leaves.entries()) {
              if (s.kind !== "bezier") continue;
              for (const t of [0, 0.25, 0.5, 0.75, 1]) {
                const p = casteljau([s.start, s.control1, s.control2, s.end], t);
                const nearest = r.mesh.reduce((best, candidate) => distance(p, candidate) < distance(p, best) ? candidate : best);
                if (joinLeaves.has(leafIndex)) { adjustedResiduals.push(distance(p, nearest)); continue; }
                max = Math.max(max, distance(p, nearest)); samples++;
              }
            }
            expect(samples).toBeGreaterThan(0);
            expect(max, `${r.path} independent normal residual`).toBeLessThanOrEqual(manifest.residualToleranceMm);
            residuals.push({ path: r.path, samples, maxMm: max, adjustedJoinLeaves: [...joinLeaves], adjustedJoinMaxMm: Math.max(0, ...adjustedResiduals) });
          }
          record.residuals = residuals;
          record.status = "PASS";
        } catch (error) { record.status = "FAIL"; record.failure = String(error); failures.push(`${host} ${checkpoint.file}: ${String(error)}`); }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});

function checkDiagnostics(result: EvaluationResult, unit: Unit, elements: { id: string; name: string }[]) {
  expect(result.errors).toHaveLength(Object.keys(unit.errors ?? {}).length);
  for (const [name, message] of Object.entries(unit.errors ?? {})) {
    const id = elements.find(e => e.name === name)!.id;
    expect(result.errors.find(e => e.elementId === id)?.message).toContain(message);
    expect(result.computedGeometry.has(id)).toBe(false);
  }
  expect(result.warnings.map(w => w.elementName)).toEqual(unit.warnings ?? []);
  expect(result.geometryValueErrors ?? []).toHaveLength(unit.pureErrors?.length ?? 0);
  for (const entry of result.computedGeometryValues?.values() ?? []) {
    expect(entry.value).not.toHaveProperty("elementId");
    expect(entry.value).not.toHaveProperty("name");
  }
}
