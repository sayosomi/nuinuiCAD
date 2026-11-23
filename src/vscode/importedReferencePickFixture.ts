import { emptyEvaluationResult } from "../geometry/evaluationEngine";
import { compileDslDocument, createModuleRuntimeContext, queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import { analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph, documentIdFromHost, moduleDeclarationContributor, savedSourceFingerprintFromHost } from "@nuinuicad/nui-language/workspace";
import { evaluateElements } from "../geometry/evaluate";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { referencePickTargetProofFor } from "./referencePickProtocol";

export const importedPickUri = "file:///workspace/patterns/pick_test.nui";
const libraryUri = "file:///workspace/modules/pick_module.nui";
const rootBody = `point A = coordinate(x: 0, y: 0)\npoint B = offset(\n  from: A,\n  dx: 10,\n  dy: 0,\n)\n`;
export const importedPickFixture = async (relation: "A" | "B" | "C" | "D" | "E" | "F", empty = false, options: { editable?: boolean; missing?: boolean; invalid?: boolean } = {}) => {
  const local = relation === "D" || relation === "E";
  const imported = relation !== "A" && relation !== "D";
  const instance = relation !== "A" && relation !== "B";
  const body = empty || relation === "F" ? "" : "point marker = coordinate(x: x, y: 0)";
  const text = `nui 1\n${imported ? 'import "../modules/pick_module.nui" as probe\n' : ""}${options.editable ? rootBody.replace("point B = offset", "point B = coordinate(x: 30, y: 0)\npoint Result = offset") : rootBody}${local ? `module Probe(x: number) {\npoint marker = coordinate(x: x, y: 0)\n}\n` : ""}${instance ? `instance N = ${local ? "" : "probe::"}Probe(x: ${options.invalid ? "true" : "20"})\n` : ""}`;
  const source = { normalizedSource: text, sourceRevision: 12 };
  const graph = await buildMultiDocumentImportGraph({
    root: { ...source, kind: "root-current", documentId: documentIdFromHost(importedPickUri) },
    loader: { async loadSavedDependency() { if (options.missing) return { status: "failed", reason: "missing" }; return { status: "loaded", snapshot: { kind: "dependency-saved", documentId: documentIdFromHost(libraryUri), savedSourceFingerprint: savedSourceFingerprintFromHost(`fixture-${empty}`), normalizedSource: `nui 1\nexport module Probe(x: number) {\n${body}\n}\n` } }; } },
    declarationContributors: [moduleDeclarationContributor]
  });
  const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
  const compiled = compileDslDocument(text, { preparsed: graph.nodes.get(graph.rootDocumentId)!.artifact.parsed, sourceRevision: 12, assignedStatementIds: graph.nodes.get(graph.rootDocumentId)!.artifact.statementIdByStatementIndex, moduleRuntimeContext: context });
  const standalone = compileDslDocument(text, { sourceRevision: 12, assignedStatementIds: graph.nodes.get(graph.rootDocumentId)!.artifact.statementIdByStatementIndex });
  const evaluation = compiled.document && compiled.statementMap && compiled.majorVersion ? evaluateElements(compiled.document.elements, buildEvaluationOptions({ compiledDocument: { ...compiled, document: compiled.document, statementMap: compiled.statementMap, majorVersion: compiled.majorVersion }, evaluationLimitIndex: undefined })) : emptyEvaluationResult([]);
  const offset = text.indexOf("from: A") + "from: ".length;
  const target = queryDslReferencePickTarget({ source, position: offset, semantic: { sourceRevision: 12, sourceText: text, compiled } })!;
  const request = { type: "referencePickStartRequest" as const, requestId: 1, documentUri: importedPickUri, documentVersion: 7, normalizedSourceOffset: offset, targetProof: target ? referencePickTargetProofFor(text, target) : null };
  return { source, graph, compiled, standalone, evaluation, request };
};
