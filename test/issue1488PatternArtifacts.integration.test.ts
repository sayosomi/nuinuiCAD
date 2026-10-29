import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { MultiDocumentGraphCoordinator, SavedDocumentArtifactCache, buildMultiDocumentImportGraph } from "@nuinuicad/nui-language/workspace";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { graphInput, compileGraph, id, saved } from "./issue1486Support";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation, evaluatePreparedRust, type RustEvaluationTransport } from "../src/geometry/rustEvaluationRunner";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { evaluateOutputPlan } from "../src/output/outputCore";
import { compileModulePreviewRoot } from "../src/dsl/modulePreviewRoot";
import { buildModulePreviewEvaluationOptions } from "../src/vscode/modulePreviewEvaluation";
import { projectVscodeMultiDocumentCanvasRuntime, canvasRuntimePresentationFor } from "../src/vscode/multiDocumentRuntimeTransport";
import matrix from "./fixtures/issue-1488/matrix.json";
import reducers from "./fixtures/issue-1488/reducers.json";
import rejectedAt from "./fixtures/issue-1488/rejected-missing-at.json";
import rejectedCapture from "./fixtures/issue-1488/rejected-outer-capture.json";
import historicalQueries from "./fixtures/issue1486/primary.json";
import { buildRecordImport } from "./issue1439Support";
import { compileDslDocument } from "@nuinuicad/nui-language";
import { idsFor } from "./issue1486Support";

import { compare, runtimePath, checkFile } from "./patternArtifactAssertions";

type Cell = typeof matrix[number];
type Bundle = ReturnType<typeof compileGraph>;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const records: Record<string, unknown>[] = [];
let directory: string;
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0;
let requests = 0;
let exports = 0;
const bounded = async <T,>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { rust.dispose(); reject(new Error("#1488 request exceeded 15 seconds")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
};
const transport: RustEvaluationTransport = async input => {
  requests++;
  return await bounded(rust.request(input)) as EvaluationPayload;
};
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  directory = mkdtempSync(join(tmpdir(), "nuinui-1488-"));
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
  if (process.env.ISSUE1488_RECORD) writeFileSync(process.env.ISSUE1488_RECORD, JSON.stringify({ directory, spawns, requests, exports, records }, null, 2) + "\n");
  if (directory && !process.env.ISSUE1488_KEEP_ARTIFACTS) rmSync(directory, { recursive: true, force: true });
  if (requests) expect(spawns).toBe(1);
});

const documentFor = (b: Bundle) => {
  expect(b.graph.valid, JSON.stringify([...b.graph.nodes.values()].map(n => ({ id: n.documentId, diagnostics: n.sourceDiagnostics })))).toBe(true);
  expect(b.analysis.valid, JSON.stringify(b.analysis.diagnostics)).toBe(true);
  expect([...b.compiled.diagnostics, ...(b.compiled.bindingIssueDiagnostics ?? [])].filter(d => d.severity === "error")).toEqual([]);
  expect(b.compiled.document).toBeDefined();
  expect(b.compiled.statementMap).toBeDefined();
  return b.compiled as LastGoodDslDocument;
};
const checkOrigin = (b: Bundle, documentId = id("lib.nui")) => {
  const original = b.graph.nodes.get(id("lib.nui"))!;
  const entry = original.publicApi.publicEntriesByName.get("Dim")!;
  expect(entry.identity.documentId).toBe(documentId);
  const identity = `record-type:${documentId.length}:${documentId}${entry.identity.localIdentity.length}:${entry.identity.localIdentity}`;
  const definitions = b.compiled.sourceLexicalNamespace!.recordSemanticAnalysis!.definitionsByStatementId;
  expect(definitions.get(identity)?.name).toBe("Dim");
  const dimension = [...b.compiled.sourceLexicalNamespace!.recordSemanticAnalysis!.valuesByStatementId.values()].find(v => v.name === "dimension" || v.name === "first")!;
  expect(dimension.typeIdentity).toBe(identity);
  if (b.graph.nodes.has(id("facade.nui"))) expect(b.graph.nodes.get(id("facade.nui"))!.publicApi.publicEntriesByName.get("Dim")!.identity).toEqual(entry.identity);
};
const checkGeometry = (doc: LastGoodDslDocument, result: ReturnType<typeof evaluationPayloadToResult>, cell: Cell) => {
  expect(result.errors).toEqual([]);
  expect(result.geometryValueErrors ?? []).toEqual([]);
  const geometry = Object.fromEntries([...result.computedGeometry].map(([key, shape]) => [runtimePath(doc, key), shape]));
  const relevant = Object.fromEntries(Object.entries(geometry).filter(([, shape]) => shape.kind !== "group"));
  expect(Object.keys(relevant).sort()).toEqual(Object.keys(cell.expected.geometry).sort());
  compare(relevant, cell.expected.geometry);
  for (const [elementId, shape] of result.computedGeometry) {
    if (shape.kind !== "group") expect(result.effectiveVisibleElementIds?.has(elementId), runtimePath(doc, elementId)).toBe(true);
  }
  for (const [name, value] of Object.entries(cell.expected.scalars)) {
    const binding = doc.bindingAnalysis!.catalog.bindings.find(b => b.name === name)!;
    expect(result.computedScalarBindings?.get(binding.id), name).toMatchObject({ status: "ok", value: { kind: "number", value } });
  }
  return relevant;
};

const physical = async (b: Bundle, cell: Cell, label: string) => {
  const doc = documentFor(b), results = [];
  for (const format of ["svg", "pdf"] as const) {
    const outputs = format === "svg" ? doc.document.svgOutputs : doc.document.printOutputs;
    const selected = outputs.find(o => o.name === (format === "svg" ? "Vector" : "Paper"))!;
    expect(selected).toBeDefined();
    const plan = await evaluateOutputPlan({ compiledDocument: doc, output: selected, evaluate: async (elements, options) => {
      const prepared = prepareRustEvaluation(elements, options);
      expect(prepared.rustEligible).toBe(true);
      return evaluatePreparedRust(prepared, transport);
    } });
    compare(plan.renderedBounds, cell.expected.bounds);
    expect(plan.outputId).toBe(selected.id);
    expect(plan.outputName).toBe(format === "svg" ? "Vector" : "Paper");
    expect(plan.placements).toHaveLength(cell.expected.placements.length);
    plan.placements.forEach((placement, i) => {
      const expected = cell.expected.placements[i];
      expect(runtimePath(doc, placement.groupId)).toBe(expected.group);
      compare(placement, { at: expected.at, scale: expected.scale, angleDeg: expected.angle, mirror: false, origin: { x: 0, y: 0 } });
    });
    compare(plan.drawables, cell.expected.drawables.map(shape => ({ kind: shape.kind, name: shape.name, start: shape.start, end: shape.end })));
    if (plan.print) {
      compare([plan.print.columns, plan.print.rows, plan.print.strideXmm, plan.print.strideYmm, plan.print.overlapMm], [cell.expected.columns, cell.expected.rows, 190, 277, 10]);
      compare(plan.print.pages.map(page => page.origin), cell.expected.pageOrigins);
    }
    const path = join(directory, `${label}.${format}`);
    exports++;
    expect(await bounded(rust.exportOutput({ path, payload: plan.rustPayload }))).toEqual({ exported: true });
    const bytes = readFileSync(path);
    const contents = checkFile(bytes, format, cell.expected);
    results.push({ format, path, sha256: sha(bytes), byteLength: bytes.length, contents, plan });
  }
  return results;
};

it("seals twelve independent source/state/oracle bundles before observation", () => {
  expect(matrix).toHaveLength(12);
  expect(new Set(matrix.map(c => c.id)).size).toBe(12);
  for (const cell of matrix) {
    expect(sha(cell.source)).toBe(cell.hashes.source);
    expect(sha(JSON.stringify(cell.expected))).toBe(cell.hashes.oracle);
    for (const [file, source] of Object.entries(cell.saved)) expect(sha(source)).toBe((cell.hashes.saved as Record<string, string>)[file]);
  }
});

for (let root = 1; root <= 4; root++) it(`R${root}: saved/current/cache → canonical geometry → Rust → selected physical artifacts`, async () => {
  const rootDir = join(directory, `R${root}`); mkdirSync(rootDir);
  const coordinator = new MultiDocumentGraphCoordinator();
  const cache = new SavedDocumentArtifactCache();
  // Reuse #1486's existing independent-root source; it consumes no new slot.
  const independentSource = historicalQueries.find(r => r.id === "E2")!.files["independent.nui"].text;
  await coordinator.rebuild({ ...graphInput({ "independent.nui": independentSource }, "independent.nui"), cache });
  const independentGraph = coordinator.graphForRoot(id("independent.nui"))!;
  const build = async (cell: Cell, source = cell.source, revision = cell.sourceRevision) => {
    const files = { ...cell.saved, "root.nui": source };
    const input = graphInput(files, "root.nui", revision);
    return coordinator.rebuild({ ...input, cache, loader: { async loadSavedDependency(_importer, relative) {
      const file = basename(relative), path = join(rootDir, file);
      return { status: "loaded", snapshot: saved(file, readFileSync(path, "utf8")) };
    } } });
  };
  let previous: Bundle | undefined;
  const failures: unknown[] = [];
  let baseline: { bundle: Bundle; cell: Cell } | undefined;
  let savedArtifacts: Awaited<ReturnType<typeof physical>> | undefined;
  for (const cell of matrix.filter(c => c.root === root)) {
    const record: Record<string, unknown> = { id: cell.id, hashes: cell.hashes, disposition: "UNRESOLVED" }; records.push(record);
    try {
      for (const [file, source] of Object.entries(cell.saved)) writeFileSync(join(rootDir, file), source);
      if (cell.state === 1) expect(coordinator.invalidateSavedDependency(id("lib.nui"))).toContain(id("root.nui"));
      if (cell.state === 2) {
        const dirty = await buildMultiDocumentImportGraph({ ...graphInput({ ...cell.saved, "lib.nui": cell.dirty }, "lib.nui", 99), cache });
        expect(dirty.rootSource.normalizedSource).toBe(cell.dirty);
        expect(readFileSync(join(rootDir, "lib.nui"), "utf8")).toBe(cell.saved["lib.nui"]);
        record.dirtyHash = sha(cell.dirty);
      }
      const current = await build(cell);
      expect(current.status).toBe("current");
      if (current.status !== "current") throw new Error("graph publication unavailable");
      const b = compileGraph(current.graph);
      record.semantic = [...b.compiled.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId ?? []];
      const doc = documentFor(b);
      checkOrigin(b);
      expect(doc.spans.sourceMap.source).toBe(cell.source);
      expect(doc.spans.sourceMap.sourceRevision).toBe(cell.sourceRevision);
      expect(b.graph.dependencyFingerprints.get(id("lib.nui"))).toBe(cell.hashes.saved["lib.nui"]);
      if (previous) {
        const old = previous.graph.nodes.get(id("lib.nui"))!.artifact;
        const fresh = b.graph.nodes.get(id("lib.nui"))!.artifact;
        if (cell.state === 1) expect(fresh).not.toBe(old);
        else expect(fresh).toBe(old);
        for (const [key, node] of previous.graph.nodes) {
          if (key !== id("lib.nui") && key !== id("root.nui")) expect(b.graph.nodes.get(key)!.artifact.parsed).toBe(node.artifact.parsed);
        }
      }
      expect(coordinator.graphForRoot(id("independent.nui"))).toBe(independentGraph);
      const independentDoc = documentFor(compileGraph(independentGraph));
      const independentPrepared = prepareRustEvaluation(independentDoc.document.elements, buildEvaluationOptions({ compiledDocument: independentDoc }));
      expect(independentPrepared.rustEligible).toBe(true);
      const independentResult = await evaluatePreparedRust(independentPrepared, transport);
      expect(independentResult.errors).toEqual([]);
      const independentBinding = independentDoc.bindingAnalysis!.catalog.bindings.find(b => b.name === "n")!;
      expect(independentResult.computedScalarBindings?.get(independentBinding.id)).toMatchObject({ status: "ok", value: { kind: "number", value: 41 } });
      const options = buildEvaluationOptions({ compiledDocument: doc });
      const prepared = prepareRustEvaluation(doc.document.elements, options);
      expect(prepared.rustEligible).toBe(true);
      const reference = evaluationPayloadToResult(evaluateElementsReferencePayload(doc.document.elements, options));
      checkGeometry(doc, reference, cell);
      const result = await evaluatePreparedRust(prepared, transport);
      record.geometry = checkGeometry(doc, result, cell);
      record.prepared = prepared;
      const canvas = projectVscodeMultiDocumentCanvasRuntime({ graph: b.graph, compiled: doc, graphRevision: cell.sourceRevision });
      // With no imported drawable materialization the production host uses its
      // ordinary compiled-root path; an imported record alone needs no mirror.
      expect(canvas).toBeNull();
      const canvasElements = canvas ? canvasRuntimePresentationFor(JSON.parse(JSON.stringify(canvas))).elements : doc.document.elements;
      expect(canvasElements.some(e => e.name === "Unauthored")).toBe(false);
      const canvasResult = await evaluatePreparedRust(canvas?.preparedRustEvaluation ?? prepared, transport);
      checkGeometry(doc, canvasResult, cell);
      record.canvas = canvas;
      record.artifacts = await physical(b, cell, cell.id);
      // Four independent expectation faults must be rejected by real detectors.
      expect(() => checkOrigin(b, id("facade.nui"))).toThrow();
      const artifacts = record.artifacts as Awaited<ReturnType<typeof physical>>;
      const wrongPhysical = structuredClone(cell.expected); wrongPhysical.svgMm[0] += 1;
      expect(() => checkFile(readFileSync(artifacts[0].path), "svg", wrongPhysical)).toThrow();
      const wrongPage = structuredClone(cell.expected); wrongPage.paperMm[0] += 1;
      expect(() => checkFile(readFileSync(artifacts[1].path), "pdf", wrongPage)).toThrow();
      const wrongSelection = structuredClone(cell.expected); wrongSelection.drawables.reverse();
      expect(() => checkFile(readFileSync(artifacts[0].path), "svg", wrongSelection)).toThrow();
      if (cell.state === 1) {
        if (baseline) expect(() => checkGeometry(doc, result, baseline.cell)).toThrow();
        savedArtifacts = artifacts;
      }
      if (root === 3) {
        const wrongInstance = structuredClone(cell);
        wrongInstance.expected.geometry["Left::panel::Edge"] = structuredClone(cell.expected.geometry["Right::panel::Edge"]);
        expect(() => checkGeometry(doc, result, wrongInstance)).toThrow();
        const definition = doc.moduleSemanticAnalysis!.definitions.find(d => d.name === "Panel")!;
        const preview = compileModulePreviewRoot({ source: { normalizedSource: cell.source, sourceRevision: cell.sourceRevision },
          semantic: { sourceRevision: cell.sourceRevision, sourceText: cell.source, compiled: doc },
          target: { definitionStatementId: definition.statementId, definitionStatementIndex: definition.statementIndex, name: definition.name },
          arguments: [{ name: "value", expression: "@first" }, { name: "origin", expression: "@data::out" }] });
        record.preview = preview;
        expect(preview).not.toBeNull();
        expect(preview!.diagnostics.filter(d => d.severity === "error")).toEqual([]);
        const previewPrepared = prepareRustEvaluation(preview!.compileResult.elements, buildModulePreviewEvaluationOptions(preview!));
        expect(previewPrepared.rustEligible).toBe(true);
        const previewResult = await evaluatePreparedRust(previewPrepared, transport);
        expect(previewResult.errors).toEqual([]);
        const visible = [...previewResult.computedGeometry.values()].filter(g => preview!.targetRuntimeElementIds.includes(g.elementId) && g.kind !== "group");
        expect(visible).toHaveLength(2);
        compare(visible.find(g => g.name === "Edge"), cell.expected.geometry["Left::panel::Edge"]);
        expect(visible.some(g => g.name === "NotSelected")).toBe(false);
      }
      if (cell.state === 2) {
        const restoredCell = matrix.find(c => c.root === root && c.state === 1)!;
        const restored = await build(restoredCell, restoredCell.source, 4);
        expect(restored.status).toBe("current");
        if (restored.status !== "current") throw new Error("missing restored graph");
        const restoredBundle = compileGraph(restored.graph);
        expect(restoredBundle.compiled.spans.sourceMap.source).toBe(restoredCell.source);
        expect(restoredBundle.compiled.spans.sourceMap.sourceRevision).toBe(4);
        record.restored = await physical(restoredBundle, restoredCell, `${cell.id}-restored`);
        const restoredArtifacts = record.restored as Awaited<ReturnType<typeof physical>>;
        expect(restoredArtifacts.map(a => a.sha256)).toEqual(savedArtifacts!.map(a => a.sha256));
        // Established #1486 invalid saved graph control; no stale current Canvas.
        writeFileSync(join(rootDir, "lib.nui"), "nui 1\nexport record Dim(x: Missing)");
        coordinator.invalidateSavedDependency(id("lib.nui"));
        const invalid = await build(restoredCell, restoredCell.source, 5);
        record.invalidStatus = invalid.status;
        expect(invalid.status).not.toBe("stale");
        const invalidGraph = coordinator.graphForRoot(id("root.nui"));
        expect(coordinator.graphForRoot(id("independent.nui"))).toBe(independentGraph);
        expect(invalidGraph?.valid ?? false).toBe(false);
        if (invalidGraph) {
          const invalidBundle = compileGraph(invalidGraph);
          expect(projectVscodeMultiDocumentCanvasRuntime({ graph: invalidGraph, compiled: invalidBundle.compiled, graphRevision: 5 })).toBeNull();
        }
        writeFileSync(join(rootDir, "lib.nui"), restoredCell.saved["lib.nui"]);
        coordinator.invalidateSavedDependency(id("lib.nui"));
        const recovered = await build(restoredCell, restoredCell.source, 6);
        expect(recovered.status).toBe("current");
        if (recovered.status !== "current") throw new Error("valid recovery unavailable");
        record.recovered = await physical(compileGraph(recovered.graph), restoredCell, `${cell.id}-recovered`);
      }
      if (cell.state === 0) baseline = { bundle: b, cell };
      if (baseline) {
        const oldDoc = documentFor(baseline.bundle);
        const oldResult = await evaluatePreparedRust(prepareRustEvaluation(oldDoc.document.elements, buildEvaluationOptions({ compiledDocument: oldDoc })), transport);
        checkGeometry(oldDoc, oldResult, baseline.cell);
      }
      previous = b;
      record.disposition = root === 3 ? "BUG→FIXED→REPASS" : "BASE_PASS";
    } catch (error) {
      record.error = String(error);
      if (String(error).includes("exceeded 15 seconds")) throw error;
      failures.push(error);
    }
  }
  expect(failures.map(String)).toEqual([]);
}, 120000);

for (const row of reducers) it(`${row.id}: ${row.family}`, async () => {
  const b = await buildRecordImport(row.source, row.saved);
  const record: Record<string, unknown> = { id: row.id, sourceHash: sha(row.source), oracleHash: sha(JSON.stringify(row.expected)), errors: b.errors }; records.push(record);
  expect(b.graph.valid).toBe(true);
  expect(b.analysis.valid).toBe(true);
  expect(b.errors).toEqual([]);
  const doc = b.compiled as LastGoodDslDocument;
  if (row.id === "M2" || row.id === "X2") {
    if (row.id === "X2") {
      // The same local-record source through the ordinary, non-graph compiler
      // is the nearest valid PASS control for graph identity loss in Preview.
      const local = compileDslDocument(row.source, { sourceRevision: 1, assignedStatementIds: idsFor("root.nui", row.source) });
      const definition = local.moduleSemanticAnalysis!.definitions.find(d => d.name === "Panel")!;
      const ordinary = compileModulePreviewRoot({ source: { normalizedSource: row.source, sourceRevision: 1 },
        semantic: { sourceRevision: 1, sourceText: row.source, compiled: local },
        target: { definitionStatementId: definition.statementId, definitionStatementIndex: definition.statementIndex, name: definition.name },
        arguments: [{ name: "v", expression: "@r" }] })!;
      expect(ordinary).not.toBeNull();
      const prepared = prepareRustEvaluation(ordinary.compileResult.elements, buildModulePreviewEvaluationOptions(ordinary));
      expect(prepared.rustEligible).toBe(true);
      const result = await evaluatePreparedRust(prepared, transport);
      expect(result.errors).toEqual([]);
      compare([...result.computedGeometry.values()].find(g => g.name === "P" && ordinary.targetRuntimeElementIds.includes(g.elementId)), row.expected);
      record.ordinaryControl = "PASS";
    }
    const definition = doc.moduleSemanticAnalysis!.definitions.find(d => d.name === "Panel")!;
    const preview = compileModulePreviewRoot({ source: { normalizedSource: row.source, sourceRevision: 1 },
      semantic: { sourceRevision: 1, sourceText: row.source, compiled: doc },
      target: { definitionStatementId: definition.statementId, definitionStatementIndex: definition.statementIndex, name: definition.name },
      arguments: [{ name: "v", expression: "@r" }] });
    record.previewAvailable = preview !== null;
    expect(preview).not.toBeNull();
    const prepared = prepareRustEvaluation(preview!.compileResult.elements, buildModulePreviewEvaluationOptions(preview!));
    expect(prepared.rustEligible).toBe(true);
    const result = await evaluatePreparedRust(prepared, transport);
    expect(result.errors).toEqual([]);
    compare([...result.computedGeometry.values()].find(g => g.name === "P" && preview!.targetRuntimeElementIds.includes(g.elementId)), row.expected);
  }
  const prepared = prepareRustEvaluation(doc.document.elements, buildEvaluationOptions({ compiledDocument: doc }));
  expect(prepared.rustEligible).toBe(true);
  const result = await evaluatePreparedRust(prepared, transport);
  expect(result.errors).toEqual([]);
  compare([...result.computedGeometry.values()].find(g => g.name === "P"), row.expected);
  record.disposition = "PASS";
});

it("F1 private grouped record export fails closed", async () => {
  const row = reducers[0];
  const b = await buildRecordImport(row.source.replace("export const out", "const out"), row.saved);
  expect(b.errors.length).toBeGreaterThan(0);
});

it("retains all rejected drafts as grammar/closed-scope controls", async () => {
  for (const cell of rejectedAt) {
    const b = await buildRecordImport(cell.source, cell.saved);
    expect(b.graph.valid).toBe(false);
    expect(b.graph.nodes.get(b.graph.rootDocumentId)!.sourceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "settings-missing-named-argument", severity: "error" })
    ]));
  }
  for (const cell of rejectedCapture) {
    const b = await buildRecordImport(cell.source, cell.saved);
    expect(b.analysis.valid).toBe(false);
    expect(b.analysis.diagnostics.some(d => d.message.includes("outer module instance"))).toBe(true);
  }
});
