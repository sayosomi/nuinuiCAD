import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
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
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor,
  type MultiDocumentModuleSemanticAnalysis
} from "./multiDocumentModuleSemantics";
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  projectDslSemanticDocumentView,
  type DslSemanticIdentityResolver,
  type MultiDocumentRenameDocumentProof,
  type MultiDocumentSemanticDocumentView,
  type MultiDocumentSemanticOccurrence
} from "./multiDocumentLanguageQueries";
import {
  analyzeMultiDocumentSource,
  type MultiDocumentGraphNode,
  type MultiDocumentImportEdge,
  type MultiDocumentImportGraph
} from "./multiDocumentImportGraph";
import {
  buildMultiDocumentPublicApiCatalog,
  resolveMultiDocumentPublicApiMember,
  type MultiDocumentPublicApiCatalog
} from "./multiDocumentPublicApi";
import { createModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import {
  sourceIdentityOf,
  qualifySemanticIdentity,
  type DocumentId,
  type DocumentQualifiedSemanticIdentity,
  type MultiDocumentSourceSnapshot,
  type RootCurrentSourceSnapshot
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

type CandidatePublicApiCatalogs = ReadonlyMap<DocumentId, MultiDocumentPublicApiCatalog<unknown>>;

const modulePublicEntryForIdentity = (
  catalog: MultiDocumentPublicApiCatalog<unknown>,
  identity: DocumentQualifiedSemanticIdentity<string>
) => [...catalog.publicEntriesByName.values()].find((entry) =>
  entry.family === "module" && sameIdentity(entry.identity, identity)
);

/**
 * Projects one candidate public name through the existing graph topology.
 * Current public entries decide which re-export descriptors are renamed;
 * candidate catalogs then resolve those descriptors dependency-first.
 */
const candidatePublicApiCatalogsForGraph = (
  graph: MultiDocumentImportGraph,
  identity: DocumentQualifiedSemanticIdentity<string>,
  newName: string
): CandidatePublicApiCatalogs | null => {
  if (!graph.valid) return null;
  const catalogs = new Map<DocumentId, MultiDocumentPublicApiCatalog<unknown>>();
  const visiting = new Set<DocumentId>();

  const build = (documentId: DocumentId): MultiDocumentPublicApiCatalog<unknown> | null => {
    const existing = catalogs.get(documentId);
    if (existing) return existing;
    if (visiting.has(documentId)) return null;
    const node = graph.nodes.get(documentId);
    if (!node || !node.valid || !node.publicApi.valid) return null;
    visiting.add(documentId);

    for (const edge of node.imports) {
      if (edge.status !== "resolved" || !edge.targetDocumentId || !build(edge.targetDocumentId)) {
        visiting.delete(documentId);
        return null;
      }
    }

    const declarations = node.artifact.declarations.map((declaration) =>
      declaration.family === "module" && sameIdentity(declaration.identity, identity)
        ? { ...declaration, name: newName }
        : declaration
    );
    const reExports = node.artifact.reExports.map((reExport) => {
      const edge = node.imports.find((candidate) =>
        candidate.alias === reExport.importAlias && candidate.status === "resolved"
      );
      const targetNode = edge?.targetDocumentId ? graph.nodes.get(edge.targetDocumentId) : undefined;
      const targetCatalog = targetNode?.publicApi;
      const lookup = targetCatalog
        ? resolveMultiDocumentPublicApiMember(targetCatalog, reExport.exportedName)
        : { kind: "missing" as const };
      return lookup.kind === "public" && lookup.entry.family === "module" && sameIdentity(lookup.entry.identity, identity)
        ? { ...reExport, exportedName: newName }
        : reExport;
    });
    const catalog = buildMultiDocumentPublicApiCatalog({
      documentId,
      declarations,
      reExports,
      resolveImportCatalog: (alias) => {
        const edge = node.imports.find((candidate) =>
          candidate.alias === alias && candidate.status === "resolved"
        );
        return edge?.targetDocumentId ? catalogs.get(edge.targetDocumentId) ?? null : null;
      }
    });
    visiting.delete(documentId);
    catalogs.set(documentId, catalog);
    return catalog;
  };

  for (const documentId of graph.nodes.keys()) {
    if (!build(documentId)) return null;
  }
  if (catalogs.size !== graph.nodes.size || [...catalogs.values()].some((catalog) => !catalog.valid)) return null;

  for (const [documentId, node] of graph.nodes) {
    const currentEntry = modulePublicEntryForIdentity(node.publicApi, identity);
    if (!currentEntry) continue;
    const candidateCatalog = catalogs.get(documentId);
    const candidateEntry = candidateCatalog
      ? resolveMultiDocumentPublicApiMember(candidateCatalog, newName)
      : { kind: "missing" as const };
    if (
      candidateEntry.kind !== "public" ||
      candidateEntry.entry.family !== "module" ||
      !sameIdentity(candidateEntry.entry.identity, identity)
    ) return null;
  }
  return catalogs;
};

const candidatePublicApiExposesForDocument = (
  graph: MultiDocumentImportGraph,
  catalogs: CandidatePublicApiCatalogs,
  documentId: DocumentId,
  identity: DocumentQualifiedSemanticIdentity<string>,
  newName: string
) => {
  const node = graph.nodes.get(documentId);
  const candidateCatalog = catalogs.get(documentId);
  if (!node || !candidateCatalog || !modulePublicEntryForIdentity(node.publicApi, identity)) return false;
  const candidateEntry = resolveMultiDocumentPublicApiMember(candidateCatalog, newName);
  return candidateEntry.kind === "public" && candidateEntry.entry.family === "module" &&
    sameIdentity(candidateEntry.entry.identity, identity);
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

type ModuleRenameGraphEvidence = {
  graph: MultiDocumentImportGraph;
  index: ReturnType<typeof buildMultiDocumentSemanticOccurrenceIndex>;
  candidateCatalogs: CandidatePublicApiCatalogs | null;
};

const graphReExportOccurrence = (
  graphEvidence: readonly ModuleRenameGraphEvidence[],
  source: MultiDocumentSourceSnapshot,
  occurrence: MultiDocumentSemanticOccurrence,
  identity: DocumentQualifiedSemanticIdentity<string>,
  newName: string
) => graphEvidence.some(({ graph, index, candidateCatalogs }) => {
  const graphSource = index.sourceByDocument.get(source.documentId);
  return index.valid && candidateCatalogs &&
    candidatePublicApiExposesForDocument(graph, candidateCatalogs, source.documentId, identity, newName) &&
    graphSource !== undefined && sameSourceSnapshot(graphSource, source) &&
    index.occurrences.some((candidate) =>
      candidate.kind === "reference" && exactOccurrence(candidate, occurrence)
    );
});

export type MultiDocumentModuleRenameProofInput = {
  graph: MultiDocumentImportGraph;
  analysis: MultiDocumentModuleSemanticAnalysis;
  /** Optional alternate root graphs that own exact saved/re-export snapshots. */
  graphs?: readonly MultiDocumentImportGraph[];
  /** Compiled source-semantic owner for every document that may be planned. */
  compiledByDocument: ReadonlyMap<DocumentId, CompiledDslDocument>;
};

const sameStatementIdMap = (
  left: ReadonlyMap<number, string>,
  right: ReadonlyMap<number, string>
) => left.size === right.size && [...left].every(([statementIndex, statementId]) => right.get(statementIndex) === statementId);

const candidateGraphForRename = (input: {
  graph: MultiDocumentImportGraph;
  source: MultiDocumentSourceSnapshot;
  compiled: CompiledDslDocument;
  identity: DocumentQualifiedSemanticIdentity<string>;
  newName: string;
  editedSource: string;
}): { graph: MultiDocumentImportGraph; rootNode: MultiDocumentGraphNode } | null => {
  const currentIds = input.compiled.statementMap?.statementIdByStatementIndex;
  const currentNode = input.graph.nodes.get(input.identity.documentId);
  if (!currentIds || !currentNode || !currentNode.valid || input.compiled.statements.length === 0) return null;
  const currentRevision = input.compiled.spans.sourceMap.sourceRevision;
  if (!Number.isSafeInteger(currentRevision) || currentRevision >= Number.MAX_SAFE_INTEGER) return null;
  const candidateSource: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: input.identity.documentId,
    normalizedSource: input.editedSource,
    sourceRevision: currentRevision + 1
  };
  const candidateArtifact = analyzeMultiDocumentSource(candidateSource, {
    declarationContributors: [moduleDeclarationContributor],
    statementIdByStatementIndex: currentIds
  });
  if (
    !candidateArtifact.syntaxValid ||
    candidateArtifact.parsed.statements.length !== input.compiled.statements.length ||
    !sameStatementIdMap(currentIds, candidateArtifact.statementIdByStatementIndex)
  ) return null;

  const candidateImports: MultiDocumentImportEdge[] = [];
  const usedEdges = new Set<MultiDocumentImportEdge>();
  for (const directive of candidateArtifact.imports) {
    const matches = currentNode.imports.filter((edge) =>
      !usedEdges.has(edge) &&
      sameIdentity(edge.importIdentity, directive.identity) &&
      edge.importPath === directive.importPath &&
      edge.alias === directive.alias
    );
    if (matches.length !== 1) return null;
    const edge = matches[0]!;
    if (edge.status !== "resolved" || !edge.targetDocumentId) return null;
    usedEdges.add(edge);
    candidateImports.push({
      ...edge,
      importerDocumentId: candidateSource.documentId,
      importIdentity: directive.identity,
      importLocation: directive.location,
      alias: directive.alias,
      aliasLocation: directive.aliasLocation
    });
  }
  if (candidateImports.length !== currentNode.imports.length) return null;

  const reachableDocumentIds = new Set<DocumentId>();
  const collectDependencies = (documentId: DocumentId): boolean => {
    if (reachableDocumentIds.has(documentId)) return true;
    const node = input.graph.nodes.get(documentId);
    if (!node || !node.valid) return false;
    reachableDocumentIds.add(documentId);
    for (const edge of node.imports) {
      if (edge.status !== "resolved" || !edge.targetDocumentId || !collectDependencies(edge.targetDocumentId)) return false;
    }
    return true;
  };
  if (!collectDependencies(input.identity.documentId)) return null;

  const currentEdges = input.graph.edges.filter((edge) => edge.importerDocumentId === input.identity.documentId);
  if (currentEdges.length !== candidateImports.length) return null;
  const candidateEdgeByIdentity = new Map(candidateImports.map((edge) => [edge.importIdentity.localIdentity, edge]));
  const candidateEdges: MultiDocumentImportEdge[] = [];
  for (const edge of input.graph.edges) {
    if (edge.importerDocumentId !== input.identity.documentId) {
      candidateEdges.push(edge);
      continue;
    }
    const candidateEdge = candidateEdgeByIdentity.get(edge.importIdentity.localIdentity);
    if (!candidateEdge) return null;
    candidateEdges.push(candidateEdge);
  }

  const candidateNodes = new Map<DocumentId, MultiDocumentGraphNode>();
  for (const [documentId, node] of input.graph.nodes) {
    if (reachableDocumentIds.has(documentId)) candidateNodes.set(documentId, node);
  }
  const candidateRootNode: MultiDocumentGraphNode = {
    ...currentNode,
    artifact: candidateArtifact,
    imports: candidateImports,
    publicApi: currentNode.publicApi,
    publicApiDiagnostics: currentNode.publicApiDiagnostics,
    sourceDiagnostics: [
      ...candidateArtifact.parsed.diagnostics,
      ...candidateArtifact.sourceLexicalNamespace.diagnostics
    ],
    valid: candidateArtifact.syntaxValid
  };
  candidateNodes.set(input.identity.documentId, candidateRootNode);
  const provisionalGraph: MultiDocumentImportGraph = {
    ...input.graph,
    rootDocumentId: input.identity.documentId,
    rootSource: candidateSource,
    nodes: candidateNodes,
    edges: candidateEdges.filter((edge) => reachableDocumentIds.has(edge.importerDocumentId)),
    valid: input.graph.valid && candidateRootNode.valid
  };
  const candidateCatalogs = candidatePublicApiCatalogsForGraph(provisionalGraph, input.identity, input.newName);
  if (!candidateCatalogs) return null;
  const finalizedNodes = new Map<DocumentId, MultiDocumentGraphNode>();
  for (const [documentId, node] of candidateNodes) {
    const publicApi = candidateCatalogs.get(documentId);
    if (!publicApi) return null;
    finalizedNodes.set(documentId, {
      ...node,
      publicApi,
      publicApiDiagnostics: publicApi.diagnostics,
      valid: node.valid && publicApi.valid
    });
  }
  const candidateGraph: MultiDocumentImportGraph = {
    ...provisionalGraph,
    nodes: finalizedNodes,
    valid: provisionalGraph.valid && [...finalizedNodes.values()].every((node) => node.valid)
  };
  return { graph: candidateGraph, rootNode: finalizedNodes.get(input.identity.documentId)! };
};

const graphAwareCandidateCompile = (input: {
  graph: MultiDocumentImportGraph;
  source: MultiDocumentSourceSnapshot;
  identity: DocumentQualifiedSemanticIdentity<string>;
  newName: string;
  editedSource: string;
  compiled: CompiledDslDocument;
}): CompiledDslDocument | null => {
  const compiledGraph = input.compiled.moduleRuntimeContext?.graph;
  if (!compiledGraph || compiledGraph.rootDocumentId !== input.identity.documentId) return null;
  const candidate = candidateGraphForRename({ ...input, graph: compiledGraph });
  if (!candidate) return null;
  const candidateAnalysis = analyzeMultiDocumentModuleSemantics(candidate.graph);
  if (!candidateAnalysis.valid || !candidateAnalysis.analysesByDocument.has(input.identity.documentId)) return null;
  const candidateContext = createModuleRuntimeContext(candidate.graph, candidateAnalysis);
  if (!candidateContext.valid) return null;
  const candidateCompiled = compileDslDocument(input.editedSource, {
    preparsed: candidate.rootNode.artifact.parsed,
    sourceRevision: candidate.graph.rootSource.sourceRevision,
    assignedStatementIds: candidate.rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: candidateContext
  });
  return candidateCompiled;
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
  return ({ source, identity, occurrences, newName }) => {
    if (!input.graph.valid || !input.analysis.valid || input.analysis.graph !== input.graph || source.normalizedSource.includes("\r")) {
      return { status: "rejected", reason: "graph or Module semantics are not valid" };
    }
    const globalDefinition = definitionForIdentity(input.analysis, identity);
    if (!globalDefinition) return { status: "rejected", reason: "Module definition identity is not owned by the graph" };
    const compiled = input.compiledByDocument.get(source.documentId);
    const compiledAnalysis = compiledAnalysisFor(compiled, source.documentId);
    const graphEvidence: ModuleRenameGraphEvidence[] = [input.graph, ...(input.graphs ?? [])].map((graph) => ({
      graph,
      index: buildMultiDocumentSemanticOccurrenceIndex({ graph }),
      candidateCatalogs: candidatePublicApiCatalogsForGraph(graph, identity, newName)
    }));

    if (source.documentId === identity.documentId) {
      if (!compiled || !compiledSourceIsExact(source, compiled)) {
        return { status: "rejected", reason: "defining Module source is stale or unavailable" };
      }
      const compiledDefinition = compiledAnalysis?.definitionsByStatementId.get(identity.localIdentity);
      if (!compiledDefinition || !sameDefinitionOwnership(compiledDefinition, globalDefinition)) {
        return { status: "rejected", reason: "defining Module identity does not match compiled ownership" };
      }
      if (!candidatePublicApiCatalogsForGraph(input.graph, identity, newName)) {
        return { status: "rejected", reason: "candidate Module public API is invalid or ambiguous" };
      }
      const result = analyzeModuleSemanticRename(source.normalizedSource, compiled, {
        kind: "moduleDefinition",
        statementId: identity.localIdentity
      }, newName, {
        compileCandidate: (editedSource, before) => graphAwareCandidateCompile({
          graph: input.graph,
          source,
          identity,
          newName,
          editedSource,
          compiled: before
        })
      });
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
      const provedByGraph = graphReExportOccurrence(graphEvidence, source, occurrence, identity, newName);
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
