import type { SourceRevision } from "../dsl/logicalStatementSourceMap";
import type { StatementIdentity } from "./statementIdentity";

declare const documentIdBrand: unique symbol;
declare const savedSourceFingerprintBrand: unique symbol;

/** Opaque identity supplied by the host. Core source semantics never derives it from a path or URI. */
export type DocumentId = string & { readonly [documentIdBrand]: "DocumentId" };

/** Opaque fingerprint supplied for the saved bytes/text that back an imported dependency. */
export type SavedSourceFingerprint = string & { readonly [savedSourceFingerprintBrand]: "SavedSourceFingerprint" };

/** Host boundary adapters: preserve the supplied value verbatim and add only compile-time opacity. */
export const documentIdFromHost = (value: string): DocumentId => value as DocumentId;
export const savedSourceFingerprintFromHost = (value: string): SavedSourceFingerprint => value as SavedSourceFingerprint;

export type RootCurrentSourceSnapshot = {
  kind: "root-current";
  documentId: DocumentId;
  normalizedSource: string;
  sourceRevision: SourceRevision;
};

export type DependencySavedSourceSnapshot = {
  kind: "dependency-saved";
  documentId: DocumentId;
  normalizedSource: string;
  savedSourceFingerprint: SavedSourceFingerprint;
};

/**
 * A multi-document analysis input keeps source ownership explicit. The current
 * root may be an editor buffer; dependencies are separate saved-source
 * snapshots. No statement/source concatenation is represented by this model.
 */
export type MultiDocumentSourceSnapshot = RootCurrentSourceSnapshot | DependencySavedSourceSnapshot;

export type RootCurrentSourceIdentity = Pick<RootCurrentSourceSnapshot, "kind" | "documentId" | "sourceRevision">;
export type DependencySavedSourceIdentity = Pick<DependencySavedSourceSnapshot, "kind" | "documentId" | "savedSourceFingerprint">;
export type DocumentSourceIdentity = RootCurrentSourceIdentity | DependencySavedSourceIdentity;

export type DocumentTextRange = {
  from: number;
  to: number;
};

/** Local semantic identity plus the document that owns it. */
export type DocumentQualifiedSemanticIdentity<LocalIdentity extends string = StatementIdentity> = {
  documentId: DocumentId;
  localIdentity: LocalIdentity;
};

/** Exact source owner/version plus a document-local UTF-16 text range. */
export type DocumentQualifiedSourceLocation = {
  source: DocumentSourceIdentity;
  range: DocumentTextRange;
};

export const sourceIdentityOf = (snapshot: MultiDocumentSourceSnapshot): DocumentSourceIdentity =>
  snapshot.kind === "root-current"
    ? {
        kind: snapshot.kind,
        documentId: snapshot.documentId,
        sourceRevision: snapshot.sourceRevision
      }
    : {
        kind: snapshot.kind,
        documentId: snapshot.documentId,
        savedSourceFingerprint: snapshot.savedSourceFingerprint
      };

export const qualifySemanticIdentity = <LocalIdentity extends string>(
  documentId: DocumentId,
  localIdentity: LocalIdentity
): DocumentQualifiedSemanticIdentity<LocalIdentity> => ({ documentId, localIdentity });

export const qualifySourceLocation = (
  source: DocumentSourceIdentity,
  range: DocumentTextRange
): DocumentQualifiedSourceLocation => ({ source, range });
