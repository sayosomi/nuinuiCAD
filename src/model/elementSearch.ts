import { elementTypeLabels } from "../types/geometry";
import type { CadElement, ElementId } from "../types/geometry";

export type ElementSearchResult = {
  element: CadElement;
  index: number;
  parentGroupNames: string[];
};

const normalizeSearchText = (text: string) => text.trim().toLocaleLowerCase();

const searchTokens = (query: string) =>
  normalizeSearchText(query).split(/\s+/).filter(Boolean);

const parentGroupNamesForElement = (
  element: CadElement,
  elementsById: Map<ElementId, CadElement>
) => {
  const names: string[] = [];
  let parentId = element.parentGroupId;
  const visited = new Set<ElementId>();

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = elementsById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentGroupId;
  }

  return names;
};

export const elementSearchResults = (
  elements: CadElement[],
  query: string,
  roleNamesById: Map<string, string> = new Map()
): ElementSearchResult[] => {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];

  const elementsById = new Map(elements.map((element) => [element.id, element]));

  return elements.flatMap((element, index) => {
    const parentGroupNames = parentGroupNamesForElement(element, elementsById);
    const roleNames = element.type === "group"
      ? (element.visibilityRoleIds ?? []).map((roleId) => roleNamesById.get(roleId) ?? roleId)
      : [];
    const searchableText = normalizeSearchText(
      [
        `${index + 1}`,
        element.id,
        element.name,
        element.type,
        elementTypeLabels[element.type],
        ...parentGroupNames,
        ...roleNames
      ].join(" ")
    );

    if (!tokens.every((token) => searchableText.includes(token))) return [];
    return [{ element, index, parentGroupNames }];
  });
};
