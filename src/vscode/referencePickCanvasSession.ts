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

/**
 * The coherent Canvas snapshot that supplied the geometry currently being
 * rendered. Its source is candidate authority only; the current Source
 * context remains the mutation and target authority.
 */
export type VscodeReferencePickCanvasSnapshot = {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
};

const coherentCanvasSnapshot = (
  snapshot: VscodeReferencePickCanvasSnapshot
): boolean => {
  const { source, compiled } = snapshot;
  return !source.normalizedSource.includes("\r") &&
    compiled.document !== null &&
    compiled.statementMap !== null &&
    compiled.sourceLexicalNamespace !== undefined &&
    compiled.spans.sourceMap.source === source.normalizedSource &&
    compiled.spans.sourceMap.sourceRevision === source.sourceRevision &&
    compiled.statementMap.sourceRevision === source.sourceRevision;
};

const sameReconciledStatementShape = (
  left: CompiledDslDocument["statements"][number],
  right: CompiledDslDocument["statements"][number]
): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "element" || right.kind !== "element") return true;
  return left.type === right.type && left.category === right.category;
};

/**
 * Re-anchor an exact-current target to the only statement with the same
 * reconciler-owned identity in the coherent Canvas snapshot. Statement IDs
 * are the existing source-of-truth for this proof; missing or duplicate IDs
 * fail closed rather than falling back to source positions or names.
 */
export const reanchorReferencePickTargetToCanvasSnapshot = ({
  target,
  currentCompiled,
  canvasSnapshot
}: {
  target: DslReferencePickTarget;
  currentCompiled: CompiledDslDocument;
  canvasSnapshot: VscodeReferencePickCanvasSnapshot;
}): DslReferencePickTarget | null => {
  if (!coherentCanvasSnapshot(canvasSnapshot)) return null;
  const currentStatement = currentCompiled.statements[target.sourceAnchor.statementIndex];
  if (!currentStatement) return null;

  const statementMap = canvasSnapshot.compiled.statementMap!;
  const statementId = target.sourceAnchor.statementId;
  const candidateStatementIndex = statementMap.statementIndexByStatementId?.get(statementId);
  if (candidateStatementIndex === undefined) return null;
  const matchingIndexes = [...(statementMap.statementIdByStatementIndex ?? [])]
    .filter(([, candidateId]) => candidateId === statementId)
    .map(([statementIndex]) => statementIndex);
  if (matchingIndexes.length !== 1 || matchingIndexes[0] !== candidateStatementIndex) return null;

  const candidateStatement = canvasSnapshot.compiled.statements[candidateStatementIndex];
  const candidateStatementInfo = statementMap.statements[candidateStatementIndex];
  const candidateScopeId = canvasSnapshot.compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(candidateStatementIndex);
  if (
    !candidateStatement ||
    !candidateStatementInfo ||
    !candidateScopeId ||
    !sameReconciledStatementShape(currentStatement, candidateStatement) ||
    statementMap.statementIdByStatementIndex?.get(candidateStatementIndex) !== statementId
  ) return null;

  return {
    ...target,
    sourceAnchor: {
      ...target.sourceAnchor,
      sourceRevision: canvasSnapshot.source.sourceRevision,
      statementIndex: candidateStatementIndex,
      sourceOrderIndex: candidateStatementIndex,
      scopeId: candidateScopeId,
      statementRange: {
        from: candidateStatement.documentRange.from,
        to: candidateStatement.documentRange.to,
        startLine: candidateStatementInfo.range.startLine,
        endLine: candidateStatementInfo.range.endLine
      }
    }
  };
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
 * Starts a Canvas-side draft from the exact current target. For an intentionally
 * pinned Canvas, candidate geometry may come from the coherent rendered
 * snapshot after a reconciler-identity re-anchor. No Source mutation occurs
 * here.
 */
export const startVscodeReferencePickCanvasSession = ({
  request,
  authoritativeDocumentUri,
  authoritativeDocumentVersion,
  source,
  compiled,
  evaluation,
  evaluationIsCurrent,
  candidateSnapshot
}: {
  request: VscodeReferencePickStartRequest;
  authoritativeDocumentUri: string;
  authoritativeDocumentVersion: number;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  candidateSnapshot?: VscodeReferencePickCanvasSnapshot;
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
    (!evaluationIsCurrent && !candidateSnapshot)
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

  const candidateTarget = candidateSnapshot
    ? reanchorReferencePickTargetToCanvasSnapshot({ target, currentCompiled: compiled, canvasSnapshot: candidateSnapshot })
    : target;
  if (!candidateTarget) return { session: null, result: rejected("stale") };
  const candidateCompiled = candidateSnapshot?.compiled ?? compiled;
  const candidateEvaluation = candidateSnapshot?.evaluation ?? evaluation;
  const candidates = referencePickCandidates({ compiled: candidateCompiled, evaluation: candidateEvaluation, target: candidateTarget });
  const candidateReferenceKeys = new Set(uniqueCandidateReferences(candidates).map(referencePickReferenceKey));
  const numericCandidates = uniqueNumericCandidates(candidates);
  if (candidateTarget.role === "numericPropertyBase" && !candidateTarget.numericProperty) {
    return { session: null, result: rejected("rejected") };
  }
  const seedReferences = request.initialDraftReferences ?? (
    candidateTarget.multiplicity === "multiple" ? referencePickSeedReferences(request.targetProof) : []
  );
  if (
    request.initialDraftReferences !== undefined &&
    (
      !seedReferences.every(isCanonicalReferencePickReference) ||
      (candidateTarget.multiplicity === "single" && seedReferences.length !== 1) ||
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
      candidateTarget.role !== "numericPropertyBase" ||
      !candidateTarget.numericProperty ||
      !matchingNumericCandidate ||
      !matchingNumericCandidateElement ||
      !isCanonicalReferencePickReference(initialNumericDraft.reference)
    ) return { session: null, result: rejected("rejected") };
  }
  const draft = startReferencePickSession({
    expectedGeometryInterface: candidateTarget.expectedGeometryInterface,
    role: candidateTarget.role,
    multiplicity: candidateTarget.multiplicity,
    seedReferences,
    ...(candidateTarget.numericProperty ? { numericProperty: candidateTarget.numericProperty } : {})
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
  const session: VscodeReferencePickCanvasSession = {
    request,
    target: candidateTarget,
    candidates,
    draft: seededDraft
  };
  const result: VscodeReferencePickStartedResult = {
    ...resultBase(session),
    status: "started",
    candidateReferences: uniqueCandidateReferences(candidates),
    ...(candidateTarget.role === "numericPropertyBase" ? { numericCandidates } : {})
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
