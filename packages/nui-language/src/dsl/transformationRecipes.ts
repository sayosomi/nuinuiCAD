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
  /** Runtime-only Module identity used when attaching per-instance scalar
   * products to this recipe. */
  runtimeInstancePath?: readonly string[];
};

/** The compiler-owned interpretation of the dotted member suffix on a
 * geometry reference.  The source parser intentionally keeps the suffix as
 * text; this is the semantic split shared by scalar/property lowering and
 * transformation lowering. */
export type TransformationStageSelection = {
  stagePath: readonly string[];
  propertyPath: readonly string[];
};

/** A source-resolved named checkpoint, before its Module recipe has been
 * lowered for a concrete instance. `stagePath` is the full named path. */
export type TransformationStageDeclaration = {
  ownerId: ElementId;
  stagePath: readonly string[];
  occurrenceIndex?: string;
};

/** Anonymous compiler prefix identity; never a source-language member. */
export const transformationPrefixName = (statementIndex: number) => `$prefix:${statementIndex}`;

export const resolveTransformationStageSelection = ({
  ownerId,
  members,
  recipes,
  stageDeclarations,
  useStatementIndex
}: {
  ownerId: ElementId;
  members: readonly string[];
  recipes: readonly TransformationRecipe[];
  stageDeclarations?: readonly TransformationStageDeclaration[];
  occurrenceIndex?: string;
  useStatementIndex: number;
}): TransformationStageSelection => {
  if (members[0] === "input") return { stagePath: ["input"], propertyPath: members.slice(1) };
  const ownerRecipes = recipes.filter(recipe => recipe.targets.some(target => target.ownerId === ownerId));
  const ownerDeclarations = (stageDeclarations ?? []).filter(declaration => declaration.ownerId === ownerId);
  if (ownerRecipes.length === 0 && ownerDeclarations.length === 0) return { stagePath: ["final"], propertyPath: members };
  const preceding = ownerRecipes.filter((recipe) =>
    recipe.sourceStatementIndex < useStatementIndex &&
    recipe.targets.some((target) => target.ownerId === ownerId)
  ).at(-1);
  const declarations = (stageDeclarations ?? []).filter((declaration) =>
    declaration.ownerId === ownerId &&
    Number(declaration.stagePath[0]?.slice("$prefix:".length)) < useStatementIndex
  );
  const declared = declarations.at(-1);
  return {
    stagePath: preceding ? [transformationPrefixName(preceding.sourceStatementIndex)]
      : declared?.stagePath ?? ["base"],
    propertyPath: members
  };
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
