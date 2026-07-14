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
  | { kind: "number"; key: ParameterKey; prompt: string; default?: string }
  | { kind: "name"; autoSuggest: true };

export type CreationArgumentValue =
  | PointAnchor
  | LineEndpointReference
  | ElementId
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
  "forGroup"
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
  if (definition.kind !== "number") return null;
  return {
    kind: "number",
    ...base,
    ...(definition.emptyInputDefaultValue === undefined
      ? {}
      : { default: String(definition.emptyInputDefaultValue) })
  };
};

const stepFor = (type: CadElementType, key: ParameterKey) => {
  const step = creationStepForDefinition(definitionFor(type, key));
  if (!step) throw new Error(`作成レシピに使えないparameter定義です: ${type}.${key}`);
  return step;
};

/** The only specialized recipes introduced by Phase 4a-1. */
export const creationRecipes: readonly CreationRecipe[] = [
  {
    type: "freePoint",
    steps: [stepFor("freePoint", "x"), stepFor("freePoint", "y"), nameStep]
  },
  {
    type: "line",
    steps: [stepFor("line", "startPoint"), stepFor("line", "endPoint"), nameStep]
  },
  {
    type: "arcLine",
    steps: [
      stepFor("arcLine", "centerPoint"),
      stepFor("arcLine", "radius"),
      stepFor("arcLine", "startAngleDeg"),
      stepFor("arcLine", "endAngleDeg"),
      nameStep
    ]
  },
  {
    type: "bezierCurve",
    steps: [
      stepFor("bezierCurve", "startPoint"),
      stepFor("bezierCurve", "startHandleAngleDeg"),
      stepFor("bezierCurve", "startHandleLength"),
      stepFor("bezierCurve", "endPoint"),
      stepFor("bezierCurve", "endHandleAngleDeg"),
      stepFor("bezierCurve", "endHandleLength"),
      nameStep
    ]
  },
  {
    type: "offsetLine",
    steps: [stepFor("offsetLine", "baseLineIds"), stepFor("offsetLine", "offset"), nameStep]
  },
  {
    type: "variable",
    steps: [stepFor("variable", "expression"), nameStep]
  }
];

/** Mechanically generates a recipe for a type without a specialized flow. */
export const fallbackCreationRecipe = (type: CadElementType): CreationRecipe => ({
  type,
  steps: [
    ...getParameterDefinitions(definitionElement(type))
      .map(creationStepForDefinition)
      .filter((step): step is Exclude<CreationStep, { kind: "name" }> => step !== null),
    nameStep
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

/**
 * Materializes a static recipe with document context. Missing reference inputs only
 * clear factory-provided references; numeric and other defaults remain untouched.
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
