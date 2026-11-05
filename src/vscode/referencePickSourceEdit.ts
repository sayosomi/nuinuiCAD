import type { CompiledDslDocument } from "@nuinuicad/nui-language";
import {
  queryDslReferencePickTarget,
  type SourceSnapshot
} from "@nuinuicad/nui-language";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import { isNumericComputedGeometryProperty } from "../geometry/numericExpressions";
import {
  isCanonicalReferencePickReference,
  referencePickReferenceKey,
  referencePickReplacementText,
  referencePickSeedReferences,
  referencePickTargetMatchesProof,
  referencePickSourceForReference,
  type VscodeReferencePickNumericCandidate,
  type VscodeReferencePickNumericPropertyDraft,
  type VscodeReferencePickTargetProof
} from "./referencePickProtocol";

export type VscodeReferencePickSourceEditPlan = {
  range: { from: number; to: number };
  replacement: string;
  caretNormalizedOffset: number;
};

const referenceMatchesTargetShape = (
  proof: VscodeReferencePickTargetProof,
  reference: CanonicalGeometrySourceReference
): boolean => {
  if (!isCanonicalReferencePickReference(reference)) return false;
  if (proof.role === "endpoint") return reference.pointKey !== undefined;
  // Header branches are carried in the canonical reference's dotted suffix.
  // Exact candidate membership below remains authoritative for legal stages.
  if (proof.syntax === "transformationTarget") return true;
  if (proof.expectedGeometryInterface !== "point") return reference.pointKey === undefined;
  return true;
};

/**
 * Revalidates the exact current Source target immediately before the Extension
 * Host applies a confirmed Canvas pick. Candidate references are accepted only
 * from the Canvas candidate snapshot captured for this request. Existing
 * multi-value value references can also be retained; transformation header
 * seeds must belong to that authorized snapshot before any replacement.
 */
export const planVscodeReferencePickSourceEdit = ({
  source,
  compiled,
  normalizedSourceOffset,
  targetProof,
  references,
  allowedCandidateReferences,
  numericProperty,
  allowedNumericCandidates
}: {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  normalizedSourceOffset: number;
  targetProof: VscodeReferencePickTargetProof;
  references: readonly CanonicalGeometrySourceReference[];
  allowedCandidateReferences: readonly CanonicalGeometrySourceReference[];
  numericProperty?: VscodeReferencePickNumericPropertyDraft;
  allowedNumericCandidates?: readonly VscodeReferencePickNumericCandidate[];
}): VscodeReferencePickSourceEditPlan | null => {
  const target = queryDslReferencePickTarget({
    source,
    position: normalizedSourceOffset,
    semantic: {
      sourceRevision: source.sourceRevision,
      sourceText: source.normalizedSource,
      compiled
    }
  });
  if (!target || !referencePickTargetMatchesProof(source.normalizedSource, target, targetProof)) return null;
  if (target.role === "numericPropertyBase") {
    if (
      !target.numericProperty ||
      !numericProperty ||
      references.length !== 0 ||
      !isCanonicalReferencePickReference(numericProperty.reference) ||
      numericProperty.reference.pointKey !== undefined ||
      !isNumericComputedGeometryProperty(numericProperty.property)
    ) return null;
    const allowedCandidate = allowedNumericCandidates?.find((candidate) =>
      referencePickReferenceKey(candidate.reference) === referencePickReferenceKey(numericProperty.reference)
    );
    if (!allowedCandidate || !allowedCandidate.properties.includes(numericProperty.property)) return null;
    const replacement = `${referencePickSourceForReference(numericProperty.reference)}.${numericProperty.property}`;
    return {
      range: { ...target.range },
      replacement,
      caretNormalizedOffset: target.range.from + replacement.length
    };
  }
  if (numericProperty) return null;
  if (target.selectionCount && (
    references.length < target.selectionCount.min ||
    (target.selectionCount.max !== undefined && references.length > target.selectionCount.max)
  )) return null;
  if (!references.every((reference) => referenceMatchesTargetShape(targetProof, reference))) return null;

  const authoredSeeds = referencePickSeedReferences(targetProof);
  const candidateKeys = new Set(allowedCandidateReferences.map(referencePickReferenceKey));
  if (target.syntax === "transformationTarget" && (!authoredSeeds || authoredSeeds.some(reference =>
    !candidateKeys.has(referencePickReferenceKey(reference))
  ))) return null;
  const allowedKeys = new Set([
    ...allowedCandidateReferences,
    ...(target.syntax !== "transformationTarget" && target.multiplicity === "multiple" ? authoredSeeds ?? [] : [])
  ].map(referencePickReferenceKey));
  if (references.some((reference) => !allowedKeys.has(referencePickReferenceKey(reference)))) return null;

  const selectedText = referencePickReplacementText(target.multiplicity, references);
  if (selectedText === null) return null;
  const replacement = target.syntax === "transformationTarget" && /^as\b/.test(source.normalizedSource.slice(target.range.to))
    ? `${selectedText} ` : selectedText;
  return {
    range: { ...target.range },
    replacement,
    caretNormalizedOffset: target.range.from + replacement.length
  };
};
