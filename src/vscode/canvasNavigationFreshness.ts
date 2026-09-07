import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import type { VscodeMultiDocumentCanvasRuntimePresentation } from "./multiDocumentRuntimeTransport";

export type VscodeCanvasNavigationFreshnessFailureReason =
  | "authoritative-document-unavailable"
  | "publication-not-current"
  | "publication-document-version-newer"
  | "publication-graph-revision-newer"
  | "publication-runtime-unavailable"
  | "root-source-text-mismatch"
  | "root-source-revision-mismatch"
  | "canvas-runtime-source-revision-mismatch"
  | "runtime-presentation-graph-revision-newer"
  | "runtime-presentation-source-revision-mismatch";

export type VscodeCanvasNavigationFreshnessDeferReason =
  | "publication-unavailable"
  | "publication-document-version-older"
  | "publication-graph-revision-older"
  | "runtime-presentation-unavailable"
  | "runtime-presentation-graph-revision-older";

export type VscodeCanvasNavigationFreshness =
  | { status: "ready" }
  | { status: "defer"; reason: VscodeCanvasNavigationFreshnessDeferReason }
  | { status: "failed"; reason: VscodeCanvasNavigationFreshnessFailureReason };

type CommonFreshnessInput = {
  authoritativeDocumentAvailable: boolean;
};

export type VscodeCanvasNavigationFreshnessInput = CommonFreshnessInput & (
  | { graphBackedRequest: false }
  | {
      graphBackedRequest: true;
      documentVersion: number;
      normalizedSource: string;
      sourceRevision: number;
      graphRevision: number;
      publication: VscodeMultiDocumentGraphPublication | null;
      runtimePresentation: VscodeMultiDocumentCanvasRuntimePresentation | null;
    }
);

/**
 * Classify the existing Canvas navigation freshness gates in their production
 * order. The caller keeps the public failure contract as `source-mismatch`;
 * these reasons are intentionally internal diagnostic evidence only.
 */
export const canvasNavigationFreshnessFor = (
  input: VscodeCanvasNavigationFreshnessInput
): VscodeCanvasNavigationFreshness => {
  if (!input.authoritativeDocumentAvailable) {
    return { status: "failed", reason: "authoritative-document-unavailable" };
  }
  if (!input.graphBackedRequest) return { status: "ready" };

  const {
    documentVersion,
    normalizedSource,
    sourceRevision,
    graphRevision,
    publication,
    runtimePresentation
  } = input;
  if (!publication) return { status: "defer", reason: "publication-unavailable" };
  if (publication.status !== "current") {
    return { status: "failed", reason: "publication-not-current" };
  }
  if (publication.documentVersion > documentVersion) {
    return { status: "failed", reason: "publication-document-version-newer" };
  }
  if (publication.documentVersion < documentVersion) {
    return { status: "defer", reason: "publication-document-version-older" };
  }
  if (publication.graph.revision > graphRevision) {
    return { status: "failed", reason: "publication-graph-revision-newer" };
  }
  if (publication.graph.revision < graphRevision) {
    return { status: "defer", reason: "publication-graph-revision-older" };
  }
  if (!publication.canvasRuntime) {
    return { status: "failed", reason: "publication-runtime-unavailable" };
  }
  if (publication.graph.rootSource.normalizedSource !== normalizedSource) {
    return { status: "failed", reason: "root-source-text-mismatch" };
  }
  if (publication.graph.rootSource.sourceRevision !== sourceRevision) {
    return { status: "failed", reason: "root-source-revision-mismatch" };
  }
  if (publication.canvasRuntime.rootSourceRevision !== sourceRevision) {
    return { status: "failed", reason: "canvas-runtime-source-revision-mismatch" };
  }
  if (runtimePresentation?.graphRevision !== graphRevision) {
    if (runtimePresentation && runtimePresentation.graphRevision > graphRevision) {
      return { status: "failed", reason: "runtime-presentation-graph-revision-newer" };
    }
    return { status: "defer", reason: runtimePresentation
      ? "runtime-presentation-graph-revision-older"
      : "runtime-presentation-unavailable" };
  }
  if (runtimePresentation.rootSourceRevision !== sourceRevision) {
    return { status: "failed", reason: "runtime-presentation-source-revision-mismatch" };
  }
  return { status: "ready" };
};
