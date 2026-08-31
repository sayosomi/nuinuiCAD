import { describe, expect, it } from "vitest";
import { compileDslDocument } from "./dslDocument";
import { parseDsl } from "./dslParser";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  analyzeMultiDocumentSource,
  buildMultiDocumentImportGraph,
  SavedDocumentArtifactCache,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "../document/multiDocumentImportGraph";
import { analyzeMultiDocumentModuleSemantics, moduleDeclarationContributor } from "../document/multiDocumentModuleSemantics";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "../document/multiDocumentPrimitives";
import { createModuleRuntimeContext } from "./moduleRuntimeContext";
import { sourceOwnerForRuntimeElementId } from "./sourceOwnership";
import { effectiveElementActivityById } from "../model/elementActivity";

const rootSource = (id: string, normalizedSource: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
  normalizedSource,
  sourceRevision: 1
});

const savedSource = (id: string, fingerprint: string, normalizedSource: string): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost(id),
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint),
  normalizedSource
});

const loaderFrom = (entries: ReadonlyMap<string, DependencySavedSourceSnapshot>): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, validatedRelativePath): Promise<SavedDependencyLoadResult> {
    const snapshot = entries.get(`${importerDocumentId}|${validatedRelativePath}`);
    return snapshot ? { status: "loaded", snapshot } : { status: "failed", reason: "missing" };
  }
});

const compileImported = async (
  root: RootCurrentSourceSnapshot,
  dependencies: ReadonlyMap<string, DependencySavedSourceSnapshot>,
  cache?: SavedDocumentArtifactCache
) => {
  const graph = await buildMultiDocumentImportGraph({
    root,
    ...(cache ? { cache } : {}),
    loader: loaderFrom(dependencies),
    declarationContributors: [moduleDeclarationContributor]
  });
  const semantics = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, semantics);
  const rootNode = graph.nodes.get(root.documentId)!;
  const compiled = compileDslDocument(root.normalizedSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return { graph, semantics, context, compiled };
};

const evaluateCompiled = (compiled: ReturnType<typeof compileDslDocument>) => {
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    throw new Error("expected a compiled document");
  }
  return evaluateElements(
    compiled.document.elements,
    buildEvaluationOptions({
      compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    })
  );
};

describe("multi-document module runtime", () => {
  it("materializes imported bodies with caller values and defining-document defaults", async () => {
    const library = savedSource("library", "sha256:library", [
      "nui 1",
      "const libraryDefault: number = 41",
      "export module Panel(width: number = @libraryDefault) {",
      "  point P = coordinate(x: @width, y: 2)",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 1",
      "import \"./library.nui\" as lib",
      "const callerWidth: number = 60",
      "instance explicit = lib::Panel(width: @callerWidth)",
      "instance defaulted = lib::Panel()"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    expect(compiled.moduleRuntimeContext).toBe(context);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const points = compiled.document.elements.filter((element) => element.name === "P");
    expect(points).toHaveLength(2);
    expect(points.map((point) => result.computedGeometry.get(point.id))).toEqual([
      expect.objectContaining({ kind: "point", x: 60, y: 2 }),
      expect.objectContaining({ kind: "point", x: 41, y: 2 })
    ]);

    const origins = points.map((point) => compiled.moduleMaterialization!.originByRuntimeElementId.get(point.id)!);
    expect(origins.every((origin) => origin.sourceDocumentId === library.documentId)).toBe(true);
    expect(origins.every((origin) => origin.source?.kind === "dependency-saved")).toBe(true);
    const ownershipDocument = { ...compiled, document: compiled.document, statementMap: compiled.statementMap };
    const owner = sourceOwnerForRuntimeElementId(ownershipDocument, points[0]!.id);
    expect(owner?.sourceDocumentId).toBe(library.documentId);
    expect(owner?.source?.kind === "dependency-saved" ? owner.source.savedSourceFingerprint : undefined).toBe(library.savedSourceFingerprint);
    expect(owner?.sourceLocation?.range).toEqual(origins[0]!.sourceLocation!.range);
    expect(new Set(points.map((point) => point.id)).size).toBe(2);

    const staleOrigin = {
      ...origins[0]!,
      source: { kind: "dependency-saved" as const, documentId: library.documentId, savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:stale") },
      sourceLocation: {
        ...origins[0]!.sourceLocation!,
        source: { kind: "dependency-saved" as const, documentId: library.documentId, savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:stale") }
      }
    };
    const staleOrigins = new Map(compiled.moduleMaterialization!.originByRuntimeElementId);
    staleOrigins.set(points[0]!.id, staleOrigin);
    const staleCompiled = {
      ...compiled,
      moduleMaterialization: { ...compiled.moduleMaterialization!, originByRuntimeElementId: staleOrigins }
    };
    expect(sourceOwnerForRuntimeElementId({ ...staleCompiled, statementMap: compiled.statementMap }, points[0]!.id)).toBeNull();
    const missingProofOrigins = new Map(compiled.moduleMaterialization!.originByRuntimeElementId);
    missingProofOrigins.set(points[0]!.id, { ...origins[0]!, sourceIdentity: undefined });
    const missingProofCompiled = {
      ...compiled,
      moduleMaterialization: { ...compiled.moduleMaterialization!, originByRuntimeElementId: missingProofOrigins }
    };
    expect(sourceOwnerForRuntimeElementId({ ...missingProofCompiled, statementMap: compiled.statementMap }, points[0]!.id)).toBeNull();
    const staleRangeOrigins = new Map(compiled.moduleMaterialization!.originByRuntimeElementId);
    staleRangeOrigins.set(points[0]!.id, {
      ...origins[0]!,
      sourceLocation: { ...origins[0]!.sourceLocation!, range: { from: 0, to: 1 } }
    });
    const staleRangeCompiled = {
      ...compiled,
      moduleMaterialization: { ...compiled.moduleMaterialization!, originByRuntimeElementId: staleRangeOrigins }
    };
    expect(sourceOwnerForRuntimeElementId({ ...staleRangeCompiled, statementMap: compiled.statementMap }, points[0]!.id)).toBeNull();
  });

  it("evaluates imported optional hasValue guards per repeated and colliding instance identity", async () => {
    const optionalModuleSource = [
      "nui 1",
      "export module Optional(value?: number) {",
      "  let marker: number = 0",
      "  if (hasValue(@value)) {",
      "    set marker = @value + 1",
      "    point P = coordinate(x: @marker, y: 0)",
      "  }",
      "}"
    ].join("\n");
    const first = savedSource("optional-first", "sha256:optional-first", optionalModuleSource);
    const second = savedSource("optional-second", "sha256:optional-second", optionalModuleSource);
    const parsedDependency = parseDsl(optionalModuleSource);
    const collidingIds = new Map(parsedDependency.statements.map((_, index) => [index, `collision:optional:${index}`] as const));
    const cache = new SavedDocumentArtifactCache();
    cache.set(analyzeMultiDocumentSource(first, {
      declarationContributors: [moduleDeclarationContributor],
      statementIdByStatementIndex: collidingIds
    }));
    cache.set(analyzeMultiDocumentSource(second, {
      declarationContributors: [moduleDeclarationContributor],
      statementIdByStatementIndex: collidingIds
    }));
    const root = rootSource("optional-root", [
      "nui 1",
      "import \"./optional-first.nui\" as first",
      "import \"./optional-second.nui\" as second",
      "instance absent = first::Optional()",
      "instance supplied = first::Optional(value: 4)",
      "instance other = second::Optional(value: 7)"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([
        [`${root.documentId}|./optional-first.nui`, first],
        [`${root.documentId}|./optional-second.nui`, second]
      ]),
      cache
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(context.qualifiesRuntimePaths).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const points = compiled.document?.elements.filter((element) => element.name === "P") ?? [];
    expect(points).toHaveLength(3);
    expect(points.map((point) => result.computedGeometry.get(point.id))).toEqual([
      undefined,
      expect.objectContaining({ kind: "point", x: 5, y: 0 }),
      expect.objectContaining({ kind: "point", x: 8, y: 0 })
    ]);
    const moduleInstances = compiled.moduleMaterialization?.executionStatements.filter((entry) => entry.type === "moduleInstance") ?? [];
    expect(moduleInstances).toHaveLength(3);
    expect(new Set(moduleInstances.map((entry) => JSON.stringify(entry.runtimeInstancePath))).size).toBe(3);
    expect(moduleInstances.map((entry) => entry.origin?.sourceDocumentId)).toEqual([
      root.documentId,
      root.documentId,
      root.documentId
    ]);
    expect(points.map((point) => compiled.moduleMaterialization!.originByRuntimeElementId.get(point.id)?.sourceDocumentId)).toEqual([
      first.documentId,
      first.documentId,
      second.documentId
    ]);
  });

  it("keeps imported conditional set and forGroup behavior in parity with local Module runtime", async () => {
    const moduleBody = [
      "module Adjust(enabled: boolean, start: number) {",
      "  let value: number = @start",
      "  if (@enabled) {",
      "    set value = @value + 1",
      "  }",
      "  for i in range(from: 1, count: 2, step: 1) {",
      "    point P = coordinate(x: @value + @i, y: 0)",
      "  }",
      "}"
    ];
    const library = savedSource("control-library", "sha256:control-library", ["nui 1", `export ${moduleBody[0]}`, ...moduleBody.slice(1)].join("\n"));
    const root = rootSource("control-root", [
      "nui 1",
      "import \"./control-library.nui\" as lib",
      "instance off = lib::Adjust(enabled: false, start: 0)",
      "instance on = lib::Adjust(enabled: true, start: 10)"
    ].join("\n"));
    const imported = await compileImported(
      root,
      new Map([[`${root.documentId}|./control-library.nui`, library]])
    );

    const localSource = [
      "nui 1",
      ...moduleBody,
      "instance off = Adjust(enabled: false, start: 0)",
      "instance on = Adjust(enabled: true, start: 10)"
    ].join("\n");
    const localParsed = parseDsl(localSource);
    const localCompiled = compileDslDocument(localSource, {
      preparsed: localParsed,
      assignedStatementIds: new Map(localParsed.statements.map((_, index) => [index, `local-control:${index}`] as const))
    });

    expect(imported.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(localCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const importedResult = evaluateCompiled(imported.compiled);
    const localResult = evaluateCompiled(localCompiled);
    expect(importedResult.errors).toEqual([]);
    expect(localResult.errors).toEqual([]);
    const pointXs = (result: ReturnType<typeof evaluateCompiled>) => [...result.computedGeometry.values()]
      .filter((geometry): geometry is Extract<typeof geometry, { kind: "point" }> => geometry.kind === "point")
      .map((geometry) => geometry.x);
    expect(pointXs(importedResult)).toEqual([1, 2, 12, 13]);
    expect(pointXs(importedResult)).toEqual(pointXs(localResult));
    expect(imported.compiled.bindingVersions).toBeDefined();
    expect(imported.compiled.bindingVersions?.versions.filter((version) => version.kind === "set")).toHaveLength(2);
    expect(imported.compiled.bindingVersions?.versions.some((version) => JSON.stringify(version.control).includes("conditionalBranch"))).toBe(true);
    expect(imported.compiled.moduleForGroupMutationOwnerByElementId?.size).toBe(2);
  });

  it("resolves imported geometry bodies against the caller's exact source geometry", async () => {
    const library = savedSource("geometry-library", "sha256:geometry-library", [
      "nui 1",
      "export module Shift(input: point) {",
      "  point P = offset(from: @input, dx: 3, dy: 4)",
      "}"
    ].join("\n"));
    const root = rootSource("geometry-root", [
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "import \"./geometry-library.nui\" as lib",
      "instance use = lib::Shift(input: @Base)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./geometry-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "P");
    expect(point).toBeDefined();
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 13, y: 24 });
  });

  it("lowers imported geometry-array parameters in the defining document", async () => {
    const library = savedSource("array-library", "sha256:array-library", [
      "nui 1",
      "export module Outline(paths: path[]) {",
      "  line Copy = offset(sources: @paths, distance: 1, side: left, closed: false, suppressTrimWarnings: false)",
      "}"
    ].join("\n"));
    const root = rootSource("array-root", [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "import \"./array-library.nui\" as lib",
      "instance use = lib::Outline(paths: [@A, @B, @A])"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./array-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const copy = compiled.document.elements.find((element) => element.name === "Copy");
    expect(copy?.type).toBe("offsetLine");
    if (!copy || copy.type !== "offsetLine") return;
    const a = compiled.document.elements.find((element) => element.name === "A")!;
    const b = compiled.document.elements.find((element) => element.name === "B")!;
    expect(copy.baseLineIds).toEqual([a.id, b.id, a.id]);
  });

  it("keeps nested imported module transitions in their defining documents", async () => {
    const helper = savedSource("nested-helper", "sha256:nested-helper", [
      "nui 1",
      "export module Shift(input: point) {",
      "  point P = offset(from: @input, dx: 3, dy: 4)",
      "}"
    ].join("\n"));
    const library = savedSource("nested-library", "sha256:nested-library", [
      "nui 1",
      "import \"./nested-helper.nui\" as helper",
      "export module Outer(input: point) {",
      "  instance Child = helper::Shift(input: @input)",
      "}"
    ].join("\n"));
    const root = rootSource("nested-root", [
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "import \"./nested-library.nui\" as lib",
      "instance use = lib::Outer(input: @Base)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./nested-library.nui`, library],
        [`${library.documentId}|./nested-helper.nui`, helper]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.moduleMaterialization?.executionStatements
      .filter((entry) => entry.origin?.kind === "moduleBody")
      .some((entry) => entry.origin?.sourceDocumentId === helper.documentId)).toBe(true);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "P");
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 13, y: 24 });
  });

  it("evaluates scalar exports through imported instances", async () => {
    const library = savedSource("scalar-library", "sha256:scalar-library", [
      "nui 1",
      "export module Measure(input: number) {",
      "  export const value: number = @input + 1",
      "}"
    ].join("\n"));
    const root = rootSource("scalar-root", [
      "nui 1",
      "const callerValue: number = 9",
      "import \"./scalar-library.nui\" as lib",
      "instance use = lib::Measure(input: @callerValue)",
      "const result: number = @use::value",
      "point Result = coordinate(x: @result, y: 0)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./scalar-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;
    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "Result");
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 10, y: 0 });
  });

  it("resolves imported geometry exports and geometry-property reads", async () => {
    const library = savedSource("geometry-export-library", "sha256:geometry-export-library", [
      "nui 1",
      "export module Geometry() {",
      "  export point P = coordinate(x: 3, y: 4)",
      "  export line L = segment(start: (0, 0), end: (3, 0))",
      "}"
    ].join("\n"));
    const root = rootSource("geometry-export-root", [
      "nui 1",
      "import \"./geometry-export-library.nui\" as lib",
      "instance use = lib::Geometry()",
      "const result: number = @use::P.x + @use::L.length",
      "point Result = coordinate(x: @result, y: 0)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./geometry-export-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "Result");
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 6, y: 0 });
  });

  it("keeps imported record values, record parameters, and record exports in the defining document", async () => {
    const library = savedSource("record-library", "sha256:record-library", [
      "nui 1",
      "record Pair(x: number)",
      "module Inner(input: Pair) {",
      "  export const output: Pair = @input",
      "}",
      "export module Outer(input: number) {",
      "  const local: Pair = Pair(x: @input)",
      "  instance child = Inner(input: @local)",
      "  export const result: Pair = @child::output",
      "}"
    ].join("\n"));
    const root = rootSource("record-root", [
      "nui 1",
      "import \"./record-library.nui\" as lib",
      "instance use = lib::Outer(input: 7)",
      "const result: number = @use::result.x",
      "point Result = coordinate(x: @result, y: 0)"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./record-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.document.elements.find((element) => element.name === "Result");
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 7, y: 0 });
  });

  it("qualifies colliding dependency statement identities while preserving repeated instances", async () => {
    const dependencyA = savedSource("collision-a", "sha256:collision-a", [
      "nui 1",
      "export module Shape() {",
      "  point P = coordinate(x: 1, y: 0)",
      "}"
    ].join("\n"));
    const dependencyB = savedSource("collision-b", "sha256:collision-b", [
      "nui 1",
      "export module Shape() {",
      "  point P = coordinate(x: 2, y: 0)",
      "}"
    ].join("\n"));
    const collidingIds = new Map([[0, "collision:version"], [1, "collision:module"], [2, "collision:point"]]);
    const cache = new SavedDocumentArtifactCache();
    cache.set(analyzeMultiDocumentSource(dependencyA, {
      declarationContributors: [moduleDeclarationContributor],
      statementIdByStatementIndex: collidingIds
    }));
    cache.set(analyzeMultiDocumentSource(dependencyB, {
      declarationContributors: [moduleDeclarationContributor],
      statementIdByStatementIndex: collidingIds
    }));
    const root = rootSource("collision-root", [
      "nui 1",
      "import \"./collision-a.nui\" as first",
      "import \"./collision-b.nui\" as second",
      "instance a = first::Shape()",
      "instance b = second::Shape()"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      cache,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./collision-a.nui`, dependencyA],
        [`${root.documentId}|./collision-b.nui`, dependencyB]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const points = compiled.document?.elements.filter((element) => element.name === "P") ?? [];
    expect(points).toHaveLength(2);
    expect(new Set(points.map((point) => point.id)).size).toBe(2);
    expect(points.map((point) => compiled.moduleMaterialization!.originByRuntimeElementId.get(point.id)?.sourceDocumentId)).toEqual([
      dependencyA.documentId,
      dependencyB.documentId
    ]);
    expect(context.qualifiesRuntimePaths).toBe(true);
  });

  it("does not leak dependency roots and preserves imported hidden/disabled activity", async () => {
    const library = savedSource("activity-library", "sha256:activity-library", [
      "nui 1",
      "point PrivateRoot = coordinate(x: 99, y: 99)",
      "module NotReachable() {",
      "  point HiddenRoot = coordinate(x: 88, y: 88)",
      "}",
      "export module Shape() {",
      "  point P = coordinate(x: 1, y: 2)",
      "}"
    ].join("\n"));
    const root = rootSource("activity-root", [
      "nui 1",
      "import \"./activity-library.nui\" as lib",
      "instance shown = lib::Shape()",
      "instance hidden(state: hidden) = lib::Shape()",
      "instance disabled(state: disabled) = lib::Shape()"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./activity-library.nui`, library]])),
      declarationContributors: [moduleDeclarationContributor]
    });
    const semantics = analyzeMultiDocumentModuleSemantics(graph);
    const context = createModuleRuntimeContext(graph, semantics);
    const rootNode = graph.nodes.get(root.documentId)!;
    const compiled = compileDslDocument(root.normalizedSource, {
      preparsed: rootNode.artifact.parsed,
      sourceRevision: root.sourceRevision,
      assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
      moduleRuntimeContext: context
    });
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document?.elements.some((element) => ["PrivateRoot", "HiddenRoot"].includes(element.name))).toBe(false);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;
    const result = evaluateElements(
      compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
        evaluationLimitIndex: compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const activities = effectiveElementActivityById(compiled.document.elements);
    for (const name of ["shown", "hidden", "disabled"]) {
      const instance = compiled.document.elements.find((element) => element.name === name)!;
      const point = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId === instance.id)!;
      expect(activities.get(point.id)?.activity).toBe(instance.activity);
    }
    const disabled = compiled.document.elements.find((element) => element.name === "disabled")!;
    const disabledPoint = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId === disabled.id)!;
    expect(result.computedGeometry.has(disabledPoint.id)).toBe(false);
  });
});
