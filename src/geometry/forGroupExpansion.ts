import { remapElementReferences } from "../model/elementDuplication";
import { descendantIdsForGroup, isGroupElement } from "../model/groups";
import type {
  CadElement,
  ElementId,
  ForGroupElement,
  ForGroupGeneratedRow,
  NumericVariable
} from "../types/geometry";

export const forGroupGeneratedElementId = ({
  forGroupId,
  templateElementId,
  iterationIndex
}: {
  forGroupId: ElementId;
  templateElementId: ElementId;
  iterationIndex: number;
}) => `${templateElementId}@${forGroupId}:${iterationIndex}`;

export const forGroupIterationLabel = (
  variableName: string,
  variableValue: number
) => `${variableName}=${Number.isInteger(variableValue) ? variableValue : Number(variableValue.toFixed(7))}`;

export const forGroupTemplateElements = (
  elements: CadElement[],
  forGroupId: ElementId
) => {
  const descendantIds = new Set(descendantIdsForGroup(elements, forGroupId));
  return elements.filter((element) => descendantIds.has(element.id));
};

/**
 * Source-order body statements owned by one scheduler invocation. A nested
 * forGroup opener stays in the parent body, but its descendants are replayed
 * only by the nested invocation.
 */
export const forGroupMutationTemplateElements = (
  elements: CadElement[],
  forGroupId: ElementId
) => {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  return forGroupTemplateElements(elements, forGroupId).filter((element) => {
    let parentId = element.parentGroupId;
    while (parentId) {
      if (parentId === forGroupId) return true;
      if (elementsById.get(parentId)?.type === "forGroup") return false;
      parentId = elementsById.get(parentId)?.parentGroupId;
    }
    return true;
  });
};

export const forGroupTemplateDescendantIds = (elements: CadElement[]) => {
  const ids = new Set<ElementId>();
  for (const element of elements) {
    if (element.type !== "forGroup") continue;
    for (const id of descendantIdsForGroup(elements, element.id)) {
      ids.add(id);
    }
  }
  return ids;
};

export const expandForGroupIteration = ({
  elements,
  forGroup,
  templateForGroupId,
  iterationIndex,
  variableValue
}: {
  elements: CadElement[];
  forGroup: ForGroupElement;
  /** Original template identity when `forGroup` is a generated nested clone. */
  templateForGroupId?: ElementId;
  iterationIndex: number;
  variableValue: number;
}) => {
  const templateElements = forGroupTemplateElements(elements, templateForGroupId ?? forGroup.id);
  const idMap = new Map(
    templateElements.map((element) => [
      element.id,
      forGroupGeneratedElementId({
        forGroupId: forGroup.id,
        templateElementId: element.id,
        iterationIndex
      })
    ])
  );
  const iterationVariable: NumericVariable = {
    id: `${forGroup.id}:iteration`,
    name: forGroup.variableName.trim() || "i",
    value: variableValue
  };

  const generatedElements = templateElements.map((templateElement) => {
    const generatedId = idMap.get(templateElement.id)!;
    const cloned = structuredClone(templateElement) as CadElement;
    const renamed = {
      ...cloned,
      id: generatedId,
      name: `[${forGroupIterationLabel(iterationVariable.name, variableValue)}] ${templateElement.name}`,
      // A template descendant's parent may itself be another template
      // descendant (e.g. a conditionalGroup nested inside the forGroup
      // body) - remap through idMap so the clone's parentGroupId points at
      // its own iteration's cloned parent, not the shared original.
      parentGroupId: cloned.parentGroupId ? (idMap.get(cloned.parentGroupId) ?? cloned.parentGroupId) : cloned.parentGroupId
    } as CadElement;
    const remapped = remapElementReferences(renamed, idMap);
    return {
      ...remapped,
      numericVariables: [
        iterationVariable,
        ...(remapped.numericVariables ?? [])
      ]
    } as CadElement;
  });

  const rows: ForGroupGeneratedRow[] = generatedElements
    .filter((element) => !isGroupElement(element))
    .map((element) => ({
      forGroupId: forGroup.id,
      templateElementId: templateElements.find(
        (templateElement) => idMap.get(templateElement.id) === element.id
      )?.id ?? element.id,
      generatedElementId: element.id,
      iterationIndex,
      variableName: iterationVariable.name,
      variableValue,
      elementName: element.name,
      elementType: element.type
    }));

  return { generatedElements, rows };
};
