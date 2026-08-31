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
  confirmedReferencePickNumericResult,
  confirmedReferencePickResult,
  selectReferencePickDraft,
  selectReferencePickNumericGeometry,
  selectReferencePickNumericProperty,
  seedReferencePickNumericPropertyDraft,
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
  isCanonicalReferencePickReference,
  isValidNumericReferencePickCandidate,
  sameReferencePickTargetProof,
  type VscodeReferencePickConfirmedResult,
  type VscodeReferencePickNumericCandidate,
  type VscodeReferencePickNumericPropertyDraft,
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

const uniqueNumericCandidates = (
  candidates: readonly ReferencePickCandidate[]
): VscodeReferencePickNumericCandidate[] => {
  const byReference = new Map<string, VscodeReferencePickNumericCandidate>();
  for (const candidate of candidates) {
    for (const option of candidate.options) {
      if (option.kind !== "numericProperty") continue;
      const key = referencePickReferenceKey(option.reference);
      const previous = byReference.get(key);
      if (!previous) {
        byReference.set(key, { reference: option.reference, properties: [...option.properties] });
        continue;
      }
      byReference.set(key, {
        reference: previous.reference,
        properties: [...new Set([...previous.properties, ...option.properties])]
      });
    }
  }
  return [...byReference.values()];
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
  const candidateReferenceKeys = new Set(uniqueCandidateReferences(candidates).map(referencePickReferenceKey));
  const numericCandidates = uniqueNumericCandidates(candidates);
  if (target.role === "numericPropertyBase" && !target.numericProperty) {
    return { session: null, result: rejected("rejected") };
  }
  const seedReferences = request.initialDraftReferences ?? (
    target.multiplicity === "multiple" ? referencePickSeedReferences(request.targetProof) : []
  );
  if (
    request.initialDraftReferences !== undefined &&
    (
      !seedReferences.every(isCanonicalReferencePickReference) ||
      (target.multiplicity === "single" && seedReferences.length !== 1) ||
      seedReferences.some((reference) => !candidateReferenceKeys.has(referencePickReferenceKey(reference)))
    )
  ) {
    return { session: null, result: rejected("rejected") };
  }
  const initialNumericDraft = request.initialNumericPropertyDraft;
  const matchingNumericCandidate = initialNumericDraft
    ? numericCandidates.find((candidate) =>
        referencePickReferenceKey(candidate.reference) === referencePickReferenceKey(initialNumericDraft.reference) &&
        candidate.properties.includes(initialNumericDraft.property)
      )
    : undefined;
  const matchingNumericCandidateElement = initialNumericDraft
    ? candidates.find((candidate) => candidate.options.some((option) =>
        option.kind === "numericProperty" &&
        referencePickReferenceKey(option.reference) === referencePickReferenceKey(initialNumericDraft.reference)
      ))
    : undefined;
  if (initialNumericDraft) {
    if (
      target.role !== "numericPropertyBase" ||
      !target.numericProperty ||
      !matchingNumericCandidate ||
      !matchingNumericCandidateElement ||
      !isCanonicalReferencePickReference(initialNumericDraft.reference)
    ) return { session: null, result: rejected("rejected") };
  }
  const draft = startReferencePickSession({
    expectedGeometryInterface: target.expectedGeometryInterface,
    role: target.role,
    multiplicity: target.multiplicity,
    seedReferences,
    ...(target.numericProperty ? { numericProperty: target.numericProperty } : {})
  });
  const seededDraft = initialNumericDraft
    ? seedReferencePickNumericPropertyDraft(
        draft,
        {
          candidateElementId: matchingNumericCandidateElement?.elementId ?? "",
          reference: initialNumericDraft.reference,
          property: initialNumericDraft.property
        },
        matchingNumericCandidate?.properties ?? []
      )
    : draft;
  const session: VscodeReferencePickCanvasSession = { request, target, candidates, draft: seededDraft };
  const result: VscodeReferencePickStartedResult = {
    ...resultBase(session),
    status: "started",
    candidateReferences: uniqueCandidateReferences(candidates),
    ...(target.role === "numericPropertyBase" ? { numericCandidates } : {})
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
  if (session.target.role === "numericPropertyBase") {
    if (!selection) return { ...session, draft: selectReferencePickDraft(session.draft, null) };
    const option = session.candidates
      .find((candidate) => candidate.elementId === selection.candidateElementId)
      ?.options.find((candidate) => candidate.kind === "numericProperty" &&
        referencePickReferenceKey(candidate.reference) === referencePickReferenceKey(selection.reference));
    return option?.kind === "numericProperty"
      ? { ...session, draft: selectReferencePickNumericGeometry(session.draft, selection, option.properties) }
      : session;
  }
  return { ...session, draft: selectReferencePickDraft(session.draft, selection) };
};

export const selectVscodeReferencePickCanvasNumericProperty = (
  session: VscodeReferencePickCanvasSession,
  property: VscodeReferencePickNumericPropertyDraft["property"]
): VscodeReferencePickCanvasSession => ({
  ...session,
  draft: selectReferencePickNumericProperty(session.draft, property)
});

export const confirmVscodeReferencePickCanvasSession = (
  session: VscodeReferencePickCanvasSession
): { session: VscodeReferencePickCanvasSession; result: VscodeReferencePickConfirmedResult | null } => {
  const draft = confirmReferencePickSession(session.draft);
  const updated = { ...session, draft };
  const references = confirmedReferencePickResult(draft);
  const numericProperty = confirmedReferencePickNumericResult(draft);
  return {
    session: updated,
    result: references
      ? { ...resultBase(updated), status: "confirmed", resultKind: "geometry", references }
      : numericProperty
        ? {
            ...resultBase(updated),
            status: "confirmed",
            resultKind: "numericProperty",
            reference: numericProperty.reference,
            property: numericProperty.property
          }
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
): boolean => {
  if (
    result.requestId !== session.request.requestId ||
    result.documentUri !== session.request.documentUri ||
    result.documentVersion !== session.request.documentVersion ||
    !sameReferencePickTargetProof(result.targetProof, session.request.targetProof)
  ) return false;
  if (result.status === "started") {
    if (!result.candidateReferences.every(isCanonicalReferencePickReference)) return false;
    return session.target.role !== "numericPropertyBase"
      ? result.numericCandidates === undefined
      : result.numericCandidates !== undefined &&
        result.numericCandidates.every(isValidNumericReferencePickCandidate) &&
        result.numericCandidates.every((candidate) => session.candidates.some((entry) =>
          entry.options.some((option) => option.kind === "numericProperty" &&
            referencePickReferenceKey(option.reference) === referencePickReferenceKey(candidate.reference) &&
            candidate.properties.every((property) => option.properties.includes(property))
          )
        ));
  }
  if (result.status !== "confirmed") return true;
  if (result.resultKind === "numericProperty") {
    if (session.target.role !== "numericPropertyBase") return false;
    const option = session.candidates
      .flatMap((candidate) => candidate.options)
      .find((candidate) => candidate.kind === "numericProperty" &&
        referencePickReferenceKey(candidate.reference) === referencePickReferenceKey(result.reference));
    return Boolean(
      option?.kind === "numericProperty" &&
      option.properties.includes(result.property) &&
      isCanonicalReferencePickReference(result.reference) &&
      result.reference.pointKey === undefined
    );
  }
  return session.target.role !== "numericPropertyBase";
}
