import { describe, expect, it } from "vitest";
import { compileDslDocument, createDslSemanticOccurrenceIndex, type CompiledDslDocument } from "@nuinuicad/nui-language";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import {
  planDslRenameEdits,
  planDslRenameEditsResult,
  queryDslRenameTarget,
  type DslRenameSnapshot
} from "@nuinuicad/nui-language";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { createModuleRuntimeContext } from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  SavedDocumentArtifactCache
} from "@nuinuicad/nui-language/workspace";
import type { DependencySavedSourceSnapshot } from "@nuinuicad/nui-language/workspace";
import { moduleSemanticStableFingerprint, validateRenameReferenceStability } from "@nuinuicad/nui-language/document";

const compile = (source: string, sourceRevision = 7): CompiledDslDocument => {
  const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
  return compileDslDocument(source, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `rename-test:${index}`]))
  });
};

const snapshot = (source: string, sourceRevision = 7): DslRenameSnapshot => ({
  source: { normalizedSource: source, sourceRevision },
  semantic: { sourceRevision, compiled: compile(source, sourceRevision) }
});

const at = (source: string, token: string, offset = 0) => source.indexOf(token) + offset;

const applyEdits = (source: string, edits: readonly { from: number; to: number; newText: string }[]) =>
  [...edits]
    .sort((left, right) => right.from - left.from || right.to - left.to)
    .reduce((text, edit) => `${text.slice(0, edit.from)}${edit.newText}${text.slice(edit.to)}`, source);

const geometryWithoutNames = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(geometryWithoutNames);
  if (value instanceof Map) return new Map([...value].map(([key, entry]) => [key, geometryWithoutNames(entry)]));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "name")
    .map(([key, entry]) => [key, geometryWithoutNames(entry)]));
};

type TypedRenameCase = {
  label: string;
  source: string;
  expectedSource: string;
  oldName: string;
  newName: string;
  sourceReference: string;
  expectedReference: string;
};

const qualifiedTypedRenameCases: readonly TypedRenameCase[] = [
  {
    label: "A group-qualified reference",
    source: [
      "nui 1",
      "group Front {",
      "  const dart_close_angle: number = 15",
      "}",
      "const outside_angle: number = Front::dart_close_angle + 30"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "group Front {",
      "  const chest_dart_angle: number = 15",
      "}",
      "const outside_angle: number = Front::chest_dart_angle + 30"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "Front::dart_close_angle",
    expectedReference: "Front::chest_dart_angle"
  },
  {
    label: "B absolute root without a shadow",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const outside_angle: number = ::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const chest_dart_angle: number = 15",
      "group Inside {",
      "  const outside_angle: number = ::chest_dart_angle + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "::dart_close_angle",
    expectedReference: "::chest_dart_angle"
  },
  {
    label: "C absolute root with a same-named group shadow",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = ::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const chest_dart_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = ::chest_dart_angle + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "chest_dart_angle",
    sourceReference: "::dart_close_angle",
    expectedReference: "::chest_dart_angle"
  },
  {
    label: "C renamed to test",
    source: [
      "nui 1",
      "const dart_close_angle: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = ::dart_close_angle + 30",
      "}"
    ].join("\n"),
    expectedSource: [
      "nui 1",
      "const test: number = 15",
      "group Inside {",
      "  const chest_dart_angle: number = 99",
      "  const outside_angle: number = ::test + 30",
      "}"
    ].join("\n"),
    oldName: "dart_close_angle",
    newName: "test",
    sourceReference: "::dart_close_angle",
    expectedReference: "::test"
  }
];

const unrelatedModuleSource = [
  "module Unrelated() {",
  "  export const marker: number = 1",
  "}"
].join("\n");

const qualifiedTypedRenameCasesWithModule = qualifiedTypedRenameCases.map((testCase) => ({
  ...testCase,
  label: `${testCase.label} with unrelated Module`,
  source: testCase.source.replace("nui 1\n", `nui 1\n${unrelatedModuleSource}\n`),
  expectedSource: testCase.expectedSource.replace("nui 1\n", `nui 1\n${unrelatedModuleSource}\n`)
}));

const typedIdentityAt = (compiled: CompiledDslDocument, kind: "declaration" | "reference", from: number, to: number) =>
  createDslSemanticOccurrenceIndex(compiled).occurrences.find((occurrence) =>
    occurrence.kind === kind && occurrence.from === from && occurrence.to === to && occurrence.identity.kind === "typed"
  )?.identity;

const assertIndependentTypedRenameOracle = (
  source: string,
  expectedSource: string,
  oldName: string,
  newName: string,
  sourceReferences: readonly string[],
  expectedReferences: readonly string[]
) => {
  const before = compile(source);
  const expected = compile(expectedSource);
  expect(before.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(expected.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  const target = before.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === oldName);
  expect(target).toBeDefined();
  if (!target) return;
  const renamedTarget = expected.bindingAnalysis?.catalog.bindings.find((binding) =>
    binding.kind === "typed" && binding.name === newName && binding.statementIndex === target.statementIndex
  );
  expect(renamedTarget?.id).toBe(target.id);

  const nextSourceReferenceIndex = new Map<string, number>();
  const nextExpectedReferenceIndex = new Map<string, number>();
  for (const [index, reference] of sourceReferences.entries()) {
    const sourceReferenceFrom = source.indexOf(reference, nextSourceReferenceIndex.get(reference) ?? 0);
    nextSourceReferenceIndex.set(reference, sourceReferenceFrom + reference.length);
    const from = sourceReferenceFrom + reference.length - oldName.length;
    expect(typedIdentityAt(before, "reference", from, from + oldName.length)).toEqual({ kind: "typed", bindingId: target.id });
    const expectedReference = expectedReferences[index]!;
    const expectedReferenceFrom = expectedSource.indexOf(expectedReference, nextExpectedReferenceIndex.get(expectedReference) ?? 0);
    nextExpectedReferenceIndex.set(expectedReference, expectedReferenceFrom + expectedReference.length);
    const expectedFrom = expectedReferenceFrom + expectedReference.length - newName.length;
    expect(typedIdentityAt(expected, "reference", expectedFrom, expectedFrom + newName.length)).toEqual({ kind: "typed", bindingId: target.id });
  }

  const beforeDeclarationIds = createDslSemanticOccurrenceIndex(before).occurrences
    .filter((occurrence) => occurrence.kind === "declaration" && occurrence.identity.kind === "typed")
    .map((occurrence) => occurrence.identity.kind === "typed" ? occurrence.identity.bindingId : "");
  const expectedDeclarationIds = createDslSemanticOccurrenceIndex(expected).occurrences
    .filter((occurrence) => occurrence.kind === "declaration" && occurrence.identity.kind === "typed")
    .map((occurrence) => occurrence.identity.kind === "typed" ? occurrence.identity.bindingId : "");
  expect(expectedDeclarationIds).toEqual(beforeDeclarationIds);
  return { before, expected, target };
};

const evaluatedScalarBindings = (compiled: CompiledDslDocument) => {
  if (!compiled.document || !compiled.statementMap) throw new Error("expected a compiled document");
  return evaluateElements(compiled.document.elements, buildEvaluationOptions({
    compiledDocument: compiled as LastGoodDslDocument,
    evaluationLimitIndex: compiled.document.evaluationLimitIndex
  }));
};

const importedElementRenameLibrary = {
  kind: "dependency-saved" as const,
  documentId: documentIdFromHost("file:///workspace/modules/library.nui"),
  normalizedSource: "nui 1\nexport module Panel() {\n}",
  savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:issue-1680-library")
} satisfies DependencySavedSourceSnapshot;

const importedElementRenameSource = [
  "nui 1",
  'import "../modules/library.nui" as lib',
  "point A = coordinate(x: 0, y: 0)",
  "point B = coordinate(x: 10, y: 0)",
  "line Segment = segment(start: A, end: B)",
  "instance top = lib::Panel()",
  "point Unused = coordinate(x: 25, y: 0)"
].join("\n");

const importedElementRenameSnapshot = async (
  source: string,
  sourceRevision = 7,
  priorCompiled?: CompiledDslDocument,
  cache = new SavedDocumentArtifactCache()
): Promise<{
  graph: Awaited<ReturnType<typeof buildMultiDocumentImportGraph>>;
  cache: SavedDocumentArtifactCache;
  moduleAnalysis: ReturnType<typeof analyzeMultiDocumentModuleSemantics>;
  moduleContext: ReturnType<typeof createModuleRuntimeContext>;
  compiled: CompiledDslDocument;
  renameSnapshot: DslRenameSnapshot;
}> => {
  const root = {
    kind: "root-current" as const,
    documentId: documentIdFromHost("file:///workspace/patterns/rename.nui"),
    normalizedSource: source,
    sourceRevision
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    cache,
    loader: {
      async loadSavedDependency(importerDocumentId, relativePath) {
        return importerDocumentId === root.documentId && relativePath === "../modules/library.nui"
          ? { status: "loaded" as const, snapshot: importedElementRenameLibrary }
          : { status: "failed" as const, reason: "missing" as const };
      }
    },
    declarationContributors: [moduleDeclarationContributor],
    ...(priorCompiled?.statementMap?.statementIdByStatementIndex
      ? { rootStatementIdByStatementIndex: priorCompiled.statementMap.statementIdByStatementIndex }
      : {})
  });
  const moduleAnalysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleContext = createModuleRuntimeContext(graph, moduleAnalysis);
  const rootNode = graph.nodes.get(root.documentId);
  if (!rootNode) throw new Error("missing graph-aware imported root artifact");
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: moduleContext
  });
  return {
    graph,
    cache,
    moduleAnalysis,
    moduleContext,
    compiled,
    renameSnapshot: {
      source: { normalizedSource: source, sourceRevision },
      semantic: { sourceRevision, compiled }
    }
  };
};

const importedElementRenameSourceWithoutInstance = importedElementRenameSource
  .split("\n")
  .filter((line) => !line.startsWith("instance top = "))
  .join("\n");

const importedElementRenameSourceWithoutImportOrInstance = importedElementRenameSourceWithoutInstance
  .split("\n")
  .filter((line) => !line.startsWith("import "))
  .join("\n");

describe("host-neutral DSL rename query", () => {
  it("allows ordinary element Rename with a current imported Module context", async () => {
    const fixture = await importedElementRenameSnapshot(importedElementRenameSource);

    expect(fixture.graph.valid).toBe(true);
    expect(fixture.moduleAnalysis.valid).toBe(true);
    expect(fixture.moduleContext.valid).toBe(true);
    expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(fixture.compiled.moduleRuntimeContext?.graph).toBe(fixture.graph);
    expect(fixture.compiled.moduleMaterialization).toBeTruthy();

    const candidateSource = importedElementRenameSource
      .replace("point A =", "point StartPoint =")
      .replace("start: A", "start: StartPoint");
    const candidateFixture = await importedElementRenameSnapshot(candidateSource, 8, fixture.compiled, fixture.cache);
    const candidate = candidateFixture.compiled;
    expect(candidate.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(candidate.spans.sourceMap.source).toBe(candidateSource);
    expect(candidate.spans.sourceMap.sourceRevision).toBe(8);
    expect(candidate.sourceLexicalNamespace).toBeTruthy();
    expect(candidate.moduleSemanticAnalysis).toBeTruthy();
    expect(candidate.moduleRuntimeContext?.valid).toBe(true);
    expect(candidate.moduleRuntimeContext?.graph.valid).toBe(true);
    expect(candidate.statementMap?.elementIdByStatementIndex).toEqual(fixture.compiled.statementMap?.elementIdByStatementIndex);
    expect(candidate.statementMap?.statementIdByStatementIndex).toEqual(fixture.compiled.statementMap?.statementIdByStatementIndex);
    const beforeGraph = fixture.compiled.moduleRuntimeContext?.graph;
    const afterGraph = candidate.moduleRuntimeContext?.graph;
    const graphEdges = (graph: NonNullable<typeof beforeGraph>) => graph.edges.map((edge) => ({
      importerDocumentId: edge.importerDocumentId,
      importIdentity: edge.importIdentity.localIdentity,
      importPath: edge.importPath,
      alias: edge.alias,
      targetDocumentId: edge.targetDocumentId,
      status: edge.status
    }));
    expect(beforeGraph).toBeDefined();
    expect(afterGraph).toBeDefined();
    if (!beforeGraph || !afterGraph) return;
    expect(afterGraph.rootSource.normalizedSource).toBe(candidateSource);
    expect(afterGraph.rootSource.sourceRevision).toBe(8);
    expect(graphEdges(afterGraph)).toEqual(graphEdges(beforeGraph));
    expect(afterGraph.nodes.get(importedElementRenameLibrary.documentId)?.artifact.source.normalizedSource)
      .toBe(importedElementRenameLibrary.normalizedSource);
    const rootTarget = fixture.compiled.document?.elements.find((element) => element.name === "A");
    const rootTargetStatement = rootTarget && fixture.compiled.statementMap?.byElementId.get(rootTarget.id);
    const rootTargetStatementId = rootTargetStatement && fixture.compiled.statementMap?.statementIdByStatementIndex?.get(rootTargetStatement.statementIndex);
    const beforeNamespaceDeclaration = rootTargetStatementId && fixture.compiled.sourceLexicalNamespace?.allDeclarations
      .find((declaration) => declaration.statementId === rootTargetStatementId);
    const afterNamespaceDeclaration = rootTargetStatementId && candidate.sourceLexicalNamespace?.allDeclarations
      .find((declaration) => declaration.statementId === rootTargetStatementId);
    expect(beforeNamespaceDeclaration).toMatchObject({ kind: "geometry", name: "A" });
    expect(afterNamespaceDeclaration).toMatchObject({ kind: "geometry", name: "StartPoint" });
    expect(candidate.document?.elements.find((element) => element.id === rootTarget?.id)?.name).toBe("StartPoint");
    expect(validateRenameReferenceStability({ before: fixture.compiled, after: candidate })).toEqual({ verdict: "ok" });
    expect(moduleSemanticStableFingerprint(fixture.compiled)).toBeTruthy();
    expect(moduleSemanticStableFingerprint(candidate)).toBe(moduleSemanticStableFingerprint(fixture.compiled));
    expect(candidate.moduleSemanticAnalysis?.instances.map((instance) => [
      instance.statementId,
      instance.calleeResolution,
      instance.callee?.definitionStatementId
    ])).toEqual(fixture.compiled.moduleSemanticAnalysis?.instances.map((instance) => [
      instance.statementId,
      instance.calleeResolution,
      instance.callee?.definitionStatementId
    ]));
    expect(candidate.moduleRuntimeContext?.graph.dependencyFingerprints)
      .toEqual(fixture.compiled.moduleRuntimeContext?.graph.dependencyFingerprints);
    const beforeEvaluation = evaluatedScalarBindings(fixture.compiled);
    const afterEvaluation = evaluatedScalarBindings(candidate);
    expect(afterEvaluation.errors).toEqual(beforeEvaluation.errors);
    expect(geometryWithoutNames(afterEvaluation.computedGeometry)).toEqual(geometryWithoutNames(beforeEvaluation.computedGeometry));

    const declarationFrom = at(importedElementRenameSource, "A =");
    const referenceFrom = at(importedElementRenameSource, "start: A") + "start: ".length;
    const occurrences = createDslSemanticOccurrenceIndex(fixture.compiled).occurrences;
    const declarationOccurrence = occurrences.find((occurrence) => occurrence.kind === "declaration" && occurrence.from === declarationFrom);
    const referenceOccurrence = occurrences.find((occurrence) => occurrence.kind === "reference" && occurrence.from === referenceFrom);
    expect(declarationOccurrence?.identity).toEqual(referenceOccurrence?.identity);
    expect(declarationOccurrence?.identity).toMatchObject({ kind: "element", elementId: rootTarget?.id });

    const declarationResult = planDslRenameEditsResult(
      fixture.renameSnapshot,
      declarationFrom,
      "StartPoint"
    );
    const referenceResult = planDslRenameEditsResult(fixture.renameSnapshot, referenceFrom, "StartPoint");
    expect(declarationResult.status).toBe("ok");
    expect(referenceResult.status).toBe("ok");
    if (declarationResult.status !== "ok" || referenceResult.status !== "ok") return;
    expect(declarationResult.plan.target.oldName).toBe("A");
    expect(referenceResult.plan.target.oldName).toBe("A");
    expect(declarationResult.plan.edits).toEqual(referenceResult.plan.edits);
    expect(declarationResult.plan.edits.map((edit) => [edit.from, edit.to, edit.expectedText, edit.newText])).toEqual([
      [declarationFrom, declarationFrom + 1, "A", "StartPoint"],
      [referenceFrom, referenceFrom + 1, "A", "StartPoint"]
    ]);
    expect(applyEdits(importedElementRenameSource, declarationResult.plan.edits)).toBe(candidateSource);

    const unusedFrom = at(importedElementRenameSource, "Unused =");
    const unusedResult = planDslRenameEditsResult(fixture.renameSnapshot, unusedFrom, "FreePoint");
    expect(unusedResult.status).toBe("ok");
    if (unusedResult.status !== "ok") return;
    expect(unusedResult.plan.edits.map((edit) => [edit.from, edit.to, edit.expectedText, edit.newText])).toEqual([
      [unusedFrom, unusedFrom + "Unused".length, "Unused", "FreePoint"]
    ]);
    const unusedCandidateSource = applyEdits(importedElementRenameSource, unusedResult.plan.edits);
    const unusedCandidate = await importedElementRenameSnapshot(unusedCandidateSource, 8, fixture.compiled, fixture.cache);
    expect(unusedCandidate.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("does not edit comments, string contents, or unrelated same-named geometry in an imported Module root", async () => {
    const source = [
      importedElementRenameSource,
      "// A in a comment",
      'const label: string = "A"',
      "group Other {",
      "  point A = coordinate(x: 100, y: 20)",
      "}"
    ].join("\n");
    const fixture = await importedElementRenameSnapshot(source);
    expect(fixture.graph.valid).toBe(true);
    expect(fixture.moduleContext.valid).toBe(true);
    expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const from = at(source, "A =");
    const result = planDslRenameEditsResult(fixture.renameSnapshot, from, "StartPoint");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.edits.map((edit) => [source.slice(edit.from, edit.to), edit.newText])).toEqual([
      ["A", "StartPoint"],
      ["A", "StartPoint"]
    ]);
    const renamed = applyEdits(source, result.plan.edits);
    expect(renamed).toContain('import "../modules/library.nui" as lib');
    expect(renamed).toContain("instance top = lib::Panel()");
    expect(renamed).toContain("// A in a comment");
    expect(renamed).toContain('const label: string = "A"');
    expect(renamed).toContain("point A = coordinate(x: 100, y: 20)");
  });

  it("keeps ordinary element Rename controls valid without imports and with an import only", async () => {
    const noImport = snapshot(importedElementRenameSourceWithoutImportOrInstance);
    const noImportResult = planDslRenameEditsResult(
      noImport,
      at(importedElementRenameSourceWithoutImportOrInstance, "A ="),
      "StartPoint"
    );
    expect(noImportResult.status).toBe("ok");

    const importOnly = await importedElementRenameSnapshot(importedElementRenameSourceWithoutInstance);
    expect(importOnly.graph.valid).toBe(true);
    expect(importOnly.moduleContext.valid).toBe(true);
    expect(importOnly.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(importOnly.compiled.moduleMaterialization).toBeUndefined();
    const importOnlyResult = planDslRenameEditsResult(
      importOnly.renameSnapshot,
      at(importedElementRenameSourceWithoutInstance, "A ="),
      "StartPoint"
    );
    expect(importOnlyResult.status).toBe("ok");

    const ordinaryUnused = planDslRenameEditsResult(
      noImport,
      at(importedElementRenameSourceWithoutImportOrInstance, "Unused ="),
      "FreePoint"
    );
    expect(ordinaryUnused.status).toBe("ok");
  });

  it("renames statement-for carries through next and escaped references", () => {
    const source = [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) carry total: number = 0 {",
      "  next total = i",
      "}",
      "const result: number = total"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "total"), "sum");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["total", "total", "total"]);
    expect(applyEdits(source, plan!.edits)).toContain("next sum = i");
    expect(applyEdits(source, plan!.edits)).toContain("const result: number = sum");
  });

  it("renames a typed declaration from either its declaration or reference", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = width + 1"
    ].join("\n");
    const declaration = queryDslRenameTarget(snapshot(source), at(source, "width"));
    const referenceStart = at(source, "= width") + "= ".length;
    const reference = queryDslRenameTarget(snapshot(source), referenceStart);
    expect(declaration?.range).toEqual({ from: at(source, "width"), to: at(source, "width") + 5 });
    expect(reference?.range).toEqual({ from: referenceStart, to: referenceStart + "width".length });
    const plan = planDslRenameEdits(snapshot(source), at(source, "= width") + "= ".length, "横幅");
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["width", "width"]);
    expect(plan?.edits.every((edit) => edit.newText === "横幅")).toBe(true);
  });

  it("renames a named broad-path array consumed by Join", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "line First = segment(start: A, end: B)",
      "const parts: path[] = [First]",
      "line Joined = join(paths: parts, closed: false)"
    ].join("\n");
    const result = planDslRenameEditsResult(snapshot(source), at(source, "paths: parts") + "paths: ".length, "outlineParts");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["parts", "parts"]);
    expect(compile(applyEdits(source, result.plan.edits)).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("renames a value-for binder only within its mapped body", () => {
    const source = [
      "nui 1",
      "const values: number[] = [1, 2]",
      "const doubled: number[] = for item in values { item * 2 }"
    ].join("\n");
    const binderFrom = source.indexOf("item in");
    const bodyReferenceFrom = source.indexOf("{ item") + "{ ".length;
    const target = queryDslRenameTarget(snapshot(source), binderFrom);
    expect(target?.oldName).toBe("item");
    const plan = planDslRenameEditsResult(snapshot(source), bodyReferenceFrom, "value");
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") return;
    expect(plan.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["item", "item"]);
    expect(plan.plan.edits.every((edit) => edit.newText === "value")).toBe(true);
    expect(compile(applyEdits(source, plan.plan.edits)).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("renames a geometry value-for binder and its property references only within the mapped body", () => {
    const source = [
      "nui 1",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in points { coordinate(x: item.x, y: item.y) }"
    ].join("\n");
    const plan = planDslRenameEditsResult(snapshot(source), at(source, "item.x") + 1, "pointValue");
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") return;
    expect(plan.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["item", "item", "item"]);
    expect(plan.plan.edits.every((edit) => edit.newText === "pointValue")).toBe(true);
    expect(compile(applyEdits(source, plan.plan.edits)).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("renames a nominal-record value-for binder and its field references only within the mapped body", () => {
    const source = [
      "nui 1",
      "record Pair(",
      "  x: number,",
      "  label: string,",
      ")",
      "const first: Pair = Pair(x: 1, label: \"one\")",
      "const pairs: Pair[] = [first]",
      "const mapped: Pair[] = for item in pairs { Pair(x: item.x + 1, label: item.label) }"
    ].join("\n");
    const plan = planDslRenameEditsResult(snapshot(source), at(source, "item.x") + 1, "pair");
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") return;
    expect(plan.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["item", "item", "item"]);
    expect(plan.plan.edits.every((edit) => edit.newText === "pair")).toBe(true);
    expect(compile(applyEdits(source, plan.plan.edits)).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("renames a geometry value-for binder used by a builtin operand without touching ordinary geometry", () => {
    const source = [
      "nui 1",
      "point Origin = coordinate(x: 0, y: 0)",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in points { if (distance(item, Origin) > 0) { item } else { coordinate(x: 0, y: 0) } }",
      "point item = coordinate(x: 99, y: 99)"
    ].join("\n");
    const plan = planDslRenameEditsResult(snapshot(source), at(source, "distance(item") + "distance(".length, "value");
    expect(plan.status).toBe("ok");
    if (plan.status !== "ok") return;
    expect(plan.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["item", "item", "item"]);
    expect(plan.plan.edits.every((edit) => edit.newText === "value")).toBe(true);
    const renamed = applyEdits(source, plan.plan.edits);
    expect(renamed).toContain("distance(value, Origin)");
    expect(renamed).toContain("point item = coordinate(x: 99, y: 99)");
    expect(renamed).toContain("point Origin = coordinate");
    expect(compile(renamed).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const originReferenceStart = at(source, ", Origin") + 2;
    const originPlan = planDslRenameEditsResult(snapshot(source), originReferenceStart, "Anchor");
    expect(originPlan.status).toBe("ok");
    if (originPlan.status !== "ok") return;
    expect(originPlan.plan.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Origin", "Origin"]);
    const renamedOrigin = applyEdits(source, originPlan.plan.edits);
    expect(renamedOrigin).toContain("distance(item, Anchor)");
    expect(renamedOrigin).toContain("point Anchor = coordinate");
    expect(renamedOrigin).toContain("for item in points");
    expect(compile(renamedOrigin).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("rejects a geometry value-for rename that would capture an ordinary builtin operand", () => {
    const source = [
      "nui 1",
      "point Origin = coordinate(x: 0, y: 0)",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in points { if (distance(item, Origin) > 0) { item } else { coordinate(x: 0, y: 0) } }"
    ].join("\n");
    const plan = planDslRenameEditsResult(snapshot(source), at(source, "distance(item") + "distance(".length, "Origin");
    expect(plan.status).toBe("rejected");
    if (plan.status !== "rejected") return;
    expect(plan.rejection).toMatchObject({
      reason: "reference-resolution-change",
      family: "typed",
      referencedName: "Origin"
    });
  });

  it("rejects a geometry value-for rename that would capture an ordinary geometry name", () => {
    const source = [
      "nui 1",
      "point other = coordinate(x: 9, y: 9)",
      "const points: point[] = [(1, 2), (3, 4)]",
      "const mapped: point[] = for item in points { coordinate(x: other.x, y: item.y) }"
    ].join("\n");
    const plan = planDslRenameEditsResult(snapshot(source), at(source, "item in"), "other");
    expect(plan.status).toBe("rejected");
    if (plan.status !== "rejected") return;
    expect(plan.rejection).toMatchObject({
      reason: "reference-resolution-change",
      family: "typed",
      referencedName: "other"
    });
  });

  it("renames a root immutable geometry alias without touching its backing geometry", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "const P: point = A",
      "point Use = offset(from: P, dx: 1, dy: 0)"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "from: P") + "from: ".length, "Renamed");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["P", "P"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
    expect(plan?.edits.some((edit) => source.slice(edit.from, edit.to) === "A")).toBe(false);
  });

  it("renames a root geometry value-if condition through the ordinary scalar identity", () => {
    const source = [
      "nui 1",
      "const flag: boolean = true",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "const Selected: point = if (flag) { A } else { B }"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "if (flag") + "if (".length, "enabled");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["flag", "flag"]);
    expect(applyEdits(source, plan!.edits)).toContain("if (enabled)");
  });

  it("renames a collection value-if condition through the ordinary scalar identity", () => {
    const source = [
      "nui 1",
      "const flag: boolean = true",
      "const leftValues: number[] = [1, 2]",
      "const rightValues: number[] = [3]",
      "const selected: number[] = if (flag) { leftValues } else { rightValues }"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "if (flag") + "if (".length, "enabled");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["flag", "flag"]);
    expect(applyEdits(source, plan!.edits)).toContain("if (enabled)");
  });

  it("renames a root geometry value-match scrutinee through the choice identity", () => {
    const source = [
      "nui 1",
      "const side: choice(left, right) = @left",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "const Selected: point = match side { @left => A @right => B }"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "match side") + "match ".length, "whichSide");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["side", "side"]);
    expect(applyEdits(source, plan!.edits)).toContain("match whichSide");
  });

  it("renames a constructed geometry declaration through its ordinary identity", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 10, y: 0)",
      "const L: line = segment(start: A, end: B)",
      "const Copy: line = L"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "= L") + "= ".length, "Renamed");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["L", "L"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
  });

  it("returns a structured typed same-scope collision while preserving the null wrapper", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = width + 5"
    ].join("\n");
    const result = planDslRenameEditsResult(snapshot(source), at(source, "= width") + "= ".length, "result");

    expect(result).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "result", conflictingLine: 3 }
    });
    expect(planDslRenameEdits(snapshot(source), at(source, "= width") + "= ".length, "result")).toBeNull();
  });

  it("returns a structured invalid-name rejection from the typed analyzer", () => {
    const source = "nui 1\nconst width: number = 10";

    expect(planDslRenameEditsResult(snapshot(source), at(source, "width"), "")).toEqual({
      status: "rejected",
      rejection: { reason: "invalid-name", message: "名前は空にできません。" }
    });
  });

  it("returns a structured typed reference-resolution rejection for capture", () => {
    const source = [
      "nui 1",
      "const outer: number = 1",
      "group G {",
      "  const inner: number = 2",
      "  const use: number = outer",
      "}"
    ].join("\n");

    const result = planDslRenameEditsResult(snapshot(source), at(source, "= outer") + "= ".length, "inner");

    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" ? result.rejection : null).toEqual({
      reason: "reference-resolution-change",
      family: "typed",
      referencedName: "outer"
    });
  });

  it.each(qualifiedTypedRenameCasesWithModule)("has a valid independent Module rename oracle for $label", (testCase) => {
    const oracle = assertIndependentTypedRenameOracle(
      testCase.source,
      testCase.expectedSource,
      testCase.oldName,
      testCase.newName,
      [testCase.sourceReference],
      [testCase.expectedReference]
    );
    expect(oracle).toBeDefined();
    if (!oracle) return;

    if (testCase.label.startsWith("A")) {
      const outside = oracle.expected.bindingAnalysis?.catalog.bindings.find((binding) => binding.kind === "typed" && binding.name === "outside_angle");
      expect(outside && evaluatedScalarBindings(oracle.expected).computedScalarBindings?.get(outside.id)).toMatchObject({
        status: "ok",
        value: { kind: "number", value: 45 }
      });
    }
    if (testCase.label.startsWith("C absolute")) {
      const shadowStart = testCase.expectedSource.indexOf("const chest_dart_angle: number = 99") + "const ".length;
      const shadow = typedIdentityAt(oracle.expected, "declaration", shadowStart, shadowStart + "chest_dart_angle".length);
      expect(shadow).toMatchObject({ kind: "typed" });
      if (shadow?.kind === "typed") expect(shadow.bindingId).not.toBe(oracle.target.id);
    }
  });

  it.each([...qualifiedTypedRenameCases, ...qualifiedTypedRenameCasesWithModule])("preserves only the terminal leaf for $label", (testCase) => {
    const originalReferences = [testCase.sourceReference];
    const expectedReferences = [testCase.expectedReference];
    assertIndependentTypedRenameOracle(
      testCase.source,
      testCase.expectedSource,
      testCase.oldName,
      testCase.newName,
      originalReferences,
      expectedReferences
    );

    const declarationFrom = testCase.source.indexOf("const " + testCase.oldName) + "const ".length;
    const result = planDslRenameEditsResult(snapshot(testCase.source), declarationFrom, testCase.newName);
    const observed = result.status === "ok"
      ? {
          status: result.status,
          rejection: null,
          edits: result.plan.edits.map((edit) => ({
            from: edit.from,
            to: edit.to,
            oldText: testCase.source.slice(edit.from, edit.to),
            newText: edit.newText
          })).sort((left, right) => left.from - right.from),
          candidateSource: applyEdits(testCase.source, result.plan.edits)
        }
      : { status: result.status, rejection: result.rejection, edits: [], candidateSource: null };
    const declarationStart = declarationFrom;
    const referenceStart = testCase.source.indexOf(testCase.sourceReference) + testCase.sourceReference.length - testCase.oldName.length;
    const expectedEdits = [
      { from: declarationStart, to: declarationStart + testCase.oldName.length, oldText: testCase.oldName, newText: testCase.newName },
      { from: referenceStart, to: referenceStart + testCase.oldName.length, oldText: testCase.oldName, newText: testCase.newName }
    ].sort((left, right) => left.from - right.from);

    expect(observed).toEqual({ status: "ok", rejection: null, edits: expectedEdits, candidateSource: testCase.expectedSource });

  });

  it("renames nested qualified and unqualified uses of one binding while preserving unrelated text", () => {
    const source = [
      "nui 1",
      "group Front {",
      "  group Inner {",
      "    const dart_close_angle: number = 15",
      "    const inside_use: number = dart_close_angle + 1",
      "  }",
      "}",
      "const first_use: number = Front::Inner::dart_close_angle + 2",
      "const second_use: number = Front::Inner::dart_close_angle + 3",
      "// @Front::Inner::dart_close_angle in a comment stays authored",
      "const note: string = \"@Front::Inner::dart_close_angle\"",
      "group Other {",
      "  const dart_close_angle: number = 99",
      "}"
    ].join("\n");
    const expectedSource = [
      "nui 1",
      "group Front {",
      "  group Inner {",
      "    const chest_dart_angle: number = 15",
      "    const inside_use: number = chest_dart_angle + 1",
      "  }",
      "}",
      "const first_use: number = Front::Inner::chest_dart_angle + 2",
      "const second_use: number = Front::Inner::chest_dart_angle + 3",
      "// @Front::Inner::dart_close_angle in a comment stays authored",
      "const note: string = \"@Front::Inner::dart_close_angle\"",
      "group Other {",
      "  const dart_close_angle: number = 99",
      "}"
    ].join("\n");
    const references = ["= dart_close_angle", "Front::Inner::dart_close_angle", "Front::Inner::dart_close_angle"];
    const expectedReferences = ["= chest_dart_angle", "Front::Inner::chest_dart_angle", "Front::Inner::chest_dart_angle"];
    assertIndependentTypedRenameOracle(source, expectedSource, "dart_close_angle", "chest_dart_angle", references, expectedReferences);

    const declarationFrom = source.indexOf("const dart_close_angle") + "const ".length;
    const result = planDslRenameEditsResult(snapshot(source), declarationFrom, "chest_dart_angle");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    let referenceSearchFrom = 0;
    const expectedReferenceEdits = references.map((reference) => {
      const start = source.indexOf(reference, referenceSearchFrom);
      referenceSearchFrom = start + reference.length;
      return { from: start + reference.length - "dart_close_angle".length, to: start + reference.length, oldText: "dart_close_angle", newText: "chest_dart_angle" };
    });
    expect(result.plan.edits.map((edit) => ({
      from: edit.from,
      to: edit.to,
      oldText: source.slice(edit.from, edit.to),
      newText: edit.newText
    }))).toEqual([
      { from: declarationFrom, to: declarationFrom + "dart_close_angle".length, oldText: "dart_close_angle", newText: "chest_dart_angle" },
      ...expectedReferenceEdits
    ].sort((left, right) => left.from - right.from));
    expect(applyEdits(source, result.plan.edits)).toBe(expectedSource);
  });

  it("keeps qualified separators outside the target range", () => {
    const source = [
      "nui 1",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 0)",
      "}",
      "point Use = offset(from: Front::Shoulder, dx: 1, dy: 0)"
    ].join("\n");
    const group = queryDslRenameTarget(snapshot(source), at(source, "Front::Shoulder"));
    const shoulder = queryDslRenameTarget(snapshot(source), at(source, "Front::Shoulder") + "Front::".length);
    expect(group?.oldName).toBe("Front");
    expect(shoulder?.oldName).toBe("Shoulder");
    expect(group?.range).toEqual({ from: at(source, "Front::Shoulder"), to: at(source, "Front::Shoulder") + "Front".length });
    expect(shoulder?.range.from).toBe(at(source, "Front::Shoulder") + "Front::".length);
  });

  it("projects an element rename without changing comments or unrelated text", () => {
    const source = [
      "nui 1",
      "// Base in a comment",
      "point Base = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point Use = offset(",
      "  from: Base,",
      "  dx: 1,",
      "  dy: 0,",
      ")",
      "point BaseCopy = coordinate(x: 2, y: 0)"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "from: Base") + "from: ".length, "Renamed");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["Base", "Base"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
    expect(plan?.edits.some((edit) => source.slice(edit.from, edit.to) === "BaseCopy")).toBe(false);
  });

  it("projects element-side geometry properties from numeric expressions", () => {
    const source = [
      "nui 1",
      "// A in a comment",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(",
      "  x: A.x + 10,",
      "  y: 0,",
      ")",
      'text Label = label(text: "A", anchor: none, size: 3)'
    ].join("\n");
    const referenceStart = at(source, "A.x");
    const target = queryDslRenameTarget(snapshot(source), referenceStart);
    expect(target).toEqual({
      sourceRevision: 7,
      oldName: "A",
      range: { from: referenceStart, to: referenceStart + 1 }
    });
    expect(queryDslRenameTarget(snapshot(source), referenceStart + 2)).toBeNull();

    const plan = planDslRenameEdits(snapshot(source), referenceStart, "Renamed");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["A", "A"]);
    expect(plan?.edits.every((edit) => edit.newText === "Renamed")).toBe(true);
    expect(plan?.edits.every((edit) => edit.from > source.indexOf("// A"))).toBe(true);
    expect(source.slice(plan!.edits[0].from, plan!.edits[0].to)).toBe("A");
    expect(source).toContain('text: "A"');
  });

  it("projects qualified numeric geometry-property segments independently", () => {
    const source = [
      "nui 1",
      "group Group {",
      "  point A = coordinate(",
      "    x: 0,",
      "    y: 0,",
      "  )",
      "}",
      "point B = coordinate(",
      "  x: Group::A.x + 10,",
      "  y: 0,",
      ")"
    ].join("\n");
    const referenceStart = at(source, "Group::A.x");
    const group = queryDslRenameTarget(snapshot(source), referenceStart);
    const elementStart = referenceStart + "Group::".length;
    const element = queryDslRenameTarget(snapshot(source), elementStart);
    expect(group?.oldName).toBe("Group");
    expect(group?.range).toEqual({ from: referenceStart, to: referenceStart + "Group".length });
    expect(element?.oldName).toBe("A");
    expect(element?.range).toEqual({ from: elementStart, to: elementStart + 1 });
    expect(queryDslRenameTarget(snapshot(source), referenceStart + "Group::A".length + 1)).toBeNull();

    const groupPlan = planDslRenameEdits(snapshot(source), referenceStart, "RenamedGroup");
    expect(groupPlan).not.toBeNull();
    expect(groupPlan?.edits.map((edit) => edit.expectedText)).toEqual(["Group", "Group"]);
    const elementPlan = planDslRenameEdits(snapshot(source), elementStart, "RenamedA");
    expect(elementPlan).not.toBeNull();
    expect(elementPlan?.edits.map((edit) => edit.expectedText)).toEqual(["A", "A"]);
  });

  it("renames the element path of a qualified choice geometry property", () => {
    const source = [
      "nui 1",
      "group Outer {",
      "  arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: @clockwise)",
      "}",
      "const direction: choice(counterclockwise, clockwise) = Outer::A.direction"
    ].join("\n");
    const referenceStart = at(source, "Outer::A.direction");
    const elementStart = referenceStart + "Outer::".length;
    const target = queryDslRenameTarget(snapshot(source), elementStart);
    const plan = planDslRenameEdits(snapshot(source), elementStart, "RenamedArc");

    expect(target?.oldName).toBe("A");
    expect(target?.range).toEqual({ from: elementStart, to: elementStart + 1 });
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["A", "A"]);
    expect(plan?.edits.every((edit) => source.slice(edit.from, edit.to) !== "direction")).toBe(true);
    expect(applyEdits(source, plan!.edits)).toContain("Outer::RenamedArc.direction");
    expect(queryDslRenameTarget(snapshot(source), referenceStart + "Outer::A.".length + 1)).toBeNull();
  });

  it("rejects semantic fallback renames that capture an ordinary reference", () => {
    const source = [
      "nui 1",
      "arc A = arc(center: (0, 0), radius: 40, start: 15, end: 155, direction: @clockwise)",
      "group Nested {",
      "  arc Taken = arc(center: (0, 0), radius: 20, start: 10, end: 90, direction: @clockwise)",
      "  line Use = offset(sources: [A], distance: 5, side: @right, closed: false, suppressTrimWarnings: false)",
      "}",
      "const direction: choice(counterclockwise, clockwise) = A.direction"
    ].join("\n");
    const referenceStart = at(source, "A.direction");
    const result = planDslRenameEditsResult(snapshot(source), referenceStart, "Taken");

    expect(result).toEqual({
      status: "rejected",
      rejection: {
        reason: "reference-resolution-change",
        family: "element",
        line: 5
      }
    });
  });

  it("starts element rename from derived endpoint geometry properties", () => {
    const source = [
      "nui 1",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "point B = coordinate(",
      "  x: 10,",
      "  y: 0,",
      ")",
      "line AB = segment(",
      "  start: A,",
      "  end: B,",
      ")",
      "point Use = coordinate(",
      "  x: AB.startPoint.x + 1,",
      "  y: 0,",
      ")"
    ].join("\n");
    const referenceStart = at(source, "AB.startPoint.x");
    expect(queryDslRenameTarget(snapshot(source), referenceStart)?.oldName).toBe("AB");
    const plan = planDslRenameEdits(snapshot(source), referenceStart, "RenamedLine");
    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => edit.expectedText)).toEqual(["AB", "AB"]);
  });

  it("starts rename from layout and place numeric geometry properties", () => {
    const source = [
      "nui 1",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      ")",
      "group G {",
      "}",
      "layout Sheet(",
      "  scale: 1+A.x,",
      ") {",
      "  place G(",
      "    at: (3+A.x, 4+A.x),",
      "    angle: 5+A.x,",
      "    mirror: false,",
      "  )",
      "}"
    ].join("\n");
    const scaleReference = source.indexOf("A.x", source.indexOf("scale:"));
    const placeReference = source.indexOf("A.x", source.indexOf("place"));
    const xReference = source.indexOf("3+A.x") + "3+".length;
    const yReference = source.indexOf("4+A.x") + "4+".length;
    const angleReference = source.indexOf("A.x", source.indexOf("angle:"));
    for (const referenceStart of [scaleReference, placeReference, xReference, yReference, angleReference]) {
      expect(queryDslRenameTarget(snapshot(source), referenceStart)?.oldName).toBe("A");
    }
  });

  it("routes module definitions, parameters, instances, and call labels through module semantics", () => {
    const source = [
      "nui 1",
      "module Measure(width: number) {",
      "  point P = coordinate(x: width, y: 0)",
      "}",
      "instance Call = Measure(width: 10)"
    ].join("\n");
    const definition = planDslRenameEdits(snapshot(source), at(source, "Measure"), "MeasureLine");
    const parameter = planDslRenameEdits(snapshot(source), at(source, "width: number"), "length");
    expect(definition?.edits.length).toBe(2);
    expect(parameter?.edits.length).toBe(3);
  });

  it("renames nominal record types, values, fields, and record Module parameters safely", () => {
    const source = [
      "nui 1",
      "record Pair(x: number, label: string)",
      "record Other(x: number, label: string)",
      'const input: Pair = Pair(x: 1, label: "root")',
      'const other: Other = Other(x: 2, label: "other")',
      "const alias: Pair = input",
      "module Inner(input: Pair) {",
      "  const copy: Pair = input",
      "  const member: number = input.x",
      "  export const output: Pair = copy",
      "}",
      "instance Use = Inner(input)",
      "const exported: number = Use::output.x"
    ].join("\n");
    const current = snapshot(source);

    const typePlan = planDslRenameEdits(current, at(source, "record Pair") + "record ".length, "Duo");
    expect(typePlan).not.toBeNull();
    expect(typePlan?.edits.every((edit) => source.slice(edit.from, edit.to) === "Pair")).toBe(true);
    expect(typePlan?.edits.some((edit) => source.slice(edit.from, edit.to) === "Other")).toBe(false);

    const valueReferenceOffset = source.indexOf("input", source.indexOf("const alias"));
    const valuePlan = planDslRenameEdits(current, valueReferenceOffset, "config");
    expect(valuePlan).not.toBeNull();
    expect(valuePlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "input", "input", "input"
    ]);
    expect(valuePlan?.edits.find((edit) => edit.from === source.indexOf("Inner(input)") + "Inner(".length)?.newText).toBe("input: config");

    const fieldPlan = planDslRenameEdits(current, at(source, "x: number"), "amount");
    expect(fieldPlan).not.toBeNull();
    expect(fieldPlan?.edits.every((edit) => source.slice(edit.from, edit.to) === "x")).toBe(true);
    expect(fieldPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["x", "x", "x", "x"]);

    const parameterOffset = source.indexOf("input", source.indexOf("module Inner"));
    const parameterPlan = planDslRenameEdits(current, parameterOffset + 1, "source");
    expect(parameterPlan).not.toBeNull();
    const renamed = applyEdits(source, parameterPlan!.edits);
    expect(renamed).toContain("module Inner(source: Pair)");
    expect(renamed).toContain("source.x");
    expect(renamed).toContain("Inner(source: input)");

    expect(planDslRenameEditsResult(current, at(source, "record Pair") + "record ".length, "Other")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "Other", conflictingLine: 3 }
    });
    expect(planDslRenameEditsResult(current, at(source, "x: number"), "label")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "label", conflictingLine: 2 }
    });
  });

  it("renames an optional record member without touching the optional chaining operator", () => {
    const source = [
      "nui 1",
      "record Pair(label: string)",
      "const input: Pair? = none",
      "const output: string? = input?.label"
    ].join("\n");
    const plan = planDslRenameEdits(snapshot(source), at(source, "input?.label") + "input?.".length, "caption");

    expect(plan).not.toBeNull();
    expect(plan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["label", "label"]);
    expect(plan?.edits.every((edit) => edit.newText === "caption")).toBe(true);
    expect(plan?.edits.some((edit) => source.slice(edit.from, edit.to).includes("?."))).toBe(false);
  });

  it("fails closed for stale, fatal, unresolved, and module-iteration snapshots", () => {
    const source = ["nui 1", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const stale = snapshot(source, 7);
    expect(queryDslRenameTarget({ ...stale, source: { ...stale.source, sourceRevision: 8 } }, 6)).toBeNull();
    expect(queryDslRenameTarget({
      ...stale,
      semantic: { ...stale.semantic!, sourceText: `${source} ` }
    }, 6)).toBeNull();

    const brokenSource = ["nui 1", "point A = offset(from: Missing, dx: 1, dy: 0)"].join("\n");
    expect(queryDslRenameTarget(snapshot(brokenSource), at(brokenSource, "Missing"))).toBeNull();

    const iterationSource = [
      "nui 1",
      "for i in range(min: 0, max: 0, step: 1) {",
      "  point P = coordinate(x: 0, y: 0)",
      "}"
    ].join("\n");
    expect(planDslRenameEdits(snapshot(iterationSource), at(iterationSource, "i in") , "j")).toBeNull();
  });

  it("uses UTF-16 offsets when a surrogate pair precedes a Japanese identifier", () => {
    const source = [
      "nui 1",
      "// 😀",
      "point 前身頃 = coordinate(x: 0, y: 0)"
    ].join("\n");
    const offset = source.indexOf("前身頃");
    const target = queryDslRenameTarget(snapshot(source), offset + 1);
    expect(target?.range).toEqual({ from: offset, to: offset + "前身頃".length });
  });

  it("renames an ordinary source element in a document with materialized Module elements", () => {
    const source = [
      "nui 1",
      "const width: number = 10",
      "const result: number = width + 5",
      "point 前身頃 = coordinate(x: 0, y: 0)",
      "point 使用点 = offset(from: 前身頃, dx: 10, dy: 0)",
      "const 前身頃X: number = 前身頃.x",
      "module Measure(input: point) {",
      "  point P = offset(from: input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: 前身頃)"
    ].join("\n");
    const declarationOffset = at(source, "前身頃 =");
    const referenceOffset = at(source, "from: 前身頃") + "from: ".length;

    const declarationPlan = planDslRenameEdits(snapshot(source), declarationOffset, "後身頃");
    const referencePlan = planDslRenameEdits(snapshot(source), referenceOffset, "後身頃");

    expect(declarationPlan).not.toBeNull();
    expect(referencePlan).not.toBeNull();
    expect(declarationPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "前身頃",
      "前身頃",
      "前身頃",
      "前身頃"
    ]);
    expect(declarationPlan?.edits.map((edit) => edit.newText)).toEqual(["後身頃", "後身頃", "後身頃", "後身頃"]);
    expect(referencePlan?.edits).toEqual(declarationPlan?.edits);
    expect(declarationPlan?.edits.every((edit) => !source.slice(edit.from, edit.to).includes(".x"))).toBe(true);

    const widthPlan = planDslRenameEdits(snapshot(source), at(source, "= width") + "= ".length, "renamedWidth");
    expect(widthPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["width", "width"]);
  });

  it("renames qualified module-backed element segments without projecting aggregate candidates", () => {
    const source = [
      "nui 1",
      "group Front {",
      "  point Shoulder = coordinate(x: 0, y: 20)",
      "}",
      "point QualifiedUse = offset(",
      "  from: Front::Shoulder,",
      "  dx: 10,",
      "  dy: 0,",
      ")",
      "module Measure(input: point) {",
      "  point P = offset(from: input, dx: 1, dy: 0)",
      "}",
      "instance Call = Measure(input: QualifiedUse)"
    ].join("\n");
    const qualifiedReference = at(source, "Front::Shoulder");
    const frontOffset = qualifiedReference;
    const shoulderOffset = qualifiedReference + "Front::".length;

    const frontPlan = planDslRenameEdits(snapshot(source), frontOffset, "Bodice");
    expect(frontPlan).not.toBeNull();
    expect(frontPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Front", "Front"]);
    expect(frontPlan?.edits.map((edit) => edit.newText)).toEqual(["Bodice", "Bodice"]);

    const shoulderFromReference = planDslRenameEdits(snapshot(source), shoulderOffset, "NeckPoint");
    const shoulderFromDeclaration = planDslRenameEdits(snapshot(source), at(source, "Shoulder ="), "NeckPoint");
    for (const shoulderPlan of [shoulderFromReference, shoulderFromDeclaration]) {
      expect(shoulderPlan).not.toBeNull();
      expect(shoulderPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Shoulder", "Shoulder"]);
      expect(shoulderPlan?.edits.map((edit) => edit.expectedText)).toEqual(["Shoulder", "Shoulder"]);
      expect(shoulderPlan?.edits.map((edit) => edit.newText)).toEqual(["NeckPoint", "NeckPoint"]);
      expect(shoulderPlan?.edits.every((edit) => source.slice(edit.from, edit.to) !== "Front::Shoulder")).toBe(true);
    }
    expect(shoulderFromReference?.edits).toEqual(shoulderFromDeclaration?.edits);
  });

  it("preserves ordinary same-scope collisions in a document with materialized Module elements", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)",
      "module Measure(input: point) {",
      "  point P = offset(from: input, dx: 10, dy: 0)",
      "}",
      "instance Call = Measure(input: A)"
    ].join("\n");

    const result = planDslRenameEditsResult(snapshot(source), at(source, "A ="), "B");

    expect(result).toEqual({
      status: "rejected",
      rejection: {
        reason: "same-scope-collision",
        conflictingName: "B",
        conflictingLine: 3
      }
    });
    expect(planDslRenameEdits(snapshot(source), at(source, "A ="), "B")).toBeNull();
  });

  it("returns a structured collision for an ordinary element without Module materialization", () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 0)"
    ].join("\n");

    expect(planDslRenameEditsResult(snapshot(source), at(source, "A ="), "B")).toEqual({
      status: "rejected",
      rejection: {
        reason: "same-scope-collision",
        conflictingName: "B",
        conflictingLine: 3
      }
    });
  });

  it("returns a structured Module parameter collision", () => {
    const source = [
      "nui 1",
      "module Measure(width: number, length: number) {",
      "  point P = coordinate(x: width, y: 0)",
      "}",
      "instance Call = Measure(width: 10, length: 20)"
    ].join("\n");

    expect(planDslRenameEditsResult(snapshot(source), at(source, "width: number"), "length")).toEqual({
      status: "rejected",
      rejection: { reason: "same-scope-collision", conflictingName: "length", conflictingLine: 2 }
    });
  });

  it("renames multiline layout/layer outputs and qualified placement paths", () => {
    const source = [
      "nui 1",
      "layer OutputLayer",
      "group Outer {",
      "  group Inner {",
      "    point Origin = coordinate(x: 0, y: 0)",
      "  }",
      "}",
      "layout Layout {",
      "  place Outer::Inner(",
      "    origin: Outer::Inner::Origin,",
      "    at: (0, 0),",
      "  )",
      "}",
      "print PrintOutput(",
      "  layout: Layout,",
      "  layers: [OutputLayer],",
      "  paper: a4,",
      "  overlap: 0,",
      ")",
      "svg SvgOutput(",
      "  layout: Layout,",
      "  layers: [OutputLayer],",
      ")"
    ].join("\n");

    const layoutDeclaration = source.indexOf("Layout") + 1;
    const layoutReference = source.indexOf("layout: Layout") + "layout: ".length;
    const layoutSvgReference = source.indexOf("layout: Layout", layoutReference) + "layout: ".length;
    const layoutFromDeclaration = planDslRenameEdits(snapshot(source), layoutDeclaration, "RenamedLayout");
    const layoutFromPrint = planDslRenameEdits(snapshot(source), layoutReference, "RenamedLayout");
    const layoutFromSvg = planDslRenameEdits(snapshot(source), layoutSvgReference, "RenamedLayout");
    expect(layoutFromDeclaration).not.toBeNull();
    expect(layoutFromPrint?.edits).toEqual(layoutFromDeclaration?.edits);
    expect(layoutFromSvg?.edits).toEqual(layoutFromDeclaration?.edits);
    expect(layoutFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "Layout",
      "Layout",
      "Layout"
    ]);

    const layerDeclaration = source.indexOf("OutputLayer") + 1;
    const layerReference = source.indexOf("layers: [OutputLayer") + "layers: [".length;
    const layerSvgReference = source.indexOf("layers: [OutputLayer", layerReference) + "layers: [".length;
    const layerFromDeclaration = planDslRenameEdits(snapshot(source), layerDeclaration, "RenamedLayer");
    const layerFromPrint = planDslRenameEdits(snapshot(source), layerReference, "RenamedLayer");
    const layerFromSvg = planDslRenameEdits(snapshot(source), layerSvgReference, "RenamedLayer");
    expect(layerFromDeclaration).not.toBeNull();
    expect(layerFromPrint?.edits).toEqual(layerFromDeclaration?.edits);
    expect(layerFromSvg?.edits).toEqual(layerFromDeclaration?.edits);
    expect(layerFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "OutputLayer",
      "OutputLayer",
      "OutputLayer"
    ]);

    const innerDeclaration = source.indexOf("Inner") + 1;
    const innerReference = source.indexOf("Outer::Inner") + "Outer::".length;
    const innerOriginReference = source.indexOf("Outer::Inner::Origin") + "Outer::".length;
    const innerFromDeclaration = planDslRenameEdits(snapshot(source), innerDeclaration, "RenamedInner");
    const innerFromTarget = planDslRenameEdits(snapshot(source), innerReference, "RenamedInner");
    const innerFromOrigin = planDslRenameEdits(snapshot(source), innerOriginReference, "RenamedInner");
    expect(innerFromDeclaration).not.toBeNull();
    expect(innerFromTarget?.edits).toEqual(innerFromDeclaration?.edits);
    expect(innerFromOrigin?.edits).toEqual(innerFromDeclaration?.edits);
    expect(innerFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual([
      "Inner",
      "Inner",
      "Inner"
    ]);

    const originDeclaration = source.indexOf("Origin") + 1;
    const originReference = source.indexOf("Outer::Inner::Origin") + "Outer::Inner::".length;
    const originFromDeclaration = planDslRenameEdits(snapshot(source), originDeclaration, "RenamedOrigin");
    const originFromReference = planDslRenameEdits(snapshot(source), originReference, "RenamedOrigin");
    expect(originFromDeclaration).not.toBeNull();
    expect(originFromReference?.edits).toEqual(originFromDeclaration?.edits);
    expect(originFromDeclaration?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["Origin", "Origin"]);
  });

  it("renames print and SVG declarations and rejects same-scope source collisions", () => {
    const source = [
      "nui 1",
      "group Existing {",
      "}",
      "layout Layout {",
      "  place Existing(at: (0, 0))",
      "}",
      "print PrintOutput(layout: Layout, layers: [default], paper: a4, overlap: 0)",
      "svg SvgOutput(layout: Layout, layers: [default])"
    ].join("\n");

    const printPlan = planDslRenameEdits(snapshot(source), source.indexOf("PrintOutput") + 1, "RenamedPrint");
    const svgPlan = planDslRenameEdits(snapshot(source), source.indexOf("SvgOutput") + 1, "RenamedSvg");
    expect(printPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["PrintOutput"]);
    expect(svgPlan?.edits.map((edit) => source.slice(edit.from, edit.to))).toEqual(["SvgOutput"]);
    expect(planDslRenameEdits(snapshot(source), source.indexOf("Layout") + 1, "Existing")).toBeNull();
  });
});
