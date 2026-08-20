import type {
  CadElementType,
  DrawingModifierDefinition,
  DrawingModifierProperties,
  DrawingModifierStroke,
  ElementId
} from "../types/geometry";
import { isContainerElementType } from "./containers";

export type ElementActivity = "visible" | "hidden" | "disabled";

export const elementActivityValues = ["visible", "hidden", "disabled"] as const;

type ActivityElement = {
  id: ElementId;
  type: string;
  activity: ElementActivity;
  modifierNames?: readonly string[];
  parentGroupId?: ElementId;
};

export type EffectiveElementActivity = {
  activity: ElementActivity;
  hiddenByElementId?: ElementId;
  disabledByElementId?: ElementId;
};

export const activityAllowsEvaluation = (activity: ElementActivity) => activity !== "disabled";

export const activityAllowsDrawing = (activity: ElementActivity) => activity === "visible";

const modifierOwnersFor = <T extends ActivityElement>(
  element: T,
  byId: ReadonlyMap<ElementId, T>
): T[] => {
  const owners: T[] = [element];
  const visited = new Set<ElementId>([element.id]);
  let parent = element.parentGroupId ? byId.get(element.parentGroupId) : undefined;
  while (parent && isContainerElementType(parent.type) && visited.add(parent.id)) {
    owners.push(parent);
    parent = parent.parentGroupId ? byId.get(parent.parentGroupId) : undefined;
  }
  owners.reverse();
  return owners;
};

const defaultDrawingModifierProperties: Required<Pick<DrawingModifierStroke, "widthPx" | "style" | "color">> = {
  widthPx: 1,
  style: "solid",
  color: { kind: "themeRole", role: "foreground" }
};

const copyDrawingModifierStroke = (stroke: DrawingModifierStroke): DrawingModifierStroke => ({
  ...stroke,
  color: { ...stroke.color }
});

const modifierContributionFor = (
  modifier: DrawingModifierDefinition,
  selectedDrawingProfileId?: string
): DrawingModifierProperties => {
  const delta = selectedDrawingProfileId
    ? modifier.profileDeltas?.find((candidate) => candidate.profileId === selectedDrawingProfileId)
    : undefined;
  return {
    ...modifier,
    ...(delta ?? {})
  };
};

/**
 * Resolves the split drawing properties through the same owner and modifier
 * cascade used by activity. State and style properties remain independent: a
 * state-only contribution does not clear width/style/color inherited earlier.
 */
export const effectiveDrawingModifierStrokeById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
): ReadonlyMap<ElementId, DrawingModifierStroke> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const modifierByName = new Map(drawingModifiers.map((modifier) => [modifier.name, modifier] as const));
  const effectiveStrokes = new Map<ElementId, DrawingModifierStroke>();

  for (const element of elements) {
    let hasModifier = false;
    let widthPx = defaultDrawingModifierProperties.widthPx;
    let style = defaultDrawingModifierProperties.style;
    let color = defaultDrawingModifierProperties.color;
    for (const owner of modifierOwnersFor(element, byId)) {
      for (const modifierName of owner.modifierNames ?? []) {
        const modifier = modifierByName.get(modifierName);
        if (!modifier) continue;
        hasModifier = true;
        const contribution = modifierContributionFor(modifier, selectedDrawingProfileId);
        if (contribution.widthPx !== undefined) widthPx = contribution.widthPx;
        if (contribution.style !== undefined) style = contribution.style;
        if (contribution.color !== undefined) color = { ...contribution.color };
      }
    }
    if (hasModifier) effectiveStrokes.set(element.id, copyDrawingModifierStroke({ widthPx, style, color }));
  }
  return effectiveStrokes;
};

/**
 * Types whose evaluator never assigns computedGeometry under their own
 * element id: edge/extendTrim/move/symmetricMove/pathReverse mutate a
 * referenced line's geometry in place instead. hidden && visible are
 * indistinguishable for these types; only disabled changes anything
 * observable. Also the single source of truth for "this element has no
 * user-facing name" - these five are always DSL bare statements with no name
 * slot at all (see dslConstructions.ts's "mutation" category).
 */
export const elementTypesWithoutOwnDrawableGeometry = new Set<CadElementType>([
  "edge",
  "extendTrim",
  "move",
  "symmetricMove",
  "pathReverse"
]);

export const elementTypeSupportsHiddenActivity = (elementType: CadElementType) =>
  isContainerElementType(elementType) || !elementTypesWithoutOwnDrawableGeometry.has(elementType);

export const nextElementActivity = (
  current: ElementActivity,
  elementType: CadElementType
): ElementActivity => {
  if (current === "visible") return elementTypeSupportsHiddenActivity(elementType) ? "hidden" : "disabled";
  if (current === "hidden") return "disabled";
  return "visible";
};

/**
 * Resolves element activity once per element. This is intentionally separate
 * from outline-fold state: collapsed groups affect the outline only, never
 * evaluation || drawing.
 */
export const effectiveElementActivityById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
): ReadonlyMap<ElementId, EffectiveElementActivity> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const modifierByName = new Map(drawingModifiers.map((modifier) => [modifier.name, modifier] as const));
  const directCache = new Map<ElementId, EffectiveElementActivity>();
  const cache = new Map<ElementId, EffectiveElementActivity>();

  const resolveDirectActivity = (element: T, visiting = new Set<ElementId>()): EffectiveElementActivity => {
    const cached = directCache.get(element.id);
    if (cached) return cached;

    if (!visiting.add(element.id)) return { activity: "visible" };
    const ownActivity = element.activity;
    const parent = element.parentGroupId ? byId.get(element.parentGroupId) : undefined;
    const parentActivity = parent && isContainerElementType(parent.type)
      ? resolveDirectActivity(parent, visiting)
      : undefined;

    // An ancestor disabled state wins over a child's own state. This preserves
    // the source of the effective disabled state for dependency diagnostics.
    const resolved = parentActivity?.activity === "disabled"
      ? { activity: "disabled" as const, disabledByElementId: parentActivity.disabledByElementId }
      : ownActivity === "disabled"
        ? { activity: "disabled" as const, disabledByElementId: element.id }
        : parentActivity?.activity === "hidden"
          ? { activity: "hidden" as const, hiddenByElementId: parentActivity.hiddenByElementId }
          : ownActivity === "hidden"
            ? { activity: "hidden" as const, hiddenByElementId: element.id }
            : { activity: "visible" as const };
    visiting.delete(element.id);
    directCache.set(element.id, resolved);
    return resolved;
  };

  const modifierActivityFor = (element: T): { activity: ElementActivity; ownerId: ElementId } | undefined => {
    let winning: { activity: ElementActivity; ownerId: ElementId } | undefined;
    for (const owner of modifierOwnersFor(element, byId)) {
      for (const modifierName of owner.modifierNames ?? []) {
        const modifier = modifierByName.get(modifierName);
        if (!modifier) continue;
        const activity = modifierContributionFor(modifier, selectedDrawingProfileId).state;
        if (activity !== undefined) winning = { activity, ownerId: owner.id };
      }
    }
    return winning;
  };

  for (const element of elements) {
    const directActivity = resolveDirectActivity(element);
    if (directActivity.activity !== "visible") {
      cache.set(element.id, directActivity);
      continue;
    }

    const modifierActivity = modifierActivityFor(element);
    const resolved = modifierActivity?.activity === "disabled"
      ? { activity: "disabled" as const, disabledByElementId: modifierActivity.ownerId }
      : modifierActivity?.activity === "hidden"
        ? { activity: "hidden" as const, hiddenByElementId: modifierActivity.ownerId }
        : { activity: "visible" as const };
    cache.set(element.id, resolved);
  }
  return cache;
};

export const effectiveElementActivity = <T extends ActivityElement>(
  element: T,
  activities: ReadonlyMap<ElementId, EffectiveElementActivity>
) => activities.get(element.id) ?? { activity: element.activity };

export const effectiveDrawElementIds = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
) => {
  const activities = effectiveElementActivityById(elements, drawingModifiers, selectedDrawingProfileId);
  return new Set(elements.filter((element) =>
    activityAllowsDrawing(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};

export const effectiveEvaluationElementIds = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
) => {
  const activities = effectiveElementActivityById(elements, drawingModifiers, selectedDrawingProfileId);
  return new Set(elements.filter((element) =>
    activityAllowsEvaluation(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};
