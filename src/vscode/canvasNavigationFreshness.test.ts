import { describe, expect, it } from "vitest";
import {
  canvasNavigationFreshnessFor,
  type VscodeCanvasNavigationFreshnessInput
} from "./canvasNavigationFreshness";
import {
  buildImportedRevealFreshnessFixture,
  importedRevealDocumentVersion,
  importedRevealGraphRevision,
  importedRevealGraphRootSourceRevision,
  importedRevealRootSource
} from "./testSupport/importedRevealFreshnessFixture";
import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";

type GraphFreshnessInput = {
  authoritativeDocumentAvailable: boolean;
  graphBackedRequest: true;
  documentVersion: number;
  normalizedSource: string;
  sourceRevision: number;
  graphRevision: number;
  publication: VscodeMultiDocumentGraphPublication | null;
  runtimePresentation: VscodeMultiDocumentCanvasRuntimePresentation | null;
};

const graphInputFor = async (): Promise<GraphFreshnessInput> => {
  const fixture = await buildImportedRevealFreshnessFixture();
  return {
    authoritativeDocumentAvailable: true,
    graphBackedRequest: true,
    documentVersion: importedRevealDocumentVersion,
    normalizedSource: importedRevealRootSource,
    sourceRevision: importedRevealGraphRootSourceRevision,
    graphRevision: importedRevealGraphRevision,
    publication: fixture.publication,
    runtimePresentation: fixture.runtimePresentation
  };
};

describe("Canvas navigation freshness diagnostics", () => {
  it("builds a genuine imported Module graph and accepts independent Webview compiler revision", async () => {
    const fixture = await buildImportedRevealFreshnessFixture();
    const input = await graphInputFor();

    expect(fixture.graph.valid).toBe(true);
    expect(fixture.graph.rootSource).toEqual(fixture.root);
    expect(fixture.graph.nodes.get(fixture.dependency.documentId)?.artifact.source).toEqual(fixture.dependency);
    expect(fixture.analysis.valid).toBe(true);
    expect(fixture.moduleRuntimeContext.valid).toBe(true);
    expect(fixture.moduleRuntimeContext.rootDocumentId).toBe(fixture.root.documentId);
    expect(fixture.compiled.moduleRuntimeContext?.graph).toBe(fixture.graph);
    expect(fixture.compiled.moduleMaterialization?.originByRuntimeElementId.size).toBeGreaterThan(0);
    expect([...fixture.compiled.moduleMaterialization!.originByRuntimeElementId.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceDocumentId: fixture.dependency.documentId })
      ])
    );
    expect(fixture.publication.graph.rootSource.sourceRevision).toBe(importedRevealGraphRootSourceRevision);
    expect(fixture.publication.canvasRuntime?.rootSourceRevision).toBe(importedRevealGraphRootSourceRevision);
    expect(fixture.publication.canvasRuntime?.graphRevision).toBe(importedRevealGraphRevision);
    expect(fixture.publication.canvasRuntime?.modulePresentation.revealMaterialization).toBeDefined();
    expect(fixture.runtimePresentation.revealMaterialization).toBeDefined();
    expect(fixture.target).toEqual({ kind: "statement-owner", sourceStatementIndex: 2 });
    expect(canvasNavigationFreshnessFor(input)).toEqual({ status: "ready" });
  });

  it("classifies every C-stage freshness branch without changing defer behavior", async () => {
    const base = await graphInputFor();
    const currentPublication = base.publication;
    const currentRuntimePresentation = base.runtimePresentation;
    if (!currentPublication || currentPublication.status !== "current" || !currentRuntimePresentation) {
      throw new Error("missing current imported Reveal fixture publication");
    }
    const cases: Array<[
      string,
      VscodeCanvasNavigationFreshnessInput,
      { status: "failed"; reason: string } | { status: "defer"; reason: string }
    ]> = [
      ["authoritative document", { ...base, authoritativeDocumentAvailable: false }, { status: "failed", reason: "authoritative-document-unavailable" }],
      ["publication status", { ...base, publication: { ...currentPublication, status: "building", graph: null } }, { status: "failed", reason: "publication-not-current" }],
      ["publication document ahead", { ...base, publication: { ...currentPublication, documentVersion: base.documentVersion + 1 } }, { status: "failed", reason: "publication-document-version-newer" }],
      ["publication document behind", { ...base, publication: { ...currentPublication, documentVersion: base.documentVersion - 1 } }, { status: "defer", reason: "publication-document-version-older" }],
      ["publication graph ahead", { ...base, publication: { ...currentPublication, graph: { ...currentPublication.graph, revision: base.graphRevision + 1 } } }, { status: "failed", reason: "publication-graph-revision-newer" }],
      ["publication graph behind", { ...base, publication: { ...currentPublication, graph: { ...currentPublication.graph, revision: base.graphRevision - 1 } } }, { status: "defer", reason: "publication-graph-revision-older" }],
      ["runtime unavailable", { ...base, publication: { ...currentPublication, canvasRuntime: null } }, { status: "failed", reason: "publication-runtime-unavailable" }],
      ["root text", { ...base, normalizedSource: `${base.normalizedSource}\n` }, { status: "failed", reason: "root-source-text-mismatch" }],
      ["root source revision", { ...base, sourceRevision: base.sourceRevision + 1 }, { status: "failed", reason: "root-source-revision-mismatch" }],
      ["Canvas runtime source revision", { ...base, publication: { ...currentPublication, canvasRuntime: { ...currentPublication.canvasRuntime!, rootSourceRevision: base.sourceRevision + 1 } } }, { status: "failed", reason: "canvas-runtime-source-revision-mismatch" }],
      ["runtime presentation unavailable", { ...base, runtimePresentation: null }, { status: "defer", reason: "runtime-presentation-unavailable" }],
      ["runtime presentation behind", { ...base, runtimePresentation: { ...currentRuntimePresentation, graphRevision: base.graphRevision - 1 } }, { status: "defer", reason: "runtime-presentation-graph-revision-older" }],
      ["runtime presentation ahead", { ...base, runtimePresentation: { ...currentRuntimePresentation, graphRevision: base.graphRevision + 1 } }, { status: "failed", reason: "runtime-presentation-graph-revision-newer" }],
      ["runtime presentation source revision", { ...base, runtimePresentation: { ...currentRuntimePresentation, rootSourceRevision: base.sourceRevision + 1 } }, { status: "failed", reason: "runtime-presentation-source-revision-mismatch" }]
    ];

    for (const [label, input, expected] of cases) {
      expect(canvasNavigationFreshnessFor(input), label).toEqual(expected);
    }
    expect(canvasNavigationFreshnessFor({
      authoritativeDocumentAvailable: true,
      graphBackedRequest: true,
      documentVersion: base.documentVersion,
      normalizedSource: base.normalizedSource,
      sourceRevision: base.sourceRevision,
      graphRevision: base.graphRevision,
      publication: null,
      runtimePresentation: null
    })).toEqual({ status: "defer", reason: "publication-unavailable" });
  });
});
