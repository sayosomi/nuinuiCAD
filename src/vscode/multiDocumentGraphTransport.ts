import type { MultiDocumentImportGraph } from "@nuinuicad/nui-language/workspace";
import { parseDslSnapshot } from "@nuinuicad/nui-language";
import {
  deserializeSourceEditingDocument,
  type SerializedSourceEditingDocument,
  type VscodeMultiDocumentCanvasRuntimeSnapshot
} from "./multiDocumentRuntimeTransport";
import type {
  DocumentQualifiedSemanticIdentity,
  DocumentQualifiedSourceLocation,
  MultiDocumentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";

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
      family: "record" | "module" | "modifier" | "profile" | "layout" | "layoutTemplate";
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

export type VscodeMultiDocumentGraphPublication = (
  | {
      type: "multiDocumentGraphPublication";
      documentVersion: number;
      status: "current";
      /** Canonical Host identity supplied independently from the graph root. */
      hostDocumentUri?: string;
      graph: VscodeMultiDocumentGraphSnapshot;
      canvasRuntime?: VscodeMultiDocumentCanvasRuntimeSnapshot | null;
    }
  | {
      type: "multiDocumentGraphPublication";
      documentVersion: number | null;
      status: "building" | "invalidated" | "unavailable";
      hostDocumentUri?: string;
      graph: null;
    }
) & {
  /** Attached when the existing session registry forwards a publication to Output Preview. */
  outputPreview?: {
    sequence: number;
    sourceEditing?: SerializedSourceEditingDocument;
    error?: string;
  };
};

export type VscodeOutputPreviewGraphAuthority = {
  hostDocumentUri: string;
  documentVersion: number;
  graphRevision: number;
  rootSourceRevision: number;
};

export const outputPreviewRequiresGraph = (source: string): boolean =>
  parseDslSnapshot({ normalizedSource: source.replace(/\r\n/g, "\n"), sourceRevision: 0 })
    .statements.some(statement => statement.kind === "import");

export const outputPreviewGraphAuthorityFor = (
  publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }>,
  hostDocumentUri: string,
  documentVersion: number,
  normalizedSource: string
): VscodeOutputPreviewGraphAuthority | null => {
  const { graph } = publication;
  if (
    publication.hostDocumentUri !== hostDocumentUri || publication.documentVersion !== documentVersion ||
    graph.rootDocumentId !== hostDocumentUri || graph.rootSource.documentId !== hostDocumentUri ||
    graph.rootSource.kind !== "root-current" || graph.rootSource.normalizedSource !== normalizedSource ||
    !Number.isSafeInteger(graph.revision) || graph.revision < 1 ||
    !Number.isSafeInteger(graph.rootSource.sourceRevision) || graph.rootSource.sourceRevision < 0
  ) return null;
  return {
    hostDocumentUri,
    documentVersion,
    graphRevision: graph.revision,
    rootSourceRevision: graph.rootSource.sourceRevision
  };
};

export const sameOutputPreviewGraphAuthority = (
  left: VscodeOutputPreviewGraphAuthority | undefined,
  right: VscodeOutputPreviewGraphAuthority | undefined
): boolean => left === right || Boolean(left && right &&
  left.hostDocumentUri === right.hostDocumentUri && left.documentVersion === right.documentVersion &&
  left.graphRevision === right.graphRevision && left.rootSourceRevision === right.rootSourceRevision);

export const outputPreviewGraphIsValid = (graph: VscodeMultiDocumentGraphSnapshot): boolean => {
  if (!graph.valid) return false;
  const root = graph.nodes.find(node => node.documentId === graph.rootDocumentId);
  if (
    !root || root.source.kind !== "root-current" || root.source.documentId !== graph.rootDocumentId ||
    root.source.sourceRevision !== graph.rootSource.sourceRevision ||
    root.source.normalizedSource !== graph.rootSource.normalizedSource
  ) return false;
  const fingerprints = new Map(graph.dependencyFingerprints.map(entry => [entry.documentId, entry.savedSourceFingerprint]));
  const nodeIds = new Set(graph.nodes.map(node => node.documentId));
  return nodeIds.size === graph.nodes.length &&
    fingerprints.size === graph.dependencyFingerprints.length &&
    fingerprints.size === graph.nodes.length - 1 &&
    graph.nodes.every(node => node.valid && (node === root || (
      node.source.kind === "dependency-saved" && node.source.documentId === node.documentId &&
      !!node.source.savedSourceFingerprint && fingerprints.get(node.documentId) === node.source.savedSourceFingerprint
    ))) &&
    graph.edges.every(edge => edge.status === "resolved" && edge.targetDocumentId !== undefined &&
      nodeIds.has(edge.importerDocumentId) && fingerprints.has(edge.targetDocumentId));
};

export const outputPreviewSourceEditingFor = (
  publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }>
) => {
  const { graph, canvasRuntime, outputPreview } = publication;
  const sourceEditing = outputPreview?.sourceEditing;
  if (
    !sourceEditing || !outputPreviewGraphIsValid(graph) ||
    sourceEditing.sourceText !== graph.rootSource.normalizedSource ||
    sourceEditing.sourceRevision !== graph.rootSource.sourceRevision ||
    sourceEditing.statementMap.sourceRevision !== sourceEditing.sourceRevision ||
    sourceEditing.spans.sourceMap.source !== sourceEditing.sourceText ||
    sourceEditing.spans.sourceMap.sourceRevision !== sourceEditing.sourceRevision
  ) return null;
  if (canvasRuntime && !canvasRuntime.identityOnly) {
    const { preparedRustEvaluation, graphRevision, rootDocumentId, rootSourceRevision } = canvasRuntime;
    const elements = sourceEditing.document.elements;
    const input = preparedRustEvaluation.input;
    if (
      graphRevision !== graph.revision || rootDocumentId !== graph.rootDocumentId ||
      rootSourceRevision !== sourceEditing.sourceRevision || !preparedRustEvaluation.rustEligible ||
      input.evaluationLimitIndex !== sourceEditing.document.evaluationLimitIndex ||
      input.elements.length !== elements.length ||
      !input.elements.every((element, index) => element.id === elements[index]?.id && element.type === elements[index]?.type)
    ) return null;
  }
  return deserializeSourceEditingDocument(sourceEditing, undefined);
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
