import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  queryDslReferencePickTarget,
  type DslReferencePickTarget,
  type SourceSnapshot
} from "../dsl/dslReferencePickQuery";
import {
  referencePickCandidates,
  type ReferencePickCandidate,
  type ReferencePickCandidateOption
} from "../model/referencePickCandidates";
import {
  cancelReferencePickSession,
  confirmReferencePickSession,
  confirmedReferencePickResult,
  selectReferencePickDraft,
  setReferencePickHover,
  startReferencePickSession,
  type ReferencePickHover,
  type ReferencePickSession
} from "../model/referencePickSession";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import type { EvaluationResult } from "../types/geometry";
import {
  referencePickReferenceKey,
  referencePickSeedReferences,
  referencePickTargetMatchesProof,
  sameReferencePickTargetProof,
  type VscodeReferencePickConfirmedResult,
  type VscodeReferencePickResult,
  type VscodeReferencePickStartRequest,
  type VscodeReferencePickStartedResult
} from "./referencePickProtocol";

export type VscodeReferencePickCanvasSession = {
  request: VscodeReferencePickStartRequest;
  target: DslReferencePickTarget;
  candidates: readonly ReferencePickCandidate[];
  draft: ReferencePickSession;
};

const uniqueCandidateReferences = (
  candidates: readonly ReferencePickCandidate[]
): CanonicalGeometrySourceReference[] => {
  const seen = new Set<string>();
  const result: CanonicalGeometrySourceReference[] = [];
  for (const candidate of candidates) {
    for (const option of candidate.options) {
      const key = referencePickReferenceKey(option.reference);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(option.reference);
    }
  }
  return result;
};

const resultBase = (session: VscodeReferencePickCanvasSession) => ({
  type: "referencePickResult" as const,
  requestId: session.request.requestId,
  documentUri: session.request.documentUri,
  documentVersion: session.request.documentVersion,
  targetProof: session.request.targetProof
});

/**
 * Starts a Canvas-side draft only when the Webview's exact authoritative
 * document and current evaluation can reproduce the Extension Host target
 * proof. No Source mutation occurs here.
 */
export const startVscodeReferencePickCanvasSession = ({
  request,
  authoritativeDocumentUri,
  authoritativeDocumentVersion,
  source,
  compiled,
  evaluation,
  evaluationIsCurrent
}: {
  request: VscodeReferencePickStartRequest;
  authoritativeDocumentUri: string;
  authoritativeDocumentVersion: number;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
}): {
  session: VscodeReferencePickCanvasSession | null;
  result: VscodeReferencePickResult;
} => {
  const rejected = (status: "stale" | "rejected"): VscodeReferencePickResult => ({
    type: "referencePickResult",
    requestId: request.requestId,
    documentUri: request.documentUri,
    documentVersion: request.documentVersion,
    targetProof: request.targetProof,
    status
  });
  if (
    request.documentUri !== authoritativeDocumentUri ||
    request.documentVersion !== authoritativeDocumentVersion ||
    !evaluationIsCurrent
  ) return { session: null, result: rejected("stale") };
  const target = queryDslReferencePickTarget({
    source,
    position: request.normalizedSourceOffset,
    semantic: {
      sourceRevision: source.sourceRevision,
      sourceText: source.normalizedSource,
      compiled
    }
  });
  if (!target || !referencePickTargetMatchesProof(source.normalizedSource, target, request.targetProof)) {
    return { session: null, result: rejected("stale") };
  }

  const candidates = referencePickCandidates({ compiled, evaluation, target });
  const draft = startReferencePickSession({
    expectedGeometryInterface: target.expectedGeometryInterface,
    role: target.role,
    multiplicity: target.multiplicity,
    seedReferences: target.multiplicity === "multiple"
      ? referencePickSeedReferences(request.targetProof)
      : []
  });
  const session: VscodeReferencePickCanvasSession = { request, target, candidates, draft };
  const result: VscodeReferencePickStartedResult = {
    ...resultBase(session),
    status: "started",
    candidateReferences: uniqueCandidateReferences(candidates)
  };
  return { session, result };
};

const optionBelongsToSession = (
  session: VscodeReferencePickCanvasSession,
  candidateElementId: string,
  reference: CanonicalGeometrySourceReference
): boolean => session.candidates.some((candidate) =>
  candidate.elementId === candidateElementId &&
  candidate.options.some((option) => referencePickReferenceKey(option.reference) === referencePickReferenceKey(reference))
);

export const referencePickHoverForCanvasOption = (
  candidate: ReferencePickCandidate,
  option: ReferencePickCandidateOption
): ReferencePickHover => ({
  candidateElementId: candidate.elementId,
  reference: option.reference
});

export const setVscodeReferencePickCanvasHover = (
  session: VscodeReferencePickCanvasSession,
  hover: ReferencePickHover | null
): VscodeReferencePickCanvasSession => {
  if (hover && !optionBelongsToSession(session, hover.candidateElementId, hover.reference)) return session;
  return { ...session, draft: setReferencePickHover(session.draft, hover) };
};

export const selectVscodeReferencePickCanvasDraft = (
  session: VscodeReferencePickCanvasSession,
  selection: ReferencePickHover | null
): VscodeReferencePickCanvasSession => {
  if (selection && !optionBelongsToSession(session, selection.candidateElementId, selection.reference)) return session;
  return { ...session, draft: selectReferencePickDraft(session.draft, selection) };
};

export const confirmVscodeReferencePickCanvasSession = (
  session: VscodeReferencePickCanvasSession
): { session: VscodeReferencePickCanvasSession; result: VscodeReferencePickConfirmedResult | null } => {
  const draft = confirmReferencePickSession(session.draft);
  const updated = { ...session, draft };
  const references = confirmedReferencePickResult(draft);
  return {
    session: updated,
    result: references
      ? { ...resultBase(updated), status: "confirmed", references }
      : null
  };
};

export const cancelVscodeReferencePickCanvasSession = (
  session: VscodeReferencePickCanvasSession
): { session: VscodeReferencePickCanvasSession; result: VscodeReferencePickResult } => {
  const updated = { ...session, draft: cancelReferencePickSession(session.draft) };
  return {
    session: updated,
    result: { ...resultBase(updated), status: "canceled" }
  };
};

export const referencePickCanvasResultMatchesSession = (
  session: VscodeReferencePickCanvasSession,
  result: VscodeReferencePickResult
): boolean =>
  result.requestId === session.request.requestId &&
  result.documentUri === session.request.documentUri &&
  result.documentVersion === session.request.documentVersion &&
  sameReferencePickTargetProof(result.targetProof, session.request.targetProof);
