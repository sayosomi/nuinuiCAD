import {
  compileDslDocument,
  createModuleRuntimeContext
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { evaluateElements } from "../../geometry/evaluate";
import { buildEvaluationOptions } from "../../geometry/productionEvaluationContext";
import {
  canvasRuntimePresentationFor,
  projectVscodeMultiDocumentCanvasRuntime
} from "../multiDocumentRuntimeTransport";

export const issue1673FitRootDocumentUri = "file:///workspace/fit-import.nui";
export const issue1673FitLibraryDocumentUri = "file:///workspace/fit-lib.nui";
export const issue1673FitGraphRevision = 73;
export const issue1673FitSourceRevision = 19;

export const issue1673FitRootSource = `nui 1
import "./fit-lib.nui" as lib
instance M = lib::Mark()
`;

export const issue1673FitLibrarySource = `nui 1
export module Mark() {
  line L = segment(start: (0, 0), end: (400, 200))
}
`;

export const buildIssue1673FitImportFixture = async () => {
  const rootDocumentId = documentIdFromHost(issue1673FitRootDocumentUri);
  const libraryDocumentId = documentIdFromHost(issue1673FitLibraryDocumentUri);
  const graph = await buildMultiDocumentImportGraph({
    root: {
      kind: "root-current",
      documentId: rootDocumentId,
      normalizedSource: issue1673FitRootSource,
      sourceRevision: issue1673FitSourceRevision
    },
    loader: {
      loadSavedDependency: async (importerDocumentId, importPath) =>
        importerDocumentId === rootDocumentId && importPath === "./fit-lib.nui"
          ? {
              status: "loaded",
              snapshot: {
                kind: "dependency-saved",
                documentId: libraryDocumentId,
                savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:issue-1673-fit-library"),
                normalizedSource: issue1673FitLibrarySource
              }
            }
          : { status: "failed", reason: "missing" }
    },
    declarationContributors: [moduleDeclarationContributor]
  });
  const moduleRuntimeContext = createModuleRuntimeContext(
    graph,
    analyzeMultiDocumentModuleSemantics(graph)
  );
  const rootNode = graph.nodes.get(rootDocumentId);
  if (!rootNode) throw new Error("missing Issue 1673 root graph node");
  const compiled = compileDslDocument(issue1673FitRootSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: issue1673FitSourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  if (!compiled.document || !compiled.statementMap || !compiled.majorVersion) {
    throw new Error("missing exact Issue 1673 compiled root document");
  }
  const lastGoodCompiled = compiled as LastGoodDslDocument;
  const runtime = projectVscodeMultiDocumentCanvasRuntime({
    graph,
    compiled: lastGoodCompiled,
    graphRevision: issue1673FitGraphRevision
  });
  if (!graph.valid || !moduleRuntimeContext.valid || !runtime) {
    throw new Error("missing current Issue 1673 imported Module runtime");
  }
  const runtimePresentation = canvasRuntimePresentationFor(runtime);
  const evaluation = evaluateElements(
    runtimePresentation.elements,
    buildEvaluationOptions({
      compiledDocument: lastGoodCompiled,
      evaluationLimitIndex: runtimePresentation.evaluationLimitIndex
    })
  );
  return {
    graph,
    compiled: lastGoodCompiled,
    runtime,
    runtimePresentation,
    evaluation
  };
};
