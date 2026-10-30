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
import manifest from "./fixtures/issue-1501/manifest.json";

type Expected = Record<string, unknown>;
type Unit = {
  id: string; file: string; sha256: string; expected: Expected;
  errors?: Record<string, string>; pure?: string[]; partitions?: string[][];
  input?: Record<string, Geometry>;
  segmentKinds?: Record<string, string[]>; slots?: Record<string, number>;
  revisions?: Partial<Unit>[];
};
type Geometry = { kind: string; elementId?: string; start?: XY; end?: XY; length: number; segments?: Geometry[]; control1?: XY; control2?: XY; intermediateSlotIds?: string[]; intermediatePointIds?: unknown[] };
type XY = { x: number; y: number };
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1501_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
const numericalChecks: { path: string; expected: number; actual: number; error: number; tolerance: number }[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;

async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1501 Rust exceeded 15s")); }, 15000);
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
      // Install completion/error listeners before request or disposal.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1501_RECORD) writeFileSync(process.env.ISSUE1501_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    validateOnly, spawns, requests, observations, numericalChecks
  }, null, 2) + "\n");
});

function compare(actual: unknown, expected: unknown, path: string, lengthTolerance = manifest.lengthTolerance, coordinateTolerance = manifest.coordinateTolerance): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const delta = Math.abs(Number(actual) - expected);
    const error = path.endsWith("AngleDeg") ? Math.min(delta, Math.abs(delta - 360)) : delta;
    const tolerance = path.endsWith("length") ? lengthTolerance : coordinateTolerance;
    numericalChecks.push({ path, expected, actual: Number(actual), error, tolerance });
    expect(error, `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, `${path}[${i}]`, lengthTolerance, coordinateTolerance));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    const object = expected as Expected;
    const localLength = typeof object.lengthTolerance === "number" ? object.lengthTolerance : lengthTolerance;
    const localCoordinates = typeof object.coordinateTolerance === "number" ? object.coordinateTolerance : coordinateTolerance;
    for (const [k, v] of Object.entries(object)) if (k !== "lengthTolerance" && k !== "coordinateTolerance") compare((actual as Expected)[k], v, `${path}.${k}`, localLength, localCoordinates);
  } else expect(actual, path).toEqual(expected);
}
function identityFree(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(value).not.toHaveProperty("elementId");
  expect(value).not.toHaveProperty("name");
  Object.values(value).forEach(identityFree);
}
function endpoints(g: Geometry): [XY, XY] {
  return g.kind === "bezierCurve" ? [g.segments![0].start!, g.segments!.at(-1)!.end!] : [g.start!, g.end!];
}
const coordinates = (p: XY): XY => ({ x: p.x, y: p.y });

// Independent Bernstein/de Casteljau oracle on the existing offset fitter's
// input snapshot. Offset subdivision count is not part of the split contract.
function verifyOffsetPartition(input: Geometry, near: Geometry, far: Geometry): void {
  const segments = input.segments!;
  expect(segments.slice(0, 2).map(s => s.kind)).toEqual(["line", "arc"]);
  compare(segments[0], { start: { x: -25, y: -5 }, end: { x: 0, y: -5 }, length: 25 }, "analytic offset line input");
  compare(segments[1], { center: { x: 0, y: 30 }, radius: 35, startAngleDeg: 270, sweepAngleDeg: 90, length: 35 * Math.PI / 2 }, "analytic offset arc input");
  expect(segments.slice(2).every(s => s.kind === "bezier")).toBe(true);
  for (const s of segments.slice(2)) {
    for (const p of [s.start!, s.control1!, s.control2!, s.end!]) expect(p.x).toBeCloseTo(35, 7);
    expect(s.start!.y).toBeLessThan(s.end!.y);
  }
  const i = segments.findIndex(s => s.kind === "bezier" && s.start!.y < 65 && s.end!.y > 65);
  expect(i).toBeGreaterThanOrEqual(2);
  const c = segments[i];
  const at = (t: number) => (1-t)**3*c.start!.y + 3*(1-t)**2*t*c.control1!.y + 3*(1-t)*t*t*c.control2!.y + t**3*c.end!.y;
  let lo = 0, hi = 1;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (at(mid) < 65) lo = mid; else hi = mid; }
  const t = (lo + hi) / 2;
  const mix = (a: XY, b: XY): XY => ({ x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t });
  const a = mix(c.start!, c.control1!), b = mix(c.control1!, c.control2!), d = mix(c.control2!, c.end!);
  const e = mix(a,b), f = mix(b,d), q = mix(e,f);
  const left = { ...c, control1: a, control2: e, end: q };
  const right = { ...c, start: q, control1: f, control2: d };
  expect(near.segments).toHaveLength(i + 1);
  expect(far.segments).toHaveLength(segments.length - i);
  expect(near.segments!.slice(0, i)).toEqual(segments.slice(0, i));
  expect(far.segments!.slice(1)).toEqual(segments.slice(i + 1));
  for (const [actual, expected] of [[near.segments![i], left], [far.segments![0], right]]) {
    for (const key of ["start", "control1", "control2", "end"] as const) compare(coordinates(actual[key]!), coordinates(expected[key]!), "offset split controls");
    expect(Math.abs(actual.length - Math.abs(actual.end!.y - actual.start!.y))).toBeLessThan(1e-6);
  }
}
function finite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object") Object.values(value).forEach(finite);
}
function tangentVector(g: Geometry, end: boolean): XY | undefined {
  const s = g.segments?.[end ? g.segments.length - 1 : 0];
  if (!s?.control1 || !s.control2) return undefined;
  const a = end ? s.control2 : s.start!, b = end ? s.end! : s.control1;
  return { x: b.x - a.x, y: b.y - a.y };
}
function verifyPublishedTangents(actual: Geometry, sealed: Geometry): void {
  if (actual.kind === "point") return;
  for (const end of [false, true]) {
    const primitive = sealed.segments?.[end ? sealed.segments.length - 1 : 0] ?? sealed;
    const arc = primitive as Geometry & { radius?: number; startAngleDeg?: number; sweepAngleDeg?: number };
    let expected: number;
    if (arc.radius !== undefined) {
      expected = arc.startAngleDeg! + (end ? arc.sweepAngleDeg! : 0) + Math.sign(arc.sweepAngleDeg!) * 90 + (end ? 180 : 0);
    } else {
      // A composite with only sealed overall endpoints has no independently
      // specified endpoint primitive here; explicit field assertions cover it.
      if (!sealed.segments && actual.kind !== "line") continue;
      const from = end ? primitive.end! : primitive.start!;
      const to = end ? primitive.control2 ?? primitive.start! : primitive.control1 ?? primitive.end!;
      expected = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    }
    compare((actual as unknown as Expected)[end ? "endTangentAngleDeg" : "startTangentAngleDeg"], ((expected % 360) + 360) % 360, "independent published tangent AngleDeg");
  }
}

describe("#1501 independently sealed split/onLine conformance", () => {
  it.each(units)("$id legal source -> persistent Rust and TS -> independent oracle", async unit => {
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const priorIds = new Map<string, Map<string, string>>();
    const failures: string[] = [];
    for (const checkpoint of [unit, ...(unit.revisions ?? []).map(r => ({ ...unit, ...r }))]) {
      const source = readFileSync(`test/fixtures/issue-1501/${checkpoint.file}`, "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      const compiled = compileCanonicalText(current, source);
      observations.push({ id: unit.id, file: checkpoint.file, phase: "compile", diagnostics: compiled.diagnostics });
      expect(compiled.status).not.toBe("fatal");
      expect(compiled.diagnostics).toEqual([]);
      current = compiled;
      const options = buildEvaluationOptions({ compiledDocument: compiled.doc });
      const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
      expect(prepared.rustEligible).toBe(true);
      if (validateOnly) continue;
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
        const byName: Record<string, Geometry> = {};
        const ids = new Map<string, string>();
        for (const g of result.computedGeometry.values()) {
          const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(g.elementId);
          const name = [...(origin?.instancePath ?? []).map(id => statements.get(id)), g.name].join("::");
          byName[name] = g as Geometry; ids.set(name, g.elementId);
        }
        for (const entry of result.computedGeometryValues?.values() ?? []) {
          const name = [...entry.occurrence.instancePath.map(id => statements.get(id)), statements.get(entry.occurrence.sourceStatementId)].join("::");
          byName[name] = entry.value as Geometry;
        }
        try {
          expect(result.errors).toHaveLength(Object.keys(checkpoint.errors ?? {}).length);
          for (const [name, message] of Object.entries(checkpoint.errors ?? {})) {
            const element = compiled.doc.document.elements.find(e => e.name === name)!;
            expect(result.errors.find(e => e.elementId === element.id)?.message).toContain(message);
            expect(byName[name]).toBeUndefined();
          }
          expect(result.geometryValueErrors ?? []).toEqual([]);
          expect(result.warnings).toEqual([]);
          compare(byName.Control, { start: { x: 201, y: -103 }, end: { x: 238, y: -103 }, length: 37 }, "unaffected sibling");
          for (const [name, expected] of Object.entries(checkpoint.expected)) {
            compare(byName[name], expected, `${host}.${name}`);
            if (ids.has(name)) verifyPublishedTangents(byName[name], expected as Geometry);
          }
          for (const name of checkpoint.pure ?? []) {
            expect(byName[name], name).toBeTruthy();
            expect(ids.has(name), name + " has occurrence identity only").toBe(false);
            identityFree(byName[name]);
          }
          for (const [nearName, farName] of checkpoint.partitions ?? []) {
            const near = byName[nearName], far = byName[farName];
            expect(ids.get(nearName), "near source publication").toBeTruthy();
            expect(ids.get(farName), "new far drawable").toBeTruthy();
            expect(ids.get(nearName)).not.toBe(ids.get(farName));
            compare(coordinates(endpoints(near)[1]), coordinates(endpoints(far)[0]), "partition continuity");
            const input = checkpoint.input?.[nearName] ?? (unit.id === "A4" ? byName.Selected : result.preMutationGeometry?.get(ids.get(nearName)!) as Geometry | undefined);
            expect(input, "pre-mutation selected input").toBeTruthy();
            compare(coordinates(endpoints(near)[0]), coordinates(endpoints(input!)[0]), "prefix starts at source start");
            compare(coordinates(endpoints(far)[1]), coordinates(endpoints(input!)[1]), "suffix ends at source end");
            // Cubic approximation bounds are checked against sealed integrals.
            if (near.kind !== "bezierCurve") expect(Math.abs(near.length + far.length - input!.length)).toBeLessThan(1e-6);
            if (unit.id === "P1") verifyOffsetPartition(input!, near, far);
            const nt = tangentVector(near, true), ft = tangentVector(far, false);
            if (nt && ft) {
              const scale = Math.hypot(nt.x, nt.y) * Math.hypot(ft.x, ft.y);
              expect(Math.abs(nt.x * ft.y - nt.y * ft.x) / scale).toBeLessThan(1e-7);
              expect(nt.x * ft.x + nt.y * ft.y).toBeGreaterThan(0);
            }
          }
          for (const [name, kinds] of Object.entries(checkpoint.segmentKinds ?? {})) expect(byName[name].segments?.map(s => s.kind)).toEqual(kinds);
          for (const [name, count] of Object.entries(checkpoint.slots ?? {})) {
            expect(byName[name].intermediateSlotIds).toHaveLength(count);
            expect(byName[name].intermediatePointIds).toHaveLength(count);
          }
          if (unit.id === "P3") {
            for (const part of ["Source", "Far", "Cut", "UseFar"]) {
              const first = ids.get(`First::${part}`)!, second = ids.get(`Second::${part}`)!;
              expect(first).toBeTruthy(); expect(second).toBeTruthy(); expect(first).not.toBe(second);
              const origins = [first, second].map(id => compiled.doc.moduleMaterialization!.originByRuntimeElementId.get(id)!);
              expect(origins[0].sourceStatementId).toBe(origins[1].sourceStatementId);
              expect(origins[0].instancePath).not.toEqual(origins[1].instancePath);
            }
          }
          for (const [name, id] of ids) {
            const prior = priorIds.get(host)?.get(name);
            if (prior) expect(id, "stable identity: " + name).toBe(prior);
          }
          priorIds.set(host, ids);
          finite(payload);
          record.status = "PASS";
        } catch (error) { record.status = "FAIL"; record.failure = String(error); failures.push(`${host} ${checkpoint.file}: ${String(error)}`); }
      }
    }
    expect(failures).toEqual([]);
  }, 60000);
});
