import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  analyzeDslLintDiagnostics,
  compileDslDocument,
  parseDslSnapshot,
  createModuleRuntimeContext,
  createDslSemanticOccurrenceIndex,
  geometryValueOccurrenceKey,
  resolveTypedDependencyGraphRuntime
} from "@nuinuicad/nui-language";
import { AutomationDocument } from "@nuinuicad/nui-language/document";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor
} from "@nuinuicad/nui-language/workspace";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput } from "../src/geometry/rustEvaluationInput";
import { runtimeGeometryDiagnostics } from "../src/geometry/runtimeGeometryDiagnostics";
import {
  createRustStdioParityClient,
  fixtureFromSource,
  normalizeParityPayload
} from "./evaluationParitySupport";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const measurement = "record Measurements(bust: number)\nconst M: Measurements = Measurements(bust: 830)";
const prefixes = [
  ["none", ""],
  ["record", "record Measurements(bust: number)"],
  ["measurement", measurement],
  ["unused-distance", `${measurement}\nconst dart_width: number = @M.bust / 32 - 8`]
];
const variants = [
  ["polar-drawable", "const P: point = polar(from: @E, angle: 0, distance: 17.9375)"],
  ["offset-drawable", "const P: point = offset(from: @E, dx: 17.9375, dy: 0)"],
  ["coordinate-literal", "const P: point = coordinate(x: 27.9375, y: 20)"],
  ["coordinate-arithmetic", "const P: point = coordinate(x: 20 + 7.9375, y: 20)"],
  ["coordinate-binding", "const qx: number = 27.9375\nconst P: point = coordinate(x: @qx, y: 20)"],
  ["coordinate-property", "const P: point = coordinate(x: @E.x + 17.9375, y: 20)"],
  ["polar-pure", "const Q: point = coordinate(x: 10, y: 20)\nconst P: point = polar(from: @Q, angle: 0, distance: 17.9375)"],
  ["alias-pure", "const Q: point = coordinate(x: 27.9375, y: 20)\nconst P: point = @Q"],
  ["alias-drawable", "point Q = coordinate(x: 27.9375, y: 20)\nconst P: point = @Q"],
  ["offset-coordinate", "const P: point = offset(from: (10, 20), dx: 17.9375, dy: 0)"],
  ["polar-pure-neighbor", "const Neighbor: point = coordinate(x: 0, y: 20)\nconst P: point = polar(from: @E, angle: 0, distance: 17.9375)"],
  ["offset-pure-neighbor", "const Neighbor: point = coordinate(x: 0, y: 20)\nconst P: point = offset(from: @E, dx: 17.9375, dy: 0)"],
  ["alias-pure-neighbor", "const Neighbor: point = coordinate(x: 0, y: 20)\npoint Q = coordinate(x: 27.9375, y: 20)\nconst P: point = @Q"],
  ["drawable-control", "point P = polar(from: @E, angle: 0, distance: 17.9375)"]
];
const consumers = {
  segment: "line Probe = segment(start: @E, end: @P)",
  property: "point Probe = coordinate(x: @P.x, y: @P.y)",
  "lifted-property": "const px: number = @P.x\nconst py: number = @P.y\npoint Probe = coordinate(x: @px, y: @py)"
} as const;
type Consumer = keyof typeof consumers;

// Match the VS Code root compiler, including documents with no imports/Modules.
const compileRoot = async (source: string, graphBacked: boolean, canonical?: LastGoodDslDocument): Promise<LastGoodDslDocument> => {
  if (!graphBacked) return canonical ?? fixtureFromSource(source).compiled!.doc;
  const root = {
    kind: "root-current" as const,
    documentId: documentIdFromHost("file:///tmp/issue1541.nui"),
    normalizedSource: source,
    sourceRevision: canonical?.spans.sourceMap.sourceRevision ?? 0
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    rootStatementIdByStatementIndex: canonical?.statementMap?.statementIdByStatementIndex,
    loader: { loadSavedDependency: async () => ({ status: "failed", reason: "missing" }) },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  expect(graph.valid && analysis.valid && context.valid).toBe(true);
  const artifact = graph.nodes.get(root.documentId)!.artifact;
  const compiled = compileDslDocument(source, {
    preparsed: artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  expect(compiled.document).not.toBeNull();
  expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  return compiled as LastGoodDslDocument;
};

const assertProducerContract = (compiled: LastGoodDslDocument) => {
  const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
  const input = buildRustEvaluationInput(compiled.document.elements, options);
  const edges = options.typedDependencyGraph?.edges ?? [];
  expect(input.scalarExpressionPayload?.conditionalDependencyGraph?.edges).toEqual(edges);
  expect(input.geometryValueProgram).toEqual(compiled.geometryValueProgram);
  const dependencyOrder = options.typedDependencyGraph
    ? resolveTypedDependencyGraphRuntime(options.typedDependencyGraph, new Map()).dependencyOrder : [];
  for (const consumer of input.geometryInputTargets ?? []) {
    for (const parameter of consumer.parameters) {
      const targets = "kind" in parameter.target ? [parameter.target] : parameter.target;
      for (const target of targets) {
        if (target.kind !== "geometryValue") continue;
        const key = geometryValueOccurrenceKey(target.occurrence);
        expect(compiled.geometryValueProgram?.some(entry => geometryValueOccurrenceKey(entry.occurrence) === key)).toBe(true);
        expect(edges).toContainEqual(expect.objectContaining({
          from: expect.objectContaining({ kind: "element", id: consumer.elementId }),
          to: expect.objectContaining({ kind: "geometry-value", id: key })
        }));
        expect(dependencyOrder.indexOf(`geometry-value:${key}`)).toBeGreaterThanOrEqual(0);
        expect(dependencyOrder.indexOf(`geometry-value:${key}`)).toBeLessThan(dependencyOrder.indexOf(`element:${consumer.elementId}`));
      }
    }
  }
  const values = compiled.moduleSemanticAnalysis?.geometryValues ?? [];
  for (const value of values) {
    const entry = compiled.geometryValueProgram?.find(e => e.sourceStatementId === value.statementId);
    expect(entry).toBeDefined();
    expect(entry!.occurrence).toEqual({ sourceStatementId: value.statementId, instancePath: [] });
    expect(compiled.document.elements.some(element => element.id === value.statementId || element.name === value.name)).toBe(false);
    // Producer references remain resolved semantic identities, including aliases.
    for (const site of compiled.moduleSemanticAnalysis?.rootGeometryReferencesByStatementId.get(value.statementId) ?? []) {
      if (site.reference.coordinate) continue;
      expect(site.reference.target).not.toBeNull();
      expect(["resolved", "deferred"]).toContain(site.reference.resolution);
    }
  }
  const p = values.find(value => value.name === "P");
  const entry = compiled.geometryValueProgram?.find(e => e.sourceStatementId === p?.statementId);
  if (entry?.construction.kind === "coordinate" && entry.construction.x.kind === "reference") {
    const qx = compiled.bindingAnalysis?.catalog.bindings.find(binding => binding.name === "qx");
    expect(entry.construction.x.bindingId).toBe(qx?.id);
    const references = createDslSemanticOccurrenceIndex(compiled).occurrences.filter(occurrence =>
      occurrence.kind === "reference" && occurrence.identity.kind === "typed" && occurrence.identity.bindingId === qx?.id
    );
    expect(references.map(reference => compiled.spans.sourceMap.source.slice(reference.from, reference.to))).toEqual(["qx"]);
    expect(edges).toContainEqual(expect.objectContaining({
      from: expect.objectContaining({ kind: "geometry-value", id: geometryValueOccurrenceKey(entry.occurrence) }),
      to: expect.objectContaining({ kind: "binding", id: qx!.id }),
      requiredness: "required"
    }));
  }
  if (entry?.construction.kind === "polarPoint" || entry?.construction.kind === "offsetPoint") {
    const from = entry.construction.from;
    if (from.kind === "target") {
      const target = from.target;
      expect(edges.some(edge => edge.from.kind === "geometry-value" &&
        edge.from.id === geometryValueOccurrenceKey(entry.occurrence) &&
        (target.kind === "geometryValue"
          ? edge.to.kind === "geometry-value" && edge.to.id === geometryValueOccurrenceKey(target.occurrence)
          : edge.to.kind === "geometry-stage" && "statementId" in target && edge.to.ownerId === target.statementId))).toBe(true);
    }
  }
  return options;
};

describe("Issue #1541 root immutable point production", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  let targetDirectory: string | undefined;
  beforeAll(() => {
    // Other suites execute target/debug/evaluation_stdio directly. Keep this
    // suite's build from replacing that executable while those tests spawn it.
    targetDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-1541-rust-"));
    rust = createRustStdioParityClient(repoRoot, { targetDirectory });
  }, 30000);
  afterAll(() => {
    rust?.dispose();
    if (targetDirectory) rmSync(targetDirectory, { recursive: true, force: true });
  });

  const evaluateBoth = async (compiled: LastGoodDslDocument) => {
    const options = assertProducerContract(compiled);
    const elements = compiled.document.elements;
    const tsPayload = evaluateElementsReferencePayload(elements, options);
    const rustPayload = await rust.evaluate(elements, options);
    expect(normalizeParityPayload(rustPayload)).toEqual(normalizeParityPayload(tsPayload));
    return [evaluationPayloadToResult(tsPayload), evaluationPayloadToResult(rustPayload)];
  };

  it.each(prefixes.flatMap(([prefixName, prefix]) => variants.flatMap(([variantName, producer]) =>
    (Object.keys(consumers) as Consumer[]).flatMap(consumer => [false, true].map(graphBacked => ({
      name: `${prefixName}/${variantName}/${consumer}/${graphBacked ? "graph" : "local"}`,
      graphBacked,
      source: ["nui 1", prefix, "point E = coordinate(x: 10, y: 20)", producer, consumers[consumer]].join("\n"),
      consumer
    })))
  )))("$name", async ({ source, consumer, graphBacked }) => {
    const compiled = await compileRoot(source, graphBacked);
    expect(compiled.diagnostics).toEqual([]);
    expect(analyzeDslLintDiagnostics(compiled).some(d => d.presentation?.parameters?.name === "qx")).toBe(false);
    for (const result of await evaluateBoth(compiled)) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      expect(runtimeGeometryDiagnostics({ ...result, compiledDocument: compiled })).toEqual([]);
      const probe = compiled.document.elements.find(e => e.name === "Probe")!;
      expect(result.computedGeometry.get(probe.id)).toMatchObject(consumer === "segment"
        ? { kind: "line", start: { x: 10, y: 20 }, end: { x: 27.9375, y: 20 }, length: 17.9375 }
        : { kind: "point", x: 27.9375, y: 20 });
      for (const value of compiled.moduleSemanticAnalysis?.geometryValues ?? []) {
        const stored = result.computedGeometryValues?.get(geometryValueOccurrenceKey({ sourceStatementId: value.statementId, instancePath: [] }));
        expect(stored?.value).toMatchObject({ kind: "point", x: value.name === "Neighbor" ? 0 : value.name === "Q" && source.includes("polar(from: @Q") ? 10 : 27.9375, y: 20 });
        expect(stored?.value).not.toHaveProperty("elementId");
      }
    }
  }, 30000);

  it.each([false, true].flatMap(graphBacked => [false, true].flatMap(dynamic =>
    ["segment", "lifted-property"].map(consumer => ({ graphBacked, dynamic, consumer: consumer as Consumer }))
  )))("evaluates the exact Issue fixture: graph=$graphBacked dynamic=$dynamic consumer=$consumer", async ({ graphBacked, dynamic, consumer }) => {
    const source = `nui 1

record Measurements(bust: number)
const M: Measurements = Measurements(bust: 830)

point E = coordinate(x: 10, y: 20)
const dart_width: number = @M.bust / 32 - 8

const P: point = polar(
  from: @E,
  angle: 0,
  distance: ${dynamic ? "@dart_width" : "17.9375"}
)

${consumer === "segment" ? `line ProbeLine = segment(
  start: @E,
  end: @P
)` : "const px: number = @P.x\nconst py: number = @P.y\npoint Probe = coordinate(x: @px, y: @py)"}`;
    const compiled = await compileRoot(source, graphBacked);
    const dartWarnings = analyzeDslLintDiagnostics(compiled).filter(d => d.presentation?.parameters?.name === "dart_width");
    expect(dartWarnings).toHaveLength(dynamic ? 0 : 1);
    for (const result of await evaluateBoth(compiled)) {
      expect(result.errors).toEqual([]);
      expect(result.geometryValueErrors ?? []).toEqual([]);
      const probe = compiled.document.elements.find(e => e.name === (consumer === "segment" ? "ProbeLine" : "Probe"))!;
      expect(result.computedGeometry.get(probe.id)).toMatchObject(consumer === "segment"
        ? { kind: "line", start: { x: 10, y: 20 }, end: { x: 27.9375, y: 20 }, length: 17.9375 }
        : { kind: "point", x: 27.9375, y: 20 });
    }
  }, 30000);

  it.each([false, true])("re-evaluates measurement and fixed distances with aliases (graph=%s)", async graphBacked => {
    let document: AutomationDocument | undefined;
    let occurrences: string[] | undefined;
    for (const bust of [830, 831, 830]) {
      const source = `nui 1
record Measurements(bust: number)
const M: Measurements = Measurements(bust: ${bust})
point E = coordinate(x: 10, y: 20)
const dart_width: number = @M.bust / 32 - 8
const P: point = polar(from: @E, angle: 0, distance: @dart_width)
const Fixed: point = polar(from: @E, angle: 0, distance: 17.9375)
const Alias: point = @P
line Probe = segment(start: @E, end: @Alias)
point Properties = coordinate(x: @Alias.x, y: @Alias.y)
point FixedProperties = coordinate(x: @Fixed.x, y: @Fixed.y)`;
      if (document) document.replaceSource(source);
      else document = AutomationDocument.fromSource(source);
      const compiled = await compileRoot(source, graphBacked, document.getState().doc);
      const currentOccurrences = compiled.geometryValueProgram!.map(entry => geometryValueOccurrenceKey(entry.occurrence));
      if (occurrences) expect(currentOccurrences).toEqual(occurrences);
      occurrences = currentOccurrences;
      for (const result of await evaluateBoth(compiled)) {
        expect(result.errors).toEqual([]);
        expect(result.geometryValueErrors ?? []).toEqual([]);
        const geometry = (name: string) => result.computedGeometry.get(compiled.document.elements.find(e => e.name === name)!.id);
        const distance = bust === 830 ? 17.9375 : 17.96875;
        expect(geometry("Probe")).toMatchObject({ kind: "line", length: distance, end: { x: 10 + distance, y: 20 } });
        expect(geometry("Properties")).toMatchObject({ kind: "point", x: 10 + distance, y: 20 });
        expect(geometry("FixedProperties")).toMatchObject({ kind: "point", x: 27.9375, y: 20 });
        const binding = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "dart_width")!;
        expect(result.computedScalarBindings?.get(binding.id)).toMatchObject({ status: "ok", value: { kind: "number", value: distance } });
      }
    }
  }, 30000);

  it.each([false, true])("uses dependency order for forward scalar and geometry aliases (graph=%s)", async graphBacked => {
    const source = `nui 1
line Probe = segment(start: @E, end: @Alias)
point Properties = coordinate(x: @Alias.x, y: @Alias.y)
const Alias: point = @P
const P: point = coordinate(x: @qx, y: 20)
const qx: number = 27.9375
point E = coordinate(x: 10, y: 20)`;
    const compiled = await compileRoot(source, graphBacked);
    for (const result of await evaluateBoth(compiled)) {
      expect(result.errors).toEqual([]);
      expect([...result.computedGeometry.values()].find(g => g.name === "Probe")).toMatchObject({ kind: "line", length: 17.9375 });
      expect([...result.computedGeometry.values()].find(g => g.name === "Properties")).toMatchObject({ kind: "point", x: 27.9375, y: 20 });
    }
  }, 30000);

  it.each([false, true])("preserves failed scalar inputs instead of publishing fabricated points (graph=%s)", async graphBacked => {
    const compiled = await compileRoot(`nui 1
const qx: number = 1 / 0
const P: point = coordinate(x: @qx, y: 20)
line Probe = segment(start: (10, 20), end: @P)`, graphBacked);
    for (const result of await evaluateBoth(compiled)) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.computedGeometry.size).toBe(0);
      expect(result.computedGeometryValues?.size ?? 0).toBe(0);
      const qx = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "qx")!;
      expect(result.computedScalarBindings?.get(qx.id)).toMatchObject({ status: "error" });
      expect(runtimeGeometryDiagnostics({ ...result, compiledDocument: compiled }).length).toBeGreaterThan(0);
    }
  }, 30000);

  it.each([
    ["missing geometry", "const P: point = @Missing", "module-undefined-geometry-reference"],
    ["missing scalar", "const P: point = coordinate(x: @missing, y: 20)", "undefined-reference"],
    ["geometry cycle", "const P: point = @Q\nconst Q: point = @P", "dependency-cycle"]
  ])("retains compile diagnostics for %s", (_, producer, code) => {
    const source = `nui 1\n${producer}\nline Probe = segment(start: (10, 20), end: @P)`;
    const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision: 0 });
    const compiled = compileDslDocument(source, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `invalid1541:${index}`]))
    });
    expect(compiled.diagnostics.some(d => d.severity === "error" && d.code?.includes(code))).toBe(true);
  });
});
