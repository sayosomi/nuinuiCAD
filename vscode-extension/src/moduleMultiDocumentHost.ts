import { compileDslDocument } from "@nuinuicad/nui-language";
import type { DslCompletionSemanticSnapshot } from "@nuinuicad/nui-language";
import { createModuleRuntimeContext } from "@nuinuicad/nui-language";
import {
  createMultiDocumentModuleIdentityResolver,
  createMultiDocumentModuleRenameDocumentProof
} from "@nuinuicad/nui-language/workspace";
import {
  analyzeMultiDocumentModuleSemantics,
  moduleDeclarationContributor
} from "@nuinuicad/nui-language/workspace";
import type { MultiDocumentRenameDocumentProof } from "@nuinuicad/nui-language/workspace";
import type {
  MultiDocumentGraphNode,
  MultiDocumentImportGraph
} from "@nuinuicad/nui-language/workspace";
import {
  qualifySourceLocation,
  sourceIdentityOf,
  type DocumentId,
  type DocumentQualifiedSourceLocation,
  type DocumentSourceIdentity,
  type DocumentTextRange
} from "@nuinuicad/nui-language/workspace";
import {
  VscodeMultiDocumentHost,
  type VscodeMultiDocumentCompletionSemanticRootCompiler,
  type VscodeMultiDocumentDiagnostic,
  type VscodeMultiDocumentDiagnosticsProjector,
  type VscodeMultiDocumentHostOptions,
  type VscodeMultiDocumentRenameProofFactory,
  type VscodeMultiDocumentSemanticRootCompiler
} from "./multiDocumentHost";
import { projectVscodeMultiDocumentCanvasRuntime } from "../../src/vscode/multiDocumentRuntimeTransport";
import {
  compilerDiagnosticsFor,
  type CompilerDiagnostic,
  type CompilerDiagnosticRange
} from "./compilerDiagnostics";
import { projectConfiguredCompilerDiagnosticsWithTypoSuggestions } from "./typoDiagnosticPresentation";

const sameStatementIds = (
  left: ReadonlyMap<number, string>,
  right: ReadonlyMap<number, string>
): boolean => left.size === right.size &&
  [...left].every(([statementIndex, statementId]) => right.get(statementIndex) === statementId);

type ModuleRootCompilation = {
  rootNode: MultiDocumentGraphNode<unknown>;
  analysis: ReturnType<typeof analyzeMultiDocumentModuleSemantics>;
  compiled: ReturnType<typeof compileDslDocument>;
};

const moduleRootCompilationFor = (graph: Parameters<VscodeMultiDocumentSemanticRootCompiler>[0]): ModuleRootCompilation | null => {
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
  return { rootNode, analysis, compiled };
};

const exactModuleRootCompile: VscodeMultiDocumentSemanticRootCompiler = (graph) => {
  const prepared = moduleRootCompilationFor(graph);
  if (!prepared) return null;
  const { rootNode, analysis, compiled } = prepared;
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

/**
 * Build the Completion-only root semantic view. The graph builder still marks
 * an incomplete root invalid, but it has loaded the root's imports through the
 * existing saved-artifact/public-catalog path. Only the root validity bit and
 * root semantic diagnostics are relaxed here; every dependency must remain
 * exact and valid before the shared Module runtime context is admitted.
 */
const completionModuleRootCompile: VscodeMultiDocumentCompletionSemanticRootCompiler = ({ graph, source }) => {
  if (
    graph.rootDocumentId !== source.documentId ||
    graph.rootSource.kind !== "root-current" ||
    graph.rootSource.normalizedSource !== source.normalizedSource ||
    graph.rootSource.sourceRevision !== source.sourceRevision ||
    graph.diagnostics.length > 0
  ) return null;

  const rootNode = graph.nodes.get(source.documentId);
  if (!rootNode || rootNode.artifact.source !== graph.rootSource || !rootNode.publicApi.valid) return null;
  if (graph.edges.some((edge) => edge.status !== "resolved")) return null;
  if ([...graph.nodes].some(([documentId, node]) =>
    documentId !== source.documentId && (!node.valid || !node.publicApi.valid)
  )) return null;
  if ([...graph.dependencyFingerprints].some(([documentId]) => documentId === source.documentId)) return null;
  for (const [documentId] of graph.nodes) {
    if (documentId !== source.documentId && !graph.dependencyFingerprints.has(documentId)) return null;
  }

  const completionNodes = new Map<DocumentId, MultiDocumentGraphNode<unknown>>();
  for (const [documentId, node] of graph.nodes) {
    completionNodes.set(
      documentId,
      documentId === source.documentId ? { ...node, valid: true } : node
    );
  }
  const completionGraph: MultiDocumentImportGraph<unknown> = {
    ...graph,
    nodes: completionNodes,
    valid: true
  };
  const analysis = analyzeMultiDocumentModuleSemantics(completionGraph);
  const rootAnalysis = analysis.analysesByDocument.get(source.documentId);
  if (!rootAnalysis || analysis.analysesByDocument.size !== completionGraph.nodes.size) return null;
  if (analysis.diagnostics.some((diagnostic) => diagnostic.location.source.documentId !== source.documentId)) return null;

  const completionAnalysis = {
    ...analysis,
    valid: true,
    diagnostics: []
  };
  const context = createModuleRuntimeContext(completionGraph, completionAnalysis);
  if (
    !context.valid ||
    context.graph !== completionGraph ||
    context.rootDocumentId !== source.documentId
  ) return null;

  const compiled = compileDslDocument(source.normalizedSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: source.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex
  });
  if (
    !compiled.sourceLexicalNamespace ||
    compiled.spans.sourceMap.source !== source.normalizedSource ||
    compiled.spans.sourceMap.sourceRevision !== source.sourceRevision
  ) return null;
  return {
    ...compiled,
    moduleSemanticAnalysis: rootAnalysis,
    moduleRuntimeContext: context
  };
};

const moduleIdentityProjector: VscodeMultiDocumentHostOptions["identityProjector"] = (
  _documentId,
  identity,
  compiled
) => createMultiDocumentModuleIdentityResolver(compiled)(identity);

const offsetAt = (
  source: string,
  position: { line: number; character: number }
): number | null => {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) ||
      position.line < 0 || position.character < 0) return null;
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  const lineEnd = source.indexOf("\n", offset);
  const end = lineEnd === -1 ? source.length : lineEnd;
  return offset + position.character <= end ? offset + position.character : null;
};

const rangeForCompilerDiagnostic = (
  source: string,
  range: CompilerDiagnosticRange
): DocumentTextRange | null => {
  const from = offsetAt(source, range.start);
  const to = offsetAt(source, range.end);
  return from === null || to === null || to < from ? null : { from, to };
};

const relatedInformationForCompilerDiagnostic = (
  source: string,
  sourceIdentity: DocumentSourceIdentity,
  diagnostic: CompilerDiagnostic
): readonly { message: string; location: DocumentQualifiedSourceLocation; presentation?: CompilerDiagnostic["presentation"] }[] =>
  (diagnostic.relatedInformation ?? []).flatMap((related) => {
    const range = rangeForCompilerDiagnostic(source, related.range);
    return range ? [{
      message: related.message,
      location: qualifySourceLocation(sourceIdentity, range),
      ...(related.presentation ? { presentation: related.presentation } : {})
    }] : [];
  });

const projectCompilerDiagnostic = (
  source: string,
  sourceIdentity: DocumentSourceIdentity,
  diagnostic: CompilerDiagnostic
): VscodeMultiDocumentDiagnostic | null => {
  const range = rangeForCompilerDiagnostic(source, diagnostic.range);
  if (!range) return null;
  const relatedInformation = relatedInformationForCompilerDiagnostic(source, sourceIdentity, diagnostic);
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    location: qualifySourceLocation(sourceIdentity, range),
    ...(diagnostic.presentation ? { presentation: diagnostic.presentation } : {}),
    ...(diagnostic.suffixPresentation ? { suffixPresentation: diagnostic.suffixPresentation } : {}),
    ...(relatedInformation.length > 0 ? { relatedInformation } : {}),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code })
  };
};

const projectDslDiagnostic = (
  source: string,
  sourceIdentity: DocumentSourceIdentity,
  diagnostic: import("@nuinuicad/nui-language").DslDiagnostic
): VscodeMultiDocumentDiagnostic | null => {
  const projected = compilerDiagnosticsFor(source, [diagnostic], [])[0];
  return projected ? projectCompilerDiagnostic(source, sourceIdentity, projected) : null;
};

const diagnosticKey = (diagnostic: VscodeMultiDocumentDiagnostic): string => JSON.stringify([
  diagnostic.severity,
  diagnostic.code,
  diagnostic.presentation ?? null,
  diagnostic.code === undefined && diagnostic.presentation === undefined ? diagnostic.message : null,
  diagnostic.location,
  (diagnostic.relatedInformation ?? []).map((related) => ({
    location: related.location,
    presentation: related.presentation ?? null,
    message: related.presentation === undefined ? related.message : null
  }))
]);

export const projectVscodeModuleDiagnostics: VscodeMultiDocumentDiagnosticsProjector = ({ graph, compiled }) => {
  const diagnostics: VscodeMultiDocumentDiagnostic[] = [];
  const add = (diagnostic: VscodeMultiDocumentDiagnostic | null): void => {
    if (diagnostic) diagnostics.push(diagnostic);
  };
  const addQualified = (
    severity: "error" | "warning",
    code: string,
    message: string,
    location: DocumentQualifiedSourceLocation,
    relatedLocations: readonly DocumentQualifiedSourceLocation[] = [],
    presentation: VscodeMultiDocumentDiagnostic["presentation"] = { key: `diagnostic.${code}` }
  ): void => {
    add({
      severity,
      code,
      message,
      presentation,
      location,
      ...(relatedLocations.length > 0
        ? { relatedInformation: relatedLocations.map((related) => ({ message, location: related, presentation })) }
        : {})
    });
  };

  for (const diagnostic of graph.diagnostics) {
    addQualified("error", diagnostic.code, diagnostic.message, diagnostic.location, diagnostic.relatedLocations, diagnostic.presentation);
  }

  for (const node of graph.nodes.values()) {
    const sourceIdentity = sourceIdentityOf(node.artifact.source);
    for (const diagnostic of node.sourceDiagnostics) {
      add(projectDslDiagnostic(node.artifact.source.normalizedSource, sourceIdentity, diagnostic));
    }
    for (const diagnostic of node.publicApiDiagnostics) {
      addQualified(
        "error",
        diagnostic.code,
        diagnostic.message,
        diagnostic.location,
        diagnostic.relatedLocations,
        diagnostic.presentation
      );
    }
  }

  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  for (const diagnostic of analysis.diagnostics) {
    addQualified(
      "error",
      diagnostic.code,
      diagnostic.message,
      diagnostic.location,
      diagnostic.relatedLocations,
      diagnostic.presentation
    );
  }

  const diagnosticCompiled = compiled ?? moduleRootCompilationFor(graph)?.compiled ?? null;
  if (diagnosticCompiled && diagnosticCompiled.spans.sourceMap.source === graph.rootSource.normalizedSource &&
      diagnosticCompiled.spans.sourceMap.sourceRevision === graph.rootSource.sourceRevision) {
    const sourceIdentity = sourceIdentityOf(graph.rootSource);
    const base = compilerDiagnosticsFor(
      graph.rootSource.normalizedSource,
      diagnosticCompiled.diagnostics,
      diagnosticCompiled.bindingIssueDiagnostics ?? []
    );
    const semantic: DslCompletionSemanticSnapshot = {
      sourceRevision: graph.rootSource.sourceRevision,
      sourceText: graph.rootSource.normalizedSource,
      compiled: diagnosticCompiled,
      ...(diagnosticCompiled.bindingAnalysis ? { bindingAnalysis: diagnosticCompiled.bindingAnalysis } : {})
    };
    const projected = projectConfiguredCompilerDiagnosticsWithTypoSuggestions(
      base,
      {
        normalizedSource: graph.rootSource.normalizedSource,
        sourceRevision: graph.rootSource.sourceRevision
      },
      semantic
    );
    for (const diagnostic of projected) add(projectCompilerDiagnostic(graph.rootSource.normalizedSource, sourceIdentity, diagnostic));
  }

  const unique = new Map<string, VscodeMultiDocumentDiagnostic>();
  for (const diagnostic of diagnostics) unique.set(diagnosticKey(diagnostic), diagnostic);
  return [...unique.values()];
};

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
  completionSemanticRootCompiler: completionModuleRootCompile,
  diagnosticsProjector: projectVscodeModuleDiagnostics,
  canvasRuntimeProjector: projectVscodeMultiDocumentCanvasRuntime,
  identityProjector: moduleIdentityProjector,
  renameProofFactory: moduleRenameProofFactory
};

/** Production VS Code host: one generic graph lifecycle with Module seams. */
export const createVscodeModuleMultiDocumentHost = (): VscodeMultiDocumentHost =>
  new VscodeMultiDocumentHost(moduleMultiDocumentHostOptions);
