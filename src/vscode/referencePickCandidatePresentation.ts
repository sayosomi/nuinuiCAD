import type { ElementId } from "../types/geometry";
import {
  referencePickCandidateOptionKey,
  type ReferencePickCandidate,
  type ReferencePickGeometryOption
} from "../model/referencePickCandidates";

export type ReferencePickCandidateExplanation =
  | "individualOccurrence"
  | "allOccurrences"
  | "baseGeometry"
  | "allOccurrencesBaseGeometry"
  | "namedStage"
  | "individualNamedStage"
  | "allOccurrencesNamedStage"
  | "sourceGeometry";

export type PresentedReferencePickGeometryOption = {
  candidateElementId: ElementId;
  option: ReferencePickGeometryOption;
  explanation: ReferencePickCandidateExplanation;
};

export type ReferencePickCandidatePresentation = {
  primary: readonly PresentedReferencePickGeometryOption[];
  details: readonly PresentedReferencePickGeometryOption[];
};

const stagePathFor = (option: ReferencePickGeometryOption): string[] =>
  option.reference.pointKey?.split(".") ?? [];

const isBaseGeometry = (stagePath: readonly string[]) =>
  stagePath.length === 1 && stagePath[0] === "base";

const explanationFor = (
  stagePath: readonly string[],
  scope: "occurrence" | "bulk" | "source"
): ReferencePickCandidateExplanation => {
  if (isBaseGeometry(stagePath)) {
    return scope === "bulk" ? "allOccurrencesBaseGeometry" : "baseGeometry";
  }
  if (stagePath.length > 0) {
    if (scope === "occurrence") return "individualNamedStage";
    return scope === "bulk" ? "allOccurrencesNamedStage" : "namedStage";
  }
  if (scope === "occurrence") return "individualOccurrence";
  return scope === "bulk" ? "allOccurrences" : "sourceGeometry";
};

const presented = (
  candidateElementId: ElementId,
  option: ReferencePickGeometryOption,
  scope: "occurrence" | "bulk" | "source"
): PresentedReferencePickGeometryOption => ({
  candidateElementId,
  option,
  explanation: explanationFor(stagePathFor(option), scope)
});

/**
 * Classify only compiler/evaluator-authorized geometry options for the real
 * drawable hits supplied by the overlay. Candidate identity groups dedupe
 * locally; equal canonical references on different real hits remain distinct.
 */
export const referencePickCandidatePresentationForHits = (
  hitCandidates: readonly ReferencePickCandidate[]
): ReferencePickCandidatePresentation => {
  const optionsByElementId = new Map<ElementId, ReferencePickGeometryOption[]>();
  const seenByElementId = new Map<ElementId, Set<string>>();

  for (const candidate of hitCandidates) {
    const options = optionsByElementId.get(candidate.elementId) ?? [];
    const seen = seenByElementId.get(candidate.elementId) ?? new Set<string>();
    for (const option of candidate.options) {
      if (option.kind !== "geometry") continue;
      const key = referencePickCandidateOptionKey(option);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(option);
    }
    optionsByElementId.set(candidate.elementId, options);
    seenByElementId.set(candidate.elementId, seen);
  }

  const primary: PresentedReferencePickGeometryOption[] = [];
  const details: PresentedReferencePickGeometryOption[] = [];

  for (const [candidateElementId, options] of optionsByElementId) {
    const occurrenceIndexes = new Set(options.flatMap(({ reference }) =>
      reference.occurrenceIndex === undefined ? [] : [reference.occurrenceIndex]
    ));
    if (occurrenceIndexes.size > 1) {
      primary.push(...options.map((option) => presented(
        candidateElementId,
        option,
        option.reference.occurrenceIndex === undefined ? "bulk" : "occurrence"
      )));
      continue;
    }
    const occurrenceIndex = occurrenceIndexes.size === 1 ? [...occurrenceIndexes][0] : undefined;
    const scope = occurrenceIndex === undefined
      ? occurrenceIndexes.size === 0 ? "source" : "bulk"
      : "occurrence";

    const occurrenceOptions = occurrenceIndex === undefined
      ? []
      : options.filter((option) => option.reference.occurrenceIndex === occurrenceIndex);
    const bulkOptions = occurrenceIndex === undefined
      ? options
      : options.filter((option) => option.reference.occurrenceIndex === undefined);
    const ownPrimary = (occurrenceIndex === undefined ? bulkOptions : occurrenceOptions)
      .filter((option) => !isBaseGeometry(stagePathFor(option)));
    const ownDetails = occurrenceIndex === undefined
      ? bulkOptions.filter((option) => isBaseGeometry(stagePathFor(option)))
      : [
          ...occurrenceOptions.filter((option) => isBaseGeometry(stagePathFor(option))),
          ...bulkOptions.filter((option) => !isBaseGeometry(stagePathFor(option))),
          ...bulkOptions.filter((option) => isBaseGeometry(stagePathFor(option)))
        ];

    // A drawable candidate should map to one canonical occurrence. Preserve
    // every legal option visibly if a malformed/ambiguous candidate breaks
    // that production invariant; presentation must never guess by ID or label.
    if (ownPrimary.length === 0) {
      primary.push(...options.map((option) => presented(
        candidateElementId,
        option,
        occurrenceIndex === undefined
          ? "source"
          : option.reference.occurrenceIndex === undefined ? "bulk" : "occurrence"
      )));
      continue;
    }

    primary.push(...ownPrimary.map((option) => presented(candidateElementId, option, scope)));
    details.push(...ownDetails.map((option) => presented(
      candidateElementId,
      option,
      occurrenceIndexes.size === 0
        ? "source"
        : option.reference.occurrenceIndex === undefined ? "bulk" : "occurrence"
    )));
  }

  return { primary, details };
};
