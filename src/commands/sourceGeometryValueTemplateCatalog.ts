import {
  allConstructionSpecs,
  type DslArgSpec,
  type DslConstructionSpec,
  type DslPureValueInterface
} from "@nuinuicad/nui-language";

export const SOURCE_GEOMETRY_VALUE_GROUP_DEFINITIONS = [
  { id: "point", label: "Point" },
  { id: "line", label: "Line" },
  { id: "path", label: "Path" }
] as const;

export type SourceGeometryValueGroupId = (typeof SOURCE_GEOMETRY_VALUE_GROUP_DEFINITIONS)[number]["id"];

export type SourceGeometryValueExclusiveChoice = {
  /** Registry-owned mutually-exclusive argument spellings. */
  group: readonly string[];
  /** The one member selected for this form. */
  selectedArgName: string;
};

export type SourceGeometryValueTemplateForm = {
  /** Arguments retained from the registry spec, in their original order. */
  args: readonly DslArgSpec[];
  /** One selected member for each registry-owned exclusive group. */
  exclusiveChoices: readonly SourceGeometryValueExclusiveChoice[];
};

export type SourceGeometryValueConstructionPlan = {
  /** Stable registry identity; do not replace this with a spelling lookup. */
  spec: DslConstructionSpec;
  groupId: SourceGeometryValueGroupId;
  construction: string;
  forms: readonly SourceGeometryValueTemplateForm[];
};

export type SourceGeometryValueTemplateGroup = {
  id: SourceGeometryValueGroupId;
  label: string;
  plans: readonly SourceGeometryValueConstructionPlan[];
};

const isGeometryValueGroupId = (value: DslPureValueInterface): value is SourceGeometryValueGroupId =>
  SOURCE_GEOMETRY_VALUE_GROUP_DEFINITIONS.some(({ id }) => id === value);

const formsFor = (spec: DslConstructionSpec): SourceGeometryValueTemplateForm[] | null => {
  const argsByName = new Map<string, DslArgSpec>();
  for (const argSpec of spec.args) {
    if (argsByName.has(argSpec.arg)) return null;
    argsByName.set(argSpec.arg, argSpec);
  }

  const groups = spec.exclusiveGroups ?? [];
  const exclusiveMembers = new Set<string>();
  for (const group of groups) {
    if (group.length === 0 || new Set(group).size !== group.length) return null;
    for (const member of group) {
      if (!argsByName.has(member) || exclusiveMembers.has(member)) return null;
      exclusiveMembers.add(member);
    }
  }

  let selections: readonly SourceGeometryValueExclusiveChoice[][] = [[]];
  for (const group of groups) {
    const choices = group.map((selectedArgName) => ({
      group: [...group],
      selectedArgName
    }));
    selections = selections.flatMap((selection) =>
      choices.map((choice) => [...selection, choice])
    );
  }

  return selections.map((selection) => {
    const selectedArguments = new Set(selection.map(({ selectedArgName }) => selectedArgName));
    return {
      args: spec.args.filter(({ arg }) => !exclusiveMembers.has(arg) || selectedArguments.has(arg)),
      exclusiveChoices: selection
    };
  });
};

const planFor = (
  spec: DslConstructionSpec,
  groupId: SourceGeometryValueGroupId
): SourceGeometryValueConstructionPlan | null => {
  const forms = formsFor(spec);
  if (!forms) return null;
  return {
    spec,
    groupId,
    construction: spec.construction,
    forms
  };
};

/**
 * Projects one registry spec into Geometry Value authoring forms. A malformed
 * exclusive-group declaration is rejected instead of being repaired or
 * interpreted through a second metadata source.
 */
export const sourceGeometryValueConstructionPlanFor = (
  spec: DslConstructionSpec
): SourceGeometryValueConstructionPlan | null => {
  if (!spec.pureValueInterface || !isGeometryValueGroupId(spec.pureValueInterface)) return null;
  return planFor(spec, spec.pureValueInterface);
};

/** Returns pure constructions in the authoritative registry order. */
export const sourceGeometryValueConstructionPlansFor = (
  groupId: SourceGeometryValueGroupId
): readonly SourceGeometryValueConstructionPlan[] =>
  allConstructionSpecs().flatMap((spec) => {
    if (spec.pureValueInterface !== groupId) return [];
    const plan = sourceGeometryValueConstructionPlanFor(spec);
    return plan ? [plan] : [];
  });

/** Rebuilds all presentation groups from the current Language Core registry. */
export const sourceGeometryValueTemplateGroups = (): readonly SourceGeometryValueTemplateGroup[] =>
  SOURCE_GEOMETRY_VALUE_GROUP_DEFINITIONS.map(({ id, label }) => ({
    id,
    label,
    plans: sourceGeometryValueConstructionPlansFor(id)
  }));

export const sourceGeometryValueTemplateGroupFor = (
  groupId: SourceGeometryValueGroupId
): SourceGeometryValueTemplateGroup => {
  const definition = SOURCE_GEOMETRY_VALUE_GROUP_DEFINITIONS.find(({ id }) => id === groupId);
  if (!definition) throw new Error(`Unsupported Geometry Value group: ${groupId}`);
  return {
    ...definition,
    plans: sourceGeometryValueConstructionPlansFor(groupId)
  };
};
