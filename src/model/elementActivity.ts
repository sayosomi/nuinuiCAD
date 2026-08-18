import type {
  CadElementType,
  DrawingModifierDefinition,
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

const copyDrawingModifierStroke = (stroke: DrawingModifierStroke): DrawingModifierStroke => ({
  ...stroke,
  color: { ...stroke.color }
});

/**
 * Resolves only the explicit stroke property of drawing modifiers. State and
 * stroke are intentionally independent properties: a state-only modifier does
 * not clear a stroke inherited from an outer owner, and a stroke-only modifier
 * does not affect activity.
 */
export const effectiveDrawingModifierStrokeById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = []
): ReadonlyMap<ElementId, DrawingModifierStroke> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const strokeByName = new Map(
    drawingModifiers.flatMap((modifier) => modifier.stroke
      ? [[modifier.name, modifier.stroke] as const]
      : [])
  );
  const effectiveStrokes = new Map<ElementId, DrawingModifierStroke>();

  for (const element of elements) {
    let winningStroke: DrawingModifierStroke | undefined;
    for (const owner of modifierOwnersFor(element, byId)) {
      for (const modifierName of owner.modifierNames ?? []) {
        const stroke = strokeByName.get(modifierName);
        if (stroke) winningStroke = stroke;
      }
    }
    if (winningStroke) effectiveStrokes.set(element.id, copyDrawingModifierStroke(winningStroke));
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
  drawingModifiers: readonly DrawingModifierDefinition[] = []
): ReadonlyMap<ElementId, EffectiveElementActivity> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const modifierStateByName = new Map(drawingModifiers.map((modifier) => [modifier.name, modifier.state] as const));
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
        const activity = modifierStateByName.get(modifierName);
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
  drawingModifiers: readonly DrawingModifierDefinition[] = []
) => {
  const activities = effectiveElementActivityById(elements, drawingModifiers);
  return new Set(elements.filter((element) =>
    activityAllowsDrawing(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};

export const effectiveEvaluationElementIds = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = []
) => {
  const activities = effectiveElementActivityById(elements, drawingModifiers);
  return new Set(elements.filter((element) =>
    activityAllowsEvaluation(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};
