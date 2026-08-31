import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  dslSemanticIdentityKey,
  type DslSemanticIdentity,
  type DslSemanticOccurrenceIndex
} from "../dsl/dslSemanticOccurrenceIndex";
import { moduleSemanticIdentityKey, type ModuleDefinitionSemantic } from "../dsl/moduleSemanticTypes";
import type { ModuleSemanticTarget } from "../dsl/moduleSemanticEditor";
import {
  analyzeModuleSemanticRename,
  type ModuleRenameAnalysis
} from "./moduleSemanticRenameAnalysis";
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  projectDslSemanticDocumentView,
  type DslSemanticIdentityResolver,
  type MultiDocumentRenameDocumentProof,
  type MultiDocumentSemanticDocumentView,
  type MultiDocumentSemanticOccurrence
} from "./multiDocumentLanguageQueries";
import type { MultiDocumentModuleSemanticAnalysis } from "./multiDocumentModuleSemantics";
import type { MultiDocumentImportGraph } from "./multiDocumentImportGraph";
import {
  sourceIdentityOf,
  qualifySemanticIdentity,
  type DocumentId,
  type DocumentQualifiedSemanticIdentity,
  type MultiDocumentSourceSnapshot
} from "./multiDocumentPrimitives";

const sameIdentity = (
  left: DocumentQualifiedSemanticIdentity<string>,
  right: DocumentQualifiedSemanticIdentity<string>
) => left.documentId === right.documentId && left.localIdentity === right.localIdentity;

const sameSourceIdentity = (
  left: ReturnType<typeof sourceIdentityOf>,
  right: ReturnType<typeof sourceIdentityOf>
) => {
  if (left.kind !== right.kind || left.documentId !== right.documentId) return false;
  return left.kind === "root-current"
    ? right.kind === "root-current" && left.sourceRevision === right.sourceRevision
    : right.kind === "dependency-saved" && left.savedSourceFingerprint === right.savedSourceFingerprint;
};

const sameSourceSnapshot = (
  left: MultiDocumentSourceSnapshot,
  right: MultiDocumentSourceSnapshot
) => sameSourceIdentity(sourceIdentityOf(left), sourceIdentityOf(right)) &&
  left.normalizedSource === right.normalizedSource;

const moduleIdentityForDefinition = (
  definition: ModuleDefinitionSemantic,
  compiled: CompiledDslDocument
): DocumentQualifiedSemanticIdentity<string> | null => {
  const identity = definition.identity;
  if (!identity || identity.documentId !== definition.documentId || identity.localIdentity !== definition.statementId) return null;
  const context = compiled.moduleRuntimeContext;
  if (context && context.definitionFor(identity) !== definition) return null;
  return identity;
};

const candidateIdentityForCallee = (
  compiled: CompiledDslDocument,
  callee: NonNullable<NonNullable<CompiledDslDocument["moduleSemanticAnalysis"]>["instances"][number]["callee"]>
): DocumentQualifiedSemanticIdentity<string> | null => {
  const identity = callee.definitionIdentity;
  const definition = callee.definition;
  if (!identity || !definition || !definition.identity || identity.localIdentity !== definition.statementId || identity.documentId !== definition.documentId) return null;
  if (moduleSemanticIdentityKey(identity) !== moduleSemanticIdentityKey(definition.identity)) return null;
  const context = compiled.moduleRuntimeContext;
  if (context && context.definitionFor(identity) !== definition) return null;
  return identity;
};

const resolvedModuleIdentity = (
  compiled: CompiledDslDocument,
  target: ModuleSemanticTarget
): DocumentQualifiedSemanticIdentity<string> | null => {
  if (target.kind !== "moduleDefinition") return null;
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis || compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
      analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
      (compiled.moduleRuntimeContext && !compiled.moduleRuntimeContext.valid)) return null;

  const candidates = new Map<string, DocumentQualifiedSemanticIdentity<string>>();
  let inconsistent = false;
  const localDefinition = analysis.definitionsByStatementId.get(target.statementId);
  if (localDefinition) {
    const identity = moduleIdentityForDefinition(localDefinition, compiled);
    if (identity) candidates.set(moduleSemanticIdentityKey(identity), identity);
    else inconsistent = true;
  }

  for (const instance of analysis.instances) {
    if (instance.calleeResolution !== "resolved" || instance.callee?.definitionStatementId !== target.statementId) continue;
    const callee = instance.callee;
    const calleeIdentity = callee?.definitionIdentity;
    const identity = calleeIdentity && calleeIdentity.documentId === analysis.documentId && localDefinition?.identity
      ? sameIdentity(calleeIdentity, localDefinition.identity) ? localDefinition.identity : null
      : callee ? candidateIdentityForCallee(compiled, callee) : null;
    if (!identity) {
      inconsistent = true;
      continue;
    }
    candidates.set(moduleSemanticIdentityKey(identity), identity);
  }

  if (inconsistent || candidates.size !== 1) return null;
  return [...candidates.values()][0] ?? null;
};

/**
 * Projects the existing single-document Module target into the exact
 * document-qualified definition identity already produced by graph-backed
 * Module semantics. Every other DSL family keeps the normal caller-provided
 * projection; unresolved or contradictory Module ownership is omitted.
 */
export const createMultiDocumentModuleIdentityResolver = (
  compiled: CompiledDslDocument
): DslSemanticIdentityResolver => {
  const documentId = compiled.moduleSemanticAnalysis?.documentId ?? compiled.sourceSemanticAnalysis?.documentId;
  const defaultIdentity = (identity: DslSemanticIdentity) => documentId
    ? qualifySemanticIdentity(documentId, dslSemanticIdentityKey(identity))
    : null;
  return (identity: DslSemanticIdentity) => {
    if (identity.kind !== "module" || identity.target.kind !== "moduleDefinition") return defaultIdentity(identity);
    return resolvedModuleIdentity(compiled, identity.target);
  };
};

/** Build an exact Module-aware semantic document view for generic queries. */
export const projectMultiDocumentModuleSemanticDocumentView = (input: {
  source: MultiDocumentSourceSnapshot;
  compiled: CompiledDslDocument;
  occurrenceIndex?: DslSemanticOccurrenceIndex;
  valid?: boolean;
}): MultiDocumentSemanticDocumentView => projectDslSemanticDocumentView({
  ...input,
  identityFor: createMultiDocumentModuleIdentityResolver(input.compiled)
});

const compiledSourceIsExact = (
  source: MultiDocumentSourceSnapshot,
  compiled: CompiledDslDocument
) => {
  const analysis = compiled.moduleSemanticAnalysis;
  if (!analysis || analysis.documentId !== source.documentId) return false;
  if (!analysis.source || !sameSourceIdentity(analysis.source, sourceIdentityOf(source))) return false;
  if (compiled.moduleRuntimeContext && !compiled.moduleRuntimeContext.valid) return false;
  if (compiled.spans.sourceMap.source !== source.normalizedSource) return false;
  if (source.kind === "root-current" && compiled.spans.sourceMap.sourceRevision !== source.sourceRevision) return false;
  if (compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") || analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")) return false;
  return true;
};

const definitionForIdentity = (
  analysis: MultiDocumentModuleSemanticAnalysis | undefined,
  identity: DocumentQualifiedSemanticIdentity<string>
) => {
  const documentAnalysis = analysis?.analysesByDocument.get(identity.documentId);
  const definition = documentAnalysis?.definitionsByStatementId.get(identity.localIdentity);
  return definition && definition.identity && sameIdentity(definition.identity, identity) ? definition : null;
};

const compiledAnalysisFor = (
  compiled: CompiledDslDocument | undefined,
  documentId: DocumentId
) => compiled?.moduleRuntimeContext?.analysisFor(documentId) ?? (
  compiled?.moduleSemanticAnalysis?.documentId === documentId ? compiled.moduleSemanticAnalysis : undefined
);

const sameDefinitionOwnership = (
  left: ModuleDefinitionSemantic,
  right: ModuleDefinitionSemantic
) => left.statementId === right.statementId &&
  left.statementIndex === right.statementIndex &&
  left.name === right.name &&
  !!left.identity && !!right.identity &&
  sameIdentity(left.identity, right.identity);

const exactOccurrence = (
  left: MultiDocumentSemanticOccurrence,
  right: MultiDocumentSemanticOccurrence
) => left.kind === right.kind &&
  sameIdentity(left.identity, right.identity) &&
  sameSourceIdentity(left.location.source, right.location.source) &&
  left.location.range.from === right.location.range.from &&
  left.location.range.to === right.location.range.to;

const editsExactlyCover = (
  source: MultiDocumentSourceSnapshot,
  edits: readonly { from: number; to: number; expectedText: string; newText: string }[],
  occurrences: readonly MultiDocumentSemanticOccurrence[],
  identity: DocumentQualifiedSemanticIdentity<string>
) => {
  if (edits.length !== occurrences.length) return false;
  if (occurrences.some((occurrence) =>
    !sameIdentity(occurrence.identity, identity) ||
    occurrence.location.source.documentId !== source.documentId ||
    !sameSourceIdentity(occurrence.location.source, sourceIdentityOf(source))
  )) return false;
  const occurrenceKeys = new Set(occurrences.map((occurrence) =>
    `${occurrence.location.range.from}:${occurrence.location.range.to}`
  ));
  if (occurrenceKeys.size !== occurrences.length) return false;
  const editKeys = new Set<string>();
  for (const edit of edits) {
    const key = `${edit.from}:${edit.to}`;
    if (
      editKeys.has(key) || !occurrenceKeys.has(key) ||
      !Number.isInteger(edit.from) || !Number.isInteger(edit.to) ||
      edit.from < 0 || edit.to <= edit.from || edit.to > source.normalizedSource.length ||
      source.normalizedSource.slice(edit.from, edit.to) !== edit.expectedText
    ) return false;
    editKeys.add(key);
  }
  return editKeys.size === occurrenceKeys.size;
};

const physicalRenameEdits = (analysis: Extract<ModuleRenameAnalysis, { verdict: "ok" }>) => {
  const edits = [] as { from: number; to: number; expectedText: string; newText: string }[];
  for (const entry of analysis.entries) {
    const segments = entry.physicalSpan?.segments;
    if (!segments || segments.length !== 1) return null;
    const segment = segments[0]!;
    edits.push({ from: segment.from, to: segment.to, expectedText: entry.oldName, newText: entry.newName });
  }
  return edits;
};

const graphReExportOccurrence = (
  graphIndexes: readonly ReturnType<typeof buildMultiDocumentSemanticOccurrenceIndex>[],
  source: MultiDocumentSourceSnapshot,
  occurrence: MultiDocumentSemanticOccurrence
) => graphIndexes.some((graphIndex) => graphIndex.valid && graphIndex.occurrences.some((candidate) =>
  candidate.kind === "reference" && exactOccurrence(candidate, occurrence) &&
  graphIndex.sourceByDocument.get(source.documentId) !== undefined &&
  sameSourceSnapshot(graphIndex.sourceByDocument.get(source.documentId)!, source)
));

export type MultiDocumentModuleRenameProofInput = {
  graph: MultiDocumentImportGraph;
  analysis: MultiDocumentModuleSemanticAnalysis;
  /** Optional alternate root graphs that own exact saved/re-export snapshots. */
  graphs?: readonly MultiDocumentImportGraph[];
  /** Compiled source-semantic owner for every document that may be planned. */
  compiledByDocument: ReadonlyMap<DocumentId, CompiledDslDocument>;
};

/**
 * Adapts exact Module source semantics to the generic all-or-nothing rename
 * planner. The defining document delegates all safety decisions to
 * analyzeModuleSemanticRename. Other documents may contribute only compiled
 * Module reference occurrences or graph-owned re-export member occurrences.
 */
export const createMultiDocumentModuleRenameDocumentProof = (
  input: MultiDocumentModuleRenameProofInput
): MultiDocumentRenameDocumentProof => {
  const graphIndexes = [input.graph, ...(input.graphs ?? [])].map((graph) =>
    buildMultiDocumentSemanticOccurrenceIndex({ graph })
  );

  return ({ source, identity, occurrences, newName }) => {
    if (!input.graph.valid || !input.analysis.valid || input.analysis.graph !== input.graph || source.normalizedSource.includes("\r")) {
      return { status: "rejected", reason: "graph or Module semantics are not valid" };
    }
    const globalDefinition = definitionForIdentity(input.analysis, identity);
    if (!globalDefinition) return { status: "rejected", reason: "Module definition identity is not owned by the graph" };
    const compiled = input.compiledByDocument.get(source.documentId);
    const compiledAnalysis = compiledAnalysisFor(compiled, source.documentId);

    if (source.documentId === identity.documentId) {
      if (!compiled || !compiledSourceIsExact(source, compiled)) {
        return { status: "rejected", reason: "defining Module source is stale or unavailable" };
      }
      const compiledDefinition = compiled.moduleSemanticAnalysis?.definitionsByStatementId.get(identity.localIdentity);
      if (!compiledDefinition || !sameDefinitionOwnership(compiledDefinition, globalDefinition)) {
        return { status: "rejected", reason: "defining Module identity does not match compiled ownership" };
      }
      const result = analyzeModuleSemanticRename(source.normalizedSource, compiled, {
        kind: "moduleDefinition",
        statementId: identity.localIdentity
      }, newName);
      if (result.verdict !== "ok") return { status: "rejected", reason: result.reason };
      const edits = physicalRenameEdits(result);
      if (!edits || !editsExactlyCover(source, edits, occurrences, identity)) {
        return { status: "rejected", reason: "Module rename edits do not exactly cover semantic occurrences" };
      }
      return { status: "ok", edits };
    }

    const view = compiled && compiledAnalysis && compiledSourceIsExact(source, compiled)
      ? projectMultiDocumentModuleSemanticDocumentView({ source, compiled })
      : null;
    if (view && !view.valid) return { status: "rejected", reason: "importer Module semantic view is stale or invalid" };

    const edits: { from: number; to: number; expectedText: string; newText: string }[] = [];
    for (const occurrence of occurrences) {
      if (
        !Number.isInteger(occurrence.location.range.from) ||
        !Number.isInteger(occurrence.location.range.to) ||
        occurrence.location.range.from < 0 ||
        occurrence.location.range.to <= occurrence.location.range.from ||
        occurrence.location.range.to > source.normalizedSource.length
      ) return { status: "rejected", reason: "occurrence range is outside the exact source" };
      const sourceText = source.normalizedSource.slice(occurrence.location.range.from, occurrence.location.range.to);
      if (sourceText !== globalDefinition.name || occurrence.kind !== "reference") {
        return { status: "rejected", reason: "occurrence is not an exact public Module member reference" };
      }
      const provedByView = view?.occurrences.some((candidate) =>
        candidate.kind === "reference" &&
        candidate.identity.documentId === identity.documentId &&
        candidate.identity.localIdentity === identity.localIdentity &&
        candidate.range.from === occurrence.location.range.from &&
        candidate.range.to === occurrence.location.range.to
      ) ?? false;
      const provedByGraph = graphReExportOccurrence(graphIndexes, source, occurrence);
      if (!provedByView && !provedByGraph) {
        return { status: "rejected", reason: "Module occurrence was not proven by semantic view or graph re-export owner" };
      }
      edits.push({
        from: occurrence.location.range.from,
        to: occurrence.location.range.to,
        expectedText: sourceText,
        newText: newName
      });
    }
    if (!editsExactlyCover(source, edits, occurrences, identity)) {
      return { status: "rejected", reason: "Module reference edits do not exactly cover semantic occurrences" };
    }
    return { status: "ok", edits };
  };
};
