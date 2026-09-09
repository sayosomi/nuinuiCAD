import {
  argNameForParameter,
  constructionForElementType,
  parameterKeyForArg,
  type DslConstructionCategory
} from "../dsl/dslConstructions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElementType } from "../types/geometry";
import {
  creationRecipeForLegacyCommand,
  legacyCreationCommandRecipeMap
} from "./legacyCreationRecipes";

export type SourceCreationTemplateCommandId = keyof typeof legacyCreationCommandRecipeMap;

export type SourceCreationTemplateArgumentHole = {
  /** The argument spelling used by the nui declaration. */
  argName: string;
  /** The existing creation-recipe parameter filled by this argument. */
  parameterKey: ParameterKey;
};

export type SourceCreationTemplateExclusiveChoice = {
  /** The registry-owned set of mutually-exclusive argument spellings. */
  group: readonly string[];
  /** The member represented by this form. */
  selectedArgName: string;
  /** The creation-recipe parameter filled by selectedArgName. */
  parameterKey: ParameterKey;
};

export type SourceCreationTemplateForm = {
  /** Ordered holes for this declaration form. */
  argumentHoles: readonly SourceCreationTemplateArgumentHole[];
  /** Explicit selections made for the registry-owned exclusive groups. */
  exclusiveChoices: readonly SourceCreationTemplateExclusiveChoice[];
};

export type SourceCreationTemplatePlan = {
  commandId: SourceCreationTemplateCommandId;
  elementType: CadElementType;
  category: DslConstructionCategory;
  construction: string;
  hasNameHole: boolean;
  forms: readonly SourceCreationTemplateForm[];
};

type ExclusiveGroupOverlay = {
  anchorIndex: number;
  group: readonly string[];
  choices: readonly SourceCreationTemplateExclusiveChoice[];
};

const commandIds = Object.keys(
  legacyCreationCommandRecipeMap
) as SourceCreationTemplateCommandId[];

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const exclusiveChoiceFor = (
  type: CadElementType,
  group: readonly string[],
  argName: string
): SourceCreationTemplateExclusiveChoice | null => {
  const spec = constructionForElementType(type);
  const argSpec = spec.args.find((candidate) => candidate.arg === argName);
  if (!argSpec || argSpec.special) return null;

  return {
    group,
    selectedArgName: argName,
    parameterKey: parameterKeyForArg(type, argName)
  };
};

const baseArgumentHolesFor = (
  type: CadElementType,
  recipe: NonNullable<ReturnType<typeof creationRecipeForLegacyCommand>>
): SourceCreationTemplateArgumentHole[] | null => {
  const holes: SourceCreationTemplateArgumentHole[] = [];
  for (const step of recipe.steps) {
    if (step.kind === "name") continue;
    const argName = argNameForParameter(type, step.key);
    if (argName === null) return null;
    holes.push({ argName, parameterKey: step.key });
  }
  return holes;
};

const overlaysFor = (
  type: CadElementType,
  argumentHoles: readonly SourceCreationTemplateArgumentHole[],
  exclusiveGroups: readonly (readonly string[])[]
): ExclusiveGroupOverlay[] | null => {
  const overlays: ExclusiveGroupOverlay[] = [];

  for (const group of exclusiveGroups) {
    if (group.length === 0 || new Set(group).size !== group.length) return null;

    const representedIndexes = argumentHoles.flatMap((hole, index) =>
      group.includes(hole.argName) ? [index] : []
    );
    if (representedIndexes.length !== 1) return null;

    const choices = group.map((argName) => exclusiveChoiceFor(type, group, argName));
    if (choices.some((choice) => choice === null)) return null;

    overlays.push({
      anchorIndex: representedIndexes[0]!,
      group,
      choices: choices as SourceCreationTemplateExclusiveChoice[]
    });
  }

  return overlays;
};

const formsFor = (
  type: CadElementType,
  argumentHoles: readonly SourceCreationTemplateArgumentHole[],
  exclusiveGroups: readonly (readonly string[])[] | undefined
): SourceCreationTemplateForm[] | null => {
  const overlays = overlaysFor(type, argumentHoles, exclusiveGroups ?? []);
  if (overlays === null) return null;

  let forms: SourceCreationTemplateForm[] = [{
    argumentHoles: [...argumentHoles],
    exclusiveChoices: []
  }];

  for (const overlay of overlays) {
    const nextForms: SourceCreationTemplateForm[] = [];
    for (const form of forms) {
      for (const choice of overlay.choices) {
        const nextHoles = form.argumentHoles.map((hole, index) =>
          index === overlay.anchorIndex
            ? { argName: choice.selectedArgName, parameterKey: choice.parameterKey }
            : hole
        );
        const memberCount = nextHoles.filter((hole) => overlay.group.includes(hole.argName)).length;
        if (memberCount !== 1) continue;
        nextForms.push({
          argumentHoles: nextHoles,
          exclusiveChoices: [...form.exclusiveChoices, choice]
        });
      }
    }
    forms = nextForms;
  }

  return forms.length > 0 ? forms : null;
};

/**
 * Plans the host-neutral Source declaration shape for one catalog command.
 * Unknown commands and metadata that cannot be mapped unambiguously return
 * null so callers cannot accidentally invent a creation form.
 */
export const sourceCreationTemplatePlanForLegacyCommand = (
  commandId: string
): SourceCreationTemplatePlan | null => {
  if (!hasOwn(legacyCreationCommandRecipeMap, commandId)) return null;

  const entry = legacyCreationCommandRecipeMap[commandId as SourceCreationTemplateCommandId];
  const recipe = creationRecipeForLegacyCommand(commandId);
  if (!recipe || recipe.type !== entry.type) return null;

  try {
    const spec = constructionForElementType(entry.type);
    if (spec.elementType !== entry.type) return null;

    const argumentHoles = baseArgumentHolesFor(entry.type, recipe);
    if (argumentHoles === null) return null;
    const forms = formsFor(entry.type, argumentHoles, spec.exclusiveGroups);
    if (forms === null) return null;

    return {
      commandId: commandId as SourceCreationTemplateCommandId,
      elementType: entry.type,
      category: spec.category,
      construction: spec.construction,
      hasNameHole: recipe.steps.some((step) => step.kind === "name"),
      forms
    };
  } catch {
    return null;
  }
};

const requiredPlanFor = (commandId: SourceCreationTemplateCommandId): SourceCreationTemplatePlan => {
  const plan = sourceCreationTemplatePlanForLegacyCommand(commandId);
  if (!plan) throw new Error(`Source creation template metadata cannot map legacy command: ${commandId}`);
  return plan;
};

/** Ordered by the authoritative legacy Create Geometry catalog. */
export const sourceCreationTemplatePlans: readonly SourceCreationTemplatePlan[] = commandIds.map(
  requiredPlanFor
);
