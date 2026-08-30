import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  queryDslReferencePickTarget,
  type SourceSnapshot
} from "../dsl/dslReferencePickQuery";
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
  if (proof.expectedGeometryInterface !== "point") return reference.pointKey === undefined;
  return true;
};

/**
 * Revalidates the exact current Source target immediately before the Extension
 * Host applies a confirmed Canvas pick. Candidate references are accepted only
 * from the Canvas candidate snapshot captured for this request (plus existing
 * seed references for a multi-value target), so a stale or forged result cannot
 * turn into an arbitrary Source edit.
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
    if (
      target.numericProperty.kind === "fixedProperty" &&
      target.numericProperty.property !== numericProperty.property
    ) return null;
    const allowedCandidate = allowedNumericCandidates?.find((candidate) =>
      referencePickReferenceKey(candidate.reference) === referencePickReferenceKey(numericProperty.reference)
    );
    if (!allowedCandidate || !allowedCandidate.properties.includes(numericProperty.property)) return null;
    const replacement = target.numericProperty.kind === "fixedProperty"
      ? referencePickSourceForReference(numericProperty.reference)
      : `${referencePickSourceForReference(numericProperty.reference)}.${numericProperty.property}`;
    const suffixLength = (target.activationRange ?? target.range).to - target.range.to;
    return {
      range: { ...target.range },
      replacement,
      caretNormalizedOffset: target.range.from + replacement.length + suffixLength
    };
  }
  if (numericProperty) return null;
  if (!references.every((reference) => referenceMatchesTargetShape(targetProof, reference))) return null;

  const allowedKeys = new Set([
    ...allowedCandidateReferences,
    ...(target.multiplicity === "multiple" ? referencePickSeedReferences(targetProof) : [])
  ].map(referencePickReferenceKey));
  if (references.some((reference) => !allowedKeys.has(referencePickReferenceKey(reference)))) return null;

  const replacement = referencePickReplacementText(target.multiplicity, references);
  if (replacement === null) return null;
  return {
    range: { ...target.range },
    replacement,
    caretNormalizedOffset: target.range.from + replacement.length
  };
};
