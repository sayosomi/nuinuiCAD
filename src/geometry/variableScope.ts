import type {
  CadElement,
  ComputedVariable,
  ElementId,
  VariableElement
} from "../types/geometry";

export const isVariableElement = (element: CadElement): element is VariableElement =>
  element.type === "variable";

const ancestorGroupIds = (
  element: Pick<CadElement, "parentGroupId">,
  elementsById: Map<ElementId, CadElement>
) => {
  const ids: ElementId[] = [];
  const visited = new Set<ElementId>();
  let parentId = element.parentGroupId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    ids.push(parentId);
    parentId = elementsById.get(parentId)?.parentGroupId;
  }

  return ids;
};

export const variableIsInScope = ({
  variable,
  consumer,
  elementsById
}: {
  variable: Pick<VariableElement, "scope" | "parentGroupId">;
  consumer: Pick<CadElement, "parentGroupId">;
  elementsById: Map<ElementId, CadElement>;
}) => {
  if (variable.scope === "global") return true;
  if (!variable.parentGroupId) return !consumer.parentGroupId;
  if (consumer.parentGroupId === variable.parentGroupId) return true;
  return ancestorGroupIds(consumer, elementsById).includes(variable.parentGroupId);
};

export const resolveVariableReference = ({
  variableIdOrName,
  consumer,
  elements,
  elementsById,
  computedVariables
}: {
  variableIdOrName: string;
  consumer: CadElement;
  elements: CadElement[];
  elementsById: Map<ElementId, CadElement>;
  computedVariables: Map<ElementId, ComputedVariable>;
}) => {
  const consumerIndex = elements.findIndex((element) => element.id === consumer.id);
  for (let index = consumerIndex - 1; index >= 0; index -= 1) {
    const candidate = elements[index];
    if (!isVariableElement(candidate)) continue;
    if (candidate.id !== variableIdOrName && candidate.name !== variableIdOrName) continue;
    if (!variableIsInScope({ variable: candidate, consumer, elementsById })) continue;

    return {
      element: candidate,
      computed: computedVariables.get(candidate.id) ?? null
    };
  }

  return null;
};
