import type { ElementId } from "../types/geometry";
import type { PointAnchor } from "../types/geometry";
import type { CanonicalGeometrySourceReference } from "./moduleSemanticCandidateBoundary";
import { pointAnchorForSourceReference, sourceReferenceText } from "./moduleSemanticCandidateBoundary";
import type { PickCandidate, PickOption } from "./pickCandidates";
import { pickRefForOption, pickRefKey } from "./pickReferences";

export type PickModeKind = "point" | "line" | "numeric-reference";
export type PickModeSelectionCardinality = "single" | "ordered-multiple";

export type PickModeSession = {
  kind: PickModeKind;
  targetElementId: ElementId;
  targetParameterKey: string;
  selectionCardinality: PickModeSelectionCardinality;
  /** Resolved, uncommitted values owned only by this explicit Pick session. */
  draft: readonly PickModeDraftEntry[];
};

export type PickModeDraftEntry =
  | {
      kind: "point";
      key: string;
      anchor: PointAnchor;
      sourceReference?: CanonicalGeometrySourceReference;
    }
  | {
      kind: "line";
      key: string;
      lineId: ElementId;
      sourceReference?: CanonicalGeometrySourceReference;
    }
  | {
      kind: "numeric-reference";
      key: string;
      expression: string;
    };

export type PickModeSemanticTarget = {
  elementId: ElementId;
  parameterKey: string;
  selectionCardinality?: PickModeSelectionCardinality;
};

export type PickModeSemanticTargets = {
  point: PickModeSemanticTarget | null;
  numericReference: PickModeSemanticTarget | null;
  line: PickModeSemanticTarget | null;
};

export const pickModeSelectionCardinalityFor = (
  target: PickModeSemanticTarget
): PickModeSelectionCardinality =>
  target.selectionCardinality ?? "single";

export const pickModeDraftEntryForOption = (
  candidateElementId: ElementId,
  option: PickOption
): PickModeDraftEntry => {
  const key = pickRefKey(pickRefForOption(candidateElementId, option));
  if (option.kind === "point") {
    return {
      kind: "point",
      key,
      anchor: option.anchor,
      ...(option.sourceReference ? { sourceReference: option.sourceReference } : {})
    };
  }
  if (option.kind === "line") {
    return {
      kind: "line",
      key,
      lineId: option.lineId,
      ...(option.sourceReference ? { sourceReference: option.sourceReference } : {})
    };
  }
  return {
    kind: "numeric-reference",
    key,
    expression: option.expression
  };
};

const pointAnchorKey = (anchor: PointAnchor) => JSON.stringify(anchor);

const pointOptionMatchesAnchor = (anchor: PointAnchor, option: PickOption) =>
  option.kind === "point" && (
    pointAnchorKey(option.sourceReference ? pointAnchorForSourceReference(option.sourceReference) : option.anchor) === pointAnchorKey(anchor) ||
    Boolean(option.sourceReference) && pointAnchorKey(option.anchor) === pointAnchorKey(anchor)
  );

const lineOptionMatchesValue = (lineId: ElementId, option: PickOption) => {
  if (option.kind !== "line") return false;
  if (!option.sourceReference) return option.lineId === lineId;
  const sourceText = sourceReferenceText(option.sourceReference);
  return lineId === sourceText ||
    lineId === option.sourceReference.base ||
    lineId === sourceText?.slice(1) ||
    lineId === option.lineId;
};

const firstMatchingOption = (
  candidates: readonly PickCandidate[],
  matches: (option: PickOption) => boolean
) => {
  for (const candidate of candidates) {
    const option = candidate.options.find(matches);
    if (option) return { candidate, option };
  }
  return null;
};

const uniqueDraftEntries = (entries: readonly PickModeDraftEntry[]) => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
};

/** Resolves committed point-list values through the current Canvas candidate authority. */
export const pickModeDraftForPointAnchors = (
  anchors: readonly PointAnchor[],
  candidates: readonly PickCandidate[]
) => uniqueDraftEntries(anchors.flatMap((anchor) => {
  const resolved = firstMatchingOption(candidates, (option) => pointOptionMatchesAnchor(anchor, option));
  return resolved ? [pickModeDraftEntryForOption(resolved.candidate.elementId, resolved.option)] : [];
}));

/** Resolves committed line-list values through the current Canvas candidate authority. */
export const pickModeDraftForLineIds = (
  lineIds: readonly ElementId[],
  candidates: readonly PickCandidate[]
) => uniqueDraftEntries(lineIds.flatMap((lineId) => {
  const resolved = firstMatchingOption(candidates, (option) => lineOptionMatchesValue(lineId, option));
  return resolved ? [pickModeDraftEntryForOption(resolved.candidate.elementId, resolved.option)] : [];
}));

export const activatePickModeDraftEntry = (
  session: PickModeSession,
  entry: PickModeDraftEntry
): PickModeSession => {
  const currentIndex = session.draft.findIndex((candidate) => candidate.key === entry.key);
  if (session.selectionCardinality === "single") {
    return {
      ...session,
      draft: currentIndex >= 0 ? [] : [entry]
    };
  }
  return {
    ...session,
    draft: currentIndex >= 0
      ? session.draft.filter((_, index) => index !== currentIndex)
      : [...session.draft, entry]
  };
};

export const movePickModeDraftEntry = (
  draft: readonly PickModeDraftEntry[],
  key: string,
  toIndex: number
) => {
  const fromIndex = draft.findIndex((entry) => entry.key === key);
  if (fromIndex < 0 || draft.length < 2) return [...draft];
  const boundedIndex = Math.max(0, Math.min(toIndex, draft.length - 1));
  if (fromIndex === boundedIndex) return [...draft];
  const next = [...draft];
  const [entry] = next.splice(fromIndex, 1);
  if (!entry) return next;
  next.splice(boundedIndex, 0, entry);
  return next;
};

export const removePickModeDraftEntry = (
  draft: readonly PickModeDraftEntry[],
  key: string
) => draft.filter((entry) => entry.key !== key);

export const pickModeSessionForTarget = (
  kind: PickModeKind,
  target: PickModeSemanticTarget | null,
  selectionCardinality = target ? pickModeSelectionCardinalityFor(target) : "single",
  draft: readonly PickModeDraftEntry[] = []
): PickModeSession | null => target ? {
  kind,
  targetElementId: target.elementId,
  targetParameterKey: target.parameterKey,
  selectionCardinality,
  draft: [...draft]
} : null;

/**
 * Projects an explicit mode session only when it still belongs to one of the
 * current semantic targets. Target fields remain candidate/caller data; this
 * projection is the single active/inactive boundary for Pick Mode consumers.
 */
export const matchingPickModeSessionForTargets = (
  session: PickModeSession | null | undefined,
  targets: PickModeSemanticTargets
): PickModeSession | null => {
  if (!session) return null;
  const target = session.kind === "point"
    ? targets.point
    : session.kind === "line"
      ? targets.line
      : targets.numericReference;
  if (!target) return null;
  return target.elementId === session.targetElementId &&
      target.parameterKey === session.targetParameterKey &&
      pickModeSelectionCardinalityFor(target) === session.selectionCardinality
    ? session
    : null;
};
