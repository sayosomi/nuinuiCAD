import type {
  CadElementType,
  DrawingModifierDefinition,
  DrawingModifierProperties,
  DrawingModifierStroke,
  ElementId
} from "../types/geometry";
import { isContainerElementType } from "./containers";
import type {
  DrawingModifierPropertyWinner,
  EffectiveDrawingModifierResolution
} from "./drawingModifierInspection";

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

export type EffectiveDrawingModifierRuntime = {
  resolution: EffectiveDrawingModifierResolution;
  activity: EffectiveElementActivity;
  hasModifier: boolean;
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

type SelectedProfileDeltaIdentity = {
  profileId: string;
  profileName: string;
};

type ModifierPropertyContribution<K extends keyof DrawingModifierProperties> = {
  value: NonNullable<DrawingModifierProperties[K]>;
  selectedProfileDelta: SelectedProfileDeltaIdentity | null;
};

type ModifierContribution = {
  state?: ModifierPropertyContribution<"state">;
  widthPx?: ModifierPropertyContribution<"widthPx">;
  style?: ModifierPropertyContribution<"style">;
  color?: ModifierPropertyContribution<"color">;
};

const modifierContributionFor = (
  modifier: DrawingModifierDefinition,
  selectedDrawingProfileId?: string
): ModifierContribution => {
  const delta = selectedDrawingProfileId
    ? modifier.profileDeltas?.find((candidate) => candidate.profileId === selectedDrawingProfileId)
    : undefined;
  const property = <K extends keyof DrawingModifierProperties>(
    key: K
  ): ModifierPropertyContribution<K> | undefined => {
    const deltaValue = delta?.[key];
    if (deltaValue !== undefined) {
      return {
        value: deltaValue as NonNullable<DrawingModifierProperties[K]>,
        selectedProfileDelta: {
          profileId: delta.profileId,
          profileName: delta.profileName
        }
      };
    }
    const commonValue = modifier[key];
    if (commonValue === undefined) return undefined;
    return {
      value: commonValue as NonNullable<DrawingModifierProperties[K]>,
      selectedProfileDelta: null
    };
  };
  return {
    state: property("state"),
    widthPx: property("widthPx"),
    style: property("style"),
    color: property("color")
  };
};

const winnerFor = (
  ownerElementId: ElementId,
  modifierName: string,
  contribution: { selectedProfileDelta: SelectedProfileDeltaIdentity | null }
): DrawingModifierPropertyWinner => ({
  ownerElementId,
  modifierName,
  selectedProfileDelta: contribution.selectedProfileDelta
    ? { ...contribution.selectedProfileDelta }
    : null
});

/**
 * Single shared resolution pass for effective Drawing Modifier/Profile state,
 * stroke properties, and winner-only provenance. Existing activity/stroke APIs
 * project from this result so observability cannot drift from their precedence.
 */
export const effectiveDrawingModifierRuntimeById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
): ReadonlyMap<ElementId, EffectiveDrawingModifierRuntime> => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const modifierByName = new Map(drawingModifiers.map((modifier) => [modifier.name, modifier] as const));
  const directCache = new Map<ElementId, EffectiveElementActivity>();
  const runtime = new Map<ElementId, EffectiveDrawingModifierRuntime>();

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

  for (const element of elements) {
    let hasModifier = false;
    let modifierState: ElementActivity = "visible";
    let stateWinner: DrawingModifierPropertyWinner | null = null;
    let widthPx = defaultDrawingModifierProperties.widthPx;
    let widthPxWinner: DrawingModifierPropertyWinner | null = null;
    let style = defaultDrawingModifierProperties.style;
    let styleWinner: DrawingModifierPropertyWinner | null = null;
    let color = { ...defaultDrawingModifierProperties.color };
    let colorWinner: DrawingModifierPropertyWinner | null = null;

    for (const owner of modifierOwnersFor(element, byId)) {
      for (const modifierName of owner.modifierNames ?? []) {
        const modifier = modifierByName.get(modifierName);
        if (!modifier) continue;
        hasModifier = true;
        const contribution = modifierContributionFor(modifier, selectedDrawingProfileId);
        if (contribution.state) {
          modifierState = contribution.state.value;
          stateWinner = winnerFor(owner.id, modifier.name, contribution.state);
        }
        if (contribution.widthPx) {
          widthPx = contribution.widthPx.value;
          widthPxWinner = winnerFor(owner.id, modifier.name, contribution.widthPx);
        }
        if (contribution.style) {
          style = contribution.style.value;
          styleWinner = winnerFor(owner.id, modifier.name, contribution.style);
        }
        if (contribution.color) {
          color = { ...contribution.color.value };
          colorWinner = winnerFor(owner.id, modifier.name, contribution.color);
        }
      }
    }

    const directActivity = resolveDirectActivity(element);
    const modifierCanWinState = directActivity.activity === "visible";
    const activity = !modifierCanWinState
      ? directActivity
      : modifierState === "disabled"
        ? { activity: "disabled" as const, disabledByElementId: stateWinner?.ownerElementId }
        : modifierState === "hidden"
          ? { activity: "hidden" as const, hiddenByElementId: stateWinner?.ownerElementId }
          : { activity: "visible" as const };

    runtime.set(element.id, {
      hasModifier,
      activity,
      resolution: {
        state: {
          value: activity.activity,
          winner: modifierCanWinState ? stateWinner : null
        },
        widthPx: { value: widthPx, winner: widthPxWinner },
        style: { value: style, winner: styleWinner },
        color: { value: { ...color }, winner: colorWinner }
      }
    });
  }

  return runtime;
};

export const effectiveDrawingModifierResolutionsByRuntime = (
  runtime: ReadonlyMap<ElementId, EffectiveDrawingModifierRuntime>
): ReadonlyMap<ElementId, EffectiveDrawingModifierResolution> =>
  new Map(Array.from(runtime, ([elementId, resolved]) => [elementId, resolved.resolution] as const));

export const effectiveDrawingModifierResolutionById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
): ReadonlyMap<ElementId, EffectiveDrawingModifierResolution> =>
  effectiveDrawingModifierResolutionsByRuntime(
    effectiveDrawingModifierRuntimeById(elements, drawingModifiers, selectedDrawingProfileId)
  );

export const effectiveDrawingModifierStrokeByRuntime = (
  runtime: ReadonlyMap<ElementId, EffectiveDrawingModifierRuntime>
): ReadonlyMap<ElementId, DrawingModifierStroke> => {
  const effectiveStrokes = new Map<ElementId, DrawingModifierStroke>();
  for (const [elementId, resolved] of runtime) {
    if (!resolved.hasModifier) continue;
    effectiveStrokes.set(elementId, copyDrawingModifierStroke({
      widthPx: resolved.resolution.widthPx.value,
      style: resolved.resolution.style.value,
      color: resolved.resolution.color.value
    }));
  }
  return effectiveStrokes;
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
): ReadonlyMap<ElementId, DrawingModifierStroke> =>
  effectiveDrawingModifierStrokeByRuntime(
    effectiveDrawingModifierRuntimeById(elements, drawingModifiers, selectedDrawingProfileId)
  );

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

export const effectiveElementActivityByRuntime = (
  runtime: ReadonlyMap<ElementId, EffectiveDrawingModifierRuntime>
): ReadonlyMap<ElementId, EffectiveElementActivity> =>
  new Map(Array.from(runtime, ([elementId, resolved]) => [elementId, resolved.activity] as const));

/**
 * Resolves element activity once per element. This is intentionally separate
 * from outline-fold state: collapsed groups affect the outline only, never
 * evaluation || drawing.
 */
export const effectiveElementActivityById = <T extends ActivityElement>(
  elements: readonly T[],
  drawingModifiers: readonly DrawingModifierDefinition[] = [],
  selectedDrawingProfileId?: string
): ReadonlyMap<ElementId, EffectiveElementActivity> =>
  effectiveElementActivityByRuntime(
    effectiveDrawingModifierRuntimeById(elements, drawingModifiers, selectedDrawingProfileId)
  );

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
