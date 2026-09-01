import type { MultiDocumentImportGraph } from "../document/multiDocumentImportGraph";
import type { VscodeMultiDocumentCanvasRuntimeSnapshot } from "./multiDocumentRuntimeTransport";
import type {
  DocumentQualifiedSemanticIdentity,
  DocumentQualifiedSourceLocation,
  MultiDocumentSourceSnapshot
} from "../document/multiDocumentPrimitives";

export type VscodeMultiDocumentSemanticIdentity = {
  documentId: string;
  localIdentity: string;
};

export type VscodeMultiDocumentSourceLocation = {
  source:
    | { kind: "root-current"; documentId: string; sourceRevision: number }
    | { kind: "dependency-saved"; documentId: string; savedSourceFingerprint: string };
  range: { from: number; to: number };
};

export type VscodeMultiDocumentSourceSnapshot =
  | {
      kind: "root-current";
      documentId: string;
      normalizedSource: string;
      sourceRevision: number;
    }
  | {
      kind: "dependency-saved";
      documentId: string;
      normalizedSource: string;
      savedSourceFingerprint: string;
    };

export type VscodeMultiDocumentGraphSnapshot = {
  revision: number;
  rootDocumentId: string;
  rootSource: VscodeMultiDocumentSourceSnapshot & { kind: "root-current" };
  valid: boolean;
  nodes: readonly {
    documentId: string;
    source: VscodeMultiDocumentSourceSnapshot;
    valid: boolean;
    publicEntries: readonly {
      name: string;
      family: "module" | "modifier" | "profile" | "layout" | "layoutTemplate";
      identity: VscodeMultiDocumentSemanticIdentity;
      declaration: VscodeMultiDocumentSourceLocation;
      reExportPath: readonly VscodeMultiDocumentSourceLocation[];
    }[];
  }[];
  edges: readonly {
    importerDocumentId: string;
    importIdentity: VscodeMultiDocumentSemanticIdentity;
    importLocation: VscodeMultiDocumentSourceLocation;
    importPath: string;
    alias: string;
    aliasLocation: VscodeMultiDocumentSourceLocation;
    targetDocumentId?: string;
    status: "resolved" | "failed" | "cycle";
    failureReason?: string;
  }[];
  dependencyFingerprints: readonly {
    documentId: string;
    savedSourceFingerprint: string;
  }[];
  diagnostics: readonly {
    code: string;
    message: string;
    location: VscodeMultiDocumentSourceLocation;
    relatedLocations: readonly VscodeMultiDocumentSourceLocation[];
  }[];
};

export type VscodeMultiDocumentGraphPublication =
  | {
      type: "multiDocumentGraphPublication";
      documentVersion: number;
      status: "current";
      graph: VscodeMultiDocumentGraphSnapshot;
      canvasRuntime?: VscodeMultiDocumentCanvasRuntimeSnapshot | null;
    }
  | {
      type: "multiDocumentGraphPublication";
      documentVersion: number | null;
      status: "building" | "invalidated" | "unavailable";
      graph: null;
    };

const sourceSnapshot = (source: MultiDocumentSourceSnapshot): VscodeMultiDocumentSourceSnapshot =>
  source.kind === "root-current"
    ? {
        kind: source.kind,
        documentId: String(source.documentId),
        normalizedSource: source.normalizedSource,
        sourceRevision: source.sourceRevision
      }
    : {
        kind: source.kind,
        documentId: String(source.documentId),
        normalizedSource: source.normalizedSource,
        savedSourceFingerprint: String(source.savedSourceFingerprint)
      };

const semanticIdentity = (
  identity: DocumentQualifiedSemanticIdentity<string>
): VscodeMultiDocumentSemanticIdentity => ({
  documentId: String(identity.documentId),
  localIdentity: identity.localIdentity
});

const sourceLocation = (
  location: DocumentQualifiedSourceLocation
): VscodeMultiDocumentSourceLocation => ({
  source: location.source.kind === "root-current"
    ? {
        kind: location.source.kind,
        documentId: String(location.source.documentId),
        sourceRevision: location.source.sourceRevision
      }
    : {
        kind: location.source.kind,
        documentId: String(location.source.documentId),
        savedSourceFingerprint: String(location.source.savedSourceFingerprint)
      },
  range: { from: location.range.from, to: location.range.to }
});

/**
 * Project the host-neutral graph into an intentionally plain-data Extension
 * Host -> Webview snapshot. Family metadata is omitted because it may be
 * host/family specific and is not required to preserve graph/source identity.
 */
export const vscodeMultiDocumentGraphSnapshot = (
  graph: MultiDocumentImportGraph<unknown>,
  revision: number
): VscodeMultiDocumentGraphSnapshot => ({
  revision,
  rootDocumentId: String(graph.rootDocumentId),
  rootSource: sourceSnapshot(graph.rootSource) as VscodeMultiDocumentGraphSnapshot["rootSource"],
  valid: graph.valid,
  nodes: [...graph.nodes.values()]
    .sort((left, right) => String(left.documentId).localeCompare(String(right.documentId)))
    .map((node) => ({
      documentId: String(node.documentId),
      source: sourceSnapshot(node.artifact.source),
      valid: node.valid,
      publicEntries: [...node.publicApi.publicEntriesByName.values()]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          family: entry.family,
          identity: semanticIdentity(entry.identity),
          declaration: sourceLocation(entry.declaration),
          reExportPath: entry.reExportPath.map(sourceLocation)
        }))
    })),
  edges: graph.edges.map((edge) => ({
    importerDocumentId: String(edge.importerDocumentId),
    importIdentity: semanticIdentity(edge.importIdentity),
    importLocation: sourceLocation(edge.importLocation),
    importPath: edge.importPath,
    alias: edge.alias,
    aliasLocation: sourceLocation(edge.aliasLocation),
    ...(edge.targetDocumentId === undefined ? {} : { targetDocumentId: String(edge.targetDocumentId) }),
    status: edge.status,
    ...(edge.failureReason === undefined ? {} : { failureReason: edge.failureReason })
  })),
  dependencyFingerprints: [...graph.dependencyFingerprints.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([documentId, savedSourceFingerprint]) => ({
      documentId: String(documentId),
      savedSourceFingerprint: String(savedSourceFingerprint)
    })),
  diagnostics: graph.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    location: sourceLocation(diagnostic.location),
    relatedLocations: (diagnostic.relatedLocations ?? []).map(sourceLocation)
  }))
});
