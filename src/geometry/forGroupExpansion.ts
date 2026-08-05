import { elementTypesWithoutOwnDrawableGeometry } from "../model/elementActivity";
import { remapElementReferences } from "../model/elementDuplication";
import { descendantIdsForGroup, isGroupElement } from "../model/groups";
import { elementDisplayName } from "../model/elementNames";
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
 * Source-order body statements owned directly by one forGroup entry
 * (mutation-scheduler owned or plain generic iteration). A nested forGroup
 * opener stays in the parent body, but its descendants are owned by the
 * nested invocation instead.
 */
export const forGroupOwnedTemplateElements = (
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
  variableValue,
  ancestorIterationVariables = []
}: {
  elements: CadElement[];
  forGroup: ForGroupElement;
  /** Original template identity when `forGroup` is a generated nested clone. */
  templateForGroupId?: ElementId;
  iterationIndex: number;
  variableValue: number;
  /**
   * Iteration variables owned by enclosing forGroup loops, lowest precedence
   * first. Excludes any element-local variable declared on an ancestor
   * forGroup opener itself - only the loop's own iteration binding is
   * inherited, never the opener's other local variables.
   */
  ancestorIterationVariables?: NumericVariable[];
}) => {
  const templateRootId = templateForGroupId ?? forGroup.id;
  const templateElements = forGroupTemplateElements(elements, templateRootId);
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

  const templateElementIdByGeneratedId = new Map<ElementId, ElementId>();

  const generatedElements = templateElements.map((templateElement) => {
    const generatedId = idMap.get(templateElement.id)!;
    templateElementIdByGeneratedId.set(generatedId, templateElement.id);
    const cloned = structuredClone(templateElement) as CadElement;
    // A direct child's parentGroupId equals the template forGroup's own id,
    // which is never a member of idMap (only its descendants are) - remap it
    // explicitly to this call's runtime instance id. A template descendant
    // whose parent is itself another template descendant (e.g. a
    // conditionalGroup nested inside the forGroup body) still goes through
    // idMap so the clone's parentGroupId points at its own iteration's
    // cloned parent, not the shared original.
    const remappedParentGroupId =
      cloned.parentGroupId === templateRootId
        ? forGroup.id
        : cloned.parentGroupId
          ? (idMap.get(cloned.parentGroupId) ?? cloned.parentGroupId)
          : cloned.parentGroupId;
    const renamed = {
      ...cloned,
      id: generatedId,
      name: elementTypesWithoutOwnDrawableGeometry.has(templateElement.type)
        ? ""
        : `[${forGroupIterationLabel(iterationVariable.name, variableValue)}] ${templateElement.name}`,
      parentGroupId: remappedParentGroupId
    } as CadElement;
    const remapped = remapElementReferences(renamed, idMap);
    return {
      ...remapped,
      numericVariables: [
        ...ancestorIterationVariables,
        iterationVariable,
        ...(remapped.numericVariables ?? [])
      ]
    } as CadElement;
  });

  const rows: ForGroupGeneratedRow[] = generatedElements
    .filter((element) => !isGroupElement(element))
    .map((element) => ({
      forGroupId: forGroup.id,
      templateElementId: templateElementIdByGeneratedId.get(element.id) ?? element.id,
      generatedElementId: element.id,
      iterationIndex,
      variableName: iterationVariable.name,
      variableValue,
      elementName: elementDisplayName(element),
      elementType: element.type
    }));

  return { generatedElements, rows, templateElementIdByGeneratedId, iterationVariable };
};
