import { buildSourceLexicalNamespaceIndex, createModuleRuntimeContext, documentRecordTypeIdentity,
  type CompiledDslDocument, type DslStatement, type ModuleRuntimeContext, type ModuleSemanticAnalysis } from "@nuinuicad/nui-language";
import { analyzeMultiDocumentModuleSemantics, createGraphExternalNamespaceResolver,
  type MultiDocumentPublicApiEntry } from "@nuinuicad/nui-language/workspace";
import type { StatementIdentity } from "@nuinuicad/nui-language/document";

/** Keep the saved graph fixed while projecting the Preview's ephemeral root
 * AST. Graph analysis and runtime identity remain owned by Language Core. */
export const modulePreviewMultiDocumentContext = (
  compiled: CompiledDslDocument,
  statements: readonly DslStatement[],
  statementIdByStatementIndex: ReadonlyMap<number, StatementIdentity>
): ModuleRuntimeContext | undefined => {
  const context = compiled.moduleRuntimeContext;
  if (!context?.valid) return undefined;
  const root = context.graph.nodes.get(context.rootDocumentId)!;
  const records = compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
  const sourceLexicalNamespace = buildSourceLexicalNamespaceIndex(statements, statementIdByStatementIndex, {
    recordSemanticAnalysis: records ?? undefined,
    externalNamespaceResolver: createGraphExternalNamespaceResolver(context.graph, context.rootDocumentId),
    recordTypes: { resolveExternalDefinition: member => {
      const entry = member.value as MultiDocumentPublicApiEntry;
      return entry.family === "record" ? records?.definitionsByStatementId.get(
        documentRecordTypeIdentity(entry.identity.documentId, entry.identity.localIdentity)) ?? null : null;
    } }
  });
  const nodes = new Map(context.graph.nodes);
  nodes.set(context.rootDocumentId, { ...root, artifact: { ...root.artifact, statementIdByStatementIndex, sourceLexicalNamespace,
    parsed: { ...root.artifact.parsed, statements: [...statements] } } });
  const graph = { ...context.graph, nodes };
  return createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
};

export const modulePreviewProjectedContext = (
  context: ModuleRuntimeContext | undefined,
  rootAnalysis: ModuleSemanticAnalysis
): ModuleRuntimeContext | undefined => {
  if (!context) return undefined;
  const analysesByDocument = new Map(context.analysis.analysesByDocument);
  analysesByDocument.set(context.rootDocumentId, rootAnalysis);
  return createModuleRuntimeContext(context.graph, { ...context.analysis, root: rootAnalysis, analysesByDocument });
};
