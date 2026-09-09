import {
  argNameForParameter,
  constructionForElementType,
  parameterKeyForArg,
  type DslConstructionCategory,
  type DslConstructionSpec
} from "../dsl/dslConstructions";
import { creationParameterDefinitionFor } from "./creationRecipes";
import type { ParameterDefinition, ParameterKey } from "../parameters/parameterDefinitions";
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
  /** The existing parameter value kind used by the Source adapter. */
  kind: ParameterDefinition["kind"];
  /** The existing parameter label used by the Source adapter. */
  label: string;
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

type ExclusiveGroupOptions = {
  group: readonly string[];
  choices: readonly SourceCreationTemplateExclusiveChoice[];
};

const commandIds = Object.keys(
  legacyCreationCommandRecipeMap
) as SourceCreationTemplateCommandId[];

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const argumentHoleFor = (
  type: CadElementType,
  spec: DslConstructionSpec,
  argName: string
): SourceCreationTemplateArgumentHole | null => {
  if (!spec.args.some((argSpec) => argSpec.arg === argName)) return null;

  const parameterKey = parameterKeyForArg(type, argName);
  let definition: ParameterDefinition;
  try {
    definition = creationParameterDefinitionFor(type, parameterKey);
  } catch {
    return null;
  }

  return {
    argName,
    parameterKey,
    kind: definition.kind,
    label: definition.label
  };
};

const recipeParameterKeysFor = (
  type: CadElementType,
  spec: DslConstructionSpec,
  recipe: NonNullable<ReturnType<typeof creationRecipeForLegacyCommand>>
): ReadonlySet<ParameterKey> | null => {
  const parameterKeys = new Set<ParameterKey>();
  for (const step of recipe.steps) {
    if (step.kind === "name") continue;

    const argName = argNameForParameter(type, step.key);
    if (argName === null || !spec.args.some((argSpec) => argSpec.arg === argName)) return null;
    if (parameterKeyForArg(type, argName) !== step.key) return null;
    parameterKeys.add(step.key);
  }
  return parameterKeys;
};

const exclusiveGroupOptionsFor = (
  type: CadElementType,
  spec: DslConstructionSpec
): ExclusiveGroupOptions[] | null => {
  const options: ExclusiveGroupOptions[] = [];
  const seenMembers = new Set<string>();

  for (const group of spec.exclusiveGroups ?? []) {
    if (group.length === 0 || new Set(group).size !== group.length) return null;
    if (group.some((argName) => seenMembers.has(argName))) return null;
    for (const argName of group) seenMembers.add(argName);

    const choices: SourceCreationTemplateExclusiveChoice[] = [];
    for (const argName of group) {
      if (!spec.args.some((argSpec) => argSpec.arg === argName)) return null;
      choices.push({
        group: [...group],
        selectedArgName: argName,
        parameterKey: parameterKeyForArg(type, argName)
      });
    }
    options.push({ group: [...group], choices });
  }

  return options;
};

const selectionsFor = (
  groups: readonly ExclusiveGroupOptions[]
): SourceCreationTemplateExclusiveChoice[][] => {
  let selections: SourceCreationTemplateExclusiveChoice[][] = [[]];
  for (const group of groups) {
    const nextSelections: SourceCreationTemplateExclusiveChoice[][] = [];
    for (const selection of selections) {
      for (const choice of group.choices) {
        nextSelections.push([...selection, choice]);
      }
    }
    selections = nextSelections;
  }
  return selections;
};

const formFor = (
  type: CadElementType,
  spec: DslConstructionSpec,
  recipeParameterKeys: ReadonlySet<ParameterKey>,
  groups: readonly ExclusiveGroupOptions[],
  selection: readonly SourceCreationTemplateExclusiveChoice[]
): SourceCreationTemplateForm | null => {
  const selectedByArg = new Map(selection.map((choice) => [choice.selectedArgName, choice]));
  const exclusiveMembers = new Set(groups.flatMap(({ group }) => group));
  const argumentHoles: SourceCreationTemplateArgumentHole[] = [];

  for (const argSpec of spec.args) {
    const choice = selectedByArg.get(argSpec.arg);
    const parameterKey = parameterKeyForArg(type, argSpec.arg);
    const include = choice !== undefined || (
      !exclusiveMembers.has(argSpec.arg) && (
        recipeParameterKeys.has(parameterKey) || (argSpec.required === true && !argSpec.special)
      )
    );
    if (!include) continue;

    const hole = argumentHoleFor(type, spec, argSpec.arg);
    if (!hole) return null;
    argumentHoles.push(hole);
  }

  for (const group of groups) {
    if (argumentHoles.filter((hole) => group.group.includes(hole.argName)).length !== 1) return null;
  }

  return { argumentHoles, exclusiveChoices: [...selection] };
};

const formsFor = (
  type: CadElementType,
  spec: DslConstructionSpec,
  recipeParameterKeys: ReadonlySet<ParameterKey>
): SourceCreationTemplateForm[] | null => {
  const groups = exclusiveGroupOptionsFor(type, spec);
  if (groups === null) return null;

  const forms = selectionsFor(groups).map((selection) =>
    formFor(type, spec, recipeParameterKeys, groups, selection)
  );
  return forms.every((form): form is SourceCreationTemplateForm => form !== null) ? forms : null;
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

    const recipeParameterKeys = recipeParameterKeysFor(entry.type, spec, recipe);
    if (recipeParameterKeys === null) return null;
    const forms = formsFor(entry.type, spec, recipeParameterKeys);
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
