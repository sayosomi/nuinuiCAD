import { parseDslReferenceToken } from "../dsl/dslReferenceTokens";
import { resolveSourceLexicalPath } from "../dsl/sourceLexicalNamespaceIndex";
import type { DslDiagnosticPresentation } from "../dsl/dslTypes";
import {
  analyzeMultiDocumentModuleSemantics,
  type MultiDocumentModuleSemanticAnalysis
} from "./multiDocumentModuleSemantics";
import {
  buildMultiDocumentSemanticOccurrenceIndex,
  type MultiDocumentSemanticOccurrenceIndex
} from "./multiDocumentLanguageQueries";
import {
  createGraphExternalNamespaceResolver,
  type MultiDocumentGraphNode,
  type MultiDocumentImportDirective,
  type MultiDocumentImportGraph
} from "./multiDocumentImportGraph";
import {
  sourceIdentityOf,
  type DocumentQualifiedSemanticIdentity,
  type DocumentQualifiedSourceLocation
} from "./multiDocumentPrimitives";

export const MULTI_DOCUMENT_LINT_DIAGNOSTIC_CODES = {
  unusedImport: "unused-import"
} as const;

export type MultiDocumentLintDiagnostic = {
  severity: "warning";
  code: typeof MULTI_DOCUMENT_LINT_DIAGNOSTIC_CODES.unusedImport;
  message: string;
  presentation: DslDiagnosticPresentation;
  location: DocumentQualifiedSourceLocation;
};

export type MultiDocumentLintAnalysisInput = {
  graph: MultiDocumentImportGraph<unknown>;
  moduleAnalysis?: MultiDocumentModuleSemanticAnalysis;
  occurrenceIndex?: MultiDocumentSemanticOccurrenceIndex;
};

const identityKey = (identity: DocumentQualifiedSemanticIdentity<string>): string =>
  `${String(identity.documentId)}\u0000${identity.localIdentity}`;

const sourceIdentityKey = (source: ReturnType<typeof sourceIdentityOf>): string =>
  source.kind === "root-current"
    ? `${source.kind}\u0000${String(source.documentId)}\u0000${source.sourceRevision}`
    : `${source.kind}\u0000${String(source.documentId)}\u0000${String(source.savedSourceFingerprint)}`;

const exactSourceIdentity = (
  left: ReturnType<typeof sourceIdentityOf>,
  right: ReturnType<typeof sourceIdentityOf>
): boolean => sourceIdentityKey(left) === sourceIdentityKey(right);

const exactGraphProof = (graph: MultiDocumentImportGraph<unknown>): boolean => {
  if (!graph.valid || graph.diagnostics.length > 0 || graph.rootDocumentId !== graph.rootSource.documentId) return false;
  const root = graph.nodes.get(graph.rootDocumentId);
  if (!root || !root.valid || !root.publicApi.valid || root.artifact.source !== graph.rootSource) return false;
  if (
    root.artifact.source.kind !== "root-current" ||
    root.artifact.source.normalizedSource.includes("\r") ||
    root.artifact.source.sourceRevision !== graph.rootSource.sourceRevision
  ) return false;

  for (const [documentId, node] of graph.nodes) {
    if (
      !node.valid ||
      !node.publicApi.valid ||
      node.artifact.source.normalizedSource.includes("\r") ||
      node.artifact.source.documentId !== documentId
    ) return false;
    if (documentId === graph.rootDocumentId) {
      if (node.artifact.source !== graph.rootSource) return false;
    } else if (
      node.artifact.source.kind !== "dependency-saved" ||
      graph.dependencyFingerprints.get(documentId) !== node.artifact.source.savedSourceFingerprint
    ) return false;
  }

  return graph.edges.every((edge) => edge.status === "resolved" && edge.targetDocumentId !== undefined);
};

const exactSemanticProof = (
  graph: MultiDocumentImportGraph<unknown>,
  analysis: MultiDocumentModuleSemanticAnalysis,
  occurrenceIndex: MultiDocumentSemanticOccurrenceIndex
): boolean => {
  if (
    analysis.graph !== graph ||
    !analysis.valid ||
    analysis.diagnostics.length > 0 ||
    analysis.analysesByDocument.size !== graph.nodes.size ||
    occurrenceIndex.graph !== graph ||
    !occurrenceIndex.valid ||
    occurrenceIndex.sourceByDocument.size !== graph.nodes.size
  ) return false;

  for (const [documentId, node] of graph.nodes) {
    const documentAnalysis = analysis.analysesByDocument.get(documentId);
    const activeSource = occurrenceIndex.sourceByDocument.get(documentId);
    if (
      !documentAnalysis ||
      documentAnalysis.documentId !== documentId ||
      !activeSource ||
      !exactSourceIdentity(sourceIdentityOf(node.artifact.source), sourceIdentityOf(activeSource)) ||
      (documentAnalysis.source !== undefined &&
        !exactSourceIdentity(documentAnalysis.source, sourceIdentityOf(node.artifact.source)))
    ) return false;

    for (const instance of documentAnalysis.instances) {
      const statement = node.artifact.parsed.statements[instance.statementIndex];
      const statementId = node.artifact.statementIdByStatementIndex.get(instance.statementIndex);
      if (
        !statement ||
        statement.kind !== "moduleInstance" ||
        !statementId ||
        statementId !== instance.statementId ||
        (instance.documentId !== undefined && instance.documentId !== documentId) ||
        (instance.identity !== undefined &&
          (instance.identity.documentId !== documentId || instance.identity.localIdentity !== instance.statementId))
      ) return false;
    }
  }

  return true;
};

const importDirectiveForIdentity = (
  node: MultiDocumentGraphNode<unknown>,
  identity: DocumentQualifiedSemanticIdentity<string>
): MultiDocumentImportDirective | null => {
  if (identity.documentId !== node.documentId) return null;
  const directive = node.artifact.imports.find((candidate) =>
    candidate.identity.localIdentity === identity.localIdentity
  );
  return directive ?? null;
};

const addReExportUses = (
  graph: MultiDocumentImportGraph<unknown>,
  occurrenceIndex: MultiDocumentSemanticOccurrenceIndex,
  used: Set<string>
): void => {
  for (const occurrence of occurrenceIndex.occurrences) {
    if (occurrence.kind !== "reference") continue;
    const node = graph.nodes.get(occurrence.identity.documentId);
    const directive = node ? importDirectiveForIdentity(node, occurrence.identity) : null;
    if (directive) used.add(identityKey(directive.identity));
  }
};

const addDirectModuleUses = (
  graph: MultiDocumentImportGraph<unknown>,
  analysis: MultiDocumentModuleSemanticAnalysis,
  used: Set<string>
): void => {
  for (const [documentId, node] of graph.nodes) {
    const documentAnalysis = analysis.analysesByDocument.get(documentId);
    if (!documentAnalysis) return;
    const externalNamespaceResolver = createGraphExternalNamespaceResolver(graph, documentId);
    for (const instance of documentAnalysis.instances) {
      if (instance.calleeResolution !== "resolved" || !instance.callee) continue;
      const statement = node.artifact.parsed.statements[instance.statementIndex];
      if (!statement || statement.kind !== "moduleInstance" || statement.moduleName.length === 0) continue;
      const path = parseDslReferenceToken(statement.moduleName);
      if (path.segments.length < 2) continue;
      const lookup = resolveSourceLexicalPath(
        node.artifact.sourceLexicalNamespace,
        instance.statementIndex,
        path,
        { externalNamespaceResolver }
      );
      if (lookup.kind !== "external") continue;
      const directive = node.artifact.imports.find((candidate) =>
        candidate.identity.localIdentity === lookup.namespace.statementId
      );
      if (directive) used.add(identityKey(directive.identity));
    }
  }
};

/**
 * Analyze exact graph-backed import usage. The analyzer deliberately keeps
 * direct Module alias proof separate from the generic occurrence universe so
 * imported member Definition/References/Rename identity remains unchanged.
 */
export const analyzeMultiDocumentLintDiagnostics = (
  input: MultiDocumentLintAnalysisInput
): readonly MultiDocumentLintDiagnostic[] => {
  try {
    if (!exactGraphProof(input.graph)) return [];
    const occurrenceIndex = input.occurrenceIndex ?? buildMultiDocumentSemanticOccurrenceIndex({ graph: input.graph });
    const moduleAnalysis = input.moduleAnalysis ?? analyzeMultiDocumentModuleSemantics(input.graph);
    if (!exactSemanticProof(input.graph, moduleAnalysis, occurrenceIndex)) return [];

    const used = new Set<string>();
    addReExportUses(input.graph, occurrenceIndex, used);
    addDirectModuleUses(input.graph, moduleAnalysis, used);

    return [...input.graph.nodes.values()].flatMap((node) => node.artifact.imports.flatMap((directive) => {
      if (used.has(identityKey(directive.identity))) return [];
      return [{
        severity: "warning" as const,
        code: MULTI_DOCUMENT_LINT_DIAGNOSTIC_CODES.unusedImport,
        message: `Import alias '${directive.alias}' is not used anywhere.`,
        presentation: {
          key: "diagnostic.unused-import",
          parameters: { name: directive.alias }
        },
        location: directive.aliasLocation
      }];
    }));
  } catch {
    return [];
  }
};
