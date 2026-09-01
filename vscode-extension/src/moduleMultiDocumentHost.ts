import { compileDslDocument } from "../../src/dsl/dslDocument";
import { createModuleRuntimeContext } from "../../src/dsl/moduleRuntimeContext";
import {
  createMultiDocumentModuleIdentityResolver,
  createMultiDocumentModuleRenameDocumentProof
} from "../../src/document/multiDocumentModuleLanguage";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "../../src/document/multiDocumentModuleSemantics";
import type { MultiDocumentRenameDocumentProof } from "../../src/document/multiDocumentLanguageQueries";
import {
  VscodeMultiDocumentHost,
  type VscodeMultiDocumentHostOptions,
  type VscodeMultiDocumentRenameProofFactory,
  type VscodeMultiDocumentSemanticRootCompiler
} from "./multiDocumentHost";
import { projectVscodeMultiDocumentCanvasRuntime } from "../../src/vscode/multiDocumentRuntimeTransport";

const sameStatementIds = (
  left: ReadonlyMap<number, string>,
  right: ReadonlyMap<number, string>
): boolean => left.size === right.size &&
  [...left].every(([statementIndex, statementId]) => right.get(statementIndex) === statementId);

const exactModuleRootCompile: VscodeMultiDocumentSemanticRootCompiler = (graph) => {
  if (!graph.valid || graph.rootSource.kind !== "root-current") return null;
  const rootNode = graph.nodes.get(graph.rootDocumentId);
  if (!rootNode || !rootNode.valid || rootNode.artifact.source !== graph.rootSource) return null;

  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  if (!analysis.valid || analysis.graph !== graph || !analysis.analysesByDocument.has(graph.rootDocumentId)) {
    return null;
  }
  const context = createModuleRuntimeContext(graph, analysis);
  if (!context.valid || context.graph !== graph || context.rootDocumentId !== graph.rootDocumentId) return null;

  const compiled = compileDslDocument(graph.rootSource.normalizedSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: graph.rootSource.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: context
  });
  const rootAnalysis = analysis.analysesByDocument.get(graph.rootDocumentId);
  const hasModuleStatements = rootNode.artifact.parsed.statements.some(
    (statement) => statement.kind === "moduleDefinition" || statement.kind === "moduleInstance"
  );
  const compiledStatementIds = compiled.statementMap?.statementIdByStatementIndex;
  if (!hasModuleStatements &&
      !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
      compiled.spans.sourceMap.source === graph.rootSource.normalizedSource &&
      compiled.spans.sourceMap.sourceRevision === graph.rootSource.sourceRevision) {
    return compiled;
  }
  if (
    !rootAnalysis ||
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    compiled.spans.sourceMap.source !== graph.rootSource.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== graph.rootSource.sourceRevision ||
    compiled.moduleRuntimeContext?.graph !== graph ||
    compiled.moduleRuntimeContext?.rootDocumentId !== graph.rootDocumentId ||
    compiled.moduleSemanticAnalysis !== rootAnalysis ||
    !compiledStatementIds ||
    !sameStatementIds(compiledStatementIds, rootNode.artifact.statementIdByStatementIndex)
  ) return null;
  return compiled;
};

const moduleIdentityProjector: VscodeMultiDocumentHostOptions["identityProjector"] = (
  _documentId,
  identity,
  compiled
) => createMultiDocumentModuleIdentityResolver(compiled)(identity);

const moduleRenameProofFactory: VscodeMultiDocumentRenameProofFactory = ({
  primaryGraph,
  primaryIndex,
  reverseIndexes,
  reverseGraphs,
  compiledByDocument
}) => {
  if (primaryIndex.graph !== primaryGraph || !primaryIndex.valid) return null;
  const primaryCompiled = compiledByDocument.get(primaryGraph.rootDocumentId);
  const context = primaryCompiled?.moduleRuntimeContext;
  const analysis = context?.analysis;
  if (
    !primaryCompiled ||
    !context ||
    !context.valid ||
    context.graph !== primaryGraph ||
    !analysis ||
    analysis.graph !== primaryGraph ||
    !analysis.valid ||
    reverseIndexes.some((index) => !index.valid) ||
    reverseGraphs.some((graph) => !graph.valid) ||
    reverseIndexes.length !== reverseGraphs.length ||
    reverseIndexes.some((index, indexPosition) => index.graph !== reverseGraphs[indexPosition]) ||
    reverseGraphs.some((graph) => !compiledByDocument.has(graph.rootDocumentId))
  ) return null;

  const proof: MultiDocumentRenameDocumentProof = createMultiDocumentModuleRenameDocumentProof({
    graph: primaryGraph,
    analysis,
    graphs: reverseGraphs,
    compiledByDocument
  });
  return proof;
};

const moduleMultiDocumentHostOptions: VscodeMultiDocumentHostOptions = {
  declarationContributors: [moduleDeclarationContributor],
  semanticRootCompiler: exactModuleRootCompile,
  canvasRuntimeProjector: projectVscodeMultiDocumentCanvasRuntime,
  identityProjector: moduleIdentityProjector,
  renameProofFactory: moduleRenameProofFactory
};

/** Production VS Code host: one generic graph lifecycle with Module seams. */
export const createVscodeModuleMultiDocumentHost = (): VscodeMultiDocumentHost =>
  new VscodeMultiDocumentHost(moduleMultiDocumentHostOptions);
