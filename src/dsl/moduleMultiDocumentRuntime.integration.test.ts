import { evaluateWithRustOptions } from "../../test/evaluationParitySupport";
import { evaluationPayloadToResult } from "../geometry/evaluationPayload";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeDslLintDiagnostics, compileDslDocument } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { parseDsl } from "@nuinuicad/nui-language";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import {
  analyzeMultiDocumentSource,
  buildMultiDocumentImportGraph,
  SavedDocumentArtifactCache,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "@nuinuicad/nui-language/workspace";
import { analyzeMultiDocumentModuleSemantics, moduleDeclarationContributor } from "@nuinuicad/nui-language/workspace";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
import { createModuleRuntimeContext } from "@nuinuicad/nui-language";
import { resolveSourceLexicalPath } from "@nuinuicad/nui-language";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import { queryDslCanvasRevealSourceTarget } from "@nuinuicad/nui-language";
import { queryDslCanvasSourceDefinitionQualified } from "@nuinuicad/nui-language";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { formatDslSourceReference } from "@nuinuicad/nui-language";
import { parseDslSourceReference } from "@nuinuicad/nui-language";
import { referencePickCandidates } from "../model/referencePickCandidates";
import {
  canvasLayerVisibleElementIds,
  projectCanvasLayerPresentation
} from "../model/canvasLayerPresentation";
import { startVscodeReferencePickCanvasSession } from "../vscode/referencePickCanvasSession";
import { referencePickTargetProofFor } from "../vscode/referencePickProtocol";
import {
  canvasRuntimePresentationFor,
  projectVscodeMultiDocumentCanvasRuntime
} from "../vscode/multiDocumentRuntimeTransport";

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
  cache?: SavedDocumentArtifactCache,
  rootStatementIdByStatementIndex?: ReadonlyMap<number, string>
) => {
  const graph = await buildMultiDocumentImportGraph({
    root,
    ...(cache ? { cache } : {}),
    ...(rootStatementIdByStatementIndex ? { rootStatementIdByStatementIndex } : {}),
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

const evaluateCompiledWithRust = (compiled: ReturnType<typeof compileDslDocument>) => {
  if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) {
    throw new Error("expected a compiled document");
  }
  return evaluationPayloadToResult(evaluateWithRustOptions(
    process.cwd(),
    compiled.document.elements,
    buildEvaluationOptions({
      compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion },
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    })
  ));
};

describe("M2 imported materialized path recipe scopes", () => {
  it.each([
    ["extract", true], ["extract", false], ["transformCopy", true], ["transformCopy", false]
  ] as const)("%s / angle before source %s", async (kind, angleBefore) => {
    const source = "line L = segment(start: (0, 0), end: (20, 0))";
    const copy = kind === "extract"
      ? "extract C(source: L, parts: [copy: start..end])"
      : "transformCopy C(startPoint: (0, 0), parts: [copy: L])";
    const angle = "const angle: number = -45";
    const move = "move C::copy(from: (0, 0), to: (0, 0), angleDeg: angle)";
    const body = angleBefore ? [angle, source, copy, move] : [source, copy, angle, move];
    const library = savedSource("issue-1701-library", "sha256:issue-1701-library", [
      "nui 1", "export module Shape() {", ...body.map(row => `  ${row}`), "}"
    ].join("\n"));
    const root = rootSource("issue-1701-root", [
      "nui 1", 'import "./shape.nui" as lib', "instance First = lib::Shape()", "instance Second = lib::Shape()"
    ].join("\n"));
    const { graph, compiled } = await compileImported(root, new Map([[`${root.documentId}|./shape.nui`, library]]));
    expect(graph.valid).toBe(true);
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    const savedLibrary = compileFreshCanonicalText(library.normalizedSource);
    expect(savedLibrary.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(analyzeDslLintDiagnostics(savedLibrary.currentCompiled)
      .filter(diagnostic => diagnostic.code === "unused-typed-declaration")).toEqual([]);
    for (const evaluation of [evaluateCompiled(compiled), evaluateCompiledWithRust(compiled)]) {
      expect(evaluation.errors).toEqual([]);
      expect(evaluation.geometryValueErrors ?? []).toEqual([]);
      for (const name of ["L", "copy"]) {
        const elements = compiled.document!.elements.filter(element => element.name === name);
        expect(new Set(elements.map(element => element.id)).size).toBe(2);
        for (const element of elements) {
          const geometry = evaluation.computedGeometry.get(element.id);
          if (!geometry || !("end" in geometry)) throw new Error(`Missing path ${element.id}`);
          expect(geometry.end?.x).toBeCloseTo(name === "L" ? 20 : 14.1421356237, 8);
          expect(geometry.end?.y).toBeCloseTo(name === "L" ? 0 : -14.1421356237, 8);
        }
      }
    }
  }, 20_000);
});

const issue1702Library = savedSource("issue-1702-copy2-library", "sha256:issue-1702-copy2-library", `nui 1\nexport module Copy2() {\n  point Origin = coordinate(x: 0, y: 0)\n  line Source = segment(start: (0, 0), end: (10, 0))\n  transformCopy Copy(startPoint: Origin, visible: false, parts: [transformed: Source])\n  export path copy2 = from(source: Copy::transformed)\n}`);

const issue1702Root = (copy2Target: string) => rootSource("issue-1702-copy2-root", `nui 1\nimport "./copy2_lib.nui" as lib\ngroup body_front {\n  line unrelated = segment(start: (30, 30), end: (40, 30))\n  group seam {\n    line upper = segment(start: (5, -10), end: (5, 10))\n    instance corner = lib::Copy2()\n    edge [\n      ${copy2Target},\n      upper.start\n    ](index: 0)\n  }\n}`);

const issue1702ShadowRoot = (copy2Target: string) => rootSource("issue-1702-shadow-root", `nui 1\nimport "./copy2_lib.nui" as lib\ninstance corner = lib::Copy2()\ngroup body_front {\n  line unrelated = segment(start: (30, 30), end: (40, 30))\n  group seam {\n    line upper = segment(start: (5, -10), end: (5, 10))\n    instance corner = lib::Copy2()\n    edge [\n      ${copy2Target},\n      upper.start\n    ](index: 0)\n  }\n}\ngroup other {\n  instance corner = lib::Copy2()\n}`);

const compileIssue1702Edge = async (copy2Target: string) => {
  const root = issue1702Root(copy2Target);
  const imported = await compileImported(root, new Map([[
    `${root.documentId}|./copy2_lib.nui`,
    issue1702Library
  ]]));
  return { root, ...imported };
};

const compileIssue1702ShadowEdge = async (copy2Target: string) => {
  const root = issue1702ShadowRoot(copy2Target);
  const imported = await compileImported(root, new Map([[
    `${root.documentId}|./copy2_lib.nui`,
    issue1702Library
  ]]));
  return { root, ...imported };
};

const issue1702TargetOwner = (
  compiled: ReturnType<typeof compileDslDocument>,
  libraryDocumentId: typeof issue1702Library.documentId,
  selector: string
) => {
  const parsed = parseDslSourceReference(selector);
  if (parsed.kind !== "valid" || parsed.reference.path.segments.length < 2) {
    throw new Error(`expected a qualified endpoint selector: ${selector}`);
  }
  const edgeStatementIndex = compiled.statements.findIndex(statement =>
    statement.kind === "transformation" && statement.construction === "edge"
  );
  if (!compiled.sourceLexicalNamespace || !compiled.moduleSemanticAnalysis || !compiled.moduleMaterialization ||
      !compiled.moduleRuntimeContext || !compiled.statementMap || edgeStatementIndex < 0) {
    throw new Error("expected lexical, semantic, runtime, and materialization products for the edge target");
  }
  const instanceLookup = resolveSourceLexicalPath(
    compiled.sourceLexicalNamespace,
    edgeStatementIndex,
    {
      absolute: parsed.reference.path.absolute,
      segments: parsed.reference.path.segments.slice(0, -1)
    }
  );
  expect(instanceLookup.kind).toBe("resolved");
  if (instanceLookup.kind !== "resolved" || instanceLookup.declaration.kind !== "moduleInstance") {
    throw new Error(`expected a resolved Module instance path for ${selector}`);
  }
  const instance = compiled.moduleSemanticAnalysis.instancesByStatementId.get(instanceLookup.declaration.statementId);
  if (!instance?.callee || instance.calleeResolution !== "resolved") {
    throw new Error(`expected a resolved Module callee for ${selector}`);
  }
  const definition = (instance.callee.definitionIdentity
    ? compiled.moduleRuntimeContext.definitionFor(instance.callee.definitionIdentity)
    : null) ?? instance.callee.definition;
  if (!definition) throw new Error(`expected the exact Module definition identity for ${selector}`);
  const exportName = parsed.reference.path.segments.at(-1)!;
  const exported = definition.exports.find(candidate => candidate.kind === "geometry" && candidate.name === exportName);
  if (!exported || exported.kind !== "geometry") throw new Error(`expected a public geometry export ${exportName}`);
  const entry = compiled.moduleMaterialization.executionStatements.find(candidate =>
    candidate.origin?.kind === "moduleBody" &&
    candidate.origin.sourceDocumentId === libraryDocumentId &&
    candidate.sourceStatementId === exported.exportedStatementId &&
    candidate.sourceStatementIndex === exported.exportedStatementIndex &&
    candidate.instancePath.length === 1 &&
    candidate.instancePath[0] === instance.statementId
  );
  if (!entry) throw new Error(`expected materialized export ${exportName} for the resolved Module instance`);
  const owner = sourceOwnerForRuntimeElementId({ ...compiled, statementMap: compiled.statementMap }, entry.runtimeElementId);
  expect(owner).toMatchObject({
    runtimeElementId: entry.runtimeElementId,
    kind: "moduleBody",
    sourceStatementId: entry.sourceStatementId,
    sourceStatementIndex: exported.exportedStatementIndex,
    sourceDocumentId: libraryDocumentId,
    sourceIdentity: { documentId: libraryDocumentId, localIdentity: exported.exportedStatementId },
    origin: {
      kind: "moduleBody",
      instancePath: [instance.statementId],
      sourceDocumentId: libraryDocumentId,
      moduleDefinitionIdentity: definition.identity
    }
  });
  expect(owner?.sourceStatementId).toBe(entry.sourceStatementId);

  const sourceRecipe = compiled.document?.transformationRecipes?.find(recipe =>
    recipe.sourceStatementIndex === edgeStatementIndex && recipe.construction === "edge"
  );
  const runtimeRecipe = compiled.runtimeTransformationRecipes?.find(recipe =>
    recipe.sourceStatementIndex === edgeStatementIndex && recipe.construction === "edge"
  );
  expect(sourceRecipe?.targets.map(target => target.ownerId)).toContain(entry.sourceStatementId);
  expect(runtimeRecipe?.targets.map(target => target.ownerId)).toContain(entry.runtimeElementId);
  return { instance, definition, exported, entry, owner, sourceRecipe, runtimeRecipe };
};

const assertIssue1702Geometry = (
  compiled: ReturnType<typeof compileDslDocument>,
  evaluation: ReturnType<typeof evaluateCompiled>
) => {
  expect(evaluation.errors).toEqual([]);
  expect(evaluation.geometryValueErrors).toEqual([]);
  const copy2 = compiled.moduleMaterialization?.executionStatements.find(entry =>
    entry.origin?.kind === "moduleBody" &&
    entry.origin.sourceDocumentId === issue1702Library.documentId &&
    entry.statement.name === "copy2"
  );
  const upperStatementIndex = compiled.statements.findIndex(statement =>
    statement.kind === "element" && statement.name === "upper"
  );
  const unrelatedStatementIndex = compiled.statements.findIndex(statement =>
    statement.kind === "element" && statement.name === "unrelated"
  );
  const upper = compiled.sourceElementsByStatementIndex.get(upperStatementIndex);
  const unrelated = compiled.sourceElementsByStatementIndex.get(unrelatedStatementIndex);
  expect(copy2).toBeDefined();
  expect(upper).toBeDefined();
  expect(unrelated).toBeDefined();
  expect(copy2 && evaluation.computedGeometry.get(copy2.runtimeElementId)).toMatchObject({
    start: { x: 0, y: 0 },
    end: { x: 5, y: 0 }
  });
  expect(upper && evaluation.computedGeometry.get(upper.id)).toMatchObject({
    kind: "line",
    start: { x: 5, y: 0 },
    end: { x: 5, y: 10 }
  });
  expect(unrelated && evaluation.computedGeometry.get(unrelated.id)).toMatchObject({
    kind: "line",
    start: { x: 30, y: 30 },
    end: { x: 40, y: 30 }
  });
};

beforeAll(() => {
  execFileSync(
    "cargo",
    ["build", "--quiet", "--manifest-path", `${process.cwd()}/rust-evaluator/Cargo.toml`, "--example", "evaluate_fixture"],
    { cwd: process.cwd(), stdio: "inherit", timeout: 120_000 }
  );
}, 125_000);

describe("multi-document module runtime", () => {
  it("compiles and evaluates a fully-qualified Module export edge target (#1702)", async () => {
    const { compiled } = await compileIssue1702Edge("body_front::seam::corner::copy2.end");
    const errors = compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    expect(errors, JSON.stringify(compiled.diagnostics, null, 2)).toEqual([]);
    expect(compiled.document).not.toBeNull();
    if (!compiled.document) return;
    issue1702TargetOwner(compiled, issue1702Library.documentId, "body_front::seam::corner::copy2.end");
    assertIssue1702Geometry(compiled, evaluateCompiled(compiled));
    assertIssue1702Geometry(compiled, evaluateCompiledWithRust(compiled));
  });

  it("keeps the short Module export edge selector as a working control (#1702)", async () => {
    const { compiled } = await compileIssue1702Edge("corner::copy2.end");
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    if (!compiled.document) return;
    issue1702TargetOwner(compiled, issue1702Library.documentId, "corner::copy2.end");
    assertIssue1702Geometry(compiled, evaluateCompiled(compiled));
    assertIssue1702Geometry(compiled, evaluateCompiledWithRust(compiled));
  });

  it("preserves lexical shadowing, distinct same-name instances, and absolute Module qualification (#1702)", async () => {
    for (const selector of [
      "body_front::seam::corner::copy2.end",
      "corner::copy2.end",
      "::body_front::seam::corner::copy2.end"
    ]) {
      const { compiled } = await compileIssue1702ShadowEdge(selector);
      expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error"), selector).toEqual([]);
      expect(compiled.document).not.toBeNull();
      if (!compiled.document || !compiled.moduleMaterialization) continue;
      const { instance, entry } = issue1702TargetOwner(compiled, issue1702Library.documentId, selector);
      const copyEntries = compiled.moduleMaterialization.executionStatements.filter(candidate =>
        candidate.origin?.kind === "moduleBody" &&
        candidate.origin.sourceDocumentId === issue1702Library.documentId &&
        candidate.sourceStatementId === entry.sourceStatementId
      );
      expect(copyEntries).toHaveLength(3);
      expect(new Set(copyEntries.map(candidate => candidate.instancePath.join("/"))).size).toBe(3);
      expect(entry.instancePath).toEqual([instance.statementId]);
      const unrelatedIndex = compiled.statements.findIndex(statement =>
        statement.kind === "element" && statement.name === "unrelated"
      );
      const upperIndex = compiled.statements.findIndex(statement =>
        statement.kind === "element" && statement.name === "upper"
      );
      const unrelated = compiled.sourceElementsByStatementIndex.get(unrelatedIndex)!;
      const upper = compiled.sourceElementsByStatementIndex.get(upperIndex)!;
      for (const evaluation of [evaluateCompiled(compiled), evaluateCompiledWithRust(compiled)]) {
        expect(evaluation.errors).toEqual([]);
        expect(evaluation.geometryValueErrors).toEqual([]);
        expect(evaluation.computedGeometry.get(entry.runtimeElementId)).toMatchObject({
          start: { x: 0, y: 0 },
          end: { x: 5, y: 0 }
        });
        expect(evaluation.computedGeometry.get(upper.id)).toMatchObject({
          start: { x: 5, y: 0 },
          end: { x: 5, y: 10 }
        });
        expect(evaluation.computedGeometry.get(unrelated.id)).toMatchObject({
          start: { x: 30, y: 30 },
          end: { x: 40, y: 30 }
        });
        for (const sibling of copyEntries.filter(candidate => candidate.runtimeElementId !== entry.runtimeElementId)) {
          expect(evaluation.computedGeometry.get(sibling.runtimeElementId)).toMatchObject({
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 }
          });
        }
      }
    }
  });

  it("compiles an edge selector produced from a fully-qualified Reference Pick candidate (#1671)", async () => {
    const root = rootSource("issue-1702-pick-root", `nui 1\nimport "./copy2_lib.nui" as lib\ngroup body_front {\n  line unrelated = segment(start: (30, 30), end: (40, 30))\n  group seam {\n    line upper = segment(start: (5, -10), end: (5, 10))\n    instance corner = lib::Copy2()\n    // Reference Pick edge insertion point\n  }\n}`);
    const dependencies = new Map([[`${root.documentId}|./copy2_lib.nui`, issue1702Library]]);
    const picked = await compileImported(root, dependencies);
    expect(picked.compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(picked.compiled.document).not.toBeNull();
    if (!picked.compiled.document) return;
    const pickEvaluation = evaluateCompiled(picked.compiled);
    const candidate = referencePickCandidates({ compiled: picked.compiled, evaluation: pickEvaluation, target: null })
      .find(item => item.options.some(option =>
        option.kind === "point" &&
        option.reference.base === "body_front::seam::corner::copy2" &&
        option.reference.pointKey === "end"
      ));
    const endpoint = candidate?.options.find(option =>
      option.kind === "point" && option.reference.base === "body_front::seam::corner::copy2" && option.reference.pointKey === "end"
    );
    expect(endpoint?.kind).toBe("point");
    if (!endpoint || endpoint.kind !== "point") return;
    const pickedReference = parseDslSourceReference(`${endpoint.reference.base}.${endpoint.reference.pointKey}`);
    expect(pickedReference.kind).toBe("valid");
    if (pickedReference.kind !== "valid") return;
    const selector = formatDslSourceReference(pickedReference.reference);
    expect(selector).toBe("body_front::seam::corner::copy2.end");
    const rootWithEdge = rootSource("issue-1702-pick-root", root.normalizedSource.replace(
      "    // Reference Pick edge insertion point",
      `    edge [\n      ${selector},\n      upper.start\n    ](index: 0)`
    ));
    const { compiled } = await compileImported(rootWithEdge, dependencies);
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    if (!compiled.document) return;
    issue1702TargetOwner(compiled, issue1702Library.documentId, selector);
    assertIssue1702Geometry(compiled, evaluateCompiled(compiled));
    assertIssue1702Geometry(compiled, evaluateCompiledWithRust(compiled));
  });

  it("rejects invalid, ambiguous, private, and missing qualified Module export paths (#1702)", async () => {
    const expectRejectedEdge = (compiled: ReturnType<typeof compileDslDocument>) => {
      const edgeIndex = compiled.statements.findIndex(statement =>
        statement.kind === "transformation" && statement.construction === "edge"
      );
      expect(edgeIndex).toBeGreaterThanOrEqual(0);
      expect(compiled.diagnostics.some(diagnostic => diagnostic.severity === "error"),
        JSON.stringify(compiled.diagnostics, null, 2)).toBe(true);
      expect(compiled.transformationRecipes?.some(recipe =>
        recipe.sourceStatementIndex === edgeIndex && recipe.construction === "edge"
      )).not.toBe(true);
      expect(compiled.runtimeTransformationRecipes?.some(recipe =>
        recipe.sourceStatementIndex === edgeIndex && recipe.construction === "edge"
      )).not.toBe(true);
    };

    const invalid = await compileIssue1702Edge("body_front::missing::corner::copy2.end");
    const invalidParsed = parseDslSourceReference("body_front::missing::corner::copy2.end");
    expect(invalidParsed.kind).toBe("valid");
    expect(invalid.compiled.diagnostics.some(diagnostic => diagnostic.code === "unresolved-transformation-target")).toBe(true);
    expectRejectedEdge(invalid.compiled);

    const ambiguousRoot = rootSource("issue-1702-ambiguous-root", `nui 1\nimport "./copy2_lib.nui" as lib\ngroup body_front {\n  group seam {\n    instance corner = lib::Copy2()\n  }\n}\ngroup body_front {\n  group seam {\n    instance corner = lib::Copy2()\n  }\n}\nline upper = segment(start: (5, -10), end: (5, 10))\nedge [body_front::seam::corner::copy2.end, upper.start](index: 0)`);
    const ambiguous = await compileImported(ambiguousRoot, new Map([[
      `${ambiguousRoot.documentId}|./copy2_lib.nui`,
      issue1702Library
    ]]));
    const ambiguousEdgeIndex = ambiguous.compiled.statements.findIndex(statement =>
      statement.kind === "transformation" && statement.construction === "edge"
    );
    const ambiguousPath = resolveSourceLexicalPath(ambiguous.compiled.sourceLexicalNamespace!, ambiguousEdgeIndex, {
      absolute: false,
      segments: ["body_front", "seam", "corner"]
    });
    expect(ambiguousPath.kind).toBe("ambiguous");
    expect(ambiguous.compiled.diagnostics.some(diagnostic => diagnostic.code === "duplicate-element-name")).toBe(true);
    expectRejectedEdge(ambiguous.compiled);

    const privateLibrary = savedSource("issue-1702-private-library", "sha256:issue-1702-private-library", `nui 1\nexport module Public() {\n  export line Visible = segment(start: (0, 0), end: (10, 0))\n  line Private = segment(start: (0, 10), end: (10, 10))\n}`);
    const privateRoot = (selector: string, id: string) => rootSource(id, `nui 1\nimport "./private_lib.nui" as lib\ngroup G {\n  line upper = segment(start: (5, -10), end: (5, 10))\n  instance corner = lib::Public()\n  edge [${selector}, upper.start](index: 0)\n}`);
    for (const [selector, id] of [["corner::Private.end", "issue-1702-private-root"], ["corner::Missing.end", "issue-1702-missing-root"]]) {
      const rootForExport = privateRoot(selector, id);
      const compiled = await compileImported(rootForExport, new Map([[
        `${rootForExport.documentId}|./private_lib.nui`,
        privateLibrary
      ]]));
      expect(
        compiled.compiled.diagnostics.some(diagnostic => diagnostic.code === "unresolved-transformation-target"),
        `${selector}: ${JSON.stringify(compiled.compiled.diagnostics, null, 2)}`
      ).toBe(true);
      expectRejectedEdge(compiled.compiled);
    }
  });

  it("evaluates the imported exported-line edge owner in TS and Rust (#1670)", async () => {
    const library = savedSource("edge-export-library", "sha256:issue-1670-edge-export-library", [
      "nui 1",
      "",
      "export module ExportLine() {",
      "  export line side = segment(",
      "    start: (0, 0),",
      "    end: (10, 0),",
      "  )",
      "}"
    ].join("\n"));
    const root = rootSource("edge-export-root", [
      "nui 1",
      'import "./edge_export_lib.nui" as lib',
      "",
      "point unrelated = coordinate(x: 100, y: 100)",
      "",
      "line bottom = segment(",
      "  start: (5, -10),",
      "  end: (5, 10),",
      ")",
      "",
      "instance concave_notch = lib::ExportLine()",
      "",
      "edge [",
      "  concave_notch::side.end,",
      "  bottom.start",
      "](index: 0)"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./edge_export_lib.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.code === "transformation-target-kind-incompatible")).toEqual([]);
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;

    const evaluationOptions = buildEvaluationOptions({
      compiledDocument: {
        ...compiled,
        document: compiled.document,
        statementMap: compiled.statementMap,
        majorVersion: compiled.majorVersion
      },
      evaluationLimitIndex: compiled.document.evaluationLimitIndex
    });
    const ts = evaluateCompiled(compiled);
    const rust = evaluationPayloadToResult(evaluateWithRustOptions(
      process.cwd(),
      compiled.document.elements,
      evaluationOptions
    ));
    const side = compiled.document.elements.find(element => element.name === "side");
    const bottom = compiled.document.elements.find(element => element.name === "bottom");
    const unrelated = compiled.document.elements.find(element => element.name === "unrelated");

    expect(side).toBeDefined();
    expect(bottom).toBeDefined();
    expect(unrelated).toBeDefined();
    for (const evaluation of [ts, rust]) {
      expect(evaluation.errors).toEqual([]);
      expect(evaluation.geometryValueErrors).toEqual([]);
      expect(side && evaluation.computedGeometry.get(side.id)).toMatchObject({
        kind: "line",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 }
      });
      expect(bottom && evaluation.computedGeometry.get(bottom.id)).toMatchObject({
        kind: "line",
        start: { x: 5, y: 0 },
        end: { x: 5, y: 10 }
      });
      expect(unrelated && evaluation.computedGeometry.get(unrelated.id)).toMatchObject({
        kind: "point",
        x: 100,
        y: 100
      });
    }
  });

  it("projects root Layer declarations for the Issue #1621 imported-instance fixture", async () => {
    const library = savedSource("file:///workspace/modules/layer_probe.nui", "sha256:issue-1621-layer-probe", `nui 1

export module Probe(x: number) {
  point marker = coordinate(x: x, y: 0)
}
`);
    const rootText = (instanceLine: string) => `nui 1

import "../modules/layer_probe.nui" as probe

layer seam_layer

${instanceLine}
`;
    const activeRoot = rootSource("file:///workspace/patterns/f12-mini.nui", rootText("instance N = probe::Probe(x: 10)"));
    const dependencies = new Map([[`${activeRoot.documentId}|../modules/layer_probe.nui`, library]]);
    const active = await compileImported(activeRoot, dependencies);
    expect(active.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(active.compiled.document?.elements.some((element) => element.name === "marker")).toBe(true);

    const activeSnapshot = projectVscodeMultiDocumentCanvasRuntime({
      graph: active.graph,
      compiled: active.compiled,
      graphRevision: 42
    });
    expect(activeSnapshot).not.toBeNull();
    expect(activeSnapshot?.rootDocumentId).toBe(activeRoot.documentId);
    expect(activeSnapshot?.rootSourceRevision).toBe(activeRoot.sourceRevision);
    // This is the earliest graph-to-Canvas source boundary: Fixture A's empty
    // root Layer must travel beside its imported Module materialization.
    expect(activeSnapshot?.modulePresentation.layerSourceDocuments).toContainEqual(expect.objectContaining({
      documentId: activeRoot.documentId,
      declarations: [expect.objectContaining({ name: "seam_layer" })]
    }));
    const serializedPresentation = canvasRuntimePresentationFor(JSON.parse(JSON.stringify(activeSnapshot!)));
    expect(serializedPresentation).toMatchObject({
      graphRevision: 42,
      rootDocumentId: activeRoot.documentId,
      rootSourceRevision: activeRoot.sourceRevision
    });
    expect(serializedPresentation.layerSourceDocuments).toEqual(activeSnapshot?.modulePresentation.layerSourceDocuments);

    const staleRoot = { ...activeRoot, sourceRevision: activeRoot.sourceRevision - 1 };
    const stale = await compileImported(staleRoot, dependencies);
    expect(projectVscodeMultiDocumentCanvasRuntime({
      graph: active.graph,
      compiled: stale.compiled,
      graphRevision: 42
    })).toBeNull();

    const activeContext = active.compiled.moduleRuntimeContext!;
    const revisionMismatchContext: NonNullable<typeof active.compiled.moduleRuntimeContext> = {
      ...activeContext,
      documentFor: (documentId) => {
        const runtimeDocument = activeContext.documentFor(documentId);
        if (
          documentId !== activeContext.rootDocumentId ||
          !runtimeDocument ||
          runtimeDocument.source.kind !== "root-current"
        ) return runtimeDocument;
        return {
          ...runtimeDocument,
          source: {
            ...runtimeDocument.source,
            sourceRevision: active.graph.rootSource.sourceRevision + 1
          }
        };
      }
    };
    const revisionMismatchCompiled = {
      ...active.compiled,
      moduleRuntimeContext: revisionMismatchContext
    };
    expect(active.graph.valid).toBe(true);
    expect(revisionMismatchContext.valid).toBe(true);
    expect(revisionMismatchContext.graph).toBe(active.graph);
    expect(revisionMismatchContext.rootDocumentId).toBe(active.graph.rootDocumentId);
    const mismatchedRootSource = revisionMismatchContext.documentFor(revisionMismatchContext.rootDocumentId)?.source;
    expect(mismatchedRootSource?.kind).toBe("root-current");
    if (mismatchedRootSource?.kind !== "root-current") throw new Error("Expected the graph root source snapshot");
    expect(mismatchedRootSource.sourceRevision).not.toBe(active.graph.rootSource.sourceRevision);
    expect(projectVscodeMultiDocumentCanvasRuntime({
      graph: active.graph,
      compiled: revisionMismatchCompiled,
      graphRevision: 42
    })).toBeNull();

    const controlRoot = rootSource(
      "file:///workspace/patterns/f12-mini.nui",
      rootText("// instance N = probe::Probe(x: 10)")
    );
    const control = await compileImported(controlRoot, dependencies);
    expect(projectVscodeMultiDocumentCanvasRuntime({
      graph: control.graph,
      compiled: control.compiled,
      graphRevision: 43
    })).toBeNull();
    const controlPresentation = projectCanvasLayerPresentation({
      compiledDocument: control.compiled,
      elements: control.compiled.document!.elements,
      evaluation: evaluateCompiled(control.compiled)
    });
    expect(controlPresentation.layers.map((layer) => layer.name)).toEqual(["default", "seam_layer"]);
  });

  it("keeps Fixture B root and imported memberships independent through JSON transport", async () => {
    const rootText = `nui 1

import "../modules/layer_probe.nui" as probe

layer seam_layer

point root_marker in seam_layer = coordinate(
  x: 0,
  y: 20,
)

point root_default = coordinate(
  x: -10,
  y: 20,
)

instance N = probe::Probe(x: 11)
`;
    const root = {
      ...rootSource("file:///workspace/patterns/f12-mini.nui", rootText),
      sourceRevision: 7
    };
    const library = savedSource("file:///workspace/modules/layer_probe.nui", "sha256:issue-1621-fixture-b", `nui 1

export module Probe(x: number) {
  layer module_layer

  point marker in module_layer = coordinate(
    x: x,
    y: 0,
  )
}
`);
    const fixture = await compileImported(root, new Map([[`${root.documentId}|../modules/layer_probe.nui`, library]]));
    expect(fixture.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const snapshot = projectVscodeMultiDocumentCanvasRuntime({
      graph: fixture.graph,
      compiled: fixture.compiled,
      graphRevision: 71
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rootSourceRevision).toBe(7);
    const runtime = canvasRuntimePresentationFor(JSON.parse(JSON.stringify(snapshot!)));
    const rootSourceDocument = runtime.layerSourceDocuments.find((sourceDocument) =>
      sourceDocument.documentId === root.documentId
    );
    const importedSourceDocument = runtime.layerSourceDocuments.find((sourceDocument) =>
      sourceDocument.documentId === library.documentId
    );
    expect(rootSourceDocument?.declarations.map((declaration) => declaration.name)).toEqual(["seam_layer"]);
    expect(importedSourceDocument?.declarations.map((declaration) => declaration.name)).toEqual(["module_layer"]);

    const rootMarker = runtime.elements.find((element) => element.name === "root_marker")!;
    const rootDefault = runtime.elements.find((element) => element.name === "root_default")!;
    const importedMarker = runtime.elements.find((element) => element.name === "marker")!;
    const unmappedImportedMarker = { ...importedMarker, id: "runtime-unmapped-imported-marker", name: "unmapped_marker" };
    expect(rootSourceDocument?.membershipsByElementId).toContainEqual([
      rootMarker.id,
      expect.objectContaining({ layerName: "seam_layer" })
    ]);
    expect(rootSourceDocument?.membershipsByElementId).toContainEqual([
      rootDefault.id,
      expect.objectContaining({ layerName: "default" })
    ]);
    expect(importedSourceDocument?.membershipsBySourceStatementId).toContainEqual([
      expect.any(String),
      expect.objectContaining({ layerName: "module_layer" })
    ]);

    const lastGoodRoot = compileDslDocument(
      "nui 1\nlayer previous_last_good\npoint Old = coordinate(x: 0, y: 0)"
    );
    expect(runtime.revealMaterialization).toBeDefined();
    const revealMaterialization = runtime.revealMaterialization!;
    const importedMarkerOrigin = revealMaterialization.originByRuntimeElementId.get(importedMarker.id)!;
    const projectionMaterialization = {
      ...revealMaterialization,
      originByRuntimeElementId: new Map([
        ...revealMaterialization.originByRuntimeElementId,
        [unmappedImportedMarker.id, {
          ...importedMarkerOrigin,
          sourceDocumentId: documentIdFromHost("file:///workspace/modules/unmapped_layer_probe.nui")
        }]
      ])
    };
    const basePresentation = projectCanvasLayerPresentation({
      compiledDocument: lastGoodRoot,
      sourceDocuments: runtime.layerSourceDocuments,
      moduleMaterialization: projectionMaterialization,
      elements: [...runtime.elements, unmappedImportedMarker],
      evaluation: evaluateCompiled(fixture.compiled)
    });
    expect(basePresentation.layers.map((layer) => layer.name)).toEqual(["default", "seam_layer", "module_layer"]);
    expect(revealMaterialization.rootDocumentId).toBe(runtime.rootDocumentId);
    const layerFor = (name: string) => basePresentation.layers.find((layer) => layer.name === name)!;
    const drawableIds = new Set([rootMarker.id, rootDefault.id, importedMarker.id, unmappedImportedMarker.id]);
    expect(basePresentation.unmappedModuleDrawableIds.has(unmappedImportedMarker.id)).toBe(true);
    expect(canvasLayerVisibleElementIds(drawableIds, {
      ...basePresentation,
      hiddenLayerIds: new Set([layerFor("default").id])
    })).toEqual(new Set([rootMarker.id, importedMarker.id]));
    expect(canvasLayerVisibleElementIds(drawableIds, {
      ...basePresentation,
      hiddenLayerIds: new Set([layerFor("seam_layer").id])
    })).toEqual(new Set([rootDefault.id, importedMarker.id]));
    expect(canvasLayerVisibleElementIds(drawableIds, {
      ...basePresentation,
      hiddenLayerIds: new Set([layerFor("module_layer").id])
    })).toEqual(new Set([rootMarker.id, rootDefault.id]));

    const implicitLibrary = savedSource("file:///workspace/modules/layer_probe.nui", "sha256:issue-1621-implicit-default", `nui 1

export module Probe(x: number) {
  point marker = coordinate(x: x, y: 0)
}
`);
    const implicitFixture = await compileImported(root, new Map([[`${root.documentId}|../modules/layer_probe.nui`, implicitLibrary]]));
    const implicitSnapshot = projectVscodeMultiDocumentCanvasRuntime({
      graph: implicitFixture.graph,
      compiled: implicitFixture.compiled,
      graphRevision: 72
    });
    expect(implicitSnapshot).not.toBeNull();
    const implicitRuntime = canvasRuntimePresentationFor(JSON.parse(JSON.stringify(implicitSnapshot!)));
    const implicitSources = implicitRuntime.layerSourceDocuments;
    expect(implicitRuntime.revealMaterialization?.rootDocumentId).toBe(implicitRuntime.rootDocumentId);
    const implicitPresentation = projectCanvasLayerPresentation({
      compiledDocument: lastGoodRoot,
      sourceDocuments: implicitSources,
      moduleMaterialization: implicitRuntime.revealMaterialization,
      elements: implicitRuntime.elements,
      evaluation: evaluateCompiled(implicitFixture.compiled)
    });
    expect(implicitPresentation.layers.map((layer) => layer.name)).toEqual(["default", "seam_layer"]);
    const implicitRootDefault = implicitRuntime.elements.find((element) => element.name === "root_default")!;
    const implicitRootMarker = implicitRuntime.elements.find((element) => element.name === "root_marker")!;
    const implicitImportedMarker = implicitRuntime.elements.find((element) => element.name === "marker")!;
    const defaultLayer = implicitPresentation.layers.find((layer) => layer.name === "default")!;
    expect(canvasLayerVisibleElementIds(new Set([
      implicitRootDefault.id,
      implicitRootMarker.id,
      implicitImportedMarker.id
    ]), {
      ...implicitPresentation,
      hiddenLayerIds: new Set([defaultLayer.id])
    })).toEqual(new Set([implicitRootMarker.id]));
  });

  it("picks imported Module endpoints from the completed invocation without comparing different documents' source indexes (#1567)", async () => {
    const library = savedSource("pick-library", "sha256:pick-library", `nui 1
const padding: number = 9
export module M(width: number) {
 export line Out = segment(start: (0, 0), end: (width, 0))
 move Out(from: (0, 0), to: (10, 0))
 reverse Out()
}`);
    const root = rootSource("pick-root", `nui 1
import "./library.nui" as lib
instance Use = lib::M(width: 100)
point P = from(source: Use::Out.end)`);
    const cache = new SavedDocumentArtifactCache();
    const { compiled, graph } = await compileImported(root, new Map([["pick-root|./library.nui", library]]), cache);
    expect(compiled.diagnostics).toEqual([]);
    const target = queryDslReferencePickTarget({ source: root, position: root.normalizedSource.indexOf("Use::Out.end"),
      semantic: { sourceRevision: root.sourceRevision, sourceText: root.normalizedSource, compiled } })!;
    const ts = evaluateCompiled(compiled);
    const rust = evaluationPayloadToResult(evaluateWithRustOptions(process.cwd(), compiled.document!.elements,
      buildEvaluationOptions({ compiledDocument: { ...compiled, document: compiled.document!, statementMap: compiled.statementMap!, majorVersion: 1 }, evaluationLimitIndex: undefined })));
    expect(referencePickCandidates({ compiled: { ...compiled, moduleRuntimeContext: undefined }, evaluation: ts, target })
      .flatMap(candidate => candidate.options).some(option => option.reference.base === "Use::Out")).toBe(false);
    for (const evaluation of [ts, rust]) {
      expect(evaluation.errors).toEqual([]);
      const candidate = referencePickCandidates({ compiled, evaluation, target }).find(candidate => candidate.options.some(option => option.reference.base === "Use::Out"))!;
      expect(candidate.options).toContainEqual(expect.objectContaining({ reference: { base: "Use::Out", pointKey: "end" }, point: expect.objectContaining({ x: 10, y: 0 }) }));
      const point = compiled.document!.elements.find(element => element.name === "P")!;
      expect(evaluation.computedGeometry.get(point.id)).toMatchObject({ x: 10, y: 0 });
      expect(sourceOwnerForRuntimeElementId({ ...compiled, statementMap: compiled.statementMap! }, candidate.elementId)?.sourceDocumentId).toBe(library.documentId);
    }
    const changedLibrary = savedSource("pick-library", "sha256:pick-library-edited", library.normalizedSource.replace("to: (10, 0)", "to: (20, 0)"));
    const { compiled: changed } = await compileImported(root, new Map([["pick-root|./library.nui", changedLibrary]]), cache,
      graph.nodes.get(root.documentId)!.artifact.statementIdByStatementIndex);
    expect(evaluateCompiled(changed).computedGeometry.get(changed.document!.elements.find(element => element.name === "P")!.id))
      .toMatchObject({ x: 20, y: 0 });
    const position = root.normalizedSource.indexOf("Use::Out.end");
    const currentTarget = queryDslReferencePickTarget({ source: root, position,
      semantic: { sourceRevision: root.sourceRevision, sourceText: root.normalizedSource, compiled: changed } })!;
    expect(currentTarget.sourceAnchor.statementId).toBe(target.sourceAnchor.statementId);
    const uri = "file:///pick-root.nui";
    for (const [current, status] of [[compiled, "started"], [changed, "stale"]] as const) {
      const started = startVscodeReferencePickCanvasSession({ source: root, compiled: current, evaluation: ts, evaluationIsCurrent: false,
        authoritativeDocumentUri: uri, authoritativeDocumentVersion: 1,
        request: { type: "referencePickStartRequest", requestId: 1, documentUri: uri, documentVersion: 1,
          normalizedSourceOffset: position, targetProof: referencePickTargetProofFor(root.normalizedSource, currentTarget)! },
        candidateSnapshot: { source: root, compiled, evaluation: ts } });
      expect(started.result.status).toBe(status);
    }
  });
  it("Browse qualifies imported Module exports from named groups without changing target-bound paths (#1671)", async () => {
    const library = savedSource("pick-group-library", "sha256:pick-group-library", `nui 1
export module M() {
  export line Out = segment(start: (0, 0), end: (20, 0))
  line Private = segment(start: (0, 10), end: (20, 10))
}`);
    const root = rootSource("pick-group-root", `nui 1
import "./pick_group_lib.nui" as lib
instance Root = lib::M()
group G1 {
  instance I = lib::M()
  const Proof: line = I::Out
  line Use = offset(sources: [I::Out], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)
  line Ordinary = segment(start: (0, 30), end: (20, 30))
}
group G2 {
  instance I = lib::M()
  line Ordinary = segment(start: (0, 40), end: (20, 40))
}
instance Hidden(visible: false) = lib::M()
instance Disabled(enabled: false) = lib::M()`);
    const { compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./pick_group_lib.nui`, library]])
    );
    expect(compiled.diagnostics.filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document).not.toBeNull();
    if (!compiled.document || !compiled.moduleMaterialization || !compiled.sourceLexicalNamespace) return;
    const evaluation = evaluateCompiled(compiled);
    expect(evaluation.errors).toEqual([]);
    expect(evaluation.geometryValueErrors).toEqual([]);

    const candidates = referencePickCandidates({ compiled, evaluation, target: null });
    const names = candidates.flatMap(candidate => candidate.options.map(option => option.reference.base));
    expect(names).toContain("Root::Out");
    expect(names).toContain("G1::I::Out");
    expect(names).toContain("G2::I::Out");
    expect(names).not.toContain("I::Out");
    expect(names).toContain("G1::Ordinary");
    expect(names).toContain("G2::Ordinary");
    expect(names.some(name => name.includes("Private"))).toBe(false);
    expect(names).not.toContain("Hidden::Out");
    expect(names).not.toContain("Disabled::Out");

    const candidateFor = (base: string) => candidates.find(candidate =>
      candidate.options.some(option => option.reference.base === base)
    );
    const g1 = candidateFor("G1::I::Out");
    const g2 = candidateFor("G2::I::Out");
    const rootCandidate = candidateFor("Root::Out");
    expect(g1).toBeDefined();
    expect(g2).toBeDefined();
    expect(rootCandidate).toBeDefined();
    if (!g1 || !g2 || !rootCandidate) return;
    const declarationIdFor = (segments: string[]) => {
      const resolved = resolveSourceLexicalPath(compiled.sourceLexicalNamespace!, 0, { absolute: false, segments });
      expect(resolved.kind).toBe("resolved");
      return resolved.kind === "resolved" ? resolved.declaration.statementId : null;
    };
    const g1InstanceId = declarationIdFor(["G1", "I"]);
    const g2InstanceId = declarationIdFor(["G2", "I"]);
    const rootInstanceId = declarationIdFor(["Root"]);
    expect(g1InstanceId).not.toBeNull();
    expect(g2InstanceId).not.toBeNull();
    expect(rootInstanceId).not.toBeNull();
    expect(compiled.moduleMaterialization.originByRuntimeElementId.get(g1.elementId)?.instancePath.at(-1)).toBe(g1InstanceId);
    expect(compiled.moduleMaterialization.originByRuntimeElementId.get(g2.elementId)?.instancePath.at(-1)).toBe(g2InstanceId);
    expect(compiled.moduleMaterialization.originByRuntimeElementId.get(rootCandidate.elementId)?.instancePath.at(-1)).toBe(rootInstanceId);
    expect(g1.elementId).not.toBe(g2.elementId);
    expect(g1.options).toContainEqual(expect.objectContaining({ reference: { base: "G1::I::Out", pointKey: "end" } }));

    const position = root.normalizedSource.indexOf("sources: [I::Out]") + "sources: [".length;
    const target = queryDslReferencePickTarget({
      source: root,
      position,
      semantic: { sourceRevision: root.sourceRevision, sourceText: root.normalizedSource, compiled }
    });
    expect(target).not.toBeNull();
    if (!target) return;
    const targetBoundReferences = referencePickCandidates({ compiled, evaluation, target })
      .flatMap(candidate => candidate.options.map(option => option.reference.base));
    expect(targetBoundReferences).toContain("I::Out");
  });
  it("preserves definition-local prefix captures through imported Module instances (#1567)", async () => {
    const library = savedSource("prefix-library", "sha256:prefix-library", `nui 1
export module Prefix(width: number) {
  line L = segment(start: (0, 0), end: (width, 0))
  export const original: line = L
  const originals: line[] = [L]
  move L(from: L.start, to: (10, 0))
  export const shifted: line = L
  const shifts: line[] = [L]
  reverse L()
  export line Original = from(source: original)
  export line Shifted = from(source: shifted)
  export line ArrayOriginal = from(source: originals[0])
  export line ArrayShifted = from(source: shifts[0])
}`);
    const root = rootSource("prefix-root", `nui 1
import "./library.nui" as lib
instance First = lib::Prefix(width: 100)
instance Second = lib::Prefix(width: 50)
module CaptureConsumer(paths: line[], points: point[]) {
  line Copied = from(source: paths[0])
  line Points = polyline(points: points, closed: false)
}
instance OriginalCopy = CaptureConsumer(paths: [First::original], points: [First::original.start, First::original.end])
instance ShiftedCopy = CaptureConsumer(paths: [Second::shifted], points: [Second::shifted.start, Second::shifted.end])
line Caller = segment(start: (0, 0), end: (2, 0))
move Caller(from: First::original.start, to: Second::shifted.end)
const callerCapture: line = Caller
line CallerPreview = from(source: callerCapture)
`);
    const { compiled } = await compileImported(root, new Map([["prefix-root|./library.nui", library]]));
    expect(compiled.diagnostics).toEqual([]);
    const result = evaluateCompiled(compiled);
    const rust = evaluationPayloadToResult(evaluateWithRustOptions(process.cwd(), compiled.document!.elements, buildEvaluationOptions({
      compiledDocument: { ...compiled, document: compiled.document!, statementMap: compiled.statementMap!, majorVersion: 1 }, evaluationLimitIndex: undefined
    })));
    expect(rust.errors).toEqual([]);
    expect([...rust.computedGeometry].sort()).toEqual([...result.computedGeometry].sort());
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    expect(rust.geometryValueErrors).toEqual([]);
    for (const name of ["Caller", "CallerPreview"]) {
      const element = compiled.document!.elements.find(element => element.name === name)!;
      expect(result.computedGeometry.get(element.id)).toMatchObject({ start: { x: 60, y: 0 }, end: { x: 62, y: 0 } });
    }
    const originals = compiled.document!.elements.filter(element => element.name === "Original");
    const shifted = compiled.document!.elements.filter(element => element.name === "Shifted");
    expect(originals.map(element => result.computedGeometry.get(element.id))).toEqual([
      expect.objectContaining({ start: expect.objectContaining({ x: 0, y: 0 }), end: expect.objectContaining({ x: 100, y: 0 }) }),
      expect.objectContaining({ start: expect.objectContaining({ x: 0, y: 0 }), end: expect.objectContaining({ x: 50, y: 0 }) })
    ]);
    expect(shifted.map(element => result.computedGeometry.get(element.id))).toEqual([
      expect.objectContaining({ start: expect.objectContaining({ x: 10, y: 0 }), end: expect.objectContaining({ x: 110, y: 0 }) }),
      expect.objectContaining({ start: expect.objectContaining({ x: 10, y: 0 }), end: expect.objectContaining({ x: 60, y: 0 }) })
    ]);
    for (const [name, starts, ends] of [["ArrayOriginal", 0, [100, 50]], ["ArrayShifted", 10, [110, 60]]] as const) {
      const members = compiled.document!.elements.filter(element => element.name === name);
      members.forEach((element, index) => expect(result.computedGeometry.get(element.id)).toMatchObject({ start: { x: starts, y: 0 }, end: { x: ends[index], y: 0 } }));
    }
    for (const [instanceName, start, end] of [["OriginalCopy", 0, 100], ["ShiftedCopy", 10, 60]] as const) {
      const instance = compiled.document!.elements.find(element => element.name === instanceName)!;
      for (const name of ["Copied", "Points"]) {
        const element = compiled.document!.elements.find(element => element.parentGroupId === instance.id && element.name === name)!;
        expect(result.computedGeometry.get(element.id)).toMatchObject({ start: { x: start, y: 0 }, end: { x: end, y: 0 } });
      }
    }
  });

  it("lowers named Bezier knots using imported record values and Module point parameters (#1537)", async () => {
    const library = savedSource("knot-library", "sha256:knot-library", `nui 1
export record Handles(angle: number, incoming: number, outgoing: number)
export module Shape(p: point, h: Handles) {
  export const Curve: path = bezier(start: (1, 2), end: (12, 3), startAngle: 0, startLength: 2, endAngle: 90, endLength: 3, intermediates: [knot(point: p, angle: h.angle, incoming: h.incoming, outgoing: h.outgoing)])
}`);
    const root = rootSource("knot-root", `nui 1
import "./knots.nui" as lib
point B = coordinate(x: 5, y: 7)
const h: lib::Handles = lib::Handles(angle: 90, incoming: 2, outgoing: 4)
instance Use = lib::Shape(p: B, h: h)
path Rendered = from(source: Use::Curve)`);
    const { compiled } = await compileImported(root, new Map([["knot-root|./knots.nui", library]]));
    expect(compiled.diagnostics).toEqual([]);
    const evaluation = evaluateCompiled(compiled);
    expect(evaluation.errors).toEqual([]);
    const geometry = [...evaluation.computedGeometry.values()].find(geometry => geometry.name === "Rendered");
    expect(geometry).toMatchObject({ kind: "bezierCurve", segments: [{ control2: { x: 5, y: 5 } }, { control1: { x: 5, y: 11 } }] });
  });

  it("evaluates imported Module pure Bezier feature-point exports through geometry values", async () => {
    const library = savedSource("feature-library", "sha256:feature-library", [
      "nui 1",
      "export module Feature() {",
      "  const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "  export const Extreme: point = bezierExtremePoint(source: Curve, direction: 90)",
      "  export const Bulge: point = bezierBulgePoint(source: Curve)",
      "}"
    ].join("\n"));
    const root = rootSource("feature-root", [
      "nui 1",
      "import \"./feature-library.nui\" as lib",
      "instance use = lib::Feature()",
      "const Extreme: point = use::Extreme",
      "const Bulge: point = use::Bulge",
      "line Use = segment(start: Extreme, end: Bulge)"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./feature-library.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const values = [...(result.computedGeometryValues?.values() ?? [])].filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(values).toHaveLength(3);
    expect(values.filter((entry) => entry.value.kind === "point")).toHaveLength(2);
    for (const entry of values.filter((candidate) => candidate.value.kind === "point")) {
      expect(entry.value).toMatchObject({ x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) });
      expect(entry.value).not.toHaveProperty("elementId");
      expect(entry.value).not.toHaveProperty("name");
    }
    const use = compiled.document?.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({
      kind: "line",
      start: { x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) },
      end: { x: expect.closeTo(5, 10), y: expect.closeTo(7.5, 10) }
    });
  });

  it("evaluates imported geometry value-for collections with coordinate members per module instance", async () => {
    const library = savedSource("map-library", "sha256:map-library", [
      "nui 1",
      "export module MapPoints(input: point[]) {",
      "  export const mapped: point[] = for item in input { coordinate(x: item.x + 1, y: item.y - 1) }",
      "}"
    ].join("\n"));
    const root = rootSource("map-root", [
      "nui 1",
      "import \"./map-library.nui\" as lib",
      "const first: point[] = [(1, 2), (3, 4)]",
      "const second: point[] = [(10, 20), (30, 40)]",
      "instance A = lib::MapPoints(input: first)",
      "instance B = lib::MapPoints(input: second)",
      "line UseA = segment(start: A::mapped[0], end: A::mapped[1])",
      "line UseB = segment(start: B::mapped[0], end: B::mapped[1])"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./map-library.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const useA = compiled.document?.elements.find((element) => element.name === "UseA");
    const useB = compiled.document?.elements.find((element) => element.name === "UseB");
    expect(useA && result.computedGeometry.get(useA.id)).toMatchObject({
      kind: "line",
      start: { x: 2, y: 1 },
      end: { x: 4, y: 3 }
    });
    expect(useB && result.computedGeometry.get(useB.id)).toMatchObject({
      kind: "line",
      start: { x: 11, y: 19 },
      end: { x: 31, y: 39 }
    });
    const mappedValues = [...(result.computedGeometryValues?.values() ?? [])].filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(mappedValues).toHaveLength(4);
    expect(new Set(mappedValues.map((entry) => entry.occurrence.instancePath.join("/"))).size).toBe(2);
  });

  it("materializes imported bodies with caller values and defining-document defaults", async () => {
    const library = savedSource("library", "sha256:library", [
      "nui 1",
      "const libraryDefault: number = 41",
      "export module Panel(width: number = libraryDefault) {",
      "  point P = coordinate(x: width, y: 2)",
      "}"
    ].join("\n"));
    const root = rootSource("root", [
      "nui 1",
      "import \"./library.nui\" as lib",
      "const callerWidth: number = 60",
      "instance explicit = lib::Panel(width: callerWidth)",
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

    const runtimeSnapshot = projectVscodeMultiDocumentCanvasRuntime({
      graph,
      compiled,
      graphRevision: 12
    });
    expect(runtimeSnapshot).not.toBeNull();
    expect(runtimeSnapshot?.graphRevision).toBe(12);
    expect(runtimeSnapshot?.preparedRustEvaluation.rustEligible).toBe(true);
    expect(runtimeSnapshot?.preparedRustEvaluation.input.elements.some((element) => element.name === "P")).toBe(true);
    expect(runtimeSnapshot?.modulePresentation.origins.some((origin) => origin.kind === "moduleBody")).toBe(true);

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

  it("resolves an imported Module caller through Canvas Reveal source ownership", async () => {
    const library = savedSource("reveal-library", "sha256:reveal-library", [
      "nui 1",
      "export module Panel(value: number) {",
      "  point P = coordinate(x: value, y: 0)",
      "}"
    ].join("\n"));
    const root = rootSource("reveal-root", [
      "nui 1",
      "import \"./library.nui\" as lib",
      "const untouched: number = 0",
      "instance Direct = lib::Panel(value: 20)"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./library.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.moduleRuntimeContext).toBe(context);
    expect(compiled.moduleMaterialization?.executionStatements.some((entry) =>
      entry.type === "moduleInstance" &&
      entry.sourceStatementIndex === 3 &&
      entry.origin?.sourceDocumentId === root.documentId &&
      entry.origin.moduleDefinitionDocumentId === library.documentId
    )).toBe(true);
    const materializedPoint = compiled.document?.elements.find((element) => element.name === "P");
    expect(materializedPoint).toBeDefined();
    expect(materializedPoint && compiled.moduleMaterialization?.originByRuntimeElementId.get(materializedPoint.id)).toMatchObject({
      sourceDocumentId: library.documentId,
      sourceStatementIndex: 2
    });

    const source = {
      normalizedSource: root.normalizedSource,
      sourceRevision: root.sourceRevision
    };
    const unrelatedRootResult = queryDslCanvasRevealSourceTarget({
      source,
      compiled,
      position: root.normalizedSource.indexOf("untouched") + 2
    });
    expect(unrelatedRootResult).toEqual({ status: "failed", reason: "no-target" });

    const importedCallerResult = queryDslCanvasRevealSourceTarget({
      source,
      compiled,
      position: root.normalizedSource.indexOf("Direct") + 2
    });

    expect(importedCallerResult).toEqual({
      status: "resolved",
      target: {
        kind: "statement-owner",
        sourceStatementIndex: 3
      }
    });
  });

  it("evaluates imported optional coalescing per repeated and colliding instance identity", async () => {
    const optionalModuleSource = [
      "nui 1",
      "export module Optional(value: number?) {",
      "  if ((value ?? 0) > 0) {",
      "    const marker: number = (value ?? 0) + 1",
      "    point P = coordinate(x: marker, y: 0)",
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

  it("resolves imported geometry bodies against the caller's exact source geometry", async () => {
    const library = savedSource("geometry-library", "sha256:geometry-library", [
      "nui 1",
      "export module Shift(input: point) {",
      "  point P = offset(from: input, dx: 3, dy: 4)",
      "}"
    ].join("\n"));
    const root = rootSource("geometry-root", [
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "import \"./geometry-library.nui\" as lib",
      "instance use = lib::Shift(input: Base)"
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

  it("uses a typed dynamic geometry-array index across an imported Module boundary", async () => {
    const library = savedSource("dynamic-array-library", "sha256:dynamic-array-library", [
      "nui 1",
      "export module Shift(input: path) {",
      "  line Shifted = offset(sources: [input], distance: 1, side: @left, closed: false, suppressTrimWarnings: false)",
      "}"
    ].join("\n"));
    const root = rootSource("dynamic-array-root", [
      "nui 1",
      "const index: number = 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "const lines: line[] = [A, B]",
      "const paths: path[] = lines",
      "import \"./dynamic-array-library.nui\" as lib",
      "instance use = lib::Shift(input: paths[index])"
    ].join("\n"));
    const { compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./dynamic-array-library.nui`, library]])
    );

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);
    expect(result.errors).toEqual([]);
    const shifted = compiled.document?.elements.find((element) => element.name === "Shifted");
    expect(shifted).toBeDefined();
    expect(shifted && result.computedGeometry.get(shifted.id)).toMatchObject({
      kind: "offsetLine",
      start: { x: 0, y: 11 },
      end: { x: 10, y: 11 }
    });
  });

  it("lowers imported geometry-array parameters in the defining document", async () => {
    const library = savedSource("array-library", "sha256:array-library", [
      "nui 1",
      "export module Outline(paths: path[]) {",
      "  line Copy = offset(sources: paths, distance: 1, side: @left, closed: false, suppressTrimWarnings: false)",
      "}"
    ].join("\n"));
    const root = rootSource("array-root", [
      "nui 1",
      "line A = segment(start: (0, 0), end: (10, 0))",
      "line B = segment(start: (0, 10), end: (10, 10))",
      "import \"./array-library.nui\" as lib",
      "instance use = lib::Outline(paths: [A, B, A])"
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
      "  point P = offset(from: input, dx: 3, dy: 4)",
      "}"
    ].join("\n"));
    const library = savedSource("nested-library", "sha256:nested-library", [
      "nui 1",
      "import \"./nested-helper.nui\" as helper",
      "export module Outer(input: point) {",
      "  instance Child = helper::Shift(input: input)",
      "}"
    ].join("\n"));
    const root = rootSource("nested-root", [
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "import \"./nested-library.nui\" as lib",
      "instance use = lib::Outer(input: Base)"
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

  it("resolves Canvas source definitions to qualified root and nested dependency documents", async () => {
    const helper = savedSource("qualified-helper", "sha256:qualified-helper", [
      "nui 1",
      "export module Shift(input: point) {",
      "  point P = offset(from: input, dx: 3, dy: 4)",
      "}"
    ].join("\n"));
    const library = savedSource("qualified-library", "sha256:qualified-library", [
      "nui 1",
      "import \"./qualified-helper.nui\" as helper",
      "export module Outer(input: point) {",
      "  instance Child = helper::Shift(input: input)",
      "}"
    ].join("\n"));
    const root = rootSource("qualified-root", [
      "nui 1",
      "point Base = coordinate(x: 10, y: 20)",
      "import \"./qualified-library.nui\" as lib",
      "instance use = lib::Outer(input: Base)"
    ].join("\n"));
    const { compiled } = await compileImported(root, new Map([
      [`${root.documentId}|./qualified-library.nui`, library],
      [`${library.documentId}|./qualified-helper.nui`, helper]
    ]));
    if (!compiled.document) throw new Error("expected compiled document");

    const moduleBody = compiled.document.elements.find((element) => element.name === "P");
    const moduleInstance = compiled.document.elements.find((element) => element.name === "use");
    expect(moduleBody).toBeDefined();
    expect(moduleInstance).toBeDefined();
    if (!moduleBody || !moduleInstance) return;

    const bodyTarget = queryDslCanvasSourceDefinitionQualified({
      source: root,
      compiled,
      runtimeElementId: moduleBody.id
    });
    expect(bodyTarget).toEqual({
      source: {
        kind: "dependency-saved",
        documentId: helper.documentId,
        savedSourceFingerprint: helper.savedSourceFingerprint
      },
      sourceStatementIndex: 2,
      range: {
        from: helper.normalizedSource.indexOf("P"),
        to: helper.normalizedSource.indexOf("P") + 1
      }
    });

    const instanceTarget = queryDslCanvasSourceDefinitionQualified({
      source: root,
      compiled,
      runtimeElementId: moduleInstance.id
    });
    expect(instanceTarget).toEqual({
      source: {
        kind: "root-current",
        documentId: root.documentId,
        sourceRevision: root.sourceRevision
      },
      sourceStatementIndex: 3,
      range: {
        from: root.normalizedSource.indexOf("use"),
        to: root.normalizedSource.indexOf("use") + 3
      }
    });
  });

  it("evaluates scalar exports through imported instances", async () => {
    const library = savedSource("scalar-library", "sha256:scalar-library", [
      "nui 1",
      "export module Measure(input: number) {",
      "  export const value: number = input + 1",
      "}"
    ].join("\n"));
    const root = rootSource("scalar-root", [
      "nui 1",
      "const callerValue: number = 9",
      "import \"./scalar-library.nui\" as lib",
      "instance use = lib::Measure(input: callerValue)",
      "const result: number = use::value",
      "point Result = coordinate(x: result, y: 0)"
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

  it("indexes an exported collection through a cross-document Module occurrence", async () => {
    const library = savedSource("indexed-collection-library", "sha256:indexed-collection-library", [
      "nui 1",
      "export module Collection() {",
      "  export const values: number[] = [3, 8]",
      "}"
    ].join("\n"));
    const root = rootSource("indexed-collection-root", [
      "nui 1",
      "import \"./indexed-collection-library.nui\" as lib",
      "instance use = lib::Collection()",
      "const result: number = use::values[1]",
      "point Result = coordinate(x: result, y: 0)"
    ].join("\n"));
    const compiled = await compileImported(root, new Map([[`${root.documentId}|./indexed-collection-library.nui`, library]]));
    expect(compiled.graph.valid).toBe(true);
    expect(compiled.semantics.valid).toBe(true);
    expect(compiled.compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.compiled.document || !compiled.compiled.statementMap || compiled.compiled.majorVersion === null) return;
    const result = evaluateElements(
      compiled.compiled.document.elements,
      buildEvaluationOptions({
        compiledDocument: {
          ...compiled.compiled,
          document: compiled.compiled.document,
          statementMap: compiled.compiled.statementMap,
          majorVersion: compiled.compiled.majorVersion
        },
        evaluationLimitIndex: compiled.compiled.document.evaluationLimitIndex
      })
    );
    expect(result.errors).toEqual([]);
    const point = compiled.compiled.document.elements.find((element) => element.name === "Result");
    expect(point && result.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 8, y: 0 });
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
      "const result: number = use::P.x + use::L.length",
      "point Result = coordinate(x: result, y: 0)"
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

  it("consumes imported pure division-point exports without drawable identity", async () => {
    const library = savedSource("division-library", "sha256:division-library", [
      "nui 1",
      "export module Division(source: path) {",
      "  export const Mid: point = between(start: source.start, end: source.end, ratio: 0.5)",
      "  export const FromEnd: point = onLine(from: source.end, distance: 25)",
      "}"
    ].join("\n"));
    const root = rootSource("division-root", [
      "nui 1",
      "line Base = segment(start: (0, 0), end: (100, 0))",
      "import \"./division-library.nui\" as lib",
      "instance use = lib::Division(source: Base)",
      "line Use = segment(start: use::Mid, end: use::FromEnd)"
    ].join("\n"));
    const { compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./division-library.nui`, library]])
    );

    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    if (!compiled.document || !compiled.statementMap || compiled.majorVersion === null) return;
    const result = evaluateCompiled(compiled);

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const use = compiled.document.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 75, y: 0 }
    });
    const pureValues = [...(result.computedGeometryValues?.values() ?? [])];
    expect(pureValues).toHaveLength(2);
    expect(pureValues.map((entry) => entry.value)).toEqual([
      { kind: "point", x: 50, y: 0 },
      { kind: "point", x: 75, y: 0 }
    ]);
    expect(pureValues.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
  });

  it("consumes imported pure intersection exports through a root geometry consumer", async () => {
    const library = savedSource("intersection-library", "sha256:intersection-library", [
      "nui 1",
      "export module Cross(first: path, second: path) {",
      "  const Local: point = intersection(line1: first, line2: second, index: 0, extensions: false)",
      "  export const Output: point = Local",
      "}"
    ].join("\n"));
    const root = rootSource("intersection-root", [
      "nui 1",
      "line Horizontal = segment(start: (0, 0), end: (100, 0))",
      "line Vertical = segment(start: (50, -50), end: (50, 50))",
      "import \"./intersection-library.nui\" as lib",
      "instance use = lib::Cross(first: Horizontal, second: Vertical)",
      "const Point: point = use::Output",
      "line Use = segment(start: Point, end: (75, 0))"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./intersection-library.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const importedValues = [...(result.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(importedValues.map((entry) => entry.value)).toEqual([
      { kind: "point", x: 50, y: 0 },
      { kind: "point", x: 50, y: 0 }
    ]);
    expect(importedValues.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    const use = compiled.document?.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({
      kind: "line",
      start: { x: 50, y: 0 },
      end: { x: 75, y: 0 }
    });
  });

  it("consumes imported pure tangentOffset values with local and exported modes", async () => {
    const library = savedSource("tangent-library", "sha256:tangent-library", [
      "nui 1",
      "export module Tangent(line: path, base: point) {",
      "  const LocalAngle: point = tangentOffset(line: line, base: base, angle: 90, distance: 2)",
      "  export const Convex: point = tangentOffset(line: line, base: base, curveSide: @convex, distance: 1)",
      "  export const DefaultAngle: point = tangentOffset(line: line, base: base, distance: 2)",
      "}"
    ].join("\n"));
    const root = rootSource("tangent-root", [
      "nui 1",
      "const Curve: path = bezier(start: (0, 0), end: (10, 0), startAngle: 90, startLength: 10, endAngle: -90, endLength: 10)",
      "const Base: point = coordinate(x: 5, y: 7.5)",
      "import \"./tangent-library.nui\" as lib",
      "instance use = lib::Tangent(line: Curve, base: Base)",
      "const Convex: point = use::Convex",
      "const DefaultAngle: point = use::DefaultAngle",
      "line Use = segment(start: DefaultAngle, end: Convex)"
    ].join("\n"));
    const { graph, semantics, context, compiled } = await compileImported(
      root,
      new Map([[`${root.documentId}|./tangent-library.nui`, library]])
    );

    expect(graph.valid).toBe(true);
    expect(semantics.valid).toBe(true);
    expect(context.valid).toBe(true);
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const result = evaluateCompiled(compiled);

    expect(result.errors).toEqual([]);
    expect(result.geometryValueErrors).toEqual([]);
    const importedValues = [...(result.computedGeometryValues?.values() ?? [])]
      .filter((entry) => entry.occurrence.instancePath.length === 1);
    expect(importedValues).toHaveLength(3);
    expect(importedValues.map((entry) => entry.value)).toEqual(expect.arrayContaining([
      { kind: "point", x: 5, y: 9.5 },
      { kind: "point", x: 5, y: 8.5 },
      { kind: "point", x: 7, y: 7.5 }
    ]));
    expect(importedValues.every(({ value }) => !("elementId" in value) && !("name" in value))).toBe(true);
    const use = compiled.document?.elements.find((element) => element.name === "Use");
    expect(use && result.computedGeometry.get(use.id)).toMatchObject({
      kind: "line",
      start: { x: 7, y: 7.5 },
      end: { x: 5, y: 8.5 }
    });
  });

  it("keeps imported record values, record parameters, and record exports in the defining document", async () => {
    const library = savedSource("record-library", "sha256:record-library", [
      "nui 1",
      "record Pair(x: number)",
      "module Inner(input: Pair) {",
      "  export const output: Pair = input",
      "}",
      "export module Outer(input: number) {",
      "  const local: Pair = Pair(x: input)",
      "  instance child = Inner(input: local)",
      "  export const result: Pair = child::output",
      "}"
    ].join("\n"));
    const root = rootSource("record-root", [
      "nui 1",
      "import \"./record-library.nui\" as lib",
      "instance use = lib::Outer(input: 7)",
      "const result: number = use::result.x",
      "point Result = coordinate(x: result, y: 0)"
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
      "instance hidden(visible: false) = lib::Shape()",
      "instance disabled(enabled: false) = lib::Shape()"
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
    for (const name of ["shown", "hidden", "disabled"]) {
      const instance = compiled.document.elements.find((element) => element.name === name)!;
      const point = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId === instance.id)!;
      if (name === "shown") {
        expect(result.computedGeometry.has(point.id)).toBe(true);
        expect(result.effectiveVisibleElementIds).toContain(point.id);
      } else if (name === "hidden") {
        expect(result.computedGeometry.has(point.id)).toBe(true);
        expect(result.effectiveVisibleElementIds).not.toContain(point.id);
      } else {
        expect(result.computedGeometry.has(point.id)).toBe(false);
      }
    }
    const disabled = compiled.document.elements.find((element) => element.name === "disabled")!;
    const disabledPoint = compiled.document.elements.find((element) => element.name === "P" && element.parentGroupId === disabled.id)!;
    expect(result.computedGeometry.has(disabledPoint.id)).toBe(false);
  });
});
