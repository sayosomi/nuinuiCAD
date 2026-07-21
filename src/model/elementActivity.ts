import type { CadElementType, ElementId } from "../types/geometry";

export type ElementActivity = "visible" | "hidden" | "disabled";

/** The v2 DSL and Rust IPC continue to use this boolean representation. */
export type LegacyElementActivityFlags = {
  visible?: boolean;
  enabled?: boolean;
};

type ActivityElement = LegacyElementActivityFlags & {
  id: ElementId;
  type: string;
  parentGroupId?: ElementId;
};

export type EffectiveElementActivity = {
  activity: ElementActivity;
  hiddenByElementId?: ElementId;
  disabledByElementId?: ElementId;
};

export const elementActivityFromLegacyFlags = ({
  visible = true,
  enabled = true
}: LegacyElementActivityFlags): ElementActivity => {
  if (!enabled) return "disabled";
  return visible ? "visible" : "hidden";
};

export const legacyFlagsForElementActivity = (
  activity: ElementActivity
): Required<LegacyElementActivityFlags> => {
  switch (activity) {
    case "visible":
      return { visible: true, enabled: true };
    case "hidden":
      return { visible: false, enabled: true };
    case "disabled":
      return { visible: true, enabled: false };
  }
};

export const activityAllowsEvaluation = (activity: ElementActivity) => activity !== "disabled";

export const activityAllowsDrawing = (activity: ElementActivity) => activity === "visible";

const isActivityContainer = (elementType: string) =>
  elementType === "group" || elementType === "conditionalGroup" || elementType === "forGroup";

/**
 * Types whose evaluator never assigns computedGeometry under their own
 * element id: edge/extendTrim/move/symmetricMove mutate a referenced line's
 * geometry in place instead, and variable writes to computedVariables, not
 * computedGeometry. hidden and visible are indistinguishable for these
 * types; only disabled changes anything observable.
 */
const elementTypesWithoutOwnDrawableGeometry = new Set<CadElementType>([
  "variable",
  "edge",
  "extendTrim",
  "move",
  "symmetricMove"
]);

export const elementTypeSupportsHiddenActivity = (elementType: CadElementType) =>
  isActivityContainer(elementType) || !elementTypesWithoutOwnDrawableGeometry.has(elementType);

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
 * evaluation or drawing.
 */
export const effectiveElementActivityById = <T extends ActivityElement>(
  elements: readonly T[]
): ReadonlyMap<ElementId, EffectiveElementActivity> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const cache = new Map<ElementId, EffectiveElementActivity>();

  const resolve = (element: T, visiting = new Set<ElementId>()): EffectiveElementActivity => {
    const cached = cache.get(element.id);
    if (cached) return cached;

    const ownActivity = elementActivityFromLegacyFlags(element);
    const parent = element.parentGroupId ? byId.get(element.parentGroupId) : undefined;
    const parentActivity = parent && isActivityContainer(parent.type) && !visiting.has(element.id)
      ? (() => {
          visiting.add(element.id);
          const resolved = resolve(parent, visiting);
          visiting.delete(element.id);
          return resolved;
        })()
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
    cache.set(element.id, resolved);
    return resolved;
  };

  for (const element of elements) resolve(element);
  return cache;
};

export const effectiveElementActivity = <T extends ActivityElement>(
  element: T,
  activities: ReadonlyMap<ElementId, EffectiveElementActivity>
) => activities.get(element.id) ?? { activity: elementActivityFromLegacyFlags(element) };

export const effectiveDrawElementIds = <T extends ActivityElement>(elements: readonly T[]) => {
  const activities = effectiveElementActivityById(elements);
  return new Set(elements.filter((element) =>
    activityAllowsDrawing(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};

export const effectiveEvaluationElementIds = <T extends ActivityElement>(elements: readonly T[]) => {
  const activities = effectiveElementActivityById(elements);
  return new Set(elements.filter((element) =>
    activityAllowsEvaluation(effectiveElementActivity(element, activities).activity)
  ).map((element) => element.id));
};
