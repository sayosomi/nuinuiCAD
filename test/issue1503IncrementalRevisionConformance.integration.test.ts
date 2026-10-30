// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText, AutomationDocument, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import manifest from "./fixtures/issue-1503/manifest.json";

type Expected = Record<string, unknown>;
type Checkpoint = { file: string; sha256: string; edit: string; expected: Expected; invalid: string | null; sourceRevision: number; docIndex: number; compiledRevision: number; scalars?: Record<string, number>;
  diagnosticOracles: { channel: "diagnostics" | "bindingIssueDiagnostics"; code: string; fromOffset: number; toOffset: number }[];
  requiredDependencies: [string, string, string, string[]?][];
};
type Unit = { id: string; projection?: boolean; newIdentity?: string; newIdentities?: string[]; stable: string[]; checkpoints: Checkpoint[] };
const units = manifest.units as Unit[];
const validateOnly = process.env.ISSUE1503_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1503 Rust request exceeded 15s")); }, 15000);
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
      // Install listeners before the first request and before disposal.
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1503_RECORD) writeFileSync(process.env.ISSUE1503_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    manifestSha256: createHash("sha256").update(readFileSync("test/fixtures/issue-1503/manifest.json")).digest("hex"),
    testSha256: createHash("sha256").update(readFileSync("test/issue1503IncrementalRevisionConformance.integration.test.ts")).digest("hex"),
    validateOnly, spawns, requests, observations
  }, null, 2) + "\n");
});

// JSON string carriers retain literal CRLF/trailing spaces without weakening
// repository whitespace checks. Hash the decoded source bytes, never a formatter.
function sourceFor(file: string): string {
  const stored = readFileSync(`test/fixtures/issue-1503/${file}`, "utf8");
  return file.endsWith(".source.json") ? JSON.parse(stored) as string : stored;
}
function compare(actual: unknown, expected: unknown, path: string, lengthTolerance = manifest.lengthTolerance): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const delta = Math.abs(Number(actual) - expected);
    const error = path.endsWith("AngleDeg") ? Math.min(delta, Math.abs(delta - 360)) : delta;
    expect(error, `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(path.endsWith("length") ? lengthTolerance : manifest.coordinateTolerance);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v, i) => compare((actual as unknown[])[i], v, `${path}[${i}]`, lengthTolerance));
  } else if (expected && typeof expected === "object") {
    expect(actual, path).toBeTruthy();
    const object = expected as Expected;
    const tolerance = typeof object.lengthTolerance === "number" ? object.lengthTolerance : lengthTolerance;
    for (const [key, value] of Object.entries(object)) {
      if (key === "lengthTolerance" || key === "lengthBound") continue;
      compare((actual as Expected)[key], value, `${path}.${key}`, tolerance);
    }
  } else expect(actual, path).toEqual(expected);
}
function names(compiled: TextCompileResult) {
  const doc = compiled.currentCompiled;
  const qualified = (i: number): string => {
    const s = doc.statements[i];
    const parent = s.enclosing ? qualified(s.enclosing.statementIndex) : "";
    return [parent, "name" in s ? s.name : s.kind].filter(Boolean).join("::");
  };
  const byIndex = new Map(doc.statements.map((_, i) => [i, qualified(i)]));
  const byId = new Map([...doc.statementMap?.statementIdByStatementIndex ?? []].map(([i, id]) => [id, byIndex.get(i)!]));
  return { byIndex, byId };
}
function declarationIds(compiled: TextCompileResult): Map<string, string> {
  const n = names(compiled);
  return new Map([...compiled.currentCompiled.statementMap?.statementIdByStatementIndex ?? []].map(([i, id]) => [n.byIndex.get(i)!, id]));
}
function dependencyObservations(compiled: TextCompileResult) {
  const n = names(compiled);
  const endpoint = (v: NonNullable<TextCompileResult["typedDependencyGraph"]>["edges"][number]["from"]) => {
    const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(v.id);
    const statement = compiled.currentCompiled.statements[v.statementIndex];
    const role = statement?.kind === "transformation" ? `${statement.construction}:${statement.targets.map(t => t.source).join(",")}:${statement.stageName ?? ""}` : n.byIndex.get(v.statementIndex);
    const path = origin ? [...origin.instancePath.map(id => n.byId.get(id)), n.byId.get(origin.sourceStatementId)].join("/") : role;
    return { kind: v.kind, owner: path, ...(v.kind === "geometry-stage" ? { stagePath: v.stagePath } : {}) };
  };
  return (compiled.typedDependencyGraph?.edges ?? []).map(edge => JSON.stringify({ kind: edge.kind, from: endpoint(edge.from), to: endpoint(edge.to), reason: edge.reason, requiredness: edge.requiredness })).sort();
}

// Freeze source/oracles before running either evaluator. Continue through a
// failed observation so later sealed checkpoints remain independently tested.
describe("#1503 sealed incremental single-document revision matrix", () => {
  it.each(units)("$id incremental/fresh × reference/persistent Rust", async unit => {
    let current: TextCompileResult | undefined;
    let automation: AutomationDocument | undefined;
    let initialIds: Map<string, string> | undefined;
    let expectedRevision = 0, expectedCompiledRevision = 0;
    const failures: string[] = [];
    const introducedIds = new Map<string, string>();
    const initialRuntimeIds = new Map<string, string>();
    for (const [index, cp] of unit.checkpoints.entries()) {
      const source = sourceFor(cp.file);
      expect(createHash("sha256").update(source).digest("hex")).toBe(cp.sha256);
      const previous = current;
      const input = previous && unit.projection ? {
        sourceText: previous.sourceText, doc: previous.doc, docText: previous.docText,
        diagnostics: previous.diagnostics, bindingIssueDiagnostics: previous.bindingIssueDiagnostics,
        typedDependencyGraph: previous.typedDependencyGraph,
        currentSourceRevision: previous.currentCompiled.spans.sourceMap.sourceRevision
      } : previous;
      current = input ? compileCanonicalText(input, source) : compileFreshCanonicalText(source);
      const fresh = compileFreshCanonicalText(source);
      if (!automation) automation = AutomationDocument.fromSource(source);
      else automation.replaceSource(source);
      if (!previous || previous.sourceText !== source) expectedRevision++;
      if (previous && previous.sourceText !== source && current.doc !== previous.doc) expectedCompiledRevision++;
      const record: Expected = { id: unit.id, file: cp.file, index, edit: cp.edit,
        status: current.status, sourceRevision: current.currentCompiled.spans.sourceMap.sourceRevision,
        compiledSourceRevision: current.doc.statementMap.sourceRevision,
        diagnostics: current.diagnostics, bindingIssueDiagnostics: current.bindingIssueDiagnostics,
        freshDiagnostics: fresh.diagnostics, freshBindingIssueDiagnostics: fresh.bindingIssueDiagnostics };
      observations.push(record);
      for (const name of unit.newIdentities ?? (unit.newIdentity ? [unit.newIdentity] : [])) {
        const id = declarationIds(current).get(name);
        if (id) {
          const prior = introducedIds.get(name);
          if (prior && id !== prior) failures.push(`${cp.file} new declaration identity changed: ${name} ${prior} -> ${id}`);
          introducedIds.set(name, id);
        }
      }
      const check = (label: string, run: () => void) => {
        try { run(); } catch (error) { failures.push(`${cp.file} ${label}: ${String(error)}`); }
      };
      check("source/lifecycle", () => {
        expect(expectedRevision).toBe(cp.sourceRevision);
        expect(expectedCompiledRevision).toBe(cp.compiledRevision);
        expect(current!.sourceText).toBe(source);
        const represented = unit.checkpoints[cp.docIndex];
        expect(current!.docText).toBe(sourceFor(represented.file));
        expect(current!.doc.statementMap.sourceRevision).toBe(represented.sourceRevision);
        expect(current!.currentCompiled.spans.sourceMap.source).toBe(source.replace(/\r\n/g, "\n"));
        expect(current!.currentCompiled.spans.sourceMap.sourceRevision).toBe(expectedRevision);
        expect(automation!.getState().revision).toBe(expectedRevision - 1);
        expect(automation!.getState().compiledRevision).toBe(expectedCompiledRevision);
        expect(automation!.getState().currentCompiled.spans.sourceMap.sourceRevision).toBe(expectedRevision);
        if (current!.status === "fatal") {
          expect(current!.doc).toBe(previous!.doc);
          expect(current!.docText).toBe(previous!.docText);
        } else expect(current!.docText).toBe(source);
      });
      check("current diagnostic ownership", () => {
        for (const diagnostic of [...current!.diagnostics, ...current!.bindingIssueDiagnostics]) {
          expect(diagnostic.physicalSpan?.sourceRevision ?? diagnostic.sourceRevision).toBe(expectedRevision);
        }
        for (const oracle of cp.diagnosticOracles) {
          expect(current![oracle.channel].some(d => d.code === oracle.code &&
            d.physicalSpan?.segments.some(segment => segment.from === oracle.fromOffset && segment.to === oracle.toOffset))).toBe(true);
        }
        const normalizedDiagnostics = (c: TextCompileResult) => [c.diagnostics, c.bindingIssueDiagnostics].map(channel => channel.map(d => ({
          severity: d.severity, code: d.code, line: d.line, column: d.column, segments: d.physicalSpan?.segments
        })));
        expect(normalizedDiagnostics(current!)).toEqual(normalizedDiagnostics(fresh));
      });
      const errors = [...current.diagnostics, ...current.bindingIssueDiagnostics].filter(d => d.severity === "error");
      if (cp.invalid) {
        check("intentional error", () => {
          expect([...current!.diagnostics, ...current!.bindingIssueDiagnostics].length).toBeGreaterThan(0);
          expect([...fresh.diagnostics, ...fresh.bindingIssueDiagnostics].length).toBeGreaterThan(0);
          if (cp.invalid === "parser") expect(current!.status).toBe("fatal");
          if (cp.invalid === "binding") {
            const error = current!.bindingIssueDiagnostics.find(d => d.code === "undefined-binding");
            expect(error).toBeTruthy();
            const lines = source.split("\n"), line = lines.findIndex(l => l.includes("@missing"));
            expect(error!.line).toBe(line + 1);
            expect(error!.physicalSpan?.sourceRevision).toBe(expectedRevision);
            const offset = source.indexOf("@missing");
            expect(error!.physicalSpan?.segments).toEqual([{ from: offset, to: offset + 8 }]);
          }
          if (cp.invalid === "geometry") {
            expect(current!.currentCompiled.statements.some(s => "name" in s && s.name === "B")).toBe(false);
            const diagnostic = current!.diagnostics.find(d => d.code === "undefined-geometry-reference");
            expect(diagnostic).toBeTruthy();
            expect(diagnostic!.physicalSpan?.sourceRevision).toBe(expectedRevision);
            expect(diagnostic!.line).toBe(source.split("\n").findIndex(l => l.includes("line Edge")) + 1);
          }
        });
        record.disposition = "INTENTIONAL_ERROR";
        if (cp.invalid === "geometry") {
          // Missing geometry is an intentionally ineligible input, not a
          // production request. Prove current lowering cannot publish old B.
          const options = buildEvaluationOptions({ compiledDocument: current.doc, evaluationLimitIndex: undefined });
          const prepared = prepareRustEvaluation(current.doc.document.elements, options);
          check("invalid production guard", () => expect(prepared.rustEligible).toBe(false));
          const result = evaluationPayloadToResult(evaluateElementsReferencePayload(current.doc.document.elements, options));
          check("invalid geometry suppression", () => {
            expect(result.errors.length).toBeGreaterThan(0);
            const byName = new Map([...result.computedGeometry.values()].map(g => [g.name, g]));
            for (const name of ["B", "Edge", "Read"]) expect(byName.has(name), name).toBe(false);
            compare(byName.get("A"), { x: 2, y: -3 }, "invalid unaffected A");
            compare(byName.get("Control"), cp.expected.Control, "invalid unaffected Control");
          });
          record.runtimeErrors = result.errors;
        }
        continue; // never evaluate fatal last-good as current
      }
      check("legal source", () => {
        expect(current!.status).not.toBe("fatal"); expect(errors).toEqual([]);
        expect(fresh.status).not.toBe("fatal");
        if (!cp.invalid) expect([...fresh.diagnostics, ...fresh.bindingIssueDiagnostics]).toEqual([]);
      });
      if (errors.length || current.status === "fatal") { record.disposition = "UNEXPECTED_COMPILER_ERROR"; continue; }
      const ids = declarationIds(current);
      initialIds ??= ids;
      check("stable source identities", () => {
        for (const name of unit.stable) { expect(ids.get(name), name).toBeTruthy(); expect(ids.get(name), name).toBe(initialIds!.get(name)); }
        if (unit.id === "A3" && index === 3) expect(ids.has("Sibling")).toBe(false);
      });
      check("fresh dependency owners", () => expect(dependencyObservations(current!)).toEqual(dependencyObservations(fresh)));
      record.dependencies = dependencyObservations(current);
      check("source-derived dependency owners", () => {
        const edges = dependencyObservations(current!).map(s => JSON.parse(s) as { kind: string; from: { owner: string }; to: { owner: string; stagePath?: string[] } });
        for (const [from, to, kind, stage] of cp.requiredDependencies) {
          expect(edges.some(e => e.kind === kind && e.from.owner === from && e.to.owner === to &&
            (!stage || JSON.stringify(e.to.stagePath) === JSON.stringify(stage))), `${from} -> ${to}`).toBe(true);
        }
      });
      if (validateOnly) continue;
      for (const [mode, compiled] of [["incremental", current], ["fresh", fresh]] as const) {
        const options = buildEvaluationOptions({ compiledDocument: compiled.doc, evaluationLimitIndex: undefined });
        const prepared = prepareRustEvaluation(compiled.doc.document.elements, options);
        expect(prepared.rustEligible, cp.file + " normal production eligibility").toBe(true);
        requests++;
        const payloads = [["TS", evaluateElementsReferencePayload(compiled.doc.document.elements, options)], ["Rust", await bounded(rust.request(prepared.input)) as EvaluationPayload]] as const;
        const n = names(compiled);
        for (const [host, payload] of payloads) {
          const result = evaluationPayloadToResult(payload);
          const byName: Expected = {};
          const origins: Expected = {};
          for (const g of result.computedGeometry.values()) {
            const origin = compiled.doc.moduleMaterialization?.originByRuntimeElementId.get(g.elementId);
            const name = [...origin?.instancePath.map(id => n.byId.get(id)?.split("::").at(-1)) ?? [], g.name].join("::");
            byName[name] = g;
            if (mode === "incremental" && host === "Rust") {
              const prior = initialRuntimeIds.get(name);
              if (prior && prior !== g.elementId && !(unit.id === "E4" && name === "B")) failures.push(`${cp.file} runtime identity changed: ${name}`);
              initialRuntimeIds.set(name, g.elementId);
            }
            if (origin) origins[name] = { source: n.byId.get(origin.sourceStatementId), instancePath: origin.instancePath.map(id => n.byId.get(id)) };
          }
          const values = [...result.computedScalarBindings ?? []].map(([id, value]) => ({ name: compiled.doc.bindingAnalysis?.catalog.bindingsById.get(id)?.name, value }));
          observations.push({ id: unit.id, file: cp.file, mode, host, byName, origins, scalars: values, errors: result.errors, geometryValueErrors: result.geometryValueErrors, warnings: result.warnings });
          check(`${mode}/${host} independent oracle`, () => {
            if (cp.invalid === "geometry") {
              expect(result.errors.length).toBeGreaterThan(0);
              expect(byName.B).toBeUndefined(); expect(byName.Edge).toBeUndefined(); expect(byName.Read).toBeUndefined();
              compare(byName.A, { x: 2, y: -3 }, "invalid unaffected A");
            } else expect(result.errors).toEqual([]);
            expect(result.geometryValueErrors ?? []).toEqual([]); expect(result.warnings).toEqual([]);
            for (const [name, expected] of Object.entries(cp.expected)) compare(byName[name], expected, `${cp.file}/${mode}/${host}/${name}`);
            for (const [name, expected] of Object.entries(cp.scalars ?? {})) {
              const value = values.find(v => v.name === name)?.value;
              expect(value, name).toMatchObject({ status: "ok", type: { kind: "number" }, value: { kind: "number" } });
              if (value?.status === "ok" && value.value.kind === "number") compare(value.value.value, expected, `scalar.${name}`);
            }
            if (unit.id === "M3") {
              for (const instance of ["Left", "Right"]) for (const part of ["P", "L"]) {
                expect(origins[`${instance}::Part::${part}`]).toEqual({ source: `Outer::Inner::${part}`, instancePath: [instance, "Outer::Part"] });
              }
            }
            if (unit.id === "M4") {
              for (const instance of ["First", "Second"]) expect(origins[`${instance}::Tip`]).toEqual({ source: "Box::Local::Tip", instancePath: [instance] });
            }
            if (unit.id === "M1" || unit.id === "M2") {
              expect(origins["First::Edge"]).toMatchObject({ source: "Panel::Edge", instancePath: ["First"] });
              expect(origins["Second::Edge"]).toMatchObject({ source: "Panel::Edge", instancePath: ["Second"] });
            }
          });
        }
      }
    }
    observations.push({ id: unit.id, phase: "unit-result", status: failures.length ? "FAIL" : "PASS", failures });
    expect(failures).toEqual([]);
  }, 60000);
});
