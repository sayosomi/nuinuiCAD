import { encodeIdentityTuple } from "../document/identityTuple";
import type {
  DocumentId,
  DocumentQualifiedSemanticIdentity,
  DocumentSourceIdentity,
  MultiDocumentSourceSnapshot
} from "../document/multiDocumentPrimitives";
import type { StatementIdentity } from "../document/statementIdentity";
import type { MultiDocumentModuleSemanticAnalysis } from "../document/multiDocumentModuleSemantics";
import type { MultiDocumentGraphNode, MultiDocumentImportGraph } from "../document/multiDocumentImportGraph";
import { buildStatementMap, type StatementMap } from "./dslDocument";
import type { DslStatement } from "./dslTypes";
import type { ModuleDefinitionSemantic, ModuleInstanceSemantic, ModuleSemanticAnalysis } from "./moduleSemanticTypes";
import type { SourceLexicalNamespaceIndex } from "./sourceLexicalNamespaceIndex";

/** The exact source/semantic slice owned by one graph document. */
export type ModuleRuntimeDocument = {
  documentId: DocumentId;
  source: MultiDocumentSourceSnapshot;
  sourceIdentity: DocumentSourceIdentity;
  statements: readonly DslStatement[];
  statementIdByStatementIndex: ReadonlyMap<number, StatementIdentity>;
  sourceLexicalNamespace: SourceLexicalNamespaceIndex;
  moduleSemanticAnalysis: ModuleSemanticAnalysis;
  statementMap: StatementMap;
};

/**
 * Narrow adapter from the multi-document graph/semantic owners into the
 * existing materialization and runtime owners. It contains no parser,
 * resolver, or evaluator of its own.
 */
export type ModuleRuntimeContext = {
  graph: MultiDocumentImportGraph;
  analysis: MultiDocumentModuleSemanticAnalysis;
  rootDocumentId: DocumentId;
  documentsById: ReadonlyMap<DocumentId, ModuleRuntimeDocument>;
  valid: boolean;
  /** True only when the graph contains repeated local identities. */
  qualifiesRuntimePaths: boolean;
  documentFor(documentId: DocumentId | undefined): ModuleRuntimeDocument | undefined;
  analysisFor(documentId: DocumentId | undefined): ModuleSemanticAnalysis | undefined;
  runtimePathComponent(documentId: DocumentId | undefined, localIdentity: StatementIdentity): string;
  runtimePathForInstance(parentPath: readonly string[], instance: ModuleInstanceSemantic): readonly string[];
  definitionFor(identity: DocumentQualifiedSemanticIdentity<StatementIdentity> | undefined): ModuleDefinitionSemantic | undefined;
  instanceFor(identity: DocumentQualifiedSemanticIdentity<StatementIdentity> | undefined): ModuleInstanceSemantic | undefined;
};

const graphNodeFor = (graph: MultiDocumentImportGraph, documentId: DocumentId): MultiDocumentGraphNode | undefined =>
  graph.nodes.get(documentId);

/** Build the one runtime context for one exact graph + semantic analysis pair. */
export const createModuleRuntimeContext = (
  graph: MultiDocumentImportGraph,
  analysis: MultiDocumentModuleSemanticAnalysis
): ModuleRuntimeContext => {
  const documentsById = new Map<DocumentId, ModuleRuntimeDocument>();
  for (const [documentId, node] of graph.nodes) {
    const moduleSemanticAnalysis = analysis.analysesByDocument.get(documentId);
    if (!moduleSemanticAnalysis) continue;
    const statementMap = buildStatementMap(
      [...node.artifact.parsed.statements],
      node.artifact.source.normalizedSource.split("\n").length,
      new Map(),
      undefined,
      undefined,
      node.artifact.statementIdByStatementIndex,
      () => true
    );
    documentsById.set(documentId, {
      documentId,
      source: node.artifact.source,
      sourceIdentity: node.artifact.source.kind === "root-current"
        ? { kind: "root-current", documentId, sourceRevision: node.artifact.source.sourceRevision }
        : { kind: "dependency-saved", documentId, savedSourceFingerprint: node.artifact.source.savedSourceFingerprint },
      statements: node.artifact.parsed.statements,
      statementIdByStatementIndex: node.artifact.statementIdByStatementIndex,
      sourceLexicalNamespace: node.artifact.sourceLexicalNamespace,
      moduleSemanticAnalysis,
      statementMap
    });
  }

  const documentByLocalIdentity = new Map<string, DocumentId>();
  let qualifiesRuntimePaths = false;
  for (const document of documentsById.values()) {
    for (const localIdentity of document.statementIdByStatementIndex.values()) {
      const previous = documentByLocalIdentity.get(localIdentity);
      if (previous && previous !== document.documentId) qualifiesRuntimePaths = true;
      else documentByLocalIdentity.set(localIdentity, document.documentId);
    }
  }

  const valid = graph.valid && analysis.valid && analysis.graph === graph &&
    documentsById.size === graph.nodes.size &&
    documentsById.has(graph.rootDocumentId);
  const documentFor = (documentId: DocumentId | undefined) =>
    documentId ? documentsById.get(documentId) : undefined;
  const analysisFor = (documentId: DocumentId | undefined) => documentFor(documentId)?.moduleSemanticAnalysis;
  const runtimePathComponent = (documentId: DocumentId | undefined, localIdentity: StatementIdentity) => {
    if (!qualifiesRuntimePaths) return localIdentity;
    return `module-document:${encodeIdentityTuple([String(documentId ?? graph.rootDocumentId), localIdentity])}`;
  };
  const runtimePathForInstance = (parentPath: readonly string[], instance: ModuleInstanceSemantic) => [
    ...parentPath,
    runtimePathComponent(instance.identity?.documentId ?? instance.documentId ?? graph.rootDocumentId, instance.statementId)
  ];
  const definitionFor = (identity: DocumentQualifiedSemanticIdentity<StatementIdentity> | undefined) =>
    identity ? analysisFor(identity.documentId)?.definitionsByStatementId.get(identity.localIdentity) : undefined;
  const instanceFor = (identity: DocumentQualifiedSemanticIdentity<StatementIdentity> | undefined) =>
    identity ? analysisFor(identity.documentId)?.instancesByStatementId.get(identity.localIdentity) : undefined;

  // Keep this reference alive as a structural assertion that every context
  // document came from the graph node that supplied its exact source artifact.
  for (const document of documentsById.values()) {
    if (graphNodeFor(graph, document.documentId)?.artifact.source !== document.source) {
      return {
        graph, analysis, rootDocumentId: graph.rootDocumentId, documentsById, valid: false,
        qualifiesRuntimePaths, documentFor, analysisFor, runtimePathComponent,
        runtimePathForInstance, definitionFor, instanceFor
      };
    }
  }

  return {
    graph,
    analysis,
    rootDocumentId: graph.rootDocumentId,
    documentsById,
    valid,
    qualifiesRuntimePaths,
    documentFor,
    analysisFor,
    runtimePathComponent,
    runtimePathForInstance,
    definitionFor,
    instanceFor
  };
};
