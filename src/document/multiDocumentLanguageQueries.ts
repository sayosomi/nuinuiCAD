import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import {
  createDslSemanticOccurrenceIndex,
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  createGraphExternalNamespaceResolver,
  type MultiDocumentGraphNode,
  type MultiDocumentImportGraph
} from "./multiDocumentImportGraph";
import {
  qualifySemanticIdentity,
  qualifySourceLocation,
  sourceIdentityOf,
  type DocumentId,
  type DocumentQualifiedSemanticIdentity,
  type DocumentQualifiedSourceLocation,
  type DocumentSourceIdentity,
  type DocumentTextRange,
  type MultiDocumentSourceSnapshot
} from "./multiDocumentPrimitives";
import type { MultiDocumentPublicApiEntry } from "./multiDocumentPublicApi";

export type MultiDocumentSemanticOccurrence = {
  kind: "declaration" | "reference";
  identity: DocumentQualifiedSemanticIdentity<string>;
  location: DocumentQualifiedSourceLocation;
};

export type MultiDocumentSemanticDocumentView = {
  /** Exact source snapshot that owns every local range in `occurrences`. */
  source: MultiDocumentSourceSnapshot;
  /** False means the host/semantic owner cannot prove this view current. */
  valid: boolean;
  occurrences: readonly {
    kind: MultiDocumentSemanticOccurrence["kind"];
    identity: DocumentQualifiedSemanticIdentity<string>;
    range: DocumentTextRange;
  }[];
};

export type DslSemanticIdentityResolver = (
  identity: DslSemanticIdentity
) => DocumentQualifiedSemanticIdentity<string> | null;

/**
 * Adapt the existing single-document semantic occurrence owner into one exact
 * document view. Cross-file family owners may override identity projection so
 * an imported occurrence uses the original public declaration identity.
 */
export const projectDslSemanticDocumentView = (input: {
  source: MultiDocumentSourceSnapshot;
  compiled: CompiledDslDocument;
  occurrenceIndex?: DslSemanticOccurrenceIndex;
  identityFor?: DslSemanticIdentityResolver;
  valid?: boolean;
}): MultiDocumentSemanticDocumentView => {
  const index = input.occurrenceIndex ?? createDslSemanticOccurrenceIndex(input.compiled);
  const identityFor = input.identityFor ?? ((identity: DslSemanticIdentity) =>
    qualifySemanticIdentity(input.source.documentId, dslSemanticIdentityKey(identity)));
  return {
    source: input.source,
    valid: input.valid ?? !input.compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    occurrences: index.occurrences.flatMap((occurrence) => {
      const identity = identityFor(occurrence.identity);
      return identity
        ? [{
            kind: occurrence.kind,
            identity,
            range: { from: occurrence.from, to: occurrence.to }
          }]
        : [];
    })
  };
};

export type MultiDocumentSemanticOccurrenceIndex = {
  graph: MultiDocumentImportGraph<unknown>;
  valid: boolean;
  sourceByDocument: ReadonlyMap<DocumentId, MultiDocumentSourceSnapshot>;
  occurrences: readonly MultiDocumentSemanticOccurrence[];
};

const identityKey = (identity: DocumentQualifiedSemanticIdentity<string>) =>
  JSON.stringify([identity.documentId, identity.localIdentity]);

const sameIdentity = (
  left: DocumentQualifiedSemanticIdentity<string>,
  right: DocumentQualifiedSemanticIdentity<string>
) => left.documentId === right.documentId && left.localIdentity === right.localIdentity;

const sourceIdentityKey = (source: DocumentSourceIdentity) => source.kind === "root-current"
  ? JSON.stringify([source.kind, source.documentId, source.sourceRevision])
  : JSON.stringify([source.kind, source.documentId, source.savedSourceFingerprint]);

const sourceSnapshotKey = (source: MultiDocumentSourceSnapshot) => source.kind === "root-current"
  ? JSON.stringify([source.kind, source.documentId, source.sourceRevision, source.normalizedSource])
  : JSON.stringify([source.kind, source.documentId, source.savedSourceFingerprint, source.normalizedSource]);

const sameSourceOwner = (
  left: MultiDocumentSourceSnapshot,
  right: MultiDocumentSourceSnapshot
) => sourceSnapshotKey(left) === sourceSnapshotKey(right);

const occurrenceKey = (occurrence: MultiDocumentSemanticOccurrence) => JSON.stringify([
  occurrence.kind,
  identityKey(occurrence.identity),
  sourceIdentityKey(occurrence.location.source),
  occurrence.location.range.from,
  occurrence.location.range.to
]);

const exactPayloadLocation = (
  node: MultiDocumentGraphNode<unknown>,
  statementIndex: number,
  key: string
): DocumentQualifiedSourceLocation | null => {
  const statement = node.artifact.parsed.statements[statementIndex];
  const physical = statement?.payloadPhysicalSpans?.[key];
  if (!physical || physical.segments.length !== 1) return null;
  const segment = physical.segments[0]!;
  return qualifySourceLocation(sourceIdentityOf(node.artifact.source), {
    from: segment.from,
    to: segment.to
  });
};

const graphOccurrencesForNode = (
  graph: MultiDocumentImportGraph<unknown>,
  node: MultiDocumentGraphNode<unknown>
): readonly MultiDocumentSemanticOccurrence[] => {
  const occurrences: MultiDocumentSemanticOccurrence[] = [];
  for (const declaration of node.artifact.declarations) {
    occurrences.push({
      kind: "declaration",
      identity: declaration.identity,
      location: declaration.declaration
    });
  }
  for (const directive of node.artifact.imports) {
    occurrences.push({
      kind: "declaration",
      identity: directive.identity,
      location: directive.aliasLocation
    });
  }

  const externalNamespaceResolver = createGraphExternalNamespaceResolver(graph, node.documentId);
  for (const [statementIndex, statement] of node.artifact.parsed.statements.entries()) {
    if (statement.kind !== "fileReExport") continue;
    const lookup = resolveSourceLexicalPath(
      node.artifact.sourceLexicalNamespace,
      statementIndex,
      parseDslReferenceToken(`${statement.importAlias}::${statement.exportedName}`),
      { externalNamespaceResolver }
    );
    if (lookup.kind !== "external") continue;
    const importDirective = node.artifact.imports.find(
      (candidate) => candidate.statementIndex === lookup.namespace.statementIndex
    );
    const member = lookup.member.value as MultiDocumentPublicApiEntry<unknown>;
    const aliasLocation = exactPayloadLocation(node, statementIndex, "importAlias");
    const memberLocation = exactPayloadLocation(node, statementIndex, "exportedName");
    if (importDirective && aliasLocation) {
      occurrences.push({
        kind: "reference",
        identity: importDirective.identity,
        location: aliasLocation
      });
    }
    if (member?.identity && memberLocation) {
      occurrences.push({
        kind: "reference",
        identity: member.identity,
        location: memberLocation
      });
    }
  }
  return occurrences;
};

/**
 * Build the exact occurrence universe for one root graph. A supplied view may
 * replace a dependency's saved ranges with an open dirty root view. Saved graph
 * ranges for that document are then deliberately discarded; callers only get
 * the dirty locations that the current semantic owner can re-prove.
 */
export const buildMultiDocumentSemanticOccurrenceIndex = (input: {
  graph: MultiDocumentImportGraph<unknown>;
  documentViews?: readonly MultiDocumentSemanticDocumentView[];
}): MultiDocumentSemanticOccurrenceIndex => {
  const suppliedViews = new Map<DocumentId, MultiDocumentSemanticDocumentView>();
  let valid = input.graph.valid;
  for (const view of input.documentViews ?? []) {
    if (suppliedViews.has(view.source.documentId)) valid = false;
    suppliedViews.set(view.source.documentId, view);
    if (!view.valid) valid = false;
  }

  const sourceByDocument = new Map<DocumentId, MultiDocumentSourceSnapshot>();
  const occurrences = new Map<string, MultiDocumentSemanticOccurrence>();
  for (const [documentId, node] of input.graph.nodes) {
    const supplied = suppliedViews.get(documentId);
    if (documentId === input.graph.rootDocumentId && supplied && !sameSourceOwner(supplied.source, node.artifact.source)) {
      valid = false;
    }
    const activeSource = supplied?.source ?? node.artifact.source;
    sourceByDocument.set(documentId, activeSource);

    if (!supplied || sameSourceOwner(supplied.source, node.artifact.source)) {
      for (const occurrence of graphOccurrencesForNode(input.graph, node)) {
        occurrences.set(occurrenceKey(occurrence), occurrence);
      }
    }
    if (supplied) {
      for (const occurrence of supplied.occurrences) {
        if (occurrence.identity.documentId !== occurrence.identity.documentId) {
          valid = false;
          continue;
        }
        const projected: MultiDocumentSemanticOccurrence = {
          kind: occurrence.kind,
          identity: occurrence.identity,
          location: qualifySourceLocation(sourceIdentityOf(supplied.source), occurrence.range)
        };
        occurrences.set(occurrenceKey(projected), projected);
      }
    }
  }

  for (const [documentId, supplied] of suppliedViews) {
    if (sourceByDocument.has(documentId)) continue;
    valid = false;
    sourceByDocument.set(documentId, supplied.source);
  }

  return {
    graph: input.graph,
    valid,
    sourceByDocument,
    occurrences: [...occurrences.values()].sort((left, right) =>
      String(left.location.source.documentId).localeCompare(String(right.location.source.documentId)) ||
      left.location.range.from - right.location.range.from ||
      left.location.range.to - right.location.range.to ||
      (left.kind === "declaration" ? -1 : 1)
    )
  };
};

const occurrenceAt = (
  index: MultiDocumentSemanticOccurrenceIndex,
  documentId: DocumentId,
  position: number
): MultiDocumentSemanticOccurrence | null => {
  const source = index.sourceByDocument.get(documentId);
  if (!source || position < 0 || position > source.normalizedSource.length) return null;
  const ownerKey = sourceIdentityKey(sourceIdentityOf(source));
  const matches = index.occurrences
    .filter((occurrence) =>
      occurrence.location.source.documentId === documentId &&
      sourceIdentityKey(occurrence.location.source) === ownerKey &&
      occurrence.location.range.from <= position && position <= occurrence.location.range.to
    )
    .sort((left, right) =>
      (left.location.range.to - left.location.range.from) -
      (right.location.range.to - right.location.range.from)
    );
  if (matches.length === 0) return null;
  const shortest = matches[0]!.location.range.to - matches[0]!.location.range.from;
  const shortestMatches = matches.filter((occurrence) =>
    occurrence.location.range.to - occurrence.location.range.from === shortest
  );
  const identities = new Set(shortestMatches.map((occurrence) => identityKey(occurrence.identity)));
  return identities.size === 1 ? shortestMatches[0]! : null;
};

export type MultiDocumentDefinitionResult = {
  identity: DocumentQualifiedSemanticIdentity<string>;
  reference: DocumentQualifiedSourceLocation;
  target: DocumentQualifiedSourceLocation;
};

/** Definition never scans the workspace: the resolved identity points directly at its owner. */
export const queryMultiDocumentDefinition = (input: {
  index: MultiDocumentSemanticOccurrenceIndex;
  documentId: DocumentId;
  position: number;
}): MultiDocumentDefinitionResult | null => {
  if (!input.index.valid) return null;
  const selected = occurrenceAt(input.index, input.documentId, input.position);
  if (!selected || selected.kind !== "reference") return null;
  const declarations = input.index.occurrences.filter((occurrence) =>
    occurrence.kind === "declaration" && sameIdentity(occurrence.identity, selected.identity)
  );
  if (declarations.length !== 1) return null;
  const target = declarations[0]!.location;
  if (
    sourceIdentityKey(target.source) === sourceIdentityKey(selected.location.source) &&
    target.range.from === selected.location.range.from &&
    target.range.to === selected.location.range.to
  ) return null;
  return { identity: selected.identity, reference: selected.location, target };
};

export type MultiDocumentReverseImporterDiscovery =
  | { status: "complete"; indexes: readonly MultiDocumentSemanticOccurrenceIndex[] }
  | { status: "incomplete"; indexes?: readonly MultiDocumentSemanticOccurrenceIndex[] };

const isPublicIdentity = (
  indexes: readonly MultiDocumentSemanticOccurrenceIndex[],
  identity: DocumentQualifiedSemanticIdentity<string>
) => indexes.some((index) => [...index.graph.nodes.values()].some((node) =>
  [...node.publicApi.publicEntriesByName.values()].some((entry) => sameIdentity(entry.identity, identity))
));

const preferredUniverse = (
  indexes: readonly MultiDocumentSemanticOccurrenceIndex[]
): {
  sourceByDocument: ReadonlyMap<DocumentId, MultiDocumentSourceSnapshot>;
  occurrences: readonly MultiDocumentSemanticOccurrence[];
} | null => {
  if (indexes.some((index) => !index.valid)) return null;
  const candidatesByDocument = new Map<DocumentId, MultiDocumentSourceSnapshot[]>();
  for (const index of indexes) {
    for (const [documentId, source] of index.sourceByDocument) {
      const candidates = candidatesByDocument.get(documentId);
      if (candidates) candidates.push(source);
      else candidatesByDocument.set(documentId, [source]);
    }
  }

  const sourceByDocument = new Map<DocumentId, MultiDocumentSourceSnapshot>();
  for (const [documentId, candidates] of candidatesByDocument) {
    const current = candidates.filter((source) => source.kind === "root-current");
    const preferred = current.length > 0 ? current : candidates;
    const keys = new Set(preferred.map(sourceSnapshotKey));
    if (keys.size !== 1) return null;
    sourceByDocument.set(documentId, preferred[0]!);
  }

  const deduped = new Map<string, MultiDocumentSemanticOccurrence>();
  for (const index of indexes) {
    for (const occurrence of index.occurrences) {
      const preferred = sourceByDocument.get(occurrence.location.source.documentId);
      if (!preferred) continue;
      if (sourceIdentityKey(occurrence.location.source) !== sourceIdentityKey(sourceIdentityOf(preferred))) continue;
      deduped.set(occurrenceKey(occurrence), occurrence);
    }
  }
  return { sourceByDocument, occurrences: [...deduped.values()] };
};

const queryIndexesFor = (
  root: MultiDocumentSemanticOccurrenceIndex,
  identity: DocumentQualifiedSemanticIdentity<string>,
  discovery: MultiDocumentReverseImporterDiscovery | undefined
): readonly MultiDocumentSemanticOccurrenceIndex[] | null => {
  if (!root.valid) return null;
  if (!isPublicIdentity([root], identity)) return [root];
  if (!discovery || discovery.status !== "complete") return null;
  return [root, ...discovery.indexes];
};

export type MultiDocumentReferencesResult = {
  identity: DocumentQualifiedSemanticIdentity<string>;
  declaration: DocumentQualifiedSourceLocation;
  references: readonly DocumentQualifiedSourceLocation[];
};

/**
 * References consumes only a host-supplied, semantically analyzed reverse
 * discovery universe. Incomplete discovery fails closed; no text search exists.
 */
export const queryMultiDocumentReferences = (input: {
  index: MultiDocumentSemanticOccurrenceIndex;
  documentId: DocumentId;
  position: number;
  reverseImporters?: MultiDocumentReverseImporterDiscovery;
}): MultiDocumentReferencesResult | null => {
  const selected = occurrenceAt(input.index, input.documentId, input.position);
  if (!selected) return null;
  const indexes = queryIndexesFor(input.index, selected.identity, input.reverseImporters);
  if (!indexes) return null;
  const universe = preferredUniverse(indexes);
  if (!universe) return null;
  const matches = universe.occurrences.filter((occurrence) => sameIdentity(occurrence.identity, selected.identity));
  const declarations = matches.filter((occurrence) => occurrence.kind === "declaration");
  if (declarations.length !== 1) return null;
  const references = matches
    .filter((occurrence) => occurrence.kind === "reference")
    .map((occurrence) => occurrence.location)
    .sort((left, right) =>
      String(left.source.documentId).localeCompare(String(right.source.documentId)) ||
      left.range.from - right.range.from || left.range.to - right.range.to
    );
  return {
    identity: selected.identity,
    declaration: declarations[0]!.location,
    references
  };
};

export type MultiDocumentRenameEdit = {
  from: number;
  to: number;
  expectedText: string;
  newText: string;
};

export type MultiDocumentRenameDocumentProofResult =
  | { status: "ok"; edits: readonly MultiDocumentRenameEdit[] }
  | { status: "rejected"; reason?: string };

export type MultiDocumentRenameDocumentProof = (input: {
  source: MultiDocumentSourceSnapshot;
  identity: DocumentQualifiedSemanticIdentity<string>;
  occurrences: readonly MultiDocumentSemanticOccurrence[];
  newName: string;
}) => MultiDocumentRenameDocumentProofResult;

export type MultiDocumentRenameDocumentPlan = {
  source: DocumentSourceIdentity;
  edits: readonly MultiDocumentRenameEdit[];
};

export type MultiDocumentRenamePlan = {
  identity: DocumentQualifiedSemanticIdentity<string>;
  documents: readonly MultiDocumentRenameDocumentPlan[];
};

export type MultiDocumentRenamePlanResult =
  | { status: "ok"; plan: MultiDocumentRenamePlan }
  | {
      status: "rejected";
      reason: "unavailable" | "incomplete-discovery" | "stale-or-invalid" | "unsafe-edit-proof";
    };

const editsSafelyCoverOccurrences = (
  source: string,
  edits: readonly MultiDocumentRenameEdit[],
  occurrences: readonly MultiDocumentSemanticOccurrence[]
) => {
  const ordered = [...edits].sort((left, right) => left.from - right.from || left.to - right.to);
  for (const [index, edit] of ordered.entries()) {
    if (
      !Number.isInteger(edit.from) || !Number.isInteger(edit.to) ||
      edit.from < 0 || edit.to <= edit.from || edit.to > source.length ||
      source.slice(edit.from, edit.to) !== edit.expectedText
    ) return false;
    if (index > 0 && edit.from < ordered[index - 1]!.to) return false;
    if (!occurrences.some((occurrence) =>
      edit.from <= occurrence.location.range.from && edit.to >= occurrence.location.range.to
    )) return false;
  }
  return occurrences.every((occurrence) => ordered.some((edit) =>
    edit.from <= occurrence.location.range.from && edit.to >= occurrence.location.range.to
  ));
};

/**
 * Group a rename by exact source owner and require every document-specific
 * semantic owner to prove its complete edit set. One rejection rejects the
 * whole plan; the core never falls back to blind replacement.
 */
export const planMultiDocumentRename = (input: {
  index: MultiDocumentSemanticOccurrenceIndex;
  documentId: DocumentId;
  position: number;
  newName: string;
  proveDocument: MultiDocumentRenameDocumentProof;
  reverseImporters?: MultiDocumentReverseImporterDiscovery;
}): MultiDocumentRenamePlanResult => {
  if (!input.index.valid) return { status: "rejected", reason: "stale-or-invalid" };
  const selected = occurrenceAt(input.index, input.documentId, input.position);
  if (!selected) return { status: "rejected", reason: "unavailable" };
  const publicTarget = isPublicIdentity([input.index], selected.identity);
  if (publicTarget && (!input.reverseImporters || input.reverseImporters.status !== "complete")) {
    return { status: "rejected", reason: "incomplete-discovery" };
  }
  const indexes = publicTarget
    ? [input.index, ...(input.reverseImporters as Extract<MultiDocumentReverseImporterDiscovery, { status: "complete" }>).indexes]
    : [input.index];
  const universe = preferredUniverse(indexes);
  if (!universe) return { status: "rejected", reason: "stale-or-invalid" };

  const matches = universe.occurrences.filter((occurrence) => sameIdentity(occurrence.identity, selected.identity));
  if (matches.length === 0 || !matches.some((occurrence) => occurrence.kind === "declaration")) {
    return { status: "rejected", reason: "unavailable" };
  }
  const byDocument = new Map<DocumentId, MultiDocumentSemanticOccurrence[]>();
  for (const occurrence of matches) {
    const documentId = occurrence.location.source.documentId;
    const occurrences = byDocument.get(documentId);
    if (occurrences) occurrences.push(occurrence);
    else byDocument.set(documentId, [occurrence]);
  }

  const documents: MultiDocumentRenameDocumentPlan[] = [];
  for (const [documentId, occurrences] of byDocument) {
    const source = universe.sourceByDocument.get(documentId);
    if (!source || source.normalizedSource.includes("\r")) {
      return { status: "rejected", reason: "stale-or-invalid" };
    }
    const proof = input.proveDocument({
      source,
      identity: selected.identity,
      occurrences,
      newName: input.newName
    });
    if (proof.status !== "ok" || !editsSafelyCoverOccurrences(source.normalizedSource, proof.edits, occurrences)) {
      return { status: "rejected", reason: "unsafe-edit-proof" };
    }
    documents.push({
      source: sourceIdentityOf(source),
      edits: [...proof.edits].sort((left, right) => left.from - right.from || left.to - right.to)
    });
  }

  documents.sort((left, right) => String(left.source.documentId).localeCompare(String(right.source.documentId)));
  return {
    status: "ok",
    plan: { identity: selected.identity, documents }
  };
};
