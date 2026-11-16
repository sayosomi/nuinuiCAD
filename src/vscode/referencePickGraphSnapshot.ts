import type { EvaluationResult } from "../types/geometry";
import { startVscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import type { CompiledDslDocument, SourceSnapshot } from "@nuinuicad/nui-language";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { referencePickTargetMatchesProof, sameReferencePickTargetProof, type VscodeReferencePickStartRequest, type VscodeReferencePickStartedResult } from "./referencePickProtocol";

/** A host-produced Pick projection, never a serialized compiler or resolver.
 * All candidate semantics are resolved against the same graph root as Canvas. */
export type VscodeReferencePickGraphSnapshot = {
  documentUri: string;
  documentVersion: number;
  graphRevision: number;
  source: SourceSnapshot;
  session: Omit<VscodeReferencePickCanvasSession, "request">;
  result: VscodeReferencePickStartedResult;
};

export type VscodeReferencePickGraphContext = {
  documentUri: string;
  graphRevision: number;
  sourceRevision: number;
  ready: boolean;
  failed?: boolean;
};

/** Consume the existing graph compile and shared candidate/session owner. */
export const projectReferencePickGraphSnapshot = ({ request, semantic, evaluation }: {
  request: VscodeReferencePickStartRequest;
  semantic: { rootDocumentId: string; documentVersion: number; graphRevision: number; sourceRevision: number; sourceText: string; compiled: CompiledDslDocument };
  evaluation: EvaluationResult;
}): VscodeReferencePickGraphSnapshot | null => {
  if (request.documentUri !== semantic.rootDocumentId || request.documentVersion !== semantic.documentVersion ||
    semantic.compiled.spans.sourceMap.source !== semantic.sourceText ||
    semantic.compiled.spans.sourceMap.sourceRevision !== semantic.sourceRevision ||
    semantic.compiled.statementMap?.sourceRevision !== semantic.sourceRevision ||
    !semantic.compiled.document || semantic.compiled.diagnostics.some(d => d.severity === "error") ||
    (semantic.compiled.bindingIssueDiagnostics ?? []).some(d => d.severity === "error")) return null;
  const source = { normalizedSource: semantic.sourceText, sourceRevision: semantic.sourceRevision };
  const started = startVscodeReferencePickCanvasSession({ request, source, compiled: semantic.compiled, evaluation,
    authoritativeDocumentUri: semantic.rootDocumentId, authoritativeDocumentVersion: semantic.documentVersion, evaluationIsCurrent: true });
  if (!started.session || started.result.status !== "started") return null;
  const { request: _request, ...session } = started.session;
  void _request;
  const snapshot = { ...started.result.snapshot!, graphRevision: semantic.graphRevision };
  return { documentUri: semantic.rootDocumentId, documentVersion: semantic.documentVersion, graphRevision: semantic.graphRevision,
    source, session: { ...session, snapshot }, result: { ...started.result, snapshot } };
};

/** The Webview consumes only a request-bound projection of its presented graph. */
export const referencePickGraphFreshness = (
  request: VscodeReferencePickStartRequest,
  normalizedSource: string,
  graph: VscodeReferencePickGraphContext | undefined
): "ready" | "defer" | "stale" => {
  const snapshot = request.graphSnapshot;
  if (!snapshot) return "ready";
  if (snapshot.documentUri !== request.documentUri || snapshot.documentVersion !== request.documentVersion ||
    snapshot.source.normalizedSource !== normalizedSource || snapshot.result.requestId !== request.requestId ||
    snapshot.result.documentUri !== request.documentUri || snapshot.result.documentVersion !== request.documentVersion ||
    !sameReferencePickTargetProof(snapshot.result.targetProof, request.targetProof) ||
    snapshot.result.snapshot?.graphRevision !== snapshot.graphRevision ||
    snapshot.result.snapshot.sourceRevision !== snapshot.source.sourceRevision ||
    snapshot.result.sessionMode !== snapshot.session.mode ||
    (request.mode === "browse" ? snapshot.session.target !== null : !snapshot.session.target || !request.targetProof ||
      !referencePickTargetMatchesProof(normalizedSource, snapshot.session.target, request.targetProof))) return "stale";
  if (!graph) return "defer";
  if (graph.documentUri !== request.documentUri || graph.graphRevision > snapshot.graphRevision) return "stale";
  if (graph.graphRevision < snapshot.graphRevision) return "defer";
  if (graph.sourceRevision !== snapshot.source.sourceRevision) return "stale";
  if (graph.failed) return "stale";
  return graph.ready ? "ready" : "defer";
};
