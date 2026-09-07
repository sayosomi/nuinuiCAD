import {
  compileDslDocument,
  createModuleRuntimeContext,
  queryDslCanvasRevealSourceTarget
} from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost,
  type DependencySavedSourceSnapshot,
  type RootCurrentSourceSnapshot
} from "@nuinuicad/nui-language/workspace";
import {
  projectVscodeMultiDocumentCanvasRuntime,
  canvasRuntimePresentationFor
} from "../multiDocumentRuntimeTransport";
import {
  vscodeMultiDocumentGraphSnapshot,
  type VscodeMultiDocumentGraphPublication
} from "../multiDocumentGraphTransport";

export const importedRevealLibrarySource = [
  "nui 1",
  "export module Panel(value: number = 20) {",
  "  point Base = coordinate(x: @value, y: 0)",
  "  export point Outline = coordinate(x: @value + 10, y: 10)",
  "}"
].join("\n");

export const importedRevealRootSource = [
  "nui 1",
  "import \"./library.nui\" as lib",
  "instance Direct = lib::Panel(value: 20)"
].join("\n");

export const importedRevealRootDocumentId = "file:///workspace/main.nui";
export const importedRevealLibraryDocumentId = "file:///workspace/library.nui";
export const importedRevealDocumentVersion = 7;
export const importedRevealGraphRevision = 41;
export const importedRevealGraphRootSourceRevision = 37;

export const buildImportedRevealFreshnessFixture = async (): Promise<{
  root: RootCurrentSourceSnapshot;
  dependency: DependencySavedSourceSnapshot;
  graph: Awaited<ReturnType<typeof buildMultiDocumentImportGraph>>;
  analysis: ReturnType<typeof analyzeMultiDocumentModuleSemantics>;
  moduleRuntimeContext: ReturnType<typeof createModuleRuntimeContext>;
  compiled: ReturnType<typeof compileDslDocument>;
  publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }>;
  runtimePresentation: NonNullable<ReturnType<typeof canvasRuntimePresentationFor>>;
  target: Extract<ReturnType<typeof queryDslCanvasRevealSourceTarget>, { status: "resolved" }>["target"];
}> => {
  const root: RootCurrentSourceSnapshot = {
    kind: "root-current",
    documentId: documentIdFromHost(importedRevealRootDocumentId),
    normalizedSource: importedRevealRootSource,
    sourceRevision: importedRevealGraphRootSourceRevision
  };
  const dependency: DependencySavedSourceSnapshot = {
    kind: "dependency-saved",
    documentId: documentIdFromHost(importedRevealLibraryDocumentId),
    savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:imported-reveal-library"),
    normalizedSource: importedRevealLibrarySource
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    loader: {
      loadSavedDependency: async (importerDocumentId, importPath) =>
        importerDocumentId === root.documentId && importPath === "./library.nui"
          ? { status: "loaded", snapshot: dependency }
          : { status: "failed", reason: "missing" }
    },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleRuntimeContext = createModuleRuntimeContext(graph, analysis);
  const rootNode = graph.nodes.get(root.documentId);
  if (!rootNode) throw new Error("missing imported Reveal graph root");
  const compiled = compileDslDocument(root.normalizedSource, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: root.sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  const canvasRuntime = projectVscodeMultiDocumentCanvasRuntime({
    graph,
    compiled,
    graphRevision: importedRevealGraphRevision
  });
  if (!graph.valid || !analysis.valid || !moduleRuntimeContext.valid || !compiled.moduleMaterialization || !canvasRuntime) {
    throw new Error("missing genuine imported Reveal runtime fixture");
  }
  const targetResult = queryDslCanvasRevealSourceTarget({
    source: {
      normalizedSource: root.normalizedSource,
      sourceRevision: root.sourceRevision
    },
    compiled,
    position: root.normalizedSource.indexOf("Direct")
  });
  if (targetResult.status !== "resolved") throw new Error("missing imported Reveal source target");

  const publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }> = {
    type: "multiDocumentGraphPublication",
    documentVersion: importedRevealDocumentVersion,
    status: "current",
    graph: vscodeMultiDocumentGraphSnapshot(graph, importedRevealGraphRevision),
    canvasRuntime
  };
  return {
    root,
    dependency,
    graph,
    analysis,
    moduleRuntimeContext,
    compiled,
    publication,
    runtimePresentation: canvasRuntimePresentationFor(canvasRuntime),
    target: targetResult.target
  };
};
