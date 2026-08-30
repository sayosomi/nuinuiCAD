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
import { moduleDeclarationContributor } from "./multiDocumentModuleSemantics";
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
  normalizedSource: source,
  savedSourceFingerprint: savedSourceFingerprintFromHost(fingerprint)
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
      "export module Pocket() {",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./library.nui`, library]
      ])),
      declarationContributors: [moduleDeclarationContributor]
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
      "export module MiddleOnly() {",
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
      declarationContributors: [moduleDeclarationContributor]
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

  it("flattens an explicit parsed file re-export to the original semantic identity", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./facade.nui\" as facade",
      "const after: number = 0"
    ].join("\n"));
    const facade = savedSource("facade", "sha256:facade", [
      "nui 4",
      "import \"./leaf.nui\" as leaf",
      "export @leaf::Pocket"
    ].join("\n"));
    const leaf = savedSource("leaf", "sha256:leaf", [
      "nui 4",
      "export module Pocket() {",
      "}"
    ].join("\n"));
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./facade.nui`, facade],
        [`${facade.documentId}|./leaf.nui`, leaf]
      ])),
      declarationContributors: [moduleDeclarationContributor]
    });

    expect(graph.valid).toBe(true);
    const facadeEntry = graph.nodes.get(facade.documentId)?.publicApi.publicEntriesByName.get("Pocket");
    expect(facadeEntry).toMatchObject({
      name: "Pocket",
      identity: { documentId: leaf.documentId },
    });
    expect(facadeEntry?.reExportPath).toHaveLength(1);
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
      "export module Pocket() {",
      "}"
    ].join("\n"));
    const invalid = savedSource("library", "sha256:v2", "nui 3\n");
    const cache = new SavedDocumentArtifactCache<{ docs: string }>();
    let dependencyContributionCount = 0;
    const countingContributor: MultiDocumentDeclarationContributor<{ docs: string }> = (context) => {
      if (context.source.kind === "dependency-saved") dependencyContributionCount += 1;
      return moduleDeclarationContributor(context);
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

  it("fails closed when one graph observes two fingerprints for the same DocumentId", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./left.nui\" as left",
      "import \"./right.nui\" as right"
    ].join("\n"));
    const left = savedSource("left", "sha256:left", [
      "nui 4",
      "import \"./shared.nui\" as shared"
    ].join("\n"));
    const right = savedSource("right", "sha256:right", [
      "nui 4",
      "import \"./shared.nui\" as shared"
    ].join("\n"));
    const sharedV1 = savedSource("shared", "sha256:shared-v1", "nui 4\n");
    const sharedV2 = savedSource("shared", "sha256:shared-v2", "nui 4\n");
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader: loaderFrom(new Map([
        [`${root.documentId}|./left.nui`, left],
        [`${root.documentId}|./right.nui`, right],
        [`${left.documentId}|./shared.nui`, sharedV1],
        [`${right.documentId}|./shared.nui`, sharedV2]
      ]))
    });

    expect(graph.valid).toBe(false);
    expect(graph.dependencyFingerprints.get(sharedV1.documentId)).toBe(sharedV1.savedSourceFingerprint);
    expect(graph.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "import-load-stale" })
    ]));
    expect(graph.edges.find(
      (edge) => edge.importerDocumentId === right.documentId && edge.alias === "shared"
    )).toMatchObject({ status: "failed", failureReason: "stale" });
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

  it("tracks a loaded invalid dependency so a later saved change invalidates its active root", async () => {
    const root = rootSource("root", [
      "nui 4",
      "import \"./invalid.nui\" as invalid"
    ].join("\n"));
    const invalid = savedSource("invalid", "sha256:invalid-v1", "nui 3\n");
    const coordinator = new MultiDocumentGraphCoordinator();

    const result = await coordinator.rebuild({
      root,
      loader: loaderFrom(new Map([[`${root.documentId}|./invalid.nui`, invalid]]))
    });

    expect(result.status).toBe("current");
    expect(result.status === "current" && result.graph.valid).toBe(false);
    expect(coordinator.graphForRoot(root.documentId)).toBeDefined();
    expect(coordinator.invalidateSavedDependency(invalid.documentId)).toEqual([root.documentId]);
    expect(coordinator.graphForRoot(root.documentId)).toBeUndefined();
  });
});
