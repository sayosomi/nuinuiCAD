import type {
  CadElement,
  ElementId,
  NumericValue,
  PointAnchor
} from "../types/geometry";

/** A resolved header selector.  The source spelling is retained for
 * canonical serialization; runtime identity is carried separately. */
export type TransformationTargetSelector = {
  source: string;
  canonical: string;
  ownerId: ElementId;
  /** The immutable checkpoint selected by this target. `[]` means the root
   * recipe, while `base` selects the built-in base snapshot. */
  stagePath: readonly string[];
  occurrenceIndex?: string;
  endpointKey?: "start" | "end";
};

export type TransformationOperation =
  | { kind: "edge"; intersectionIndex: NumericValue }
  | { kind: "extend"; point: PointAnchor }
  | {
      kind: "move";
      startPoint: PointAnchor;
      endPoint: PointAnchor;
      scale: NumericValue;
      angleDeg: NumericValue;
      mirrorX: boolean;
    }
  | { kind: "mirrorMove"; axisPoint1: PointAnchor; axisPoint2: PointAnchor }
  | { kind: "reverse" };

/** Host-neutral compiled representation of one declarative transformation
 * clause. Targets and recipe ownership are explicit and never encoded as
 * mutable ordering or as ordinary user call arguments. */
export type TransformationRecipe = {
  id: string;
  sourceStatementIndex: number;
  sourceStatementId?: string;
  construction: "edge" | "extend" | "move" | "mirrorMove" | "reverse";
  targets: readonly TransformationTargetSelector[];
  /** Primary branch path; coupled clauses retain per-target paths above. */
  recipeOwnerPath: readonly string[];
  stageName: string | null;
  enabled: boolean;
  operation: TransformationOperation;
  /** Runtime-only ordering for a concrete Module instance. Authored source
   * order remains sourceStatementIndex; this field is never serialized. */
  runtimeSourceOrder?: number;
};

/** The compiler-owned interpretation of the dotted member suffix on a
 * geometry reference.  The source parser intentionally keeps the suffix as
 * text; this is the semantic split shared by scalar/property lowering and
 * transformation lowering. */
export type TransformationStageSelection = {
  stagePath: readonly string[];
  propertyPath: readonly string[];
};

export const resolveTransformationStageSelection = ({
  ownerId,
  members,
  recipes,
  occurrenceIndex
}: {
  ownerId: ElementId;
  members: readonly string[];
  recipes: readonly TransformationRecipe[];
  occurrenceIndex?: string;
}): TransformationStageSelection => {
  const namedPaths = recipes.flatMap((recipe) => recipe.stageName
    ? recipe.targets
      .filter((target) => target.ownerId === ownerId &&
        (target.occurrenceIndex === occurrenceIndex ||
          (occurrenceIndex !== undefined && target.occurrenceIndex === undefined)))
      .map((target) => [...target.stagePath, recipe.stageName!])
    : []);
  const explicitFinalPaths = namedPaths.map((path) => [...path, "final"]);
  const candidates: readonly (readonly string[])[] = [
    ["base"],
    ["final"],
    ["base", "final"],
    ...namedPaths,
    ...explicitFinalPaths
  ];
  let selected: readonly string[] | undefined;
  for (const candidate of candidates) {
    if (candidate.length > members.length) continue;
    if (candidate.every((part, index) => members[index] === part) &&
        (!selected || candidate.length > selected.length)) selected = candidate;
  }
  if (!selected) return { stagePath: ["final"], propertyPath: members };
  return { stagePath: selected, propertyPath: members.slice(selected.length) };
};

export const transformationStageKey = (
  runtimeOwnerId: ElementId,
  occurrenceIndex: string | undefined,
  stagePath: readonly string[]
) => `${runtimeOwnerId}\u0000${occurrenceIndex ?? "*"}\u0000${stagePath.join(".")}`;

export const isTransformationElement = (element: CadElement): boolean =>
  element.type === "edge" ||
  element.type === "extendTrim" ||
  element.type === "move" ||
  element.type === "symmetricMove" ||
  element.type === "pathReverse";

/** Keeps the runtime operation construction types in one place for adapters
 * that need to use the existing geometry evaluator kernels. */
export const transformationElementType = (construction: TransformationRecipe["construction"]): CadElement["type"] => {
  switch (construction) {
    case "edge": return "edge";
    case "extend": return "extendTrim";
    case "move": return "move";
    case "mirrorMove": return "symmetricMove";
    case "reverse": return "pathReverse";
  }
};

export type TransformationRuntimeTarget = TransformationTargetSelector & {
  runtimeOwnerId: ElementId;
};

export type TransformationRecipeCompilation = {
  recipes: TransformationRecipe[];
  diagnostics: import("./dslTypes").DslDiagnostic[];
};
