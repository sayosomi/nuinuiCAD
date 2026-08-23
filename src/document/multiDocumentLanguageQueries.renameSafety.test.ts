import { describe, expect, it } from "vitest";
import type { MultiDocumentImportGraph } from "./multiDocumentImportGraph";
import {
  planMultiDocumentRename,
  type MultiDocumentSemanticOccurrenceIndex
} from "./multiDocumentLanguageQueries";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  qualifySourceLocation,
  sourceIdentityOf,
  type RootCurrentSourceSnapshot
} from "./multiDocumentPrimitives";

const source: RootCurrentSourceSnapshot = {
  kind: "root-current",
  documentId: documentIdFromHost("rename-safety"),
  normalizedSource: "alias one alias",
  sourceRevision: 1
};

const identity = qualifySemanticIdentity(source.documentId, "import-alias:test");
const sourceIdentity = sourceIdentityOf(source);
const index: MultiDocumentSemanticOccurrenceIndex = {
  graph: {
    valid: true,
    rootDocumentId: source.documentId,
    nodes: new Map([
      [source.documentId, {
        publicApi: { publicEntriesByName: new Map() }
      }]
    ])
  } as unknown as MultiDocumentImportGraph<unknown>,
  valid: true,
  sourceByDocument: new Map([[source.documentId, source]]),
  occurrences: [
    {
      kind: "declaration",
      identity,
      location: qualifySourceLocation(sourceIdentity, { from: 0, to: 5 })
    },
    {
      kind: "reference",
      identity,
      location: qualifySourceLocation(sourceIdentity, { from: 10, to: 15 })
    }
  ]
};

describe("multi-document rename exact proof", () => {
  it("rejects a proof that edits unrelated text between semantic occurrences", () => {
    const result = planMultiDocumentRename({
      index,
      documentId: source.documentId,
      position: 1,
      newName: "renamed",
      proveDocument: ({ source: currentSource }) => ({
        status: "ok",
        edits: [{
          from: 0,
          to: currentSource.normalizedSource.length,
          expectedText: currentSource.normalizedSource,
          newText: "renamed"
        }]
      })
    });

    expect(result).toEqual({ status: "rejected", reason: "unsafe-edit-proof" });
  });
});
