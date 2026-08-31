import { describe, expect, it } from "vitest";
import {
  documentIdFromHost,
  qualifySemanticIdentity,
  qualifySourceLocation,
  savedSourceFingerprintFromHost,
  sourceIdentityOf,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "./multiDocumentPrimitives";

describe("multi-document identity primitives", () => {
  it("keeps host-supplied DocumentId opaque and verbatim", () => {
    const documentId = documentIdFromHost("vscode:file:///patterns/root.nui");
    expect(documentId).toBe("vscode:file:///patterns/root.nui");
    expect(qualifySemanticIdentity(documentId, "statement:module:42")).toEqual({
      documentId,
      localIdentity: "statement:module:42"
    });
  });

  it("distinguishes current root source identity from saved dependency identity", () => {
    const root: RootCurrentSourceSnapshot = {
      kind: "root-current",
      documentId: documentIdFromHost("root"),
      normalizedSource: "nui 1\n",
      sourceRevision: 12
    };
    const dependency: DependencySavedSourceSnapshot = {
      kind: "dependency-saved",
      documentId: documentIdFromHost("dependency"),
      normalizedSource: "nui 1\n",
      savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:abc")
    };

    expect(sourceIdentityOf(root)).toEqual({
      kind: "root-current",
      documentId: root.documentId,
      sourceRevision: 12
    });
    expect(sourceIdentityOf(dependency)).toEqual({
      kind: "dependency-saved",
      documentId: dependency.documentId,
      savedSourceFingerprint: dependency.savedSourceFingerprint
    });
  });

  it("qualifies source locations with the owning document source version", () => {
    const source = {
      kind: "dependency-saved" as const,
      documentId: documentIdFromHost("dependency"),
      savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:def")
    };

    expect(qualifySourceLocation(source, { from: 8, to: 21 })).toEqual({
      source,
      range: { from: 8, to: 21 }
    });
  });
});
