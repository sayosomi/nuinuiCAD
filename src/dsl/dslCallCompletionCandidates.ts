import { elementTypeLabels } from "../types/geometry";
import { dslCompletionMetadataForType } from "./dslCompletionMetadata";
import {
  commonArgSpecs,
  constructionCandidatesFor,
  MUTATION_CATEGORY,
  type DslConstructionCategory,
  type DslConstructionSpec,
} from "./dslConstructions";

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

const userFacingCommonArgumentNames = new Set([
  "state",
  "color",
  "steps",
  "vars",
]);

const completionArgumentSpecs = (spec: DslConstructionSpec) => {
  const byName = new Map(spec.args.map((arg) => [arg.arg, arg]));
  for (const arg of commonArgSpecs) {
    if (arg.arg === "color" && spec.category === MUTATION_CATEGORY) continue;
    if (userFacingCommonArgumentNames.has(arg.arg) && !byName.has(arg.arg)) byName.set(arg.arg, arg);
  }
  return [...byName.values()];
};

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
  const excludedExclusiveArgumentNames = new Set(
    (spec.exclusiveGroups ?? [])
      .filter((group) => group.some((arg) => usedArgumentNames.has(arg)))
      .flat(),
  );
  return completionArgumentSpecs(spec)
    .filter((arg) => !arg.positional && !usedArgumentNames.has(arg.arg) && !excludedExclusiveArgumentNames.has(arg.arg))
    .map((arg) => ({
      label: arg.arg,
      apply: `${arg.arg}: `,
      detail: labels.get(arg.arg) ?? arg.arg
    }));
};
