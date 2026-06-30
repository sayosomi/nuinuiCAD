import type { CadElement, ConditionalGroupElement, ElementId, GroupElement } from "../types/geometry";

export type GroupLikeElement = GroupElement | ConditionalGroupElement;

export const isGroupElement = (element: CadElement): element is GroupLikeElement =>
  element.type === "group" || element.type === "conditionalGroup";

export const isConditionalGroupElement = (
  element: CadElement
): element is ConditionalGroupElement => element.type === "conditionalGroup";

export type ElementGroupState = {
  depth: number;
  ancestorGroupIds: ElementId[];
  hiddenByGroupId: ElementId | null;
  disabledByGroupId: ElementId | null;
  isCollapsedByGroup: boolean;
};

export const groupStateByElementId = (elements: CadElement[]) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const cache = new Map<ElementId, ElementGroupState>();

  const stateFor = (element: CadElement, visiting = new Set<ElementId>()): ElementGroupState => {
    const cached = cache.get(element.id);
    if (cached) return cached;

    if (!element.parentGroupId || visiting.has(element.id)) {
      const state: ElementGroupState = {
        depth: 0,
        ancestorGroupIds: [],
        hiddenByGroupId: null,
        disabledByGroupId: null,
        isCollapsedByGroup: false
      };
      cache.set(element.id, state);
      return state;
    }

    const parent = byId.get(element.parentGroupId);
    if (!parent || !isGroupElement(parent)) {
      const state: ElementGroupState = {
        depth: 0,
        ancestorGroupIds: [],
        hiddenByGroupId: null,
        disabledByGroupId: null,
        isCollapsedByGroup: false
      };
      cache.set(element.id, state);
      return state;
    }

    visiting.add(element.id);
    const parentState = stateFor(parent, visiting);
    visiting.delete(element.id);

    const collapsedByParent =
      parentState.isCollapsedByGroup ||
      !parent.expanded ||
      (isConditionalGroupElement(parent) &&
        element.conditionalBranch === "else" &&
        !parent.elseExpanded);
    const state: ElementGroupState = {
      depth: parentState.depth + 1,
      ancestorGroupIds: [...parentState.ancestorGroupIds, parent.id],
      hiddenByGroupId: parentState.hiddenByGroupId ?? (!parent.visible ? parent.id : null),
      disabledByGroupId: parentState.disabledByGroupId ?? (!parent.enabled ? parent.id : null),
      isCollapsedByGroup: collapsedByParent
    };
    cache.set(element.id, state);
    return state;
  };

  for (const element of elements) {
    stateFor(element);
  }

  return cache;
};

export const childIdsByGroupId = (elements: CadElement[]) => {
  const children = new Map<ElementId, ElementId[]>();
  for (const element of elements) {
    if (!element.parentGroupId) continue;
    children.set(element.parentGroupId, [
      ...(children.get(element.parentGroupId) ?? []),
      element.id
    ]);
  }
  return children;
};

export const descendantIdsForGroup = (
  elements: CadElement[],
  groupId: ElementId
): ElementId[] => {
  const children = childIdsByGroupId(elements);
  const descendants: ElementId[] = [];
  const visit = (id: ElementId) => {
    for (const childId of children.get(id) ?? []) {
      descendants.push(childId);
      visit(childId);
    }
  };
  visit(groupId);
  const order = new Map(elements.map((element, index) => [element.id, index]));
  return descendants.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
};

export const subtreeIdsForElement = (elements: CadElement[], elementId: ElementId) => {
  const element = elements.find((item) => item.id === elementId);
  if (!element) return [];
  return isGroupElement(element)
    ? [element.id, ...descendantIdsForGroup(elements, element.id)]
    : [element.id];
};

export const visibleOutlineElements = (elements: CadElement[]) => {
  const states = groupStateByElementId(elements);
  return elements.filter((element) => !states.get(element.id)?.isCollapsedByGroup);
};

export const effectiveVisibleElementIds = (elements: CadElement[]) => {
  const states = groupStateByElementId(elements);
  return new Set(
    elements
      .filter((element) => element.visible && !states.get(element.id)?.hiddenByGroupId)
      .map((element) => element.id)
  );
};

export const effectiveEnabledElementIds = (elements: CadElement[]) => {
  const states = groupStateByElementId(elements);
  return new Set(
    elements
      .filter((element) => element.enabled && !states.get(element.id)?.disabledByGroupId)
      .map((element) => element.id)
  );
};

export const nearestPreviousGroup = (
  elements: CadElement[],
  elementId: ElementId
): GroupLikeElement | null => {
  const index = elements.findIndex((element) => element.id === elementId);
  if (index <= 0) return null;
  const element = elements[index];
  const state = groupStateByElementId(elements).get(element.id);
  const targetDepth = state?.depth ?? 0;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = elements[cursor];
    const candidateDepth = groupStateByElementId(elements).get(candidate.id)?.depth ?? 0;
    if (candidateDepth < targetDepth) break;
    if (candidateDepth === targetDepth && isGroupElement(candidate)) return candidate;
  }

  return null;
};
