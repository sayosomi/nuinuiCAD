import { elementTypeLabels } from "../types/geometry";
import { dslCompletionMetadataForType } from "./dslCompletionMetadata";
import { constructionCandidatesFor, type DslConstructionCategory, type DslConstructionSpec } from "./dslConstructions";

export type DslCallCompletionCandidate = {
  label: string;
  apply: string;
  detail: string;
};

export const constructionCompletionCandidates = (category: DslConstructionCategory): readonly DslCallCompletionCandidate[] =>
  constructionCandidatesFor(category)
    .filter((spec) => spec.construction)
    .map((spec) => ({
      label: spec.construction,
      apply: spec.construction,
      detail: elementTypeLabels[spec.elementType]
    }));

/**
 * The construction spec is the sole argument-key authority. Completion
 * metadata only enriches those keys with the parameter label that the
 * serializer-derived UI metadata already owns; it never broadens the set.
 */
export const argumentCompletionCandidates = (
  spec: DslConstructionSpec,
  usedArgumentNames: ReadonlySet<string>
): readonly DslCallCompletionCandidate[] => {
  const labels = new Map(
    dslCompletionMetadataForType(spec.elementType).attributes
      .map((parameter) => [parameter.key, parameter.definition.label])
  );
  return spec.args
    .filter((arg) => !arg.positional && !usedArgumentNames.has(arg.arg))
    .map((arg) => ({
      label: arg.arg,
      apply: `${arg.arg}: `,
      detail: labels.get(arg.arg) ?? arg.arg
    }));
};
