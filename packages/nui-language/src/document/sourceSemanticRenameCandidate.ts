import { compileDslDocument, type CompiledDslDocument } from "../dsl/dslDocument";
import { createModuleRuntimeContext } from "../dsl/moduleRuntimeContext";
import { analyzeMultiDocumentSource, createGraphExternalNamespaceResolver } from "./multiDocumentImportGraph";
import { analyzeMultiDocumentModuleSemantics, moduleDeclarationContributor } from "./multiDocumentModuleSemantics";
import { buildMultiDocumentPublicApiCatalog } from "./multiDocumentPublicApi";
import { bindDocumentRecordSemantics } from "./multiDocumentRecordSemantics";

/** Recompile a local source rename against its exact saved dependency owners.
 * Imports/re-exports may not change here; public cross-file renames retain
 * their separate graph/catalog proof. Never reuse the old root's semantics. */
export const compileSourceSemanticRenameCandidate = (source: string, before: CompiledDslDocument): CompiledDslDocument | null => {
  const ids = before.statementMap?.statementIdByStatementIndex;
  const context = before.moduleRuntimeContext;
  if (!context) return compileDslDocument(source, { assignedStatementIds: ids });
  const graph = context.graph;
  const root = graph.nodes.get(graph.rootDocumentId);
  const revision = before.spans.sourceMap.sourceRevision;
  if (!context.valid || !graph.valid || !root || !ids || root.artifact.source.kind !== "root-current" ||
      root.artifact.source.normalizedSource !== before.spans.sourceMap.source ||
      root.artifact.source.sourceRevision !== revision || !Number.isSafeInteger(revision + 1)) return null;
  const snapshot = { ...graph.rootSource, normalizedSource: source, sourceRevision: revision + 1 };
  const artifact = analyzeMultiDocumentSource(snapshot, { statementIdByStatementIndex: ids, declarationContributors: [moduleDeclarationContributor] });
  if (!artifact.syntaxValid || artifact.parsed.statements.length !== before.statements.length ||
      artifact.statementIdByStatementIndex.size !== ids.size ||
      [...ids].some(([index, identity]) => artifact.statementIdByStatementIndex.get(index) !== identity) ||
      artifact.imports.length !== root.artifact.imports.length || artifact.imports.some((item, index) => {
        const old = root.artifact.imports[index]!;
        return item.identity.localIdentity !== old.identity.localIdentity || item.alias !== old.alias || item.importPath !== old.importPath;
      }) || artifact.reExports.length !== root.artifact.reExports.length || artifact.reExports.some((item, index) => {
        const old = root.artifact.reExports[index]!;
        return item.importAlias !== old.importAlias || item.exportedName !== old.exportedName;
      })) return null;
  const publicApi = buildMultiDocumentPublicApiCatalog({ documentId: snapshot.documentId, declarations: artifact.declarations,
    reExports: artifact.reExports, resolveImportCatalog: alias => {
      const edge = root.imports.find(item => item.alias === alias && item.status === "resolved");
      return edge?.targetDocumentId ? graph.nodes.get(edge.targetDocumentId)?.publicApi ?? null : null;
    } });
  const namespace = bindDocumentRecordSemantics(artifact, root.imports.flatMap(edge => {
    const dependency = edge.status === "resolved" && edge.targetDocumentId ? graph.nodes.get(edge.targetDocumentId) : undefined;
    return dependency ? [dependency.artifact] : [];
  }), createGraphExternalNamespaceResolver(graph, snapshot.documentId));
  if (!publicApi.valid || namespace.diagnostics.some(d => d.severity === "error")) return null;
  const imports = root.imports.map((edge, index) => ({ ...edge,
    importLocation: artifact.imports[index]!.location, aliasLocation: artifact.imports[index]!.aliasLocation }));
  const nextRoot = { ...root, imports, artifact: { ...artifact, sourceLexicalNamespace: namespace }, publicApi,
    publicApiDiagnostics: publicApi.diagnostics, sourceDiagnostics: [...artifact.parsed.diagnostics, ...namespace.diagnostics] };
  const nextGraph = { ...graph, rootSource: snapshot, nodes: new Map(graph.nodes).set(snapshot.documentId, nextRoot),
    edges: graph.edges.map(edge => edge.importerDocumentId === snapshot.documentId
      ? imports.find(candidate => candidate.importIdentity.localIdentity === edge.importIdentity.localIdentity)! : edge) };
  const analysis = analyzeMultiDocumentModuleSemantics(nextGraph);
  const nextContext = createModuleRuntimeContext(nextGraph, analysis);
  if (!nextContext.valid) return null;
  return compileDslDocument(source, { preparsed: artifact.parsed, sourceRevision: snapshot.sourceRevision,
    assignedStatementIds: ids, moduleRuntimeContext: nextContext });
};
