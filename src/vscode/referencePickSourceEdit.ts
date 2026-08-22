import type { CompiledDslDocument } from "../dsl/dslDocument";
import {
  queryDslReferencePickTarget,
  type SourceSnapshot
} from "../dsl/dslReferencePickQuery";
import type { CanonicalGeometrySourceReference } from "../model/moduleSemanticCandidateBoundary";
import {
  isCanonicalReferencePickReference,
  referencePickReferenceKey,
  referencePickReplacementText,
  referencePickSeedReferences,
  referencePickTargetMatchesProof,
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
  allowedCandidateReferences
}: {
  source: SourceSnapshot;
  compiled: CompiledDslDocument;
  normalizedSourceOffset: number;
  targetProof: VscodeReferencePickTargetProof;
  references: readonly CanonicalGeometrySourceReference[];
  allowedCandidateReferences: readonly CanonicalGeometrySourceReference[];
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
