import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { createModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "./multiDocumentModuleSemantics";
import {
  buildMultiDocumentImportGraph,
  SavedDocumentArtifactCache,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "./multiDocumentImportGraph";
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  planMultiDocumentRename,
  queryMultiDocumentDefinition,
  queryMultiDocumentReferences
} from "./multiDocumentLanguageQueries";
import {
  createMultiDocumentModuleIdentityResolver,
  createMultiDocumentModuleRenameDocumentProof,
  projectMultiDocumentModuleSemanticDocumentView
} from "./multiDocumentModuleLanguage";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "./multiDocumentPrimitives";

const rootSource = (id: string, source: string, sourceRevision = 1): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
  normalizedSource: source,
  sourceRevision
});

const savedSource = (
  id: string,
  fingerprint: string,
  source: string
): DependencySavedSourceSnapshot => ({
  kind: "dependency-saved",
  documentId: documentIdFromHost(id),
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint),
  normalizedSource: source
});

const loaderFrom = (
  table: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>
): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, relativePath) {
    const result = table.get(`${importerDocumentId}|${relativePath}`);
    if (!result) return { status: "failed", reason: "missing" };
    return "kind" in result ? { status: "loaded", snapshot: result } : result;
  }
});

const buildRoot = async (
  root: RootCurrentSourceSnapshot,
  dependencies: ReadonlyMap<string, DependencySavedSourceSnapshot>,
  rootStatementIdByStatementIndex?: ReadonlyMap<number, string>,
  cache?: SavedDocumentArtifactCache
) => {
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: loaderFrom(dependencies),
    cache,
    declarationContributors: [moduleDeclarationContributor],
    rootStatementIdByStatementIndex
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const node = graph.nodes.get(root.documentId)!;
  const compiled = compileDslDocument(root.normalizedSource, {
    preparsed: node.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: node.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  return { graph, analysis, context, compiled };
};

const libraryText = [
  "nui 1",
  "export module Pocket() {",
  "}"
].join("\n");

const directRootText = [
  "nui 1",
  "import \"./library.nui\" as library",
  "instance use = library::Pocket()"
].join("\n");

const directFixture = async () => {
  const library = savedSource("language-library", "sha256:language-library", libraryText);
  const root = rootSource("language-root", directRootText, 2);
  const rootBundle = await buildRoot(root, new Map([[`${root.documentId}|./library.nui`, library]]));
  const savedLibraryNode = rootBundle.graph.nodes.get(library.documentId)!;
  const moduleIndex = savedLibraryNode.artifact.parsed.statements.findIndex((statement) => statement.kind === "moduleDefinition");
  const moduleId = savedLibraryNode.artifact.statementIdByStatementIndex.get(moduleIndex)!;
  const libraryRoot = rootSource("language-library", libraryText, 7);
  const libraryBundle = await buildRoot(
    libraryRoot,
    new Map(),
    new Map([[moduleIndex, moduleId]])
  );
  const rootView = projectMultiDocumentModuleSemanticDocumentView({ source: root, compiled: rootBundle.compiled });
  const libraryView = projectMultiDocumentModuleSemanticDocumentView({ source: libraryRoot, compiled: libraryBundle.compiled });
  const rootIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: rootBundle.graph, documentViews: [rootView] });
  const libraryIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: libraryBundle.graph, documentViews: [libraryView] });
  const proof = createMultiDocumentModuleRenameDocumentProof({
    graph: rootBundle.graph,
    analysis: rootBundle.analysis,
    compiledByDocument: new Map([
      [root.documentId, rootBundle.compiled],
      [libraryRoot.documentId, libraryBundle.compiled]
    ])
  });
  return { library, root, rootBundle, libraryRoot, libraryBundle, rootView, libraryView, rootIndex, libraryIndex, proof };
};

const reExportFixture = async () => {
  const cache = new SavedDocumentArtifactCache();
  const library = savedSource("language-chain-library", "sha256:language-chain-library", libraryText);
  const facade = savedSource("language-chain-facade", "sha256:language-chain-facade", [
    "nui 1",
    "import \"./library.nui\" as library",
    "export @library::Pocket"
  ].join("\n"));
  const root = rootSource("language-chain-root", [
    "nui 1",
    "import \"./facade.nui\" as facade",
    "instance use = facade::Pocket()"
  ].join("\n"), 3);
  const rootBundle = await buildRoot(root, new Map([
    [`${root.documentId}|./facade.nui`, facade],
    [`${facade.documentId}|./library.nui`, library]
  ]), undefined, cache);
  const savedFacadeNode = rootBundle.graph.nodes.get(facade.documentId)!;
  const savedLibraryNode = rootBundle.graph.nodes.get(library.documentId)!;
  const facadeModuleIndex = savedFacadeNode.artifact.parsed.statements.findIndex((statement) => statement.kind === "fileReExport");
  const libraryModuleIndex = savedLibraryNode.artifact.parsed.statements.findIndex((statement) => statement.kind === "moduleDefinition");
  const facadeRoot = rootSource("language-chain-facade", facade.normalizedSource, 8);
  const facadeBundle = await buildRoot(
    facadeRoot,
    new Map([[`${facadeRoot.documentId}|./library.nui`, library]]),
    new Map([[facadeModuleIndex, savedFacadeNode.artifact.statementIdByStatementIndex.get(facadeModuleIndex)!]]),
    cache
  );
  const libraryRoot = rootSource("language-chain-library", libraryText, 9);
  const libraryBundle = await buildRoot(
    libraryRoot,
    new Map(),
    new Map([[libraryModuleIndex, savedLibraryNode.artifact.statementIdByStatementIndex.get(libraryModuleIndex)!]]),
    cache
  );
  const rootView = projectMultiDocumentModuleSemanticDocumentView({ source: root, compiled: rootBundle.compiled });
  const rootIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: rootBundle.graph, documentViews: [rootView] });
  const facadeIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: facadeBundle.graph });
  const libraryView = projectMultiDocumentModuleSemanticDocumentView({ source: libraryRoot, compiled: libraryBundle.compiled });
  const libraryIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: libraryBundle.graph, documentViews: [libraryView] });
  const proof = createMultiDocumentModuleRenameDocumentProof({
    graph: rootBundle.graph,
    analysis: rootBundle.analysis,
    graphs: [facadeBundle.graph],
    compiledByDocument: new Map([
      [root.documentId, rootBundle.compiled],
      [facadeRoot.documentId, facadeBundle.compiled],
      [libraryRoot.documentId, libraryBundle.compiled]
    ])
  });
  return { library, facade, root, rootBundle, facadeRoot, facadeBundle, libraryRoot, libraryBundle, rootView, rootIndex, facadeIndex, libraryIndex, proof };
};

describe("host-neutral multi-document Module language adapter", () => {
  it("projects direct imported calls and definitions through one original identity", async () => {
    const fixture = await directFixture();
    const callOffset = directRootText.lastIndexOf("Pocket") + 1;
    const definition = fixture.rootBundle.analysis.analysesByDocument
      .get(fixture.library.documentId)!.definitions.find((candidate) => candidate.name === "Pocket")!;
    const result = queryMultiDocumentDefinition({
      index: fixture.rootIndex,
      documentId: fixture.root.documentId,
      position: callOffset
    });

    expect(result).toMatchObject({ identity: definition.identity });
    expect(result?.target.source.documentId).toBe(fixture.library.documentId);
    expect(fixture.rootView.occurrences).toEqual(expect.arrayContaining([{
      kind: "reference",
      identity: definition.identity,
      range: { from: callOffset - 1, to: callOffset - 1 + "Pocket".length }
    }]));
  });

  it("keeps non-Module defaults and exact same-file Module ownership", async () => {
    const fixture = await directFixture();
    const resolver = createMultiDocumentModuleIdentityResolver(fixture.rootBundle.compiled);
    expect(resolver({ kind: "source", statementId: "other" })).toEqual({
      documentId: fixture.root.documentId,
      localIdentity: "source:other"
    });
    const declaration = fixture.libraryBundle.analysis.root?.definitions.find((candidate) => candidate.name === "Pocket");
    expect(declaration).toBeDefined();
    if (!declaration) return;
    expect(fixture.libraryView.occurrences).toEqual(expect.arrayContaining([{
      kind: "declaration",
      identity: declaration.identity,
      range: { from: libraryText.indexOf("Pocket"), to: libraryText.indexOf("Pocket") + "Pocket".length }
    }]));

    const localText = [
      "nui 1",
      "export module Local() {",
      "}",
      "instance use = Local()"
    ].join("\n");
    const localRoot = rootSource("language-local", localText, 1);
    const localBundle = await buildRoot(localRoot, new Map());
    const localView = projectMultiDocumentModuleSemanticDocumentView({ source: localRoot, compiled: localBundle.compiled });
    const localIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: localBundle.graph, documentViews: [localView] });
    const localDefinition = localBundle.analysis.root?.definitions.find((candidate) => candidate.name === "Local");
    expect(localDefinition).toBeDefined();
    if (!localDefinition) return;
    const localCall = localText.lastIndexOf("Local") + 1;
    const localResult = queryMultiDocumentDefinition({
      index: localIndex,
      documentId: localRoot.documentId,
      position: localCall
    });
    expect(localResult).toMatchObject({ identity: localDefinition.identity });
    expect(localResult?.target.source.documentId).toBe(localRoot.documentId);

    const localPlan = planMultiDocumentRename({
      index: localIndex,
      documentId: localRoot.documentId,
      position: localCall,
      newName: "RenamedLocal",
      reverseImporters: { status: "complete", indexes: [] },
      proveDocument: createMultiDocumentModuleRenameDocumentProof({
        graph: localBundle.graph,
        analysis: localBundle.analysis,
        compiledByDocument: new Map([[localRoot.documentId, localBundle.compiled]])
      })
    });
    expect(localPlan.status).toBe("ok");
    if (localPlan.status === "ok") expect(localPlan.plan.documents[0]?.edits).toHaveLength(2);
  });

  it("fails Definition and References closed for invalid or stale semantic projection", async () => {
    const fixture = await directFixture();
    const callOffset = directRootText.lastIndexOf("Pocket") + 1;
    const invalidView = projectMultiDocumentModuleSemanticDocumentView({
      source: fixture.root,
      compiled: fixture.rootBundle.compiled,
      valid: false
    });
    const invalidIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: fixture.rootBundle.graph, documentViews: [invalidView] });
    expect(queryMultiDocumentDefinition({ index: invalidIndex, documentId: fixture.root.documentId, position: callOffset })).toBeNull();

    const staleRoot = rootSource("language-root", directRootText, fixture.root.sourceRevision + 1);
    const staleView = projectMultiDocumentModuleSemanticDocumentView({ source: staleRoot, compiled: fixture.rootBundle.compiled });
    const staleIndex = buildMultiDocumentSemanticOccurrenceIndex({ graph: fixture.rootBundle.graph, documentViews: [staleView] });
    expect(queryMultiDocumentDefinition({ index: staleIndex, documentId: fixture.root.documentId, position: callOffset })).toBeNull();
    expect(queryMultiDocumentReferences({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: libraryText.indexOf("Pocket") + 1,
      reverseImporters: { status: "incomplete" }
    })).toBeNull();
  });

  it("joins defining, re-export, and final imported call occurrences through the original identity", async () => {
    const fixture = await reExportFixture();
    const definition = fixture.rootBundle.analysis.analysesByDocument
      .get(fixture.library.documentId)!.definitions.find((candidate) => candidate.name === "Pocket")!;
    const callOffset = fixture.root.normalizedSource.lastIndexOf("Pocket") + 1;
    const definitionResult = queryMultiDocumentDefinition({
      index: fixture.rootIndex,
      documentId: fixture.root.documentId,
      position: callOffset
    });
    expect(definitionResult).toMatchObject({ identity: definition.identity });

    const references = queryMultiDocumentReferences({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: libraryText.indexOf("Pocket") + 1,
      reverseImporters: {
        status: "complete",
        indexes: [fixture.facadeIndex, fixture.rootIndex]
      }
    });
    expect(references?.identity).toEqual(definition.identity);
    expect(references?.references).toHaveLength(2);
    expect(references?.references.map((reference) => reference.source.documentId)).toEqual([
      fixture.facadeRoot.documentId,
      fixture.root.documentId
    ]);
  });

  it("plans exact direct imported Module rename edits atomically", async () => {
    const fixture = await directFixture();
    const result = planMultiDocumentRename({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: libraryText.indexOf("Pocket") + 1,
      newName: "Bag",
      reverseImporters: { status: "complete", indexes: [fixture.rootIndex] },
      proveDocument: fixture.proof
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.documents).toHaveLength(2);
    expect(result.plan.documents.flatMap((document) => document.edits).map((edit) => [edit.expectedText, edit.newText])).toEqual([
      ["Pocket", "Bag"],
      ["Pocket", "Bag"]
    ]);
  });

  it("plans exact defining, facade, and final importer edits for a re-export chain", async () => {
    const fixture = await reExportFixture();
    const result = planMultiDocumentRename({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: libraryText.indexOf("Pocket") + 1,
      newName: "Bag",
      reverseImporters: { status: "complete", indexes: [fixture.facadeIndex, fixture.rootIndex] },
      proveDocument: fixture.proof
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.documents).toHaveLength(3);
    expect(result.plan.documents.flatMap((document) => document.edits)).toEqual(expect.arrayContaining([
      expect.objectContaining({ expectedText: "Pocket", newText: "Bag" })
    ]));
    expect(result.plan.documents.flatMap((document) => document.edits)).toHaveLength(3);
  });

  it("reuses defining Module safety and rejects stale, mismatched, and unproved importer occurrences", async () => {
    const fixture = await directFixture();
    const declarationIdentity = fixture.rootBundle.analysis.analysesByDocument
      .get(fixture.library.documentId)!.definitions.find((candidate) => candidate.name === "Pocket")!.identity!;
    const declarationOccurrence = fixture.libraryIndex.occurrences.find((occurrence) =>
      occurrence.kind === "declaration" && occurrence.identity.localIdentity === declarationIdentity.localIdentity
    )!;
    expect(fixture.proof({
      source: fixture.libraryRoot,
      identity: declarationIdentity,
      occurrences: [declarationOccurrence],
      newName: "Bag"
    }).status).toBe("ok");

    const collisionSource = rootSource("language-library", [
      "nui 1",
      "export module Pocket() {",
      "}",
      "module Bag() {",
      "}"
    ].join("\n"), 10);
    const collisionBundle = await buildRoot(collisionSource, new Map(), new Map([
      [1, declarationIdentity.localIdentity]
    ]));
    const collisionProof = createMultiDocumentModuleRenameDocumentProof({
      graph: fixture.rootBundle.graph,
      analysis: fixture.rootBundle.analysis,
      compiledByDocument: new Map([[collisionSource.documentId, collisionBundle.compiled]])
    });
    const collisionOccurrence = {
      ...declarationOccurrence,
      location: {
        source: {
          kind: collisionSource.kind,
          documentId: collisionSource.documentId,
          sourceRevision: collisionSource.sourceRevision
        },
        range: { from: collisionSource.normalizedSource.indexOf("Pocket"), to: collisionSource.normalizedSource.indexOf("Pocket") + "Pocket".length }
      }
    } as typeof declarationOccurrence;
    expect(collisionProof({
      source: collisionSource,
      identity: declarationIdentity,
      occurrences: [collisionOccurrence],
      newName: "Bag"
    }).status).toBe("rejected");

    const stale = rootSource("language-root", directRootText, fixture.root.sourceRevision + 1);
    const callOccurrence = fixture.rootIndex.occurrences.find((occurrence) => occurrence.kind === "reference" && occurrence.location.source.documentId === fixture.root.documentId)!;
    expect(fixture.proof({ source: stale, identity: declarationIdentity, occurrences: [callOccurrence], newName: "Bag" }).status).toBe("rejected");
    expect(fixture.proof({
      source: fixture.root,
      identity: { documentId: fixture.root.documentId, localIdentity: declarationIdentity.localIdentity },
      occurrences: [callOccurrence],
      newName: "Bag"
    }).status).toBe("rejected");
    expect(fixture.proof({
      source: fixture.root,
      identity: declarationIdentity,
      occurrences: [{ ...callOccurrence, location: { ...callOccurrence.location, range: { from: 0, to: 5 } } }],
      newName: "Bag"
    }).status).toBe("rejected");
  });

  it("rejects incomplete public reverse discovery before document proofs run", async () => {
    const fixture = await directFixture();
    const result = planMultiDocumentRename({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: libraryText.indexOf("Pocket") + 1,
      newName: "Bag",
      reverseImporters: { status: "incomplete" },
      proveDocument: fixture.proof
    });
    expect(result).toEqual({ status: "rejected", reason: "incomplete-discovery" });
  });
});
