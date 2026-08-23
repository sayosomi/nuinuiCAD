import { describe, expect, it } from "vitest";
import {
  buildMultiDocumentImportGraph,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentSavedSourceLoader
} from "../document/multiDocumentImportGraph";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  qualifySourceLocation,
  savedSourceFingerprintFromHost,
  sourceIdentityOf,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "../document/multiDocumentPrimitives";
import { vscodeMultiDocumentGraphSnapshot } from "./multiDocumentGraphTransport";

const contributor: MultiDocumentDeclarationContributor = ({ source, parsed }) =>
  parsed.statements.flatMap((statement) => {
    if (statement.kind !== "moduleDefinition" || statement.enclosing) return [];
    const segment = statement.namePhysicalSpan?.segments[0];
    if (!segment) return [];
    return [{
      identity: qualifySemanticIdentity(source.documentId, `module:${statement.name}`),
      family: "module" as const,
      name: statement.name,
      declaration: qualifySourceLocation(sourceIdentityOf(source), {
        from: segment.from,
        to: segment.to
      }),
      exported: true,
      metadata: { deliberatelyOmittedFromTransport: true }
    }];
  });

describe("VS Code multi-document graph transport", () => {
  it("serializes graph/source identity as deterministic JSON-safe plain data", async () => {
    const root: RootCurrentSourceSnapshot = {
      kind: "root-current",
      documentId: documentIdFromHost("file:///workspace/main.nui"),
      normalizedSource: [
        "nui 4",
        "import \"./library.nui\" as library",
        "export @library::Pocket"
      ].join("\n"),
      sourceRevision: 12
    };
    const dependency: DependencySavedSourceSnapshot = {
      kind: "dependency-saved",
      documentId: documentIdFromHost("file:///workspace/library.nui"),
      normalizedSource: ["nui 4", "module Pocket() {", "}"].join("\n"),
      savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:library")
    };
    const loader: MultiDocumentSavedSourceLoader = {
      async loadSavedDependency(_importer, relativePath) {
        return relativePath === "./library.nui"
          ? { status: "loaded", snapshot: dependency }
          : { status: "failed", reason: "missing" };
      }
    };
    const graph = await buildMultiDocumentImportGraph({
      root,
      loader,
      declarationContributors: [contributor]
    });

    const snapshot = vscodeMultiDocumentGraphSnapshot(graph, 41);
    const roundTrip = JSON.parse(JSON.stringify(snapshot));

    expect(roundTrip).toMatchObject({
      revision: 41,
      rootDocumentId: "file:///workspace/main.nui",
      rootSource: {
        kind: "root-current",
        documentId: "file:///workspace/main.nui",
        sourceRevision: 12
      },
      valid: true
    });
    expect(roundTrip.dependencyFingerprints).toEqual([{
      documentId: "file:///workspace/library.nui",
      savedSourceFingerprint: "sha256:library"
    }]);
    expect(roundTrip.edges).toHaveLength(1);
    expect(roundTrip.edges[0]).toMatchObject({
      importerDocumentId: "file:///workspace/main.nui",
      importPath: "./library.nui",
      alias: "library",
      targetDocumentId: "file:///workspace/library.nui",
      status: "resolved"
    });
    const libraryNode = roundTrip.nodes.find((node: { documentId: string }) =>
      node.documentId === "file:///workspace/library.nui"
    );
    expect(libraryNode.publicEntries).toHaveLength(1);
    expect(libraryNode.publicEntries[0]).toMatchObject({
      name: "Pocket",
      family: "module",
      identity: {
        documentId: "file:///workspace/library.nui",
        localIdentity: "module:Pocket"
      }
    });
    expect(libraryNode.publicEntries[0]).not.toHaveProperty("metadata");
  });
});
