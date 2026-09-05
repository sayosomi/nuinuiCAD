import { elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";
import { createCadElement } from "../model/elementFactory";
import { referenceAnchor } from "../model/pointAnchors";
import { getParameterValue, setParameterValue } from "../parameters/parameterAccess";
import {
  getParameterDefinitions,
  type ParameterDefinition,
  type ParameterKey
} from "../parameters/parameterDefinitions";
import type {
  CadElement,
  CadElementType,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor
} from "../types/geometry";

/**
 * A single prompt in a declarative CAD element creation recipe. Prompts default
 * to parameter-definition labels, while specialized recipes may override wording.
 */
export type CreationStep =
  | { kind: "point"; key: ParameterKey; prompt: string }
  | { kind: "endpoint"; key: ParameterKey; prompt: string }
  | { kind: "line"; key: ParameterKey; prompt: string }
  | { kind: "lineList"; key: ParameterKey; prompt: string }
  | { kind: "pointList"; key: ParameterKey; prompt: string }
  | { kind: "number"; key: ParameterKey; prompt: string; default?: string; stepLevels?: readonly number[] }
  | { kind: "name"; autoSuggest: true };

export type CreationArgumentValue =
  | PointAnchor
  | LineEndpointReference
  | ElementId
  | PointAnchor[]
  | ElementId[]
  | NumericValue;

/** Values completed by a creation session, keyed by parameter key plus `name`. */
export type CreationArgs = Partial<Record<ParameterKey, CreationArgumentValue>> & {
  name?: string;
};

/** Static, context-free definition of an element creation flow. */
export type CreationRecipe = {
  type: CadElementType;
  steps: CreationStep[];
};

/** Document-scoped inputs required only when a completed recipe is materialized. */
export type CreationEmitContext = {
  elements: CadElement[];
  referenceElements: CadElement[];
  createId?: () => ElementId;
};

/** Element types that are not created through the command-line recipe flow. */
export const creationRecipeExcludedTypes = [
  "image",
  "group",
  "conditionalGroup",
  "forGroup",
  "moduleInstance"
] as const satisfies readonly CadElementType[];

const excludedTypeSet = new Set<CadElementType>(creationRecipeExcludedTypes);
const nameStep: CreationStep = { kind: "name", autoSuggest: true };

const definitionElement = (type: CadElementType) =>
  createCadElement(type, [], { createId: () => `${type}-recipe-definition` });

const definitionFor = (type: CadElementType, key: ParameterKey): ParameterDefinition => {
  const definition = getParameterDefinitions(definitionElement(type)).find((item) => item.key === key);
  if (!definition) throw new Error(`作成レシピのparameter定義が見つかりません: ${type}.${key}`);
  return definition;
};

const creationStepForDefinition = (
  definition: ParameterDefinition
): Exclude<CreationStep, { kind: "name" }> | null => {
  const base = { key: definition.key, prompt: definition.label };
  if (definition.kind === "reference") return { kind: "point", ...base };
  if (definition.kind === "lineEndpointReference") return { kind: "endpoint", ...base };
  if (definition.kind === "lineReference") return { kind: "line", ...base };
  if (definition.kind === "lineReferenceList") return { kind: "lineList", ...base };
  if (definition.kind === "pointReferenceList") return { kind: "pointList", ...base };
  if (definition.kind !== "number") return null;
  return {
    kind: "number",
    ...base,
    ...(definition.emptyInputDefaultValue === undefined
      ? {}
      : { default: String(definition.emptyInputDefaultValue) }),
    ...(definition.stepLevels === undefined ? {} : { stepLevels: definition.stepLevels })
  };
};

const stepFor = (type: CadElementType, key: ParameterKey) => {
  const step = creationStepForDefinition(definitionFor(type, key));
  if (!step) throw new Error(`作成レシピに使えないparameter定義です: ${type}.${key}`);
  return step;
};

/** Specialized command-line flows whose step order differs from the generic fallback. */
export const creationRecipes: readonly CreationRecipe[] = [
  {
    type: "freePoint",
    steps: [nameStep, stepFor("freePoint", "x"), stepFor("freePoint", "y")]
  },
  {
    type: "line",
    steps: [nameStep, stepFor("line", "startPoint"), stepFor("line", "endPoint")]
  },
  {
    type: "polyline",
    steps: [nameStep, stepFor("polyline", "points")]
  },
  {
    type: "arcLine",
    steps: [
      nameStep,
      stepFor("arcLine", "centerPoint"),
      stepFor("arcLine", "radius"),
      stepFor("arcLine", "startAngleDeg"),
      stepFor("arcLine", "endAngleDeg")
    ]
  },
  {
    type: "bezierCurve",
    steps: [
      nameStep,
      stepFor("bezierCurve", "startPoint"),
      stepFor("bezierCurve", "startHandleAngleDeg"),
      stepFor("bezierCurve", "startHandleLength"),
      stepFor("bezierCurve", "endPoint"),
      stepFor("bezierCurve", "endHandleAngleDeg"),
      stepFor("bezierCurve", "endHandleLength")
    ]
  },
  {
    type: "offsetLine",
    steps: [nameStep, stepFor("offsetLine", "baseLineIds"), stepFor("offsetLine", "offset")]
  },
  {
    type: "divisionPoint",
    steps: [
      nameStep,
      stepFor("divisionPoint", "startPoint"),
      stepFor("divisionPoint", "endPoint"),
      stepFor("divisionPoint", "ratio")
    ]
  },
  {
    type: "lineDivisionPoint",
    steps: [nameStep, stepFor("lineDivisionPoint", "endpoint"), stepFor("lineDivisionPoint", "ratio")]
  },
  {
    type: "angleLengthLine",
    // Do not include startPoint:x/y: this flow always asks for a point reference.
    // The frozen emitter retains the empty-document coordinate default until Phase 4f
    // rejects incomplete preview arguments.
    steps: [
      nameStep,
      stepFor("angleLengthLine", "startPoint"),
      stepFor("angleLengthLine", "angleDeg"),
      stepFor("angleLengthLine", "length")
    ]
  },
  {
    type: "copyLine",
    steps: [
      nameStep,
      stepFor("copyLine", "baseLineIds"),
      stepFor("copyLine", "startPoint"),
      stepFor("copyLine", "endPoint"),
      stepFor("copyLine", "scale"),
      stepFor("copyLine", "angleDeg")
    ]
  },
  {
    type: "symmetricCopyLine",
    steps: [
      nameStep,
      stepFor("symmetricCopyLine", "baseLineIds"),
      stepFor("symmetricCopyLine", "axisPoint1"),
      stepFor("symmetricCopyLine", "axisPoint2")
    ]
  },
  {
    type: "move",
    steps: [
      stepFor("move", "baseLineIds"),
      stepFor("move", "startPoint"),
      stepFor("move", "endPoint"),
      stepFor("move", "scale"),
      stepFor("move", "angleDeg")
    ]
  },
  {
    type: "symmetricMove",
    steps: [
      stepFor("symmetricMove", "baseLineIds"),
      stepFor("symmetricMove", "axisPoint1"),
      stepFor("symmetricMove", "axisPoint2")
    ]
  }
];

/**
 * Mechanically generates a recipe for a type without a specialized flow. A
 * bare mutation-statement type (see elementActivity.ts's
 * elementTypesWithoutOwnDrawableGeometry) has no DSL name slot to prompt
 * for - its `name` is always compiled to "" regardless of what a stray
 * nameStep would collect, so the step is omitted rather than offered &&
 * silently discarded. Named fallback recipes begin with the name step.
 */
export const fallbackCreationRecipe = (type: CadElementType): CreationRecipe => ({
  type,
  steps: [
    ...(elementTypesWithoutOwnDrawableGeometry.has(type) ? [] : [nameStep]),
    ...getParameterDefinitions(definitionElement(type))
      .map(creationStepForDefinition)
      .filter((step): step is Exclude<CreationStep, { kind: "name" }> => step !== null)
  ]
});

/** Finds a specialized recipe first, otherwise returns the generated fallback. */
export const creationRecipeForType = (type: CadElementType): CreationRecipe | null =>
  excludedTypeSet.has(type)
    ? null
    : creationRecipes.find((recipe) => recipe.type === type) ?? fallbackCreationRecipe(type);

const hasImplicitReference = (step: Exclude<CreationStep, { kind: "name" }>, value: unknown) => {
  if (step.kind === "point") {
    if (!value || typeof value !== "object" || !("mode" in value)) return false;
    const anchor = value as PointAnchor;
    if (anchor.mode === "reference") return anchor.pointId !== "";
    return anchor.mode === "derived" && anchor.elementId !== "";
  }
  if (step.kind === "endpoint") {
    return !!value && typeof value === "object" && "lineId" in value && value.lineId !== "";
  }
  if (step.kind === "line") return typeof value === "string" && value !== "";
  return Array.isArray(value) && value.length > 0;
};

const unspecifiedReferenceValue = (step: Exclude<CreationStep, { kind: "name" }>) => {
  if (step.kind === "point") return referenceAnchor("");
  if (step.kind === "endpoint") return { lineId: "", endpointKey: "start" } satisfies LineEndpointReference;
  return step.kind === "line" ? "" : [];
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Recipe step keys with no actual supplied value. */
export const blankCreationRecipeStepKeys = (
  recipe: CreationRecipe,
  args: CreationArgs
): ReadonlySet<ParameterKey> => new Set(
  recipe.steps.flatMap((step) =>
    step.kind !== "name" && (!hasOwn(args, step.key) || args[step.key] === undefined)
      ? [step.key]
      : []
  )
);

export type CreationRecipeDraft = {
  element: CadElement;
  /** Keys whose factory-default field value must never be read - the
   * corresponding recipe step was left blank, not filled || defaulted. */
  blankParameterKeys: ReadonlySet<ParameterKey>;
};

/**
 * Materializes recipe progress without inventing values for steps the user
 * left blank. This is `emitCreationRecipe`'s counterpart for a session that
 * has one || more blank steps: filled steps && always-on factory defaults
 * (booleans/choices, which never become creation steps) are applied exactly
 * as `emitCreationRecipe` would, but a blank step's `setParameterValue` call
 * is skipped entirely rather than writing `unspecifiedReferenceValue`'s
 * sentinel. Callers must route every key in `blankParameterKeys` around
 * `element` (e.g. via `serializeElementStatementBlockWithBlanks`) instead of
 * reading it - the field is left at an arbitrary, meaningless factory value.
 */
export const materializeCreationRecipeDraft = (
  recipe: CreationRecipe,
  args: CreationArgs,
  context: CreationEmitContext
): CreationRecipeDraft => {
  const blankParameterKeys = blankCreationRecipeStepKeys(recipe, args);
  const element = createCadElement(recipe.type, context.elements, {
    referenceElements: context.referenceElements,
    createId: context.createId
  });
  const withArguments = recipe.steps.reduce<CadElement>((current, step) => {
    if (step.kind === "name" || blankParameterKeys.has(step.key)) return current;
    return setParameterValue(current, step.key, args[step.key] as CreationArgumentValue);
  }, element);
  return {
    element: setParameterValue(withArguments, "name", args.name ?? ""),
    blankParameterKeys
  };
};

/**
 * Materializes a static recipe with document context. Missing reference inputs only
 * clear factory-provided references; numeric && other defaults remain untouched.
 */
export const emitCreationRecipe = (
  recipe: CreationRecipe,
  args: CreationArgs,
  context: CreationEmitContext
): CadElement => {
  const element = createCadElement(recipe.type, context.elements, {
    referenceElements: context.referenceElements,
    createId: context.createId
  });
  const withArguments = recipe.steps.reduce<CadElement>((current, step) => {
    if (step.kind === "name") return current;
    const value = args[step.key];
    if (value !== undefined) return setParameterValue(current, step.key, value);
    return hasImplicitReference(step, getParameterValue(current, step.key))
      ? setParameterValue(current, step.key, unspecifiedReferenceValue(step))
      : current;
  }, element);
  return setParameterValue(withArguments, "name", args.name ?? "");
};
