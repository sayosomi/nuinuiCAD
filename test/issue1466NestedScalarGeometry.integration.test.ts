import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDslSemanticOccurrenceIndex, dslSemanticIdentityKey, emptyDocument, moduleScalarBindingIdFor } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import primaries from "./fixtures/issue-1466/primaries.json";
import legalVariants from "./fixtures/issue-1466/legal-variants.json";
import extensionsReducers from "./fixtures/issue-1466/extensions-reducers.json";
import referenceOracles from "./fixtures/issue-1466/reference-oracles.json";
import supplementalOracles from "./fixtures/issue-1466/supplemental-oracles.json";
import implementationFiles from "./fixtures/issue-1466/implementation-files.json";

type NumericShape = { [key: string]: number | string | NumericShape };
type Unit = {
  id: string;
  hypothesis: string;
  source: string;
  sourceSha256: string;
  expected: { compile: string; rustEligible: boolean; geometry: Record<string, NumericShape>; scalars: Record<string, number> };
  blocked?: string[];
  rejectCode?: string;
  revision?: { from: string; to: string; geometry: Record<string, NumericShape> };
};
const extraFile = process.env.ISSUE1466_UNITS;
const units = [...primaries, ...(extraFile ? JSON.parse(readFileSync(extraFile, "utf8")) as Unit[] : extensionsReducers)] as Unit[];
const selected = process.env.ISSUE1466_ONLY?.split(",");
const records: Array<Record<string, unknown>> = [];
let rust: RustEvaluationProcess;
let responseBytes = 0;
let requests = 0;
let closed: Promise<void> | undefined;
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120_000, stdio: "inherit" });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      // Install lifecycle completion before any request or teardown transition.
      closed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
      child.stdout?.on("data", (chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > 8 * 1024 * 1024) child.kill();
      });
      return child;
    }) as typeof spawn
  });
}, 120_000);
afterAll(async () => {
  rust?.dispose();
  await closed;
  if (process.env.ISSUE1466_RECORD) {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(process.env.ISSUE1466_RECORD, gzipSync(JSON.stringify({ revision, implementationSha256: Object.fromEntries(implementationFiles.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])), requests, records }, (_k, value) => value instanceof Map ? [...value] : value)));
  }
});
const runtimePath = (doc: LastGoodDslDocument, id: string): string => {
  const element = doc.document.elements.find(e => e.id === id);
  if (!element) throw new Error(`missing runtime element ${id}`);
  return [element.parentGroupId ? runtimePath(doc, element.parentGroupId) : "", element.name].filter(Boolean).join("::");
};
const authoredPath = (doc: LastGoodDslDocument, index: number): string => {
  const statement = doc.statements[index]!;
  const parent = statement.enclosing?.statementIndex;
  return [parent === undefined ? "" : authoredPath(doc, parent), statement.name].filter(Boolean).join("::");
};
const assertIdentities = (doc: LastGoodDslDocument, source: string, unitId: string) => {
  const oracles = referenceOracles as Record<string, { consumer: string; reference: string; target: string; via?: string }[]>;
  const occurrences = createDslSemanticOccurrenceIndex(doc).occurrences;
  const indexFor = (path: string) => {
    const index = doc.statements.findIndex((_s, i) => authoredPath(doc, i) === path);
    expect(index, path).toBeGreaterThanOrEqual(0);
    return index;
  };
  const idFor = (path: string) => doc.statementMap.statementIdByStatementIndex!.get(indexFor(path))!;
  for (const oracle of oracles[unitId] ?? []) {
    const consumer = doc.statements[indexFor(oracle.consumer)]!;
    const from = source.indexOf(oracle.reference, consumer.documentRange.from);
    expect(from).toBeGreaterThanOrEqual(consumer.documentRange.from);
    expect(from + oracle.reference.length).toBeLessThanOrEqual(consumer.documentRange.to);
    const refs = occurrences.filter(o => o.kind === "reference" && o.from >= from && o.to <= from + oracle.reference.length);
    const ids = refs.flatMap(o => o.identity.kind === "module" && "statementId" in o.identity.target ? [o.identity.target.statementId] : []);
    const targetId = idFor(oracle.target);
    const viaId = oracle.via ? idFor(oracle.via) : undefined;
    const targetIndex = indexFor(oracle.target);
    const definitionIndex = doc.statements[targetIndex]!.enclosing?.statementIndex;
    const typedId = viaId && definitionIndex !== undefined
      ? moduleScalarBindingIdFor([viaId], doc.statementMap.statementIdByStatementIndex!.get(definitionIndex)!, targetId)
      : `binding:${targetId}`;
    const typed = refs.some(o => o.identity.kind === "typed" && o.identity.bindingId === typedId);
    expect(typed || (ids.includes(targetId) && (!viaId || ids.includes(viaId))), `${oracle.consumer} -> ${oracle.reference} exact authored identity`).toBe(true);
  }
};
const assertShape = (actual: unknown, expected: NumericShape, context: string) => {
  expect(actual, context).toBeDefined();
  const object = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") expect(object[key], `${context}.${key}`).toBeCloseTo(value, 8);
    else if (typeof value === "string") expect(object[key], `${context}.${key}`).toBe(value);
    else assertShape(object[key], value, `${context}.${key}`);
  }
};
const assertOracle = (payload: EvaluationPayload, doc: LastGoodDslDocument, oracle: Unit["expected"], blocked: string[]) => {
  const result = evaluationPayloadToResult(payload);
  if (!blocked.length) expect(payload.errors).toEqual([]);
  for (const [path, frozenShape] of Object.entries(oracle.geometry)) {
    const shape = { ...frozenShape };
    // CAD payload tags differ from authored declaration keywords.
    if (shape.kind === "arc") shape.kind = "arcLine";
    if (shape.kind === "bezier") shape.kind = "bezierCurve";
    const matches = payload.computedGeometry.filter(g => runtimePath(doc, g.elementId) === path);
    expect(matches, `${path} occurrence identity`).toHaveLength(1);
    assertShape(matches[0], shape, path);
  }
  expect(new Set(payload.computedGeometry.map(g => g.elementId)).size).toBe(payload.computedGeometry.length);
  for (const path of blocked) {
    const element = doc.document.elements.find(e => runtimePath(doc, e.id) === path);
    expect(element, path).toBeDefined();
    expect(result.computedGeometry.has(element!.id), path).toBe(false);
    expect(payload.errors.some(e => e.elementId === element!.id), `${path} diagnostic owner`).toBe(true);
  }
  for (const [name, value] of Object.entries(oracle.scalars)) {
    const binding = doc.bindingAnalysis?.catalog.bindings.find(b => b.name === name && b.kind === "typed");
    expect(binding, `${name} typed identity`).toBeDefined();
    expect(result.computedScalarBindings?.get(binding!.id)).toMatchObject({ status: "ok", type: { kind: "number" }, value: { kind: "number", value } });
  }
};
const evaluate = async (source: string, previous: LastGoodDslDocument | undefined, record: Record<string, unknown>) => {
  const compiled = compileCanonicalText(previous ? { sourceText: previous.sourceLines.join("\n"), docText: previous.sourceLines.join("\n"), doc: previous } : regenerateCanonicalFromModel(emptyDocument(), 1), source);
  record.source = source;
  record.compileStatus = compiled.status;
  record.diagnostics = compiled.diagnostics;
  record.bindingIssueDiagnostics = compiled.bindingIssueDiagnostics;
  if (record.rejectCode) {
    expect([...compiled.diagnostics, ...compiled.bindingIssueDiagnostics].some(d => d.severity === "error" && d.code === record.rejectCode)).toBe(true);
    record.disposition = "SUPPORTED_REJECTION";
    return undefined;
  }
  if (["C05", "R04", "X06"].includes(String(record.id))) {
    const current = compiled.currentCompiled;
    const namespace = current.sourceLexicalNamespace!;
    const pathFor = (index: number): string => {
      const statement = current.statements[index]!;
      const parent = statement.enclosing?.statementIndex;
      return [parent === undefined ? "" : pathFor(parent), statement.name].filter(Boolean).join("::");
    };
    const declarationFor = (path: string) => namespace.allDeclarations.find(d => pathFor(d.statementIndex) === path)!;
    const consumer = declarationFor(record.id === "C05" ? "Local::P" : "G::P");
    const instance = declarationFor("Copy");
    const exported = declarationFor(record.id === "C05" ? "Parent::n" : "Child::n");
    const definition = current.statements[exported.statementIndex]!.enclosing!.statementIndex;
    const definitionId = namespace.allDeclarations.find(d => d.statementIndex === definition)!.statementId;
    const expectedId = moduleScalarBindingIdFor([instance.statementId], definitionId, exported.statementId);
    const lookup = current.bindingAnalysis?.catalog.sourceNamespaceBindingResolver?.("::Copy::n", consumer.statementIndex,
      namespace.scopeIndex.scopeOfStatement.get(consumer.statementIndex)!);
    record.firstOwnerRoute = { expectedId, lookup };
    expect(lookup, "absolute root instance identity at the producing resolver").toEqual({ kind: "resolved", bindingId: expectedId });
  }
  expect(compiled.status).not.toBe("fatal");
  const doc = compiled.doc;
  record.compiler = {
    moduleSemantics: doc.moduleSemanticAnalysis,
    bindings: doc.bindingAnalysis?.catalog.bindings,
    numericBindings: doc.numericBindings,
    materializedNumericBindings: doc.materializedNumericBindings,
    scalarProgram: doc.scalarProgram,
    bindingVersions: doc.bindingVersions,
    graph: doc.typedDependencyGraph,
    materialization: doc.moduleMaterialization,
    occurrences: createDslSemanticOccurrenceIndex(doc).occurrences.map(o => ({ from: o.from, to: o.to, text: source.slice(o.from, o.to), identity: dslSemanticIdentityKey(o.identity), kind: o.kind })),
    statements: doc.statements.map((s, i) => ({ kind: s.kind, name: s.name, id: doc.statementMap.statementIdByStatementIndex?.get(i) }))
  };
  expect([...compiled.diagnostics, ...compiled.bindingIssueDiagnostics].filter(d => d.severity === "error")).toEqual([]);
  const options = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: undefined });
  const prepared = prepareRustEvaluation(doc.document.elements, options);
  record.rustEligible = prepared.rustEligible;
  record.input = prepared.input;
  expect(prepared.rustEligible, "normal Rust eligibility").toBe(true);
  responseBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  requests++;
  try {
    const payload = await Promise.race([
      rust.request(prepared.input) as Promise<EvaluationPayload>,
      new Promise<never>((_, reject) => { timer = setTimeout(() => { rust.dispose(); reject(new Error("Rust request exceeded 15 seconds")); }, 15_000); })
    ]);
    record.payload = payload;
    const reference = evaluateElementsReferencePayload(doc.document.elements, options);
    record.reference = reference;
    expect(responseBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    return { doc, payload, reference };
  } finally { clearTimeout(timer); }
};
describe("Issue #1466 frozen nested scalar geometry", () => {
  for (const unit of units.filter(u => !selected || selected.includes(u.id))) {
    it(`${unit.id}: ${unit.hypothesis}`, async () => {
      const record: Record<string, unknown> = { id: unit.id, hypothesis: unit.hypothesis, frozenOracle: unit.expected, sourceSha256: unit.sourceSha256, rejectCode: unit.rejectCode };
      records.push(record);
      expect(createHash("sha256").update(unit.source).digest("hex")).toBe(unit.sourceSha256);
      try {
        let source = unit.source;
        const legal = (legalVariants as Unit[]).find(v => v.id === unit.id);
        if (legal && unit.id === "D06") {
          const original = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
          record.originalInvalidDiagnostics = original.diagnostics;
          expect(original.diagnostics.some(d => d.code === "module-unknown-geometry-property")).toBe(true);
          record.legalVariant = legal;
          source = legal.source;
        } else if (legal) {
          record.legalVariant = legal;
          source = legal.source;
        }
        const result = await evaluate(source, undefined, record);
        if (!result) return;
        assertIdentities(result.doc, source, unit.id);
        const expected = legal?.expected ?? unit.expected;
        const supplemental = (supplementalOracles as Record<string, Record<string, NumericShape>>)[unit.id];
        for (const [path, shape] of Object.entries(supplemental ?? {})) {
          for (const payload of [result.payload, result.reference]) {
            assertShape(payload.computedGeometry.find(g => runtimePath(result.doc, g.elementId) === path), shape, path);
          }
        }
        if (unit.id === "B06") {
          record.atomicityOracle = "spec.md:1232: failed parent publishes no partial geometry; independent enabled nested sibling Safe remains (14,2)";
          for (const payload of [result.payload, result.reference]) {
            expect(payload.computedGeometry.some(g => runtimePath(result.doc, g.elementId) === "Copy::Good")).toBe(false);
          }
        }
        assertOracle(result.payload, result.doc, expected, unit.blocked ?? []);
        assertOracle(result.reference, result.doc, expected, unit.blocked ?? []);
        if (unit.revision) {
          const revised: Record<string, unknown> = {};
          record.revision = revised;
          const next = await evaluate(unit.source.replace(unit.revision.from, unit.revision.to), result.doc, revised);
          if (!next) throw new Error("unexpected revised rejection");
          const expected = { ...unit.expected, geometry: unit.revision.geometry };
          assertOracle(next.payload, next.doc, expected, []);
          assertOracle(next.reference, next.doc, expected, []);
          for (const element of result.doc.document.elements) {
            const path = runtimePath(result.doc, element.id);
            expect(next.doc.document.elements.find(e => runtimePath(next.doc, e.id) === path)?.id, `${path} stable revision identity`).toBe(element.id);
          }
        }
        record.disposition = "PASS";
      } catch (error) { record.disposition = "FAIL"; record.failure = String(error); throw error; }
    }, 20_000);
  }
});
