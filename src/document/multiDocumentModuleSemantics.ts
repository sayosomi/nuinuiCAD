import { analyzeModuleSemantics } from "../dsl/moduleSemanticAnalysis";
import {
  moduleSemanticIdentityKey,
  type ExternalModuleSemanticTarget,
  type ModuleCallEdge,
  type ModuleSemanticAnalysis,
  type ModuleDefinitionSemantic,
  type ModuleInstanceSemantic
} from "../dsl/moduleSemanticTypes";
import {
  recursiveDocumentQualifiedModuleInstanceIds,
  type DocumentQualifiedModuleCallEdge
} from "../dsl/moduleCallGraph";
import {
  createGraphExternalNamespaceResolver,
  type MultiDocumentDeclarationContributor,
  type MultiDocumentGraphNode,
  type MultiDocumentImportGraph
} from "./multiDocumentImportGraph";
import {
  qualifySemanticIdentity,
  qualifySourceLocation,
  sourceIdentityOf,
  type DocumentId,
  type DocumentQualifiedSemanticIdentity,
  type DocumentQualifiedSourceLocation
} from "./multiDocumentPrimitives";
import type { MultiDocumentPublicApiEntry } from "./multiDocumentPublicApi";
import { bindingIdForStableStatementId } from "../scalars/bindingCatalog";

/** Production family contributor for direct top-level Module declarations.
 * The graph remains family-neutral; it invokes this contributor through its
 * existing declaration-contributor seam. */
export const moduleDeclarationContributor: MultiDocumentDeclarationContributor<never> = ({
  source,
  parsed,
  statementIdByStatementIndex
}) => parsed.statements.flatMap((statement, statementIndex) => {
  if (statement.kind !== "moduleDefinition" || statement.enclosing || !statement.name) return [];
  const statementId = statementIdByStatementIndex.get(statementIndex);
  if (!statementId) return [];
  const nameSegments = statement.namePhysicalSpan?.segments;
  const range = nameSegments && nameSegments.length > 0
    ? { from: nameSegments[0]!.from, to: nameSegments.at(-1)!.to }
    : { from: statement.documentRange.from, to: statement.documentRange.to };
  return [{
    identity: qualifySemanticIdentity(source.documentId, statementId),
    family: "module" as const,
    name: statement.name,
    declaration: qualifySourceLocation(sourceIdentityOf(source), range),
    exported: statement.exported
  }];
});

export type MultiDocumentModuleSemanticDiagnostic = {
  code: "module-recursion" | "module-semantic-invalid";
  message: string;
  location: DocumentQualifiedSourceLocation;
  relatedLocations?: readonly DocumentQualifiedSourceLocation[];
};

export type MultiDocumentModuleSemanticAnalysis = {
  graph: MultiDocumentImportGraph;
  valid: boolean;
  root: ModuleSemanticAnalysis | null;
  analysesByDocument: ReadonlyMap<DocumentId, ModuleSemanticAnalysis>;
  definitions: readonly ModuleDefinitionSemantic[];
  instances: readonly ModuleInstanceSemantic[];
  callEdges: readonly DocumentQualifiedModuleCallEdge[];
  diagnostics: readonly MultiDocumentModuleSemanticDiagnostic[];
};

const localIdentity = (identity: DocumentQualifiedSemanticIdentity<string>) => identity.localIdentity;

const sourceLocationForStatement = (
  node: MultiDocumentGraphNode,
  statementIndex: number,
  preferName = false
): DocumentQualifiedSourceLocation | null => {
  const statement = node.artifact.parsed.statements[statementIndex];
  if (!statement) return null;
  const physical = preferName ? statement.namePhysicalSpan : statement.physicalSpan;
  const segments = physical?.segments;
  const range = segments && segments.length > 0
    ? { from: segments[0]!.from, to: segments.at(-1)!.to }
    : statement.documentRange
      ? { from: statement.documentRange.from, to: statement.documentRange.to }
      : null;
  return range ? qualifySourceLocation(sourceIdentityOf(node.artifact.source), range) : null;
};

const postOrderNodes = (graph: MultiDocumentImportGraph): MultiDocumentGraphNode[] => {
  const visited = new Set<DocumentId>();
  const ordered: MultiDocumentGraphNode[] = [];
  const visit = (node: MultiDocumentGraphNode) => {
    if (visited.has(node.documentId)) return;
    visited.add(node.documentId);
    for (const edge of node.imports) {
      if (edge.status !== "resolved" || !edge.targetDocumentId) continue;
      const target = graph.nodes.get(edge.targetDocumentId);
      if (target) visit(target);
    }
    ordered.push(node);
  };
  const root = graph.nodes.get(graph.rootDocumentId);
  if (root) visit(root);
  for (const node of graph.nodes.values()) visit(node);
  return ordered;
};

const logicalTextByStatementIndex = (node: MultiDocumentGraphNode) => {
  const result = new Map<number, string>();
  for (const [statementIndex, statement] of node.artifact.parsed.statements.entries()) {
    const logical = node.artifact.parsed.logicalStatementByRangeFrom.get(statement.documentRange.from);
    if (logical) result.set(statementIndex, logical.logicalText);
  }
  return result;
};

const documentScalarBindingsFor = (node: MultiDocumentGraphNode) => new Map(
  node.artifact.parsed.statements.flatMap((statement, statementIndex) => {
    if (statement.kind !== "typedDeclaration" || statement.enclosing || !statement.declaredType) return [];
    const statementId = node.artifact.statementIdByStatementIndex.get(statementIndex);
    return statementId
      ? [[statementIndex, { bindingId: bindingIdForStableStatementId(statementId), statementId }] as const]
      : [];
  })
);

const callEdgeFor = (
  node: MultiDocumentGraphNode,
  edge: ModuleCallEdge
): DocumentQualifiedModuleCallEdge => ({
  caller: qualifySemanticIdentity(node.documentId, edge.callerModuleDefinitionStatementId),
  callee: edge.calleeIdentity ?? qualifySemanticIdentity(
    node.documentId,
    edge.calleeModuleDefinitionStatementId
  ),
  instance: qualifySemanticIdentity(node.documentId, edge.instanceStatementId),
  callerModuleDefinitionStatementId: edge.callerModuleDefinitionStatementId,
  calleeModuleDefinitionStatementId: edge.calleeModuleDefinitionStatementId,
  instanceStatementId: edge.instanceStatementId
});

/** Analyze every exact graph artifact with its own lexical namespace and
 * external resolver. Dependencies are analyzed first so imported call
 * parameter slots are supplied by the defining document's semantic result. */
export const analyzeMultiDocumentModuleSemantics = (
  graph: MultiDocumentImportGraph
): MultiDocumentModuleSemanticAnalysis => {
  const analysesByDocument = new Map<DocumentId, ModuleSemanticAnalysis>();
  const diagnostics: MultiDocumentModuleSemanticDiagnostic[] = [];

  for (const node of postOrderNodes(graph)) {
    if (!node.valid) continue;
    const externalNamespaceResolver = createGraphExternalNamespaceResolver(graph, node.documentId);
    const externalModuleResolver = (member: { value: unknown }): ExternalModuleSemanticTarget | null => {
      const entry = member.value as MultiDocumentPublicApiEntry | null;
      if (!entry || entry.family !== "module") return null;
      const defining = analysesByDocument.get(entry.identity.documentId);
      const definition = defining?.definitionsByStatementId.get(localIdentity(entry.identity));
      if (!defining || !definition) return null;
      return {
        identity: entry.identity as DocumentQualifiedSemanticIdentity<import("../document/statementIdentity").StatementIdentity>,
        declaration: entry.declaration,
        definitionStatementId: definition.statementId,
        definitionStatementIndex: definition.statementIndex,
        name: definition.name,
        parameters: definition.parameters,
        definition
      };
    };
    const analysis = analyzeModuleSemantics({
      statements: node.artifact.parsed.statements,
      stableStatementIdByIndex: node.artifact.statementIdByStatementIndex,
      sourceNamespace: node.artifact.sourceLexicalNamespace,
      spans: {
        sourceMap: node.artifact.parsed.sourceMap,
        logicalStatementByRangeFrom: node.artifact.parsed.logicalStatementByRangeFrom
      },
      logicalTextByStatementIndex: logicalTextByStatementIndex(node),
      documentScalarBindings: documentScalarBindingsFor(node),
      documentId: node.documentId,
      source: sourceIdentityOf(node.artifact.source),
      externalNamespaceResolver,
      externalModuleResolver
    });
    analysesByDocument.set(node.documentId, analysis);
  }

  const definitions = [...analysesByDocument.values()].flatMap((analysis) => analysis.definitions);
  const instances = [...analysesByDocument.values()].flatMap((analysis) => analysis.instances);
  const callEdges = [...analysesByDocument.entries()].flatMap(([documentId, analysis]) => {
    const node = graph.nodes.get(documentId);
    return node ? analysis.callEdges.map((edge) => callEdgeFor(node, edge)) : [];
  });
  const recursiveIds = recursiveDocumentQualifiedModuleInstanceIds(definitions, callEdges);
  for (const identity of recursiveIds) {
    const instance = instances.find((candidate) => candidate.identity && moduleSemanticIdentityKey(candidate.identity) === identity);
    if (!instance) continue;
    const location = instance.location ?? (
      graph.nodes.get(instance.documentId!)
        ? sourceLocationForStatement(graph.nodes.get(instance.documentId!)!, instance.statementIndex)
        : null
    );
    if (!location) continue;
    const relatedLocations = callEdges
      .filter((edge) => recursiveIds.has(moduleSemanticIdentityKey(edge.instance)))
      .map((edge) => {
        const related = instances.find((candidate) => candidate.identity && moduleSemanticIdentityKey(candidate.identity) === moduleSemanticIdentityKey(edge.instance));
        return related?.location ?? null;
      })
      .filter((value): value is DocumentQualifiedSourceLocation => value !== null);
    diagnostics.push({
      code: "module-recursion",
      message: `module recursion は許可されていません:「${instance.name}」。`,
      location,
      ...(relatedLocations.length > 0 ? { relatedLocations } : {})
    });
  }

  const semanticDiagnostics = [...analysesByDocument.entries()].flatMap(([documentId, analysis]) => {
    const node = graph.nodes.get(documentId);
    if (!node) return [];
    return analysis.diagnostics
      .filter((diagnostic) => diagnostic.code !== "module-recursion")
      .flatMap((diagnostic): MultiDocumentModuleSemanticDiagnostic[] => {
      const statement = node.artifact.parsed.statements.find((candidate) => candidate.line === diagnostic.line);
      const location = statement
        ? sourceLocationForStatement(node, node.artifact.parsed.statements.indexOf(statement))
        : null;
      return location
        ? [{ code: "module-semantic-invalid", message: diagnostic.message, location }]
        : [];
    });
  });
  diagnostics.push(...semanticDiagnostics);

  return {
    graph,
    valid: graph.valid && diagnostics.length === 0,
    root: analysesByDocument.get(graph.rootDocumentId) ?? null,
    analysesByDocument,
    definitions,
    instances,
    callEdges,
    diagnostics
  };
};

/** Backward-friendly verb for callers that already call local analysis
 * through `analyze...Semantics`. */
export const analyzeMultiDocumentModuleGraph = analyzeMultiDocumentModuleSemantics;
