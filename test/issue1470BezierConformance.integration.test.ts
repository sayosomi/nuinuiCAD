import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluatePreparedRust, prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import type { EvaluationResult } from "../src/types/geometry";
import manifest from "./fixtures/issue-1470/manifest.json";
import equivalents from "./fixtures/issue-1470/supported-equivalents.json";
import counterfactuals from "./fixtures/issue-1470/counterfactuals.json";

type Shape = Record<string, unknown>;
type Checkpoint = {
  file: string; sha256: string; sourceRevisionBefore: number; sourceRevisionAfter: number;
  tolerance: number; expected: Record<string, Shape>; errors: Record<string, string>;
  geometryValueErrorCount: number; wrongOracle?: Shape | null;
  expectedValues?: Record<string, Shape | null>; valueErrors?: Record<string, string>;
};
type Unit = { id: string; checkpoints: Checkpoint[] };
const units = [...manifest.units.map(unit => equivalents.units.find(e => e.id === unit.id) ?? unit), ...counterfactuals.units] as unknown as Unit[];
const observations: Shape[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0;
let requests = 0;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust.dispose(); reject(new Error("#1470 Rust request/close exceeded 15s")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}

beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      // Consume close/error before requests and before any teardown transition.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);

afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1470_RECORD) writeFileSync(process.env.ISSUE1470_RECORD, JSON.stringify({
    base: manifest.base, spawns, requests, observations
  }, null, 2) + "\n");
  if (rust) expect(spawns).toBe(1);
});

function compare(actual: unknown, expected: unknown, tolerance: number, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expect(Math.abs(Number(actual) - expected), `${path}: actual=${actual}, expected=${expected}`).toBeLessThanOrEqual(tolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((value, index) => compare((actual as unknown[])[index], value, tolerance, `${path}[${index}]`));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    Object.entries(expected).forEach(([key, value]) => compare((actual as Shape)[key], value, tolerance, `${path}.${key}`));
  } else expect(actual, path).toEqual(expected);
}

describe("#1470 independently sealed source → normally eligible persistent Rust", () => {
  it("retains the original unsupported C6 sources as CONTRACT_INVALID", () => {
    for (const unit of manifest.units.filter(u => u.id === "C6")) {
      for (const checkpoint of unit.checkpoints) {
        const source = readFileSync(`test/fixtures/issue-1470/${checkpoint.file}`, "utf8");
        expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
        const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
        expect(compiled.status).toBe("fatal");
        expect(compiled.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
          code: "module-geometry-type-mismatch", message: "このgeometry reference parameterではcoordinate形式を指定できません。"
        })]));
      }
    }
  });

  it.each(units)("$id ordered mathematical trace", async unit => {
    let current = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), "nui 1\n// #1470 initial revision\n");
    const failures: string[] = [];
    for (const checkpoint of unit.checkpoints) {
      const record: Shape = { unit: unit.id, file: checkpoint.file, expectedSha256: checkpoint.sha256 };
      observations.push(record);
      try {
        const source = readFileSync(`test/fixtures/issue-1470/${checkpoint.file}`, "utf8");
        const hash = createHash("sha256").update(source).digest("hex");
        record.actualSha256 = hash;
        expect(hash).toBe(checkpoint.sha256);
        record.sourceRevisionBefore = current.doc.statementMap.sourceRevision;
        expect(current.doc.statementMap.sourceRevision).toBe(checkpoint.sourceRevisionBefore);
        const compiled = compileCanonicalText(current, source);
        expect(compiled.sourceText).toBe(source);
        record.compileStatus = compiled.status;
        record.diagnostics = [...compiled.diagnostics, ...compiled.bindingIssueDiagnostics];
        expect(compiled.status).not.toBe("fatal");
        current = compiled;
        expect(record.diagnostics).toEqual([]);
        record.sourceRevisionAfter = compiled.doc.statementMap.sourceRevision;
        record.elementIds = Object.fromEntries(compiled.doc.document.elements.map(e => [e.name, e.id]));
        expect(compiled.doc.statementMap.sourceRevision).toBe(checkpoint.sourceRevisionAfter);
        const options = buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined });
        const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
        record.rustEligible = prepared.rustEligible;
        expect(prepared.rustEligible, "ordinary production eligibility; no bypass").toBe(true);
        const actual = await evaluatePreparedRust(prepared, async input => {
          requests++;
          return await bounded(rust.request(input)) as EvaluationPayload;
        });
        const byName = (result: EvaluationResult) => Object.fromEntries(compiled.doc.document.elements.map(e => [e.name, result.computedGeometry.get(e.id)]));
        record.geometry = byName(actual);
        record.errors = actual.errors;
        record.geometryValues = [...(actual.computedGeometryValues?.values() ?? [])];
        record.geometryValueErrors = actual.geometryValueErrors;
        const check = (result: EvaluationResult, label: string) => {
          const geometry = byName(result);
          expect(result.geometryValueErrors ?? [], label).toHaveLength(checkpoint.geometryValueErrorCount);
          expect(result.errors, label).toHaveLength(Object.keys(checkpoint.errors).length);
          for (const [name, message] of Object.entries(checkpoint.errors)) {
            const id = compiled.doc.document.elements.find(e => e.name === name)!.id;
            const error = result.errors.find(e => e.elementId === id);
            expect(error?.message, label + name).toContain(message);
            // Geometry errors belong to the failing owner, with no stale point.
            expect(error?.missingDependencyId, label + name).toBe(id);
            expect(geometry[name], label + name).toBeUndefined();
          }
          for (const [name, expected] of Object.entries(checkpoint.expected)) compare(geometry[name], expected, checkpoint.tolerance, `${label}.${name}`);
          for (const [path, expected] of Object.entries(checkpoint.expectedValues ?? {})) {
            const parts = path.split("::");
            const name = parts.at(-1)!;
            const index = compiled.doc.statements.findIndex(s => s.name === name);
            const sourceStatementId = compiled.doc.statementMap.statementIdByStatementIndex.get(index);
            expect(sourceStatementId, path).toBeDefined();
            const instanceId = parts.length === 2
              ? compiled.doc.statementMap.statementIdByStatementIndex.get(compiled.doc.statements.findIndex(s => s.name === parts[0]))
              : undefined;
            if (parts.length === 2) expect(instanceId, path).toBeDefined();
            const owns = (entry: { occurrence: { sourceStatementId: string; instancePath: readonly string[] } }) =>
              entry.occurrence.sourceStatementId === sourceStatementId &&
              (instanceId ? entry.occurrence.instancePath.length === 1 && entry.occurrence.instancePath[0] === instanceId : entry.occurrence.instancePath.length === 0);
            const entry = [...(result.computedGeometryValues?.values() ?? [])].find(owns);
            const error = result.geometryValueErrors?.find(owns);
            if (expected === null) {
              expect(entry, `${label}.${path}: failed pure value must be withheld`).toBeUndefined();
              expect(error?.message, `${label}.${path}: occurrence-owned error`).toContain(checkpoint.valueErrors![path]);
            } else {
              expect(error, path).toBeUndefined();
              compare(entry?.value, expected, checkpoint.tolerance, `${label}.${path}`);
            }
            expect(result.computedGeometry.has(sourceStatementId!), `${path}: no synthetic drawable identity`).toBe(false);
          }
          if (checkpoint.wrongOracle && checkpoint.expected.Result) {
            const good = checkpoint.expected.Result;
            const wrong = checkpoint.wrongOracle;
            if (Math.hypot(Number(good.x) - Number(wrong.x), Number(good.y) - Number(wrong.y)) > checkpoint.tolerance * 10) {
              let rejection: string | undefined;
              try { compare(geometry.Result, wrong, checkpoint.tolerance, `${label}.deliberatelyWrongOracle`); }
              catch (error) { rejection = String(error); }
              expect(rejection, "the same numeric assertion must fail for a deliberately wrong oracle").toBeDefined();
              record.wrongOracleRejected = true;
              record.wrongOracleFailures = { ...(record.wrongOracleFailures as Shape | undefined), [label]: rejection };
            }
          }
          for (const entry of result.computedGeometryValues?.values() ?? []) {
            expect(entry.value).not.toHaveProperty("elementId");
            expect(entry.value).not.toHaveProperty("name");
          }
        };
        check(actual, "persistent Rust");
        const reference = evaluationPayloadToResult(evaluateElementsReferencePayload(compiled.doc.document.elements, options));
        record.referenceGeometry = byName(reference);
        record.referenceErrors = reference.errors;
        check(reference, "TS reference control");
        record.status = "PASS";
      } catch (error) {
        record.status = "FAIL";
        record.failure = String(error);
        failures.push(`${checkpoint.file}: ${String(error)}`);
      }
    }
    expect(failures, "all sealed checkpoints must pass; failures retained in optional record").toEqual([]);
  }, 60000);
});
