import { describe, expect, it } from "vitest";
import {
  MultiDocumentGraphCoordinator,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentSavedSourceLoader
} from "./multiDocumentImportGraph";
import { moduleDeclarationContributor } from "./multiDocumentModuleSemantics";
import {
  documentIdFromHost,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "./multiDocumentPrimitives";

const rootSource = (id: string): RootCurrentSourceSnapshot => ({
  kind: "root-current",
  documentId: documentIdFromHost(id),
  normalizedSource: [
    "nui 4",
    "import \"./shared.nui\" as shared"
  ].join("\n"),
  sourceRevision: 1
});

const sharedSource: DependencySavedSourceSnapshot = {
  kind: "dependency-saved",
  documentId: documentIdFromHost("shared"),
  normalizedSource: [
    "nui 4",
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
});
