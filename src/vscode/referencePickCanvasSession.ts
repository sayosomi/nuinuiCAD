import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import {
  queryDslReferencePickTarget,
  referencePickStatementIdentityAt,
  type DslReferencePickTarget,
  type SourceSnapshot
} from "@nuinuicad/nui-language";
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
    preserveSourceFocus?: boolean;
  };
  target: DslReferencePickTarget;
  candidates: readonly ReferencePickCandidate[];
  draft: ReferencePickSession;
};

/** Rendering, hit testing and Fit share the compiler-selected value geometry.
 * Header Pick instead retains drawable geometry and exposes its occurrences. */
export const referencePickCanvasEvaluationFor = (
  session: Pick<VscodeReferencePickCanvasSessionLike, "target" | "candidates">,
  evaluation: EvaluationResult
): EvaluationResult => {
  if (session.target.syntax === "transformationTarget") return {
    ...evaluation, effectiveVisibleElementIds: new Set(session.candidates.map(candidate => candidate.elementId))
  };
  const computedGeometry = new Map(evaluation.computedGeometry);
  for (const candidate of session.candidates) {
    if (candidate.geometry) computedGeometry.set(candidate.elementId, candidate.geometry);
  }
  return { ...evaluation, computedGeometry };
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
  snapshot: Pick<VscodeReferencePickCanvasSnapshot, "source" | "compiled">
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

const exactNormalizedStatementSourceFor = (
  compiled: CompiledDslDocument,
  statement: CompiledDslDocument["statements"][number]
): string | null => {
  const sourceMap = compiled.spans.sourceMap;
  const { from, to, sourceRevision } = statement.documentRange;
  if (
    statement.sourceRevision !== sourceRevision ||
    sourceRevision !== sourceMap.sourceRevision ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > sourceMap.source.length
  ) return null;
  return sourceMap.source.slice(from, to);
};

const sameSavedCandidateSources = (current: CompiledDslDocument, pinned: CompiledDslDocument): boolean => {
  const currentContext = current.moduleRuntimeContext;
  const pinnedContext = pinned.moduleRuntimeContext;
  if (!currentContext && !pinnedContext) return true;
  if (!currentContext?.valid || !pinnedContext?.valid ||
      currentContext.rootDocumentId !== pinnedContext.rootDocumentId) return false;
  const currentFingerprints = currentContext.graph.dependencyFingerprints;
  const pinnedFingerprints = pinnedContext.graph.dependencyFingerprints;
  return currentFingerprints.size === pinnedFingerprints.size &&
    [...pinnedFingerprints].every(([documentId, fingerprint]) => currentFingerprints.get(documentId) === fingerprint);
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

  if (target.syntax !== "transformationTarget") {
    // A stable target identity alone cannot prove a value's prefix. A moved
    // target or an edited upstream recipe would make the same inserted token
    // read different geometry from the pinned Canvas candidate. Only the
    // target being edited may differ; other source/scope identities stay exact.
    if (!sameSavedCandidateSources(currentCompiled, canvasSnapshot.compiled) ||
        candidateStatementIndex !== target.sourceAnchor.statementIndex ||
        currentCompiled.statements.length < canvasSnapshot.compiled.statements.length) return null;
    for (const [index, pinned] of canvasSnapshot.compiled.statements.entries()) {
      const current = currentCompiled.statements[index];
      if (index === target.sourceAnchor.statementIndex) continue;
      const currentSource = current && exactNormalizedStatementSourceFor(currentCompiled, current);
      const pinnedSource = exactNormalizedStatementSourceFor(canvasSnapshot.compiled, pinned);
      if (!current ||
          referencePickStatementIdentityAt(currentCompiled, index) !== referencePickStatementIdentityAt(canvasSnapshot.compiled, index) ||
          currentCompiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(index) !==
            canvasSnapshot.compiled.sourceLexicalNamespace?.scopeIndex.scopeOfStatement.get(index) ||
          currentSource == null || pinnedSource === null || currentSource !== pinnedSource) return null;
    }
  }

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
 * Project a newly inserted, semantically queryable Source target onto the
 * coherent Canvas namespace without claiming that the old Canvas document
 * contains the new statement. Every existing Canvas statement must retain its
 * reconciler-owned identity, exact source and lexical scope. A middle insertion
 * must be a single transformation; appended authoring holes retain their
 * existing support. The insertion index is the candidate source-order boundary,
 * so later Canvas statements cannot become earlier transformation targets.
 */
export const reanchorInsertedReferencePickTargetToCanvasSnapshot = ({
  target,
  currentCompiled,
  canvasSnapshot
}: {
  target: DslReferencePickTarget;
  currentCompiled: CompiledDslDocument;
  canvasSnapshot: Pick<VscodeReferencePickCanvasSnapshot, "source" | "compiled">;
}): DslReferencePickTarget | null => {
  if (!coherentCanvasSnapshot(canvasSnapshot)) return null;
  if (target.syntax !== "transformationTarget" && !sameSavedCandidateSources(currentCompiled, canvasSnapshot.compiled)) return null;
  const currentIds = currentCompiled.statementMap?.statementIdByStatementIndex;
  const canvasIds = canvasSnapshot.compiled.statementMap?.statementIdByStatementIndex;
  const canvasScopeIndex = canvasSnapshot.compiled.sourceLexicalNamespace?.scopeIndex;
  const currentScopeIndex = currentCompiled.sourceLexicalNamespace?.scopeIndex;
  if (!currentIds || !canvasIds || !canvasScopeIndex || !currentScopeIndex) return null;

  const canvasLength = canvasSnapshot.compiled.statements.length;
  const insertedIndex = target.sourceAnchor.statementIndex;
  const middleInsertion = insertedIndex < canvasLength;
  const insertedStatement = currentCompiled.statements[insertedIndex];
  const insertedCount = insertedStatement?.kind === "extract"
    ? 1 + insertedStatement.parts.length : 1;
  const removableExtract = insertedStatement?.kind === "extract" &&
    currentCompiled.statements.slice(insertedIndex + 1, insertedIndex + insertedCount).every(statement =>
      statement.kind === "element" && statement.extractPart?.declarationIndex === insertedIndex);
  if (
    insertedIndex < 0 || insertedIndex > canvasLength ||
    currentCompiled.statements.length <= canvasLength ||
    (middleInsertion && (
      !removableExtract && (target.syntax !== "transformationTarget" || insertedStatement?.kind !== "transformation") ||
      currentCompiled.statements.length !== canvasLength + insertedCount
    )) ||
    currentIds.get(insertedIndex) !== target.sourceAnchor.statementId ||
    [...currentIds.values()].filter((statementId) => statementId === target.sourceAnchor.statementId).length !== 1 ||
    [...canvasIds.values()].filter((statementId) => statementId === target.sourceAnchor.statementId).length > 0 ||
    !canvasScopeIndex.scopes.has(target.sourceAnchor.scopeId) ||
    currentScopeIndex.scopeOfStatement.get(insertedIndex) !== target.sourceAnchor.scopeId
  ) return null;

  for (let index = 0; index < canvasLength; index += 1) {
    const currentIndex = middleInsertion && index >= insertedIndex ? index + insertedCount : index;
    const currentId = currentIds.get(currentIndex);
    const canvasId = canvasIds.get(index);
    const currentStatement = currentCompiled.statements[currentIndex];
    const canvasStatement = canvasSnapshot.compiled.statements[index];
    if (!currentStatement || !canvasStatement || !sameReconciledStatementShape(currentStatement, canvasStatement)) return null;

    if (currentId !== canvasId) return null;
    if (currentId !== undefined && (
      currentCompiled.statementMap?.statementIndexByStatementId?.get(currentId) !== currentIndex ||
      canvasSnapshot.compiled.statementMap?.statementIndexByStatementId?.get(currentId) !== index
    )) return null;

    const currentScopeId = currentScopeIndex.scopeOfStatement.get(currentIndex);
    const canvasScopeId = canvasScopeIndex.scopeOfStatement.get(index);
    if (currentScopeId !== canvasScopeId) return null;
    if (currentScopeId !== undefined) {
      const currentScope = currentScopeIndex.scopes.get(currentScopeId);
      const canvasScope = canvasScopeIndex.scopes.get(currentScopeId);
      if (!currentScope || !canvasScope || currentScope.kind !== canvasScope.kind || currentScope.parentId !== canvasScope.parentId) return null;
    }

    const currentSource = exactNormalizedStatementSourceFor(currentCompiled, currentStatement);
    const canvasSource = exactNormalizedStatementSourceFor(canvasSnapshot.compiled, canvasStatement);
    if (currentSource === null || canvasSource === null || currentSource !== canvasSource) return null;
  }

  return {
    ...target,
    sourceAnchor: {
      ...target.sourceAnchor,
      sourceRevision: canvasSnapshot.source.sourceRevision,
      statementIndex: insertedIndex,
      sourceOrderIndex: insertedIndex,
      scopeId: target.sourceAnchor.scopeId
    }
  };
};

const candidateCompiledForReferencePickTarget = (
  compiled: CompiledDslDocument,
  target: DslReferencePickTarget
): CompiledDslDocument => {
  const namespace = compiled.sourceLexicalNamespace;
  if (!namespace || namespace.scopeIndex.scopeOfStatement.get(target.sourceAnchor.statementIndex) === target.sourceAnchor.scopeId) return compiled;
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
  candidateSnapshot,
  requireCandidates = false
}: {
  request: VscodeReferencePickStartRequest;
  authoritativeDocumentUri: string;
  authoritativeDocumentVersion: number;
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  evaluation: EvaluationResult;
  evaluationIsCurrent: boolean;
  candidateSnapshot?: VscodeReferencePickCanvasSnapshot;
  /** Probe a pinned authority before falling back to incomplete-source projection. */
  requireCandidates?: boolean;
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
    ? reanchorReferencePickTargetToCanvasSnapshot({ target, currentCompiled: compiled, canvasSnapshot: candidateSnapshot }) ??
      reanchorInsertedReferencePickTargetToCanvasSnapshot({ target, currentCompiled: compiled, canvasSnapshot: candidateSnapshot })
    : target;
  if (!candidateTarget) return { session: null, result: rejected("stale") };
  const candidateCompiled = candidateSnapshot
    ? candidateCompiledForReferencePickTarget(candidateSnapshot.compiled, candidateTarget)
    : compiled;
  const candidateEvaluation = candidateSnapshot?.evaluation ?? evaluation;
  const candidates = referencePickCandidates({ compiled: candidateCompiled, evaluation: candidateEvaluation, target: candidateTarget });
  const candidateReferenceKeys = new Set(referencePickCandidateReferences(candidates).map(referencePickReferenceKey));
  // Decline an empty pinned authority before seed validation: valid authored
  // prefixes can still be available in the projected current Source. The
  // eventual projected/current start retains normal empty and seed policies.
  if (requireCandidates && candidateReferenceKeys.size === 0) return { session: null, result: rejected("stale") };
  const numericCandidates = uniqueNumericCandidates(candidates);
  if (candidateTarget.role === "numericPropertyBase" && !candidateTarget.numericProperty) {
    return { session: null, result: rejected("rejected") };
  }
  const authoredSeeds = referencePickSeedReferences(request.targetProof);
  const transformationTarget = candidateTarget.syntax === "transformationTarget";
  // Validate authored prefixes even when the host supplies an explicit draft.
  // An invalid or unavailable prefix must never turn into an empty selection.
  if (transformationTarget && (!authoredSeeds || authoredSeeds.some(reference =>
    !candidateReferenceKeys.has(referencePickReferenceKey(reference))
  ))) return { session: null, result: rejected("rejected") };
  const seedReferences = request.initialDraftReferences ?? (
    transformationTarget || candidateTarget.multiplicity === "multiple" ? authoredSeeds ?? [] : []
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
    selectionCount: candidateTarget.selectionCount,
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
  return { session, result };
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
