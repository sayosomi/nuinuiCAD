import { describe, expect, it } from "vitest";
import { sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import {
  canvasRuntimePresentationFor,
  projectVscodeMultiDocumentCanvasRuntime
} from "./multiDocumentRuntimeTransport";
import { buildIssue1651ImportedModuleCanvasEditFixture } from "./testSupport/issue1651ImportedModuleCanvasEditFixture";

describe("multi-document snapshot ownership transport", () => {
  it("carries only exact compiler-verified runtime Source ownership with graph and dependency identity", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
    const graph = fixture.compiled.moduleRuntimeContext?.graph;
    if (!graph) throw new Error("Issue 1651 fixture is missing its authoritative graph");
    const snapshot = projectVscodeMultiDocumentCanvasRuntime({
      graph,
      compiled: fixture.compiled,
      graphRevision: fixture.publication.graph.revision
    });
    expect(snapshot).not.toBeNull();
    if (!snapshot) return;

    const presentation = canvasRuntimePresentationFor(JSON.parse(JSON.stringify(snapshot)));
    const imported = presentation.elements.find((element) => element.name === "Imported")!;
    const root = presentation.elements.find((element) => element.name === "A")!;
    const importedOwner = sourceOwnerForRuntimeElementId(fixture.compiled, imported.id)!;
    const rootOwner = sourceOwnerForRuntimeElementId(fixture.compiled, root.id)!;
    const ownership = presentation.sourceOwnership!;
    if (importedOwner.source?.kind !== "dependency-saved" ||
        importedOwner.sourceLocation?.source.kind !== "dependency-saved") {
      throw new Error("Imported owner did not retain its saved dependency identity");
    }
    const importedOwnerSource = importedOwner.source;
    const importedLocationSource = importedOwner.sourceLocation.source;

    expect(ownership).toMatchObject({
      rootDocumentId: fixture.publication.graph.rootDocumentId,
      graphRevision: fixture.publication.graph.revision,
      rootSourceRevision: fixture.publication.graph.rootSource.sourceRevision,
      dependencySourceIdentities: fixture.publication.graph.dependencyFingerprints
    });
    expect(ownership.owners.find((owner) => owner.runtimeElementId === imported.id)).toMatchObject({
      runtimeElementId: importedOwner.runtimeElementId,
      kind: importedOwner.kind,
      sourceStatementId: importedOwner.sourceStatementId,
      sourceStatementIndex: importedOwner.sourceStatementIndex,
      sourceDocumentId: String(importedOwner.sourceDocumentId),
      sourceIdentity: {
        documentId: String(importedOwner.sourceIdentity?.documentId),
        localIdentity: importedOwner.sourceIdentity?.localIdentity
      },
      source: {
        kind: importedOwnerSource.kind,
        documentId: String(importedOwnerSource.documentId),
        savedSourceFingerprint: String(importedOwnerSource.savedSourceFingerprint)
      },
      sourceLocation: {
        source: {
          kind: importedLocationSource.kind,
          documentId: String(importedLocationSource.documentId),
          savedSourceFingerprint: String(importedLocationSource.savedSourceFingerprint)
        },
        range: importedOwner.sourceLocation.range
      }
    });
    expect(ownership.owners.find((owner) => owner.runtimeElementId === root.id)).toMatchObject({
      runtimeElementId: rootOwner.runtimeElementId,
      kind: rootOwner.kind,
      sourceStatementId: rootOwner.sourceStatementId,
      sourceStatementIndex: rootOwner.sourceStatementIndex,
      statement: {
        statementIndex: rootOwner.statement.statementIndex,
        sourceRevision: rootOwner.statement.sourceRevision,
        range: rootOwner.statement.range
      }
    });
    expect(presentation.sourceEditing?.compiled.moduleRuntimeContext).toBeUndefined();
    expect(presentation.sourceEditing?.sourceText).toBe(fixture.source);
  });
});
