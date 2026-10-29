import { createHash } from "node:crypto";
import { posix } from "node:path";
import { compileDslDocument, createModuleRuntimeContext, parseDslSnapshot } from "@nuinuicad/nui-language";
import { reconcileStatements } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph, buildMultiDocumentSemanticOccurrenceIndex,
  createMultiDocumentModuleRenameDocumentProof, documentIdFromHost, moduleDeclarationContributor,
  projectMultiDocumentModuleSemanticDocumentView, savedSourceFingerprintFromHost,
  type RootCurrentSourceSnapshot, type MultiDocumentImportGraph, type MultiDocumentSourceSnapshot,
  type MultiDocumentSemanticOccurrenceIndex
} from "@nuinuicad/nui-language/workspace";
import primary from "./fixtures/issue1486/primary.json";
export type Case = typeof primary[number];
export type Range = { from: number; to: number };
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const id = (file: string) => documentIdFromHost(`/issue1486/${file}`);
export const current = (file: string, text: string, revision = 1): RootCurrentSourceSnapshot => ({
  kind: "root-current", documentId: id(file), normalizedSource: text, sourceRevision: revision
});
export const saved = (file: string, text: string) => ({
  kind: "dependency-saved" as const, documentId: id(file), normalizedSource: text,
  savedSourceFingerprint: savedSourceFingerprintFromHost(hash(text))
});
export const idsFor = (file: string, text: string) => {
  let counter = 0;
  return reconcileStatements({ oldStatements: [], oldLines: [], oldElementIds: new Map(), oldStatementIds: new Map(),
    newStatements: parseDslSnapshot({ normalizedSource: text, sourceRevision: 1 }).statements, newLines: text.split("\n")
  }, { createStatementId: kind => `${file}:${kind}:${++counter}` }).assignedIds;
};
export const graphInput = (files: Record<string, string>, root: string, revision = 1) => ({
  root: current(root, files[root]!, revision), declarationContributors: [moduleDeclarationContributor],
  rootStatementIdByStatementIndex: idsFor(root, files[root]!),
  savedDependencyStatementIdsForDocument: (source: MultiDocumentSourceSnapshot) => idsFor(posix.basename(source.documentId), source.normalizedSource),
  loader: { async loadSavedDependency(importer: string, relative: string) {
    const file = posix.basename(posix.join(posix.dirname(importer), relative));
    return files[file] === undefined ? { status: "failed" as const, reason: "missing" as const }
      : { status: "loaded" as const, snapshot: saved(file, files[file]) };
  } }
});
export const compileGraph = (graph: MultiDocumentImportGraph) => {
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const node = graph.nodes.get(graph.rootDocumentId)!;
  const compiled = compileDslDocument(graph.rootSource.normalizedSource, {
    preparsed: node.artifact.parsed, sourceRevision: graph.rootSource.sourceRevision,
    assignedStatementIds: node.artifact.statementIdByStatementIndex,
    moduleRuntimeContext: createModuleRuntimeContext(graph, analysis)
  });
  const view = projectMultiDocumentModuleSemanticDocumentView({ source: graph.rootSource, compiled });
  return { graph, analysis, compiled, view, index: buildMultiDocumentSemanticOccurrenceIndex({ graph, documentViews: [view] }) };
};
export const bundle = async (files: Record<string, string>, root: string, revision = 1) =>
  compileGraph(await buildMultiDocumentImportGraph(graphInput(files, root, revision)));
export const texts = (row: Case) => Object.fromEntries(Object.entries(row.files).map(([file, source]) => [file, source.text]));
export const ranges = (row: Case, file: string, key: string): Range[] => {
  const source = (row.files as Record<string, { ranges: Record<string, Range[]> }>)[file];
  return source?.ranges[key] ?? [];
};
export const snapshots = (row: Case) => ({ ...row, source: texts(row) });
export type Bundle = Awaited<ReturnType<typeof bundle>>;
export const proofFor = (bundles: Bundle[]) => createMultiDocumentModuleRenameDocumentProof({
  graph: findBundle(bundles, "root.nui").graph, analysis: findBundle(bundles, "root.nui").analysis, graphs: bundles.slice(1).map(b => b.graph),
  compiledByDocument: new Map(bundles.map(b => [b.graph.rootDocumentId, b.compiled]))
});
export const findBundle = (bundles: Bundle[], file: string) => bundles.find(b => b.graph.rootDocumentId === id(file))!;
export const publicIndex = (b: Bundle, record: boolean): MultiDocumentSemanticOccurrenceIndex => record
  ? buildMultiDocumentSemanticOccurrenceIndex({ graph: b.graph }) : b.index;
