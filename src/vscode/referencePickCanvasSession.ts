import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  queryDslReferencePickTarget,
  type DslReferencePickTarget,
  type SourceSnapshot
} from "../dsl/dslReferencePickQuery";
import {
  referencePickCandidates,
  referencePickNumericSubgeometryKey,
  type ReferencePickCandidate,
  type ReferencePickCandidateOption
} from "../model/referencePickCandidates";
import {
  cancelReferencePickSession,
  confirmReferencePickSession,
  confirmedReferencePickNumericResult,
  confirmedReferencePickResult,
  moveReferencePickDraft,
  removeReferencePickDraft,
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
  type VscodeReferencePickDiagnosticEvent,
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

/** Route-neutral Canvas state. Protocol adapters provide the route-specific
 * request/result proof while this state owns the draft and candidate UX. */
export type VscodeReferencePickCanvasSessionLike = {
  request: {
    requestId: number;
    documentUri: string;
    documentVersion: number;
  };
  target: DslReferencePickTarget;
  candidates: readonly ReferencePickCandidate[];
  draft: ReferencePickSession;
};

export const createVscodeReferencePickCanvasSession = <
  TRequest extends VscodeReferencePickCanvasSessionLike["request"]
>({
  request,
  target,
  candidates,
  draft
}: {
  request: TRequest;
  target: DslReferencePickTarget;
  candidates: readonly ReferencePickCandidate[];
  draft: ReferencePickSession;
}): VscodeReferencePickCanvasSessionLike & { request: TRequest } => ({
  request,
  target,
  candidates,
  draft
});

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

/**
 * Project a newly appended, semantically queryable Source target onto the
 * coherent Canvas namespace without claiming that the old Canvas document
 * contains the new statement. Every existing Canvas statement must retain its
 * reconciler-owned identity and position; only the target's existing lexical
 * scope is extended to the virtual appended statement index.
 */
const reanchorAppendedReferencePickTargetToCanvasSnapshot = ({
  target,
  currentCompiled,
  canvasSnapshot
}: {
  target: DslReferencePickTarget;
  currentCompiled: CompiledDslDocument;
  canvasSnapshot: VscodeReferencePickCanvasSnapshot;
}): DslReferencePickTarget | null => {
  if (!coherentCanvasSnapshot(canvasSnapshot)) return null;
  const currentIds = currentCompiled.statementMap?.statementIdByStatementIndex;
  const canvasIds = canvasSnapshot.compiled.statementMap?.statementIdByStatementIndex;
  const canvasScopeIndex = canvasSnapshot.compiled.sourceLexicalNamespace?.scopeIndex;
  if (!currentIds || !canvasIds || !canvasScopeIndex) return null;

  const appendedIndex = canvasSnapshot.compiled.statements.length;
  if (
    target.sourceAnchor.statementIndex !== appendedIndex ||
    currentCompiled.statements.length <= appendedIndex ||
    currentIds.get(appendedIndex) !== target.sourceAnchor.statementId ||
    [...canvasIds.values()].filter((statementId) => statementId === target.sourceAnchor.statementId).length > 0 ||
    !canvasScopeIndex.scopes.has(target.sourceAnchor.scopeId)
  ) return null;

  for (let index = 0; index < appendedIndex; index += 1) {
    const currentId = currentIds.get(index);
    const canvasId = canvasIds.get(index);
    const currentStatement = currentCompiled.statements[index];
    const canvasStatement = canvasSnapshot.compiled.statements[index];
    if (
      currentId === undefined ||
      canvasId === undefined ||
      currentId !== canvasId ||
      !currentStatement ||
      !canvasStatement ||
      !sameReconciledStatementShape(currentStatement, canvasStatement)
    ) return null;
  }

  return {
    ...target,
    sourceAnchor: {
      ...target.sourceAnchor,
      sourceRevision: canvasSnapshot.source.sourceRevision,
      statementIndex: appendedIndex,
      sourceOrderIndex: appendedIndex,
      scopeId: target.sourceAnchor.scopeId
    }
  };
};

const referencePickStatementShapeFor = (
  statement: CompiledDslDocument["statements"][number] | undefined
): { kind: string; type?: string | null; category?: string | null } | null => {
  if (!statement) return null;
  return statement.kind === "element"
    ? {
        kind: statement.kind,
        type: statement.type ?? null,
        category: statement.category ?? null
      }
    : { kind: statement.kind };
};

/**
 * Captures the identity facts used by the existing Canvas re-anchor guards.
 * This is intentionally a read-only diagnostic projection; it is not used to
 * choose a different re-anchor path.
 */
export const referencePickCandidateReanchorFactsFor = ({
  target,
  currentCompiled,
  canvasSnapshot
}: {
  target: DslReferencePickTarget;
  currentCompiled: CompiledDslDocument;
  canvasSnapshot: VscodeReferencePickCanvasSnapshot;
}) => {
  const currentIds = currentCompiled.statementMap?.statementIdByStatementIndex;
  const canvasIds = canvasSnapshot.compiled.statementMap?.statementIdByStatementIndex;
  const canvasScopeIndex = canvasSnapshot.compiled.sourceLexicalNamespace?.scopeIndex;
  const targetStatementIndex = target.sourceAnchor.statementIndex;
  const targetStatementId = target.sourceAnchor.statementId;
  const sharedPrefixCount = Math.min(
    currentCompiled.statements.length,
    canvasSnapshot.compiled.statements.length
  );
  const sharedPrefixStatementIds = Array.from({ length: sharedPrefixCount }, (_, index) => ({
    index,
    currentId: currentIds?.get(index) ?? null,
    pinnedId: canvasIds?.get(index) ?? null
  }));
  const firstMismatchingPrefix = Array.from({ length: sharedPrefixCount }, (_, index) => index)
    .map((index) => ({
      index,
      currentId: currentIds?.get(index) ?? null,
      pinnedId: canvasIds?.get(index) ?? null,
      currentShape: referencePickStatementShapeFor(currentCompiled.statements[index]),
      pinnedShape: referencePickStatementShapeFor(canvasSnapshot.compiled.statements[index])
    }))
    .find((entry) =>
      entry.currentId !== entry.pinnedId ||
      JSON.stringify(entry.currentShape) !== JSON.stringify(entry.pinnedShape)
    ) ?? null;

  return {
    targetStatementIndex,
    targetStatementId,
    targetScopeId: target.sourceAnchor.scopeId,
    currentStatementCount: currentCompiled.statements.length,
    pinnedCanvasStatementCount: canvasSnapshot.compiled.statements.length,
    targetExactlyAppendIndex: targetStatementIndex === canvasSnapshot.compiled.statements.length,
    currentTargetStatementIdMatchesCurrentStatementMap:
      currentIds?.get(targetStatementIndex) === targetStatementId,
    targetStatementIdAlreadyExistsInPinnedCanvasMap:
      [...(canvasIds?.values() ?? [])].some((statementId) => statementId === targetStatementId),
    targetScopeExistsInPinnedCanvasScopeIndex:
      canvasScopeIndex?.scopes.has(target.sourceAnchor.scopeId) ?? false,
    sharedPrefixStatementIds,
    firstMismatchingPrefixIndex: firstMismatchingPrefix?.index ?? null,
    firstMismatchingPrefix
  };
};

const candidateCompiledForReferencePickTarget = (
  compiled: CompiledDslDocument,
  target: DslReferencePickTarget
): CompiledDslDocument => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || target.sourceAnchor.statementIndex !== compiled.statements.length) return compiled;
  const scopeOfStatement = new Map(namespace.scopeIndex.scopeOfStatement);
  scopeOfStatement.set(target.sourceAnchor.statementIndex, target.sourceAnchor.scopeId);
  return {
    ...compiled,
    sourceLexicalNamespace: {
      ...namespace,
      scopeIndex: {
        ...namespace.scopeIndex,
        scopeOfStatement
      }
    }
  };
};

export const referencePickCandidateReferences = (
  candidates: readonly ReferencePickCandidate[]
): CanonicalGeometrySourceReference[] => {
  const seen = new Set<string>();
  const result: CanonicalGeometrySourceReference[] = [];
  for (const candidate of candidates) {
    for (const option of candidate.options) {
      if (!isCanonicalReferencePickReference(option.reference)) continue;
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
  diagnostic: VscodeReferencePickDiagnosticEvent;
} => {
  const rejected = (status: "stale" | "rejected"): VscodeReferencePickResult => ({
    type: "referencePickResult",
    requestId: request.requestId,
    documentUri: request.documentUri,
    documentVersion: request.documentVersion,
    targetProof: request.targetProof,
    status
  });
  const diagnosticFor = (
    outcome: VscodeReferencePickDiagnosticEvent["outcome"],
    reason: string,
    details: VscodeReferencePickDiagnosticEvent["details"] = {}
  ): VscodeReferencePickDiagnosticEvent => ({
    requestId: request.requestId,
    documentUri: request.documentUri,
    documentVersion: request.documentVersion,
    stage: "canvasSessionStart",
    outcome,
    reason,
    details
  });
  const rejectedWithDiagnostic = (
    status: "stale" | "rejected",
    reason: string,
    details: VscodeReferencePickDiagnosticEvent["details"] = {}
  ) => ({
    session: null,
    result: rejected(status),
    diagnostic: diagnosticFor(status, reason, details)
  });
  if (
    request.documentUri !== authoritativeDocumentUri ||
    request.documentVersion !== authoritativeDocumentVersion
  ) {
    return rejectedWithDiagnostic("stale", "host-document-or-version-authority-mismatch", {
      requestDocumentUri: request.documentUri,
      authoritativeDocumentUri,
      requestDocumentVersion: request.documentVersion,
      authoritativeDocumentVersion
    });
  }
  if (!evaluationIsCurrent && !candidateSnapshot) {
    return rejectedWithDiagnostic("stale", "missing-usable-evaluation-or-candidate-snapshot-authority", {
      evaluationIsCurrent,
      candidateSnapshotProvided: candidateSnapshot !== undefined
    });
  }
  if (!evaluationIsCurrent && candidateSnapshot && !coherentCanvasSnapshot(candidateSnapshot)) {
    return rejectedWithDiagnostic("stale", "missing-usable-evaluation-or-candidate-snapshot-authority", {
      evaluationIsCurrent,
      candidateSnapshotProvided: true,
      candidateSnapshotCoherent: false
    });
  }
  const target = queryDslReferencePickTarget({
    source,
    position: request.normalizedSourceOffset,
    semantic: {
      sourceRevision: source.sourceRevision,
      sourceText: source.normalizedSource,
      compiled
    }
  });
  if (!target) {
    return rejectedWithDiagnostic("stale", "target-missing", {
      normalizedSourceOffset: request.normalizedSourceOffset
    });
  }
  if (!referencePickTargetMatchesProof(source.normalizedSource, target, request.targetProof)) {
    return rejectedWithDiagnostic("stale", "target-proof-mismatch", {
      normalizedSourceOffset: request.normalizedSourceOffset,
      targetStatementIndex: target.sourceAnchor.statementIndex,
      targetStatementId: target.sourceAnchor.statementId
    });
  }

  let candidateTarget: DslReferencePickTarget | null = target;
  let candidateReanchorMode: "existing" | "appended" | null = null;
  if (candidateSnapshot) {
    const existingTarget = reanchorReferencePickTargetToCanvasSnapshot({
      target,
      currentCompiled: compiled,
      canvasSnapshot: candidateSnapshot
    });
    const appendedTarget = existingTarget
      ? null
      : reanchorAppendedReferencePickTargetToCanvasSnapshot({
          target,
          currentCompiled: compiled,
          canvasSnapshot: candidateSnapshot
        });
    candidateTarget = existingTarget ?? appendedTarget;
    candidateReanchorMode = existingTarget ? "existing" : appendedTarget ? "appended" : null;
    if (!candidateTarget) {
      return rejectedWithDiagnostic("stale", "candidate-target-reanchor-failed", {
        canvasSnapshotCoherent: coherentCanvasSnapshot(candidateSnapshot),
        ...referencePickCandidateReanchorFactsFor({
          target,
          currentCompiled: compiled,
          canvasSnapshot: candidateSnapshot
        })
      });
    }
  } else {
    candidateTarget = target;
  }
  if (!candidateTarget) {
    return rejectedWithDiagnostic("stale", "candidate-target-reanchor-failed");
  }
  const candidateCompiled = candidateSnapshot
    ? candidateCompiledForReferencePickTarget(candidateSnapshot.compiled, candidateTarget)
    : compiled;
  const candidateEvaluation = candidateSnapshot?.evaluation ?? evaluation;
  const candidates = referencePickCandidates({ compiled: candidateCompiled, evaluation: candidateEvaluation, target: candidateTarget });
  const candidateReferenceKeys = new Set(referencePickCandidateReferences(candidates).map(referencePickReferenceKey));
  const numericCandidates = uniqueNumericCandidates(candidates);
  if (candidateTarget.role === "numericPropertyBase" && !candidateTarget.numericProperty) {
    return rejectedWithDiagnostic("rejected", "numeric-target-metadata-rejected", {
      targetRole: candidateTarget.role,
      numericPropertyMetadataPresent: false
    });
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
    return rejectedWithDiagnostic("rejected", "invalid-initial-geometry-draft", {
      targetMultiplicity: candidateTarget.multiplicity,
      initialDraftReferenceCount: seedReferences.length,
      candidateReferenceCount: candidateReferenceKeys.size
    });
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
    ) return rejectedWithDiagnostic("rejected", "invalid-initial-numeric-draft", {
      targetRole: candidateTarget.role,
      numericCandidateCount: numericCandidates.length,
      matchingNumericCandidate: matchingNumericCandidate !== undefined,
      matchingNumericCandidateElement: matchingNumericCandidateElement !== undefined,
      canonicalReference: isCanonicalReferencePickReference(initialNumericDraft.reference)
    });
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
    target,
    candidates,
    draft: seededDraft
  };
  const result: VscodeReferencePickStartedResult = {
    ...resultBase(session),
    status: "started",
    candidateReferences: referencePickCandidateReferences(candidates),
    ...(candidateTarget.role === "numericPropertyBase" ? { numericCandidates } : {})
  };
  return {
    session,
    result,
    diagnostic: diagnosticFor("started", "canvas-reference-pick-session-started", {
      candidateAuthority: candidateSnapshot ? "pinned-canvas-snapshot" : "current-evaluation",
      ...(candidateReanchorMode ? { candidateReanchorMode } : {}),
      candidateCount: candidates.length,
      candidateReferenceCount: result.candidateReferences.length,
      numericCandidateCount: numericCandidates.length,
      targetRole: candidateTarget.role
    })
  };
};

const optionBelongsToSession = (
  session: VscodeReferencePickCanvasSessionLike,
  selection: ReferencePickHover
): boolean => session.candidates.some((candidate) =>
  candidate.elementId === selection.candidateElementId &&
  candidate.options.some((option) =>
    referencePickReferenceKey(option.reference) === referencePickReferenceKey(selection.reference) &&
    (option.kind !== "numericProperty"
      ? selection.numericSubgeometry === undefined
      : selection.numericSubgeometry !== undefined &&
        referencePickNumericSubgeometryKey(option.subgeometry) === referencePickNumericSubgeometryKey(selection.numericSubgeometry))
  )
);

export const referencePickHoverForCanvasOption = (
  candidate: ReferencePickCandidate,
  option: ReferencePickCandidateOption
): ReferencePickHover => ({
  candidateElementId: candidate.elementId,
  reference: option.reference,
  ...(option.kind === "numericProperty" ? { numericSubgeometry: option.subgeometry } : {})
});

export const setVscodeReferencePickCanvasHover = <TSession extends VscodeReferencePickCanvasSessionLike>(
  session: TSession,
  hover: ReferencePickHover | null
): TSession => {
  if (hover && !optionBelongsToSession(session, hover)) return session;
  return { ...session, draft: setReferencePickHover(session.draft, hover) } as TSession;
};

export const selectVscodeReferencePickCanvasDraft = <TSession extends VscodeReferencePickCanvasSessionLike>(
  session: TSession,
  selection: ReferencePickHover | null
): TSession => {
  if (selection && !optionBelongsToSession(session, selection)) return session;
  if (session.target.role === "numericPropertyBase") {
    if (!selection) return { ...session, draft: selectReferencePickDraft(session.draft, null) } as TSession;
    const option = session.candidates
      .find((candidate) => candidate.elementId === selection.candidateElementId)
      ?.options.find((candidateOption) =>
        candidateOption.kind === "numericProperty" &&
        referencePickReferenceKey(candidateOption.reference) === referencePickReferenceKey(selection.reference) &&
        selection.numericSubgeometry !== undefined &&
        referencePickNumericSubgeometryKey(candidateOption.subgeometry) === referencePickNumericSubgeometryKey(selection.numericSubgeometry)
      );
    return option?.kind === "numericProperty"
      ? { ...session, draft: selectReferencePickNumericGeometry(session.draft, selection, option.properties) } as TSession
      : session;
  }
  return { ...session, draft: selectReferencePickDraft(session.draft, selection) } as TSession;
};

export const moveVscodeReferencePickCanvasDraft = <TSession extends VscodeReferencePickCanvasSessionLike>(
  session: TSession,
  referenceKey: string,
  toIndex: number
): TSession => ({
  ...session,
  draft: moveReferencePickDraft(session.draft, referenceKey, toIndex)
} as TSession);

export const removeVscodeReferencePickCanvasDraft = <TSession extends VscodeReferencePickCanvasSessionLike>(
  session: TSession,
  referenceKey: string
): TSession => ({
  ...session,
  draft: removeReferencePickDraft(session.draft, referenceKey)
} as TSession);

export const selectVscodeReferencePickCanvasNumericProperty = <TSession extends VscodeReferencePickCanvasSessionLike>(
  session: TSession,
  property: VscodeReferencePickNumericPropertyDraft["property"]
): TSession => ({
  ...session,
  draft: selectReferencePickNumericProperty(session.draft, property)
} as TSession);

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
            referencePickReferenceKey(option.reference) === referencePickReferenceKey(candidate.reference)
          ) && candidate.properties.every((property) => entry.options.some((option) =>
            option.kind === "numericProperty" &&
            referencePickReferenceKey(option.reference) === referencePickReferenceKey(candidate.reference) &&
            option.properties.includes(property)
          ))
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
