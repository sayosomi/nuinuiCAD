import type {
  CadElement,
  ConditionalGroupElement,
  ElementId,
  ForGroupElement,
  GroupElement
} from "../types/geometry";
import { isContainerElement } from "./containers";
export { isContainerElement } from "./containers";
export type { ContainerElement } from "./containers";
import {
  effectiveDrawElementIds,
  effectiveElementActivity,
  effectiveElementActivityById,
  effectiveEvaluationElementIds
} from "./elementActivity";

export type GroupLikeElement = GroupElement | ConditionalGroupElement | ForGroupElement;

/**
 * Presentation-only fold state for an element. The historical name is kept
 * because group/for callers already depend on it, but ordinary multiline
 * statements use `statementExpanded` too.
 */
export type GroupFoldState = {
  expanded?: boolean;
  elseExpanded?: boolean;
  statementExpanded?: boolean;
};
export type GroupFoldById = ReadonlyMap<ElementId, GroupFoldState>;

/**
 * A fold target is a presentation-only part of an element.
 * `primary` means a group/for body, || the then body of a conditional group.
 * `statement` means an ordinary multiline element statement.
 */
export type FoldTargetBranch = "statement" | "primary" | "else";
export type FoldTarget = { elementId: ElementId; branch: FoldTargetBranch };

/**
 * An element with no entry is expanded. The "collapsed on open" overview is a
 * document-load decision written explicitly by initialGroupFoldForLoadedDocument,
 * not an implicit default: a group written during an editing session must stay
 * open while its body is being filled in.
 */
export const isGroupExpanded = (id: ElementId, groupFoldById?: GroupFoldById) =>
  groupFoldById?.get(id)?.expanded ?? true;

export const isElseExpanded = (id: ElementId, groupFoldById?: GroupFoldById) =>
  groupFoldById?.get(id)?.elseExpanded ?? true;

export const isStatementExpanded = (id: ElementId, groupFoldById?: GroupFoldById) =>
  groupFoldById?.get(id)?.statementExpanded ?? true;

export const isFoldTargetExpanded = (target: FoldTarget, groupFoldById?: GroupFoldById) =>
  target.branch === "statement"
    ? isStatementExpanded(target.elementId, groupFoldById)
    : target.branch === "primary"
      ? isGroupExpanded(target.elementId, groupFoldById)
      : isElseExpanded(target.elementId, groupFoldById);

export const isGroupElement = (element: CadElement): element is GroupLikeElement =>
  element.type === "group" || element.type === "conditionalGroup" || element.type === "forGroup";

/**
 * The "every group collapsed" overview a freshly loaded document opens with,
 * as explicit state. Applied only on document load (never on undo/redo), so an
 * element id that appears later in the session has no entry && reads as
 * expanded. `elements` is the flat document-order array, so nested
 * group/forGroup/conditionalGroup elements are all covered at every depth.
 * Only the `primary` branch is seeded; `else` bodies keep their expanded default.
 */
export const initialGroupFoldForLoadedDocument = (
  elements: readonly CadElement[]
): GroupFoldById =>
  new Map(
    elements
      .filter(isGroupElement)
      .map((element) => [element.id, { expanded: false }] as const)
  );

export const isConditionalGroupElement = (
  element: CadElement
): element is ConditionalGroupElement => element.type === "conditionalGroup";

export const isForGroupElement = (
  element: CadElement
): element is ForGroupElement => element.type === "forGroup";

/**
 * Walks `element.parentGroupId` upward, collecting every forGroup-typed
 * ancestor id. Sized for a single per-element check (pathReverseEvaluator.ts)
 * rather than groupStateByElementId's whole-document precompute.
 */
export const forGroupAncestorIds = (
  elementsById: Map<ElementId, CadElement>,
  element: CadElement
): Set<ElementId> => {
  const ancestors = new Set<ElementId>();
  const visited = new Set<ElementId>();
  let parentId = element.parentGroupId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = elementsById.get(parentId);
    if (!parent) break;
    if (isForGroupElement(parent)) ancestors.add(parent.id);
    parentId = parent.parentGroupId;
  }
  return ancestors;
};

export type ElementGroupState = {
  depth: number;
  ancestorGroupIds: ElementId[];
  hiddenByGroupId: ElementId | null;
  disabledByGroupId: ElementId | null;
  isCollapsedByGroup: boolean;
};

export const groupStateByElementId = (elements: CadElement[], groupFoldById?: GroupFoldById) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const activities = effectiveElementActivityById(elements);
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
    if (!parent || !isContainerElement(parent)) {
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

    const parentFoldTarget: FoldTarget = {
      elementId: parent.id,
      branch: isConditionalGroupElement(parent) && element.conditionalBranch === "else"
        ? "else"
        : "primary"
    };
    const collapsedByParent =
      parentState.isCollapsedByGroup ||
      !isFoldTargetExpanded(parentFoldTarget, groupFoldById);
    const state: ElementGroupState = {
      depth: parentState.depth + 1,
      ancestorGroupIds: [...parentState.ancestorGroupIds, parent.id],
      hiddenByGroupId: parentState.hiddenByGroupId ??
        (effectiveElementActivity(parent, activities).activity === "hidden" ? parent.id : null),
      disabledByGroupId: parentState.disabledByGroupId ??
        (effectiveElementActivity(parent, activities).activity === "disabled" ? parent.id : null),
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

export const visibleOutlineElements = (elements: CadElement[], groupFoldById?: GroupFoldById) => {
  const states = groupStateByElementId(elements, groupFoldById);
  return elements.filter((element) => !states.get(element.id)?.isCollapsedByGroup);
};

export const effectiveVisibleElementIds = (elements: CadElement[]) => {
  return effectiveDrawElementIds(elements);
};

export const effectiveEnabledElementIds = (elements: CadElement[]) => {
  return effectiveEvaluationElementIds(elements);
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
