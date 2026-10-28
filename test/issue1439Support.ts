import { createHash } from "node:crypto";
import { posix } from "node:path";
import { compileDslDocument, createModuleRuntimeContext } from "@nuinuicad/nui-language";
import { analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph, documentIdFromHost, moduleDeclarationContributor, savedSourceFingerprintFromHost, type SavedDocumentArtifactCache } from "@nuinuicad/nui-language/workspace";

export const buildRecordImport = async (source: string, saved: Record<string, string>, cache?: SavedDocumentArtifactCache) => {
  const rootId = documentIdFromHost("/issue1439/root.nui");
  const graph = await buildMultiDocumentImportGraph({
    root: { kind: "root-current", documentId: rootId, normalizedSource: source, sourceRevision: 1 },
    cache,
    loader: { async loadSavedDependency(importer, relative) {
      const path = posix.normalize(posix.join(posix.dirname(importer), relative));
      const text = saved[posix.basename(path)];
      return text === undefined ? { status: "failed", reason: "missing" } : { status: "loaded", snapshot: {
        kind: "dependency-saved", documentId: documentIdFromHost(path), normalizedSource: text,
        savedSourceFingerprint: savedSourceFingerprintFromHost(createHash("sha256").update(text).digest("hex"))
      } };
    } },
    declarationContributors: [moduleDeclarationContributor]
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  const node = graph.nodes.get(rootId)!;
  const compiled = compileDslDocument(source, { preparsed: node.artifact.parsed, sourceRevision: 1,
    assignedStatementIds: node.artifact.statementIdByStatementIndex, moduleRuntimeContext: context });
  const errors = [...compiled.diagnostics, ...(compiled.bindingIssueDiagnostics ?? [])].filter(d => d.severity === "error");
  return { graph, analysis, context, compiled, errors };
};
