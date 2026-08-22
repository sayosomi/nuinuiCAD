import { describe, expect, it } from "vitest";
import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import {
  buildMultiDocumentImportGraph,
  createGraphExternalNamespaceResolver,
  MultiDocumentGraphCoordinator,
  SavedDocumentArtifactCache,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentSavedSourceLoader,
  type SavedDependencyLoadResult
} from "./multiDocumentImportGraph";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  qualifySourceLocation,
  savedSourceFingerprintFromHost,
  sourceIdentityOf,
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
  normalizedSource: source,
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint)
});

const moduleContributor: MultiDocumentDeclarationContributor<{ docs: string }> = ({
  source,
  parsed,
  statementIdByStatementIndex
}) => parsed.statements.flatMap((statement, statementIndex) => {
  if (statement.kind !== "moduleDefinition" || statement.enclosing) return [];
  return [{
    identity: qualifySemanticIdentity(source.documentId, statementIdByStatementIndex.get(statementIndex)!),
    family: "module" as const,
    name: statement.name,
    declaration: qualifySourceLocation(sourceIdentityOf(source), {
      from: statement.documentRange.from,
      to: statement.documentRange.to
    }),
    exported: true,
    metadata: { docs: `${statement.name} docs` }
  }];
});

const loaderFrom = (
  table: ReadonlyMap<string, DependencySavedSourceSnapshot | Exclude<SavedDependencyLoadResult, { status: "loaded" }>>
): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, relativePath) {
    const result = table.get(`${importerDocumentId}|${relativePath}`);
    if (!result) return { status: "failed", reason: "missing" };
    return "kind" in result
      ? { status: "loaded", snapshot: result }
      : result;
  }
});

describe("multi-document import graph", () => {
  it("builds source-ordered saved dependency edges and resolves import public members through the lexical owner", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./library.nui\" as library",
      "const after: number = 0"
    ].join("\n"));
    const library = savedSource("library", "sha256:library", [
      "nui 4",
      "module Pocket() {",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./library.nui`, library]
      ])),
      declarationContributors: [moduleContributor]
    });

    expect(graph.valid).toBe(true);
    expect(graph.nodes.get(root.documentId)?.imports).toEqual([
      expect.objectContaining({ alias: "library", targetDocumentId: library.documentId, status: "resolved" })
    ]);
    expect(graph.dependencyFingerprints.get(library.documentId)).toBe(library.savedSourceFingerprint);

    const rootNode = graph.nodes.get(root.documentId)!;
    const lookup = resolveSourceLexicalPath(
      rootNode.artifact.sourceLexicalNamespace,
      2,
      parseDslReferenceToken("library::Pocket"),
      { externalNamespaceResolver: createGraphExternalNamespaceResolver(graph, root.documentId) }
    );
    expect(lookup).toMatchObject({
      kind: "external",
      member: {
        name: "Pocket",
        value: {
          name: "Pocket",
          family: "module",
          metadata: { docs: "Pocket docs" },
          identity: { documentId: library.documentId }
        }
      }
    });
  });

  it("does not make transitive imports public without an explicit re-export", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./middle.nui\" as middle",
      "const after: number = 0"
    ].join("\n"));
    const middle = savedSource("middle", "sha256:middle", [
      "nui 4",
      "import \"./leaf.nui\" as leaf",
      "module MiddleOnly() {",
      "}"
    ].join("\n"));
    const leaf = savedSource("leaf", "sha256:leaf", [
      "nui 4",
      "module LeafOnly() {",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./middle.nui`, middle],
        [`${middle.documentId}|./leaf.nui`, leaf]
      ])),
      declarationContributors: [moduleContributor]
    });
    const resolver = createGraphExternalNamespaceResolver(graph, root.documentId);
    const namespace = graph.nodes.get(root.documentId)!.artifact.sourceLexicalNamespace;

    expect(resolveSourceLexicalPath(namespace, 2, parseDslReferenceToken("middle::MiddleOnly"), {
      externalNamespaceResolver: resolver
    }).kind).toBe("external");
    expect(resolveSourceLexicalPath(namespace, 2, parseDslReferenceToken("middle::LeafOnly"), {
      externalNamespaceResolver: resolver
    })).toEqual({ kind: "undefined" });
  });

  it("marks every participating cycle edge and never resolves through it", async () => {
    const root = rootSource("A", [
      "nui 4",
      "import \"./b.nui\" as b"
    ].join("\n"));
    const b = savedSource("B", "sha256:b", [
      "nui 4",
      "import \"./a.nui\" as a"
    ].join("\n"));
    const savedA = savedSource("A", "sha256:a", root.normalizedSource);
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./b.nui`, b],
        [`${b.documentId}|./a.nui`, savedA]
      ]))
    });

    expect(graph.valid).toBe(false);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.status === "cycle" && edge.failureReason === "cycle")).toBe(true);
    expect(graph.diagnostics.filter((diagnostic) => diagnostic.code === "import-cycle")).toHaveLength(2);
  });

  it("reports structured load failures on the importing statement", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./missing.nui\" as missing",
      "import \"./secret.nui\" as secret"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./missing.nui`, { status: "failed" as const, reason: "missing" as const }],
        [`${root.documentId}|./secret.nui`, { status: "failed" as const, reason: "unreadable" as const }]
      ]))
    });

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "import-missing",
      "import-unreadable"
    ]);
    expect(graph.edges.map((edge) => edge.failureReason)).toEqual(["missing", "unreadable"]);
    expect(graph.valid).toBe(false);
  });

  it("reuses only the exact DocumentId+fingerprint artifact and never falls back after a changed dependency becomes invalid", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./library.nui\" as library"
    ].join("\n"));
    const valid = savedSource("library", "sha256:v1", [
      "nui 4",
      "module Pocket() {",
      "}"
    ].join("\n"));
    const invalid = savedSource("library", "sha256:v2", "nui 3\n");
    const cache = new SavedDocumentArtifactCache<{ docs: string }>();
    let dependencyContributionCount = 0;
    const countingContributor: MultiDocumentDeclarationContributor<{ docs: string }> = (context) => {
      if (context.source.kind === "dependency-saved") dependencyContributionCount += 1;
      return moduleContributor(context);
    };

    const first = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, valid]])),
      cache,
      declarationContributors: [countingContributor]
    });
    const second = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, valid]])),
      cache,
      declarationContributors: [countingContributor]
    });
    const changed = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, invalid]])),
      cache,
      declarationContributors: [countingContributor]
    });

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(dependencyContributionCount).toBe(2);
    expect(cache.size).toBe(2);
    expect(changed.valid).toBe(false);
    expect(changed.diagnostics).toEqual([
      expect.objectContaining({ code: "import-invalid-source" })
    ]);
    expect(changed.nodes.has(valid.documentId)).toBe(false);
  });

  it("discards a slower previous build for the same root", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./library.nui\" as library"
    ].join("\n"));
    const oldDependency = savedSource("library", "sha256:old", "nui 4\n");
    const newDependency = savedSource("library", "sha256:new", "nui 4\n");
    let releaseOld!: (result: SavedDependencyLoadResult) => void;
    const slowLoader: MultiDocumentSavedSourceLoader = {
      loadSavedDependency: () => new Promise((resolve) => {
        releaseOld = resolve;
      })
    };
    const coordinator = new MultiDocumentGraphCoordinator();

    const oldBuild = coordinator.rebuild({ root, loader: slowLoader });
    await Promise.resolve();
    const newBuild = await coordinator.rebuild({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./library.nui`, newDependency]]))
    });
    releaseOld({ status: "loaded", snapshot: oldDependency });
    const staleBuild = await oldBuild;

    expect(newBuild.status).toBe("current");
    expect(staleBuild).toEqual({ status: "stale" });
    expect(coordinator.graphForRoot(root.documentId)?.dependencyFingerprints.get(newDependency.documentId)).toBe(
      newDependency.savedSourceFingerprint
    );
  });

  it("invalidates exactly the active roots that transitively contain a changed saved dependency", async () => {
    const shared = savedSource("shared", "sha256:shared", "nui 4\n");
    const unrelated = rootSource("unrelated", "nui 4\n");
    const roots = ["root-a", "root-b"].map((id) => rootSource(id, [
      "nui 4",
      "import \"./shared.nui\" as shared"
    ].join("\n")));
    const coordinator = new MultiDocumentGraphCoordinator();

    for (const root of roots) {
      await coordinator.rebuild({
        root,
        loader: loaderFrom(new Map([[`${root.documentId}|./shared.nui`, shared]]))
      });
    }
    await coordinator.rebuild({
      root: unrelated,
      loader: loaderFrom(new Map())
    });

    const affected = coordinator.invalidateSavedDependency(shared.documentId);
    expect(new Set(affected)).toEqual(new Set(roots.map((root) => root.documentId)));
    expect(roots.every((root) => coordinator.graphForRoot(root.documentId) === undefined)).toBe(true);
    expect(coordinator.graphForRoot(unrelated.documentId)).toBeDefined();
  });
});
