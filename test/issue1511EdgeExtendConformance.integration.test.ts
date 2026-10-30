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
import manifest from "./fixtures/issue-1511/manifest.json";

type Expected = Record<string, unknown>;
type Unit = {
  id: string; file: string; sha256: string; expected: Expected;
  errorCount?: number; errorContains?: string; pure?: string[]; partitions?: string[][];
  input?: Record<string, Geometry>;
  segmentKinds?: Record<string, string[]>; slots?: Record<string, number>;
  revisions?: Partial<Unit>[];
};
type Geometry = { kind: string; elementId?: string; start?: XY; end?: XY; length: number; segments?: Geometry[]; control1?: XY; control2?: XY; intermediateSlotIds?: string[]; intermediatePointIds?: unknown[] };
type XY = { x: number; y: number };
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1511_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
const numericalChecks: { path: string; expected: number; actual: number; error: number; tolerance: number }[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;

async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1511 Rust exceeded 15s")); }, 15000);
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
  if (process.env.ISSUE1511_RECORD) writeFileSync(process.env.ISSUE1511_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    validateOnly, spawns, requests,
    binarySha256: validateOnly ? null : createHash("sha256").update(readFileSync("rust-evaluator/target/debug/evaluation_stdio")).digest("hex"),
    trackedProductDiff: execFileSync("git", ["diff", manifest.base, "--", "src", "packages", "rust-evaluator"], {encoding:"utf8"}),
    observations, numericalChecks
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
    for (const [k, v] of Object.entries(object)) if (k !== "lengthTolerance" && k !== "coordinateTolerance" &&
      // Arc primitives have endpoint coordinates and sweep, but no published
      // tangent fields. Composite and drawable tangents are checked separately.
      !(path.includes(".segments[") && k.endsWith("TangentAngleDeg"))) compare((actual as Expected)[k], v, `${path}.${k}`, localLength, localCoordinates);
  } else expect(actual, path).toEqual(expected);
}
function finite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object") Object.values(value).forEach(finite);
}

describe("#1511 independently sealed edge/extend conformance", () => {
  it.each(units)("$id legal source -> persistent Rust and TS -> independent oracle", async unit => {
    let current = regenerateCanonicalFromModel(emptyDocument(), 1);
    const priorIds = new Map<string, Map<string, string>>();
    const failures: string[] = [];
    for (const checkpoint of [unit, ...(unit.revisions ?? []).map(r => ({ ...unit, ...r }))]) {
      const source = readFileSync(`test/fixtures/issue-1511/${checkpoint.file}`, "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      const compiled = compileCanonicalText(current, source);
      observations.push({ id: unit.id, file: checkpoint.file, phase: "compile", diagnostics: compiled.diagnostics, sourceRevision: compiled.doc.statementMap.sourceRevision });
      expect(compiled.status).not.toBe("fatal");
      expect(compiled.diagnostics).toEqual([]);
      current = compiled;
      const options = buildEvaluationOptions({ compiledDocument: compiled.doc });
      const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
      expect(prepared.rustEligible).toBe(true);
      expect(compiled.sourceText).toBe(source);
      if (validateOnly) continue;
      observations.push({ id: unit.id, file: checkpoint.file, phase: "lowering", sourceRevision: compiled.doc.statementMap.sourceRevision, input: prepared.input });
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
          const element = compiled.doc.document.elements.find(e => e.id === g.elementId);
          const groups: string[] = [];
          let groupId = element?.parentGroupId;
          while (groupId) {
            const group = compiled.doc.document.elements.find(e => e.id === groupId);
            if (!group) break;
            groups.unshift(group.name);
            groupId = group.parentGroupId;
          }
          const name = [...(origin?.instancePath ?? []).map(id => statements.get(id)), ...(origin ? [] : groups), g.name].join("::");
          byName[name] = g as Geometry; ids.set(name, g.elementId);
        }
        for (const entry of result.computedGeometryValues?.values() ?? []) {
          const name = [...entry.occurrence.instancePath.map(id => statements.get(id)), statements.get(entry.occurrence.sourceStatementId)].join("::");
          byName[name] = entry.value as Geometry;
        }
        record.names = Object.keys(byName);
        record.preMutationGeometry = [...(result.preMutationGeometry ?? [])];
        record.errors = result.errors;
        try {
          expect(result.errors).toHaveLength(checkpoint.errorCount ?? 0);
          if (checkpoint.errorCount && checkpoint.errorContains) {
            expect(result.errors[0].message).toContain(checkpoint.errorContains);
            expect(result.errors[0].elementName).toBe(unit.id.startsWith("T") ? "extend" : "edge");
            expect(result.errors[0].elementId).toMatch(/^transformation:/);
            expect(result.errors[0].missingDependencyId).toBe(result.errors[0].elementId);
          }
          if ((checkpoint.errorCount ?? 0) > 0) {
            // Failed operations publish the original inputs, never one moved
            // endpoint or a successful named result.
            if (unit.id === "E3") {
              compare(byName.A, {start: {x:0,y:0},end:{x:80,y:0},length:80}, "failed edge unchanged A");
              const parallel = checkpoint.file === "E3.nui";
              compare(byName.B, parallel ? {start:{x:0,y:7},end:{x:80,y:7},length:80} : {start:{x:30,y:-20},end:{x:30,y:20},length:40}, "failed edge unchanged B");
            }
            if (unit.id === "T2") compare(byName.A, {start:{x:3,y:7},end:{x:99,y:79},length:120}, "failed extend original A");
            if (unit.id === "X1") expect([...(result.transformationStageGeometry?.keys() ?? [])].some(k => k.endsWith("\0Failed"))).toBe(false);
          }
          expect(result.geometryValueErrors ?? []).toEqual([]);
          expect(result.warnings).toEqual([]);
          compare(byName.Control, { start: { x: 201, y: -103 }, end: { x: 238, y: -103 }, length: 37 }, "unaffected sibling");
          for (const [name, expected] of Object.entries(checkpoint.expected)) {
            // Identity-free path values intentionally carry controls/length only.
            // Check the full metadata on the actual named stage below.
            if (unit.id === "M1" && (name === "First" || name === "Second")) {
              const full = expected as Expected;
              compare(byName[name], { kind: full.kind, segments: full.segments, length: full.length, lengthTolerance: full.lengthTolerance }, `${host}.${name}`);
              const stage = name === "First" ? "Extended" : "Joined";
              const snapshot = result.transformationStageGeometry?.get(`${ids.get("A")}\0*\0${stage}`);
              compare(snapshot, expected, `${host}.stage.${stage}`);
            } else compare(byName[name], expected, `${host}.${name}`);
            const g = expected as Geometry;
            if (ids.has(name) && g.start && g.end && !g.segments && !("radius" in g)) {
              const angle = (Math.atan2(g.end.y - g.start.y, g.end.x - g.start.x) * 180 / Math.PI + 360) % 360;
              compare(byName[name], { startTangentAngleDeg: angle, endTangentAngleDeg: (angle + 180) % 360 }, `${host}.${name} directed tangents`);
            }
          }
          if (["T3", "X2", "X3", "B3"].includes(unit.id)) {
            const actual = byName.A;
            const before = result.preMutationGeometry?.get(ids.get("A")!) as Geometry | undefined;
            expect(before?.segments, "selected original segments").toBeTruthy();
            const kept = unit.id === "T3" ? 2 : unit.id === "X2" && checkpoint.file.includes("tangent") ? 2 : unit.id === "X3" && checkpoint.file.includes("tangent") ? 2 : 1;
            expect(actual.segments!.slice(0, kept), "untouched primitives byte-for-byte").toEqual(before!.segments!.slice(0, kept));
            for (let i = 1; i < actual.segments!.length; i++) {
              const a = actual.segments![i - 1].end!, b = actual.segments![i].start!;
              compare({x:a.x,y:a.y}, {x:b.x,y:b.y}, "segment continuity");
            }
          }
          if (unit.id === "M3") {
            for (const leaf of ["A", "B", "Station"]) {
              const first = ids.get(`First::${leaf}`)!, second = ids.get(`Second::${leaf}`)!;
              expect(first).toBeTruthy(); expect(second).toBeTruthy(); expect(first).not.toBe(second);
              const a = compiled.doc.moduleMaterialization!.originByRuntimeElementId.get(first)!;
              const b = compiled.doc.moduleMaterialization!.originByRuntimeElementId.get(second)!;
              expect(a.sourceStatementId).toBe(b.sourceStatementId);
              expect(a.instancePath).not.toEqual(b.instancePath);
            }
          }
          for (const [name,id] of ids) {
            expect(compiled.doc.document.elements.some(e => e.id === id), name + " has original drawable identity").toBe(true);
            expect(id.startsWith("transformation:")).toBe(false);
          }
          for (const [name, count] of Object.entries(checkpoint.slots ?? {})) {
            expect(byName[name].intermediateSlotIds).toHaveLength(count);
            expect(byName[name].intermediatePointIds).toHaveLength(count);
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
