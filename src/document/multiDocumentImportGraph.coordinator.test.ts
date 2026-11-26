import { describe, expect, it } from "vitest";
import {
  MultiDocumentGraphCoordinator,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentSavedSourceLoader
} from "@nuinuicad/nui-language/workspace";
import { moduleDeclarationContributor } from "@nuinuicad/nui-language/workspace";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";

const rootSource = (id: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
  normalizedSource: [
    "nui 1",
    "import \"./shared.nui\" as shared"
  ].join("\n"),
  sourceRevision: 1
});

const sharedSource: DependencySavedSourceSnapshot = {
  kind: "dependency-saved",
  documentId: documentIdFromHost("shared"),
  normalizedSource: [
    "nui 1",
    "export module Pocket() {",
    "}"
  ].join("\n"),
  savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:shared")
};

const loaderFor = (root: RootCurrentSourceSnapshot): MultiDocumentSavedSourceLoader => ({
  async loadSavedDependency(importerDocumentId, relativePath) {
    if (importerDocumentId === root.documentId && relativePath === "./shared.nui") {
      return { status: "loaded", snapshot: sharedSource };
    }
    return { status: "failed", reason: "missing" };
  }
});

describe("multi-document graph coordinator artifact cache", () => {
  it("shares one exact saved artifact across roots with the same DocumentId and fingerprint", async () => {
    let dependencyAnalyses = 0;
    const contributor: MultiDocumentDeclarationContributor = (context) => {
      if (context.source.kind === "dependency-saved") dependencyAnalyses += 1;
      return moduleDeclarationContributor(context);
    };
    const roots = [rootSource("root-a"), rootSource("root-b")];
    const coordinator = new MultiDocumentGraphCoordinator();
    const results = [];

    for (const root of roots) {
      results.push(await coordinator.rebuild({
        root,
        loader: loaderFor(root),
        declarationContributors: [contributor]
      }));
    }

    expect(results.every((result) => result.status === "current")).toBe(true);
    expect(dependencyAnalyses).toBe(1);
    const identities = results.map((result) =>
      result.status === "current"
        ? result.graph.nodes.get(sharedSource.documentId)?.publicApi.publicEntriesByName.get("Pocket")?.identity
        : undefined
    );
    expect(identities[0]).toEqual(identities[1]);
  });

  it("retires only the roots selected by saved-dependency freshness", async () => {
    const roots = [rootSource("root-a"), rootSource("root-b")];
    const coordinator = new MultiDocumentGraphCoordinator();
    const results = await Promise.all(roots.map(root => coordinator.rebuild({
      root,
      loader: loaderFor(root),
      declarationContributors: [moduleDeclarationContributor]
    })));
    const graphA = results[0];
    const graphB = results[1];
    expect(graphA.status).toBe("current");
    expect(graphB.status).toBe("current");
    if (graphA.status !== "current" || graphB.status !== "current") throw new Error("expected current graphs");

    expect(coordinator.invalidateSavedDependency(sharedSource.documentId, [roots[0]!.documentId]))
      .toEqual([roots[0]!.documentId]);
    expect(coordinator.graphForRoot(roots[0]!.documentId)).toBeUndefined();
    expect(coordinator.graphForRoot(roots[1]!.documentId)).toBe(graphB.graph);
  });
});
