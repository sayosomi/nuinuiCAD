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
import {
  canvasRuntimePresentationFor,
  projectVscodeMultiDocumentCanvasRuntime
} from "../multiDocumentRuntimeTransport";
import {
  vscodeMultiDocumentGraphSnapshot,
  type VscodeMultiDocumentGraphPublication
} from "../multiDocumentGraphTransport";

export const issue1651RootDocumentUri = "file:///workspace/module_test.nui";
export const issue1651LibraryDocumentUri = "file:///workspace/module_test_lib.nui";
export const issue1651DocumentVersion = 7;
export const issue1651GraphRevision = 41;
export const issue1651GraphSourceRevision = 37;

const pointA = "point A = coordinate(x: 0, y: 0)";

export const issue1651RootSourceFor = (testCase: "A" | "B" | "C" | "D"): string => {
  switch (testCase) {
    case "A":
      return `nui 1\n\n${pointA}`;
    case "B":
      return `nui 1\n\nimport "./module_test_lib.nui" as lib\n\n${pointA}`;
    case "C":
      return [
        "nui 1",
        "",
        "module Sample() {",
        "}",
        "",
        "instance S = Sample()",
        "",
        pointA
      ].join("\n");
    case "D":
      return [
        "nui 1",
        "",
        'import "./module_test_lib.nui" as lib',
        "",
        "instance S = lib::Sample()",
        "",
        pointA
      ].join("\n");
  }
};

export const issue1651LibrarySourceFor = (withGeometry: boolean): string => [
  "nui 1",
  "",
  "export module Sample() {",
  ...(withGeometry ? ["  point Imported = coordinate(x: 50, y: 0)"] : []),
  "}"
].join("\n");

export const buildIssue1651ImportedModuleCanvasEditFixture = async (
  withGeometry = false,
  rootDocumentUri = issue1651RootDocumentUri
): Promise<{
  source: string;
  librarySource: string;
  publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }>;
  runtimePresentation: NonNullable<ReturnType<typeof canvasRuntimePresentationFor>>;
  compiled: LastGoodDslDocument;
}> => {
  const source = issue1651RootSourceFor("D");
  const librarySource = issue1651LibrarySourceFor(withGeometry);
  const rootDocumentId = documentIdFromHost(rootDocumentUri);
  const libraryDocumentId = documentIdFromHost(issue1651LibraryDocumentUri);
  const graph = await buildMultiDocumentImportGraph({
    root: {
      kind: "root-current",
      documentId: rootDocumentId,
      normalizedSource: source,
      sourceRevision: issue1651GraphSourceRevision
    },
    loader: {
      loadSavedDependency: async (importerDocumentId, importPath) =>
        importerDocumentId === rootDocumentId && importPath === "./module_test_lib.nui"
          ? {
              status: "loaded",
              snapshot: {
                kind: "dependency-saved",
                documentId: libraryDocumentId,
                savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:issue-1651-library"),
                normalizedSource: librarySource
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
  if (!rootNode) throw new Error("missing Issue 1651 root graph node");
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision: issue1651GraphSourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  if (!compiled.document || !compiled.statementMap || !compiled.majorVersion) {
    throw new Error("missing exact Issue 1651 compiled root document");
  }
  const lastGoodCompiled = compiled as LastGoodDslDocument;
  const runtime = projectVscodeMultiDocumentCanvasRuntime({
    graph,
    compiled: lastGoodCompiled,
    graphRevision: issue1651GraphRevision
  });
  if (!graph.valid || !moduleRuntimeContext.valid || !runtime) {
    throw new Error("missing current Issue 1651 imported Module runtime");
  }
  const projectedRuntime = canvasRuntimePresentationFor(runtime);
  const runtimePresentation = {
    ...projectedRuntime,
    // Host graph publications cross a structured-clone boundary. Keep that
    // identity separation in tests so unchanged runtime elements are not
    // accidentally recognized through shared in-process object references.
    elements: projectedRuntime.elements.map((element) => structuredClone(element))
  };
  const publication: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }> = {
    type: "multiDocumentGraphPublication",
    documentVersion: issue1651DocumentVersion,
    status: "current",
    hostDocumentUri: rootDocumentUri,
    graph: vscodeMultiDocumentGraphSnapshot(graph, issue1651GraphRevision),
    canvasRuntime: runtime
  };
  return {
    source,
    librarySource,
    publication,
    runtimePresentation,
    compiled: lastGoodCompiled
  };
};
