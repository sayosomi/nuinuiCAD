import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { SavedDocumentArtifactCache, analyzeMultiDocumentSource, documentIdFromHost } from "@nuinuicad/nui-language/workspace";
import { buildRecordImport } from "./issue1439Support";
import { createRustStdioParityClient, normalizeParityPayload } from "./evaluationParitySupport";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, evaluationResultToPayload, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";

type Cell = {
  id: string; root: number; transform: number; epoch: number; fingerprint: string;
  source: string; saved: Record<string, string>;
  expected: { scalars: Record<string, number>; points: Record<string, { x: number; y: number }>; origins: Record<string, string> };
};
const cells = JSON.parse(readFileSync("test/fixtures/issue-1484/matrix.json", "utf8")) as Cell[];
const sessions = new Map<string, { cache: SavedDocumentArtifactCache; first?: Awaited<ReturnType<typeof buildRecordImport>> }>();
let rust: ReturnType<typeof createRustStdioParityClient>;
beforeAll(() => { rust = createRustStdioParityClient(process.cwd()); }, 120_000);
afterAll(() => { rust?.dispose(); });

const checkObservations = (cell: Cell, compiled: Awaited<ReturnType<typeof buildRecordImport>>["compiled"], payload: EvaluationPayload) => {
  const result = evaluationPayloadToResult(payload);
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors ?? []).toEqual([]);
  for (const [name, value] of Object.entries(cell.expected.scalars)) {
    const binding = compiled.bindingAnalysis?.catalog.bindings.find(b => b.name === name);
    expect(binding, name).toBeDefined();
    expect(result.computedScalarBindings?.get(binding!.id), `${cell.id}/${name}`).toMatchObject({ status: "ok", value: { kind: "number", value } });
  }
  for (const [name, point] of Object.entries(cell.expected.points)) {
    const element = compiled.document?.elements.find(e => e.name === name);
    expect(element, name).toBeDefined();
    expect(result.computedGeometry.get(element!.id), `${cell.id}/${name}`).toMatchObject(point);
  }
};

const checkOrigins = (cell: Cell, result: Awaited<ReturnType<typeof buildRecordImport>>) => {
  const root = result.graph.nodes.get(result.graph.rootDocumentId)!;
  const records = root.artifact.sourceLexicalNamespace.recordSemanticAnalysis!;
  for (const [name, file] of Object.entries(cell.expected.origins)) {
    const defining = [...result.graph.nodes.values()].find(n => n.documentId.endsWith(`/${file}`))!;
    const index = defining.artifact.parsed.statements.findIndex(s => s.kind === "recordDefinition" && s.name === "R");
    const localIdentity = defining.artifact.statementIdByStatementIndex.get(index)!;
    const publicIdentity = defining.publicApi.publicEntriesByName.get("R")!.identity;
    expect(publicIdentity).toEqual({ documentId: defining.documentId, localIdentity });
    const definition = defining.artifact.sourceLexicalNamespace.recordSemanticAnalysis!.definitionsByStatementIndex.get(index)!;
    const value = [...records.valuesByStatementId.values()].find(v => v.name === name);
    expect(value, `${cell.id}/${name}`).toBeDefined();
    const originalIdentity = `record-type:${defining.documentId.length}:${defining.documentId}${localIdentity.length}:${localIdentity}`;
    expect(definition.statementId).toBe(originalIdentity);
    expect(value!.typeIdentity, `${cell.id}/${name} original nominal identity`).toBe(originalIdentity);
    if (cell.root === 3 && name === "first") {
      const wrapped = [...records.definitionsByStatementId.values()].find(d => d.name === "Wrapped")!;
      expect(wrapped.fields[0]!.type).toMatchObject({ kind: "optional", valueType: { kind: "record", identity: originalIdentity } });
      expect(wrapped.fields[1]!.type).toMatchObject({ kind: "array", elementType: { kind: "record", identity: originalIdentity } });
      for (const field of wrapped.fields) expect(field.identity.recordStatementId).toBe(wrapped.statementId);
    }
    for (const field of definition.fields) expect(field.identity.recordStatementId).toBe(definition.statementId);
    const facade = [...result.graph.nodes.values()].find(n => n.documentId.endsWith("/facade.nui"))!;
    if (file === "lib.nui") expect(facade.publicApi.publicEntriesByName.get("R")!.identity).toEqual(publicIdentity);
  }
};

it("freezes 48 distinct bundles and independent oracles before evaluation", () => {
  expect(cells).toHaveLength(48);
  expect(new Set(cells.map(c => c.id)).size).toBe(48);
  expect(new Set(cells.map(c => c.fingerprint)).size).toBe(48);
  for (const cell of cells) {
    expect(createHash("sha256").update(JSON.stringify({ source: cell.source, saved: cell.saved })).digest("hex")).toBe(cell.fingerprint);
  }
});

for (const cell of cells) it(`${cell.id}: canonical graph, origin, independent oracle and persistent Rust`, async () => {
  const key = `R${cell.root}-T${cell.transform}`;
  let session = sessions.get(key);
  if (!session) { session = { cache: new SavedDocumentArtifactCache() }; sessions.set(key, session); }
  if (cell.epoch === 0) expect(session.cache.size).toBe(0);
  else {
    expect(session.first, "E0 ran in this exact cache session").toBeDefined();
    // A dirty open dependency is a current root, never a saved loader snapshot.
    analyzeMultiDocumentSource({ kind: "root-current", documentId: documentIdFromHost("/issue1439/lib.nui"), sourceRevision: 99,
      normalizedSource: 'nui 1\nexport record R(dirty: string)' });
  }
  const result = await buildRecordImport(cell.source, cell.saved, session.cache);
  if (cell.epoch === 0) session.first = result;
  expect(result.graph.valid, JSON.stringify([...result.graph.nodes.values()].map(n => ({ id: n.documentId, diagnostics: n.sourceDiagnostics })))).toBe(true);
  expect(result.analysis.valid, JSON.stringify(result.analysis.diagnostics)).toBe(true);
  expect(result.context.valid).toBe(true);
  expect(result.errors).toEqual([]);
  checkOrigins(cell, result);
  if (cell.epoch === 1) {
    const before = session.first!.graph.nodes.get(documentIdFromHost("/issue1439/lib.nui"))!;
    const after = result.graph.nodes.get(before.documentId)!;
    expect(after.artifact.source.normalizedSource).toBe(cell.saved["lib.nui"]);
    expect(after.artifact).not.toBe(before.artifact);
    expect(after.artifact.source).not.toEqual(before.artifact.source);
    expect(before.artifact.source.normalizedSource).toContain("* 5 +");
    expect(session.cache.size).toBe(Object.keys(cell.saved).length + 1);
    for (const file of Object.keys(cell.saved).filter(name => name !== "lib.nui")) {
      const id = documentIdFromHost(`/issue1439/${file}`);
      expect(result.graph.nodes.get(id)!.artifact.parsed).toBe(session.first!.graph.nodes.get(id)!.artifact.parsed);
    }
  }
  const compiled = result.compiled;
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) throw new Error("missing canonical compilation");
  const options = buildEvaluationOptions({ evaluationLimitIndex: undefined, compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion } });
  const elements = compiled.document.elements;
  const prepared = prepareRustEvaluation(elements, options);
  expect(prepared.rustEligible).toBe(true);
  const reference = evaluateElementsReferencePayload(elements, options);
  const production = await rust.evaluateInput(prepared.input);
  if (process.env.ISSUE1484_EVIDENCE_DIR) {
    const observe = (payload: EvaluationPayload) => {
      const value = evaluationPayloadToResult(payload);
      return { errors: value.errors.map(({ elementName, message, missingDependencyId }) => ({ elementName, message, missingDependencyId })),
        scalars: Object.fromEntries(Object.keys(cell.expected.scalars).map(name => [name, value.computedScalarBindings?.get(compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === name)!.id)])),
        points: Object.fromEntries(Object.keys(cell.expected.points).map(name => [name, value.computedGeometry.get(elements.find(e => e.name === name)!.id)])) };
    };
    writeFileSync(`${process.env.ISSUE1484_EVIDENCE_DIR}/${cell.id}.json`, JSON.stringify({ id: cell.id, fingerprint: cell.fingerprint,
      expected: cell.expected, reference: observe(reference), production: observe(production) }, null, 2) + "\n");
  }
  expect.soft(() => checkObservations(cell, compiled, reference), "TS independent oracle").not.toThrow();
  expect.soft(() => checkObservations(cell, compiled, production), "Rust independent oracle").not.toThrow();
  expect(normalizeParityPayload(production)).toEqual(normalizeParityPayload(reference));
}, 30_000);

const rejected = JSON.parse(readFileSync("test/fixtures/issue-1484/rejected-candidates.json", "utf8")) as Cell[];
it("accounts for the 60 distinct inputs and retains all 12 rejected candidates", async () => {
  expect(rejected).toHaveLength(12);
  expect(new Set([...cells, ...rejected].map(c => c.fingerprint)).size).toBe(60);
  for (const cell of rejected) {
    const result = await buildRecordImport(cell.source, cell.saved);
    expect(result.graph.valid).toBe(false);
    expect(result.graph.nodes.get(result.graph.rootDocumentId)!.sourceDiagnostics).toContainEqual(
      expect.objectContaining({ code: "record-reference-invalid" })
    );
  }
}, 30_000);

it("test-only sensitivity: a fault-seeded observed nominal origin is detected", async () => {
  const cell = cells.find(c => c.id === "R4-T0-E0")!;
  const result = await buildRecordImport(cell.source, cell.saved);
  checkOrigins(cell, result);
  const root = result.graph.nodes.get(result.graph.rootDocumentId)!;
  const records = root.artifact.sourceLexicalNamespace.recordSemanticAnalysis!;
  const first = [...records.valuesByStatementId.values()].find(v => v.name === "first")!;
  const second = [...records.valuesByStatementId.values()].find(v => v.name === "second")!;
  const values = new Map(records.valuesByStatementId);
  values.set(first.statementId, { ...first, typeIdentity: second.typeIdentity });
  const nodes = new Map(result.graph.nodes);
  nodes.set(root.documentId, { ...root, artifact: { ...root.artifact, sourceLexicalNamespace: { ...root.artifact.sourceLexicalNamespace,
    recordSemanticAnalysis: { ...records, valuesByStatementId: values } } } });
  expect(() => checkOrigins(cell, { ...result, graph: { ...result.graph, nodes } })).toThrow("original nominal identity");
});

it("test-only sensitivity: fault-seeded stale post-save numeric and geometry observations are detected separately", async () => {
  const cell = cells.find(c => c.id === "R1-T0-E1")!;
  const result = await buildRecordImport(cell.source, cell.saved);
  const compiled = result.compiled;
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) throw new Error("missing compilation");
  const options = buildEvaluationOptions({ evaluationLimitIndex: undefined, compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion } });
  const payload = evaluateElementsReferencePayload(compiled.document.elements, options);
  checkObservations(cell, compiled, payload);
  const stale = cells.find(c => c.id === "R1-T0-E0")!;
  const wrongNumeric = evaluationPayloadToResult(payload);
  const binding = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "observed")!;
  wrongNumeric.computedScalarBindings!.set(binding.id, { status: "ok", type: { kind: "number" }, value: { kind: "number", value: stale.expected.scalars.observed! } });
  expect(() => checkObservations(cell, compiled, evaluationResultToPayload(wrongNumeric))).toThrow();
  const wrongGeometry = evaluationPayloadToResult(payload);
  const point = compiled.document.elements.find(e => e.name === "Result")!;
  const geometry = wrongGeometry.computedGeometry.get(point.id)!;
  wrongGeometry.computedGeometry.set(point.id, { ...geometry, ...stale.expected.points.Result! });
  expect(() => checkObservations(cell, compiled, evaluationResultToPayload(wrongGeometry))).toThrow();
});
