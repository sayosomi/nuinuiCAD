import { compileDslDocument } from "../../src/dsl/dslDocument";
import type { DslCompletionSemanticSnapshot } from "../../src/dsl/dslCompletionQuery";
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
import type { MultiDocumentGraphNode } from "../../src/document/multiDocumentImportGraph";
import {
  qualifySourceLocation,
  sourceIdentityOf,
  type DocumentQualifiedSourceLocation,
  type DocumentSourceIdentity,
  type DocumentTextRange
} from "../../src/document/multiDocumentPrimitives";
import {
  VscodeMultiDocumentHost,
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
  diagnostic: import("../../src/dsl/dslTypes").DslDiagnostic
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
  diagnosticsProjector: projectVscodeModuleDiagnostics,
  canvasRuntimeProjector: projectVscodeMultiDocumentCanvasRuntime,
  identityProjector: moduleIdentityProjector,
  renameProofFactory: moduleRenameProofFactory
};

/** Production VS Code host: one generic graph lifecycle with Module seams. */
export const createVscodeModuleMultiDocumentHost = (): VscodeMultiDocumentHost =>
  new VscodeMultiDocumentHost(moduleMultiDocumentHostOptions);
