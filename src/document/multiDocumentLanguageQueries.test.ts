import { describe, expect, it } from "vitest";
import {
  buildMultiDocumentImportGraph,
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
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  planMultiDocumentRename,
  queryMultiDocumentDefinition,
  queryMultiDocumentReferences,
  type MultiDocumentRenameDocumentProof,
  type MultiDocumentSemanticDocumentView
} from "./multiDocumentLanguageQueries";

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

/** Test contributor: the fixed local identity models a family owner carrying
 * one stable declaration identity across saved and dirty root snapshots. */
const moduleContributor: MultiDocumentDeclarationContributor = ({
  source,
  parsed
}) => parsed.statements.flatMap((statement) => {
  if (statement.kind !== "moduleDefinition" || statement.enclosing) return [];
  const segments = statement.namePhysicalSpan?.segments;
  if (!segments || segments.length !== 1) return [];
  return [{
    identity: qualifySemanticIdentity(source.documentId, `test-module:${statement.name}`),
    family: "module" as const,
    name: statement.name,
    declaration: qualifySourceLocation(sourceIdentityOf(source), {
      from: segments[0]!.from,
      to: segments[0]!.to
    }),
    exported: true
  }];
});

const libraryText = [
  "nui 4",
  "module Pocket() {",
  "}"
].join("\n");

const facadeText = [
  "nui 4",
  "import \"./library.nui\" as library",
  "export @library::Pocket"
].join("\n");

const buildFixture = async () => {
  const librarySaved = savedSource("library", "sha256:library", libraryText);
  const facadeRoot = rootSource("facade", facadeText, 4);
  const facadeGraph = await buildMultiDocumentImportGraph({
    root: facadeRoot,
    loader: loaderFrom(new Map([
      [`${facadeRoot.documentId}|./library.nui`, librarySaved]
    ])),
    declarationContributors: [moduleContributor]
  });
  const libraryRoot = rootSource("library", libraryText, 7);
  const libraryGraph = await buildMultiDocumentImportGraph({
    root: libraryRoot,
    loader: loaderFrom(new Map()),
    declarationContributors: [moduleContributor]
  });
  return {
    librarySaved,
    facadeRoot,
    facadeGraph,
    libraryRoot,
    libraryGraph,
    facadeIndex: buildMultiDocumentSemanticOccurrenceIndex({ graph: facadeGraph }),
    libraryIndex: buildMultiDocumentSemanticOccurrenceIndex({ graph: libraryGraph })
  };
};

const sourceSlice = (
  source: string,
  range: { from: number; to: number }
) => source.slice(range.from, range.to);

const exactOccurrenceProof: MultiDocumentRenameDocumentProof = ({ source, occurrences, newName }) => ({
  status: "ok",
  edits: occurrences.map((occurrence) => ({
    from: occurrence.location.range.from,
    to: occurrence.location.range.to,
    expectedText: source.normalizedSource.slice(
      occurrence.location.range.from,
      occurrence.location.range.to
    ),
    newText: newName
  }))
});

describe("multi-document language queries", () => {
  it("returns a document-qualified Definition target for a flattened re-export member", async () => {
    const fixture = await buildFixture();
    const referenceOffset = facadeText.lastIndexOf("Pocket") + 1;
    const result = queryMultiDocumentDefinition({
      index: fixture.facadeIndex,
      documentId: fixture.facadeRoot.documentId,
      position: referenceOffset
    });

    expect(result).not.toBeNull();
    expect(result!.target.source).toMatchObject({
      kind: "dependency-saved",
      documentId: fixture.librarySaved.documentId,
      savedSourceFingerprint: fixture.librarySaved.savedSourceFingerprint
    });
    expect(sourceSlice(libraryText, result!.target.range)).toBe("Pocket");
    expect(sourceSlice(facadeText, result!.reference.range)).toBe("Pocket");
  });

  it("maps Definition into an open dirty target only when that current view re-proves the same identity", async () => {
    const fixture = await buildFixture();
    const publicIdentity = fixture.facadeGraph.nodes
      .get(fixture.librarySaved.documentId)!
      .publicApi.publicEntriesByName.get("Pocket")!.identity;
    const dirtyText = [
      "nui 4",
      "",
      "module Pocket() {",
      "}"
    ].join("\n");
    const dirtyLibrary = rootSource("library", dirtyText, 12);
    const dirtyNameFrom = dirtyText.indexOf("Pocket");
    const dirtyView: MultiDocumentSemanticDocumentView = {
      source: dirtyLibrary,
      valid: true,
      occurrences: [{
        kind: "declaration",
        identity: publicIdentity,
        range: { from: dirtyNameFrom, to: dirtyNameFrom + "Pocket".length }
      }]
    };
    const dirtyIndex = buildMultiDocumentSemanticOccurrenceIndex({
      graph: fixture.facadeGraph,
      documentViews: [dirtyView]
    });
    const referenceOffset = facadeText.lastIndexOf("Pocket") + 1;
    const mapped = queryMultiDocumentDefinition({
      index: dirtyIndex,
      documentId: fixture.facadeRoot.documentId,
      position: referenceOffset
    });

    expect(mapped?.target.source).toMatchObject({
      kind: "root-current",
      documentId: dirtyLibrary.documentId,
      sourceRevision: dirtyLibrary.sourceRevision
    });
    expect(mapped?.target.range).toEqual({
      from: dirtyNameFrom,
      to: dirtyNameFrom + "Pocket".length
    });

    const unprovedIndex = buildMultiDocumentSemanticOccurrenceIndex({
      graph: fixture.facadeGraph,
      documentViews: [{ source: dirtyLibrary, valid: true, occurrences: [] }]
    });
    expect(queryMultiDocumentDefinition({
      index: unprovedIndex,
      documentId: fixture.facadeRoot.documentId,
      position: referenceOffset
    })).toBeNull();
  });

  it("uses complete reverse discovery for public References and dedupes repeated candidate roots", async () => {
    const fixture = await buildFixture();
    const declarationOffset = libraryText.indexOf("Pocket") + 1;

    expect(queryMultiDocumentReferences({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: declarationOffset,
      reverseImporters: { status: "incomplete" }
    })).toBeNull();

    const result = queryMultiDocumentReferences({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: declarationOffset,
      reverseImporters: {
        status: "complete",
        indexes: [fixture.facadeIndex, fixture.facadeIndex]
      }
    });

    expect(result).not.toBeNull();
    expect(sourceSlice(libraryText, result!.declaration.range)).toBe("Pocket");
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0]!.source.documentId).toBe(fixture.facadeRoot.documentId);
    expect(sourceSlice(facadeText, result!.references[0]!.range)).toBe("Pocket");
  });

  it("keeps import-alias Rename importer-local while still editing its re-export alias occurrence", async () => {
    const fixture = await buildFixture();
    const aliasDeclaration = facadeText.indexOf("library", facadeText.indexOf(" as "));
    const result = planMultiDocumentRename({
      index: fixture.facadeIndex,
      documentId: fixture.facadeRoot.documentId,
      position: aliasDeclaration + 1,
      newName: "lib",
      proveDocument: exactOccurrenceProof
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.documents).toHaveLength(1);
    expect(result.plan.documents[0]!.source.documentId).toBe(fixture.facadeRoot.documentId);
    expect(result.plan.documents[0]!.edits).toHaveLength(2);
    expect(result.plan.documents[0]!.edits.map((edit) => edit.expectedText)).toEqual([
      "library",
      "library"
    ]);
  });

  it("plans a public Rename across declaration and reverse importer as one all-or-nothing edit set", async () => {
    const fixture = await buildFixture();
    const declarationOffset = libraryText.indexOf("Pocket") + 1;
    const result = planMultiDocumentRename({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: declarationOffset,
      newName: "Bag",
      reverseImporters: { status: "complete", indexes: [fixture.facadeIndex] },
      proveDocument: exactOccurrenceProof
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.plan.documents).toHaveLength(2);
    expect(new Set(result.plan.documents.map((document) => document.source.documentId))).toEqual(
      new Set([fixture.libraryRoot.documentId, fixture.facadeRoot.documentId])
    );
    expect(result.plan.documents.flatMap((document) => document.edits).map((edit) => edit.expectedText)).toEqual([
      "library",
      "Pocket",
      "Pocket"
    ]);
  });

  it("rejects the entire public Rename when any candidate document cannot prove safe edits", async () => {
    const fixture = await buildFixture();
    const declarationOffset = libraryText.indexOf("Pocket") + 1;
    const rejectingProof: MultiDocumentRenameDocumentProof = (input) =>
      input.source.documentId === fixture.facadeRoot.documentId
        ? { status: "rejected", reason: "candidate changed" }
        : exactOccurrenceProof(input);
    const result = planMultiDocumentRename({
      index: fixture.libraryIndex,
      documentId: fixture.libraryRoot.documentId,
      position: declarationOffset,
      newName: "Bag",
      reverseImporters: { status: "complete", indexes: [fixture.facadeIndex] },
      proveDocument: rejectingProof
    });

    expect(result).toEqual({ status: "rejected", reason: "unsafe-edit-proof" });
  });
});
