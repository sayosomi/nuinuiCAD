import type { EvaluationResult, CadElement, ElementId } from "../types/geometry";
import { getDirectParentIds } from "../model/dependencies";
import { descendantIdsForGroup, groupStateByElementId, isGroupElement } from "../model/groups";

export type DslExportOrigin = "selected" | "group-content" | "parent" | "dependency";
export type DslExportWarningKind = "disabled" | "invalid" | "too-late";

export type DslExportLineAnnotation = {
  origin: DslExportOrigin;
  warnings: DslExportWarningKind[];
};

export type DslExportSelection = {
  elements: CadElement[];
  annotationsByElementId: Map<ElementId, DslExportLineAnnotation>;
  selectedCount: number;
  groupContentCount: number;
  parentCount: number;
  dependencyCount: number;
  warningCounts: Record<DslExportWarningKind, number>;
};

type CreateDslExportSelectionInput = {
  elements: CadElement[];
  selectedElementIds: ElementId[];
  evaluation?: EvaluationResult;
};

const originPriority: Record<DslExportOrigin, number> = {
  selected: 4,
  "group-content": 3,
  dependency: 2,
  parent: 1
};

const mergeOrigin = (current: DslExportOrigin | undefined, next: DslExportOrigin) =>
  !current || originPriority[next] > originPriority[current] ? next : current;

const originLabel = (origin: DslExportOrigin) => {
  switch (origin) {
    case "selected":
      return "実際に選択";
    case "group-content":
      return "選択グループの中身";
    case "parent":
      return "親要素";
    case "dependency":
      return "選択要素の評価に必要";
  }
};

export const dslExportAnnotationComment = (annotation: DslExportLineAnnotation) => {
  const warning = annotation.warnings.length > 0
    ? ` warning=${annotation.warnings.join(",")}`
    : "";
  return `// @dsl-export: ${annotation.origin}${warning} ${originLabel(annotation.origin)}`;
};

export const createDslExportSelection = ({
  elements,
  selectedElementIds,
  evaluation
}: CreateDslExportSelectionInput): DslExportSelection => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const groupStates = groupStateByElementId(elements);
  const originsByElementId = new Map<ElementId, DslExportOrigin>();

  const add = (id: ElementId, origin: DslExportOrigin) => {
    if (!elementsById.has(id)) return false;
    const next = mergeOrigin(originsByElementId.get(id), origin);
    if (next === originsByElementId.get(id)) return false;
    originsByElementId.set(id, next);
    return true;
  };

  const addAncestorGroups = (id: ElementId) => {
    let changed = false;
    for (const ancestorId of groupStates.get(id)?.ancestorGroupIds ?? []) {
      changed = add(ancestorId, "parent") || changed;
    }
    return changed;
  };

  for (const id of selectedElementIds) {
    const element = elementsById.get(id);
    if (!element) continue;
    add(id, "selected");
    addAncestorGroups(id);
    if (isGroupElement(element)) {
      for (const descendantId of descendantIdsForGroup(elements, element.id)) {
        add(descendantId, "group-content");
        addAncestorGroups(descendantId);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const currentIds = [...originsByElementId.keys()];
    for (const id of currentIds) {
      const element = elementsById.get(id);
      if (!element) continue;
      for (const parentId of getDirectParentIds(element)) {
        if (!elementsById.has(parentId)) continue;
        changed = add(parentId, "dependency") || changed;
        changed = addAncestorGroups(parentId) || changed;
      }
    }
  }

  const errorElementIds = new Set(evaluation?.errors.map((error) => error.elementId) ?? []);
  const annotationsByElementId = new Map<ElementId, DslExportLineAnnotation>();
  const warningCounts: Record<DslExportWarningKind, number> = {
    disabled: 0,
    invalid: 0,
    "too-late": 0
  };

  for (const [id, origin] of originsByElementId) {
    const element = elementsById.get(id);
    if (!element) continue;
    const warnings = new Set<DslExportWarningKind>();
    const isPulled = origin === "dependency" || origin === "parent";
    if (isPulled) {
      if (element.activity === "disabled" || groupStates.get(id)?.disabledByGroupId) warnings.add("disabled");
      if (errorElementIds.has(id)) warnings.add("invalid");
    }
    annotationsByElementId.set(id, { origin, warnings: [...warnings] });
  }

  for (const [id, annotation] of annotationsByElementId) {
    if (annotation.origin !== "dependency" && annotation.origin !== "parent") continue;
    const parentIndex = indexById.get(id);
    if (parentIndex === undefined) continue;
    for (const [dependentId] of annotationsByElementId) {
      const dependent = elementsById.get(dependentId);
      const dependentIndex = indexById.get(dependentId);
      if (!dependent || dependentIndex === undefined || dependentIndex >= parentIndex) continue;
      if (getDirectParentIds(dependent).includes(id)) {
        annotation.warnings = Array.from(new Set([...annotation.warnings, "too-late"]));
      }
    }
  }

  for (const annotation of annotationsByElementId.values()) {
    for (const warning of annotation.warnings) {
      warningCounts[warning] += 1;
    }
  }

  const exportedElements = elements.filter((element) => annotationsByElementId.has(element.id));
  const countOrigin = (origin: DslExportOrigin) =>
    [...annotationsByElementId.values()].filter((annotation) => annotation.origin === origin).length;

  return {
    elements: exportedElements,
    annotationsByElementId,
    selectedCount: countOrigin("selected"),
    groupContentCount: countOrigin("group-content"),
    parentCount: countOrigin("parent"),
    dependencyCount: countOrigin("dependency"),
    warningCounts
  };
};
