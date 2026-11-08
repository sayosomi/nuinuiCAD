import type { ElementId } from "../types/geometry";
import {
  referencePickCandidateOptionKey,
  type ReferencePickCandidate,
  type ReferencePickGeometryOption
} from "../model/referencePickCandidates";

export type ReferencePickCandidateExplanation =
  | "individualOccurrence"
  | "allOccurrences"
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

const presented = (
  candidateElementId: ElementId,
  option: ReferencePickGeometryOption,
  explanation: ReferencePickCandidateExplanation
): PresentedReferencePickGeometryOption => ({
  candidateElementId,
  option,
  explanation
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
    if (occurrenceIndexes.size === 0) {
      primary.push(...options.map((option) => presented(candidateElementId, option, "sourceGeometry")));
      continue;
    }

    const occurrenceOptions = options.filter((option) => option.reference.occurrenceIndex !== undefined);
    const bulkOptions = options.filter((option) => option.reference.occurrenceIndex === undefined);
    primary.push(...occurrenceOptions.map((option) => presented(candidateElementId, option, "individualOccurrence")));
    details.push(...bulkOptions.map((option) => presented(candidateElementId, option, "allOccurrences")));
  }

  return { primary, details };
};
