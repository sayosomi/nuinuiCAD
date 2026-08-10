import { groupStateByElementId, isGroupElement } from "../model/groups";
import type { CadElement, DocumentPalette, ElementId } from "../types/geometry";
import { paletteColorById } from "./palette";

export const resolvedColorIdForElement = ({
  element,
  elementsById,
  ancestorGroupIds,
  palette
}: {
  element: CadElement;
  elementsById: Map<ElementId, CadElement>;
  ancestorGroupIds: ElementId[];
  palette: DocumentPalette;
}) => {
  const colorsById = paletteColorById(palette);
  if (element.colorId && colorsById.has(element.colorId)) return element.colorId;

  for (let index = ancestorGroupIds.length - 1; index >= 0; index -= 1) {
    const ancestor = elementsById.get(ancestorGroupIds[index]);
    if (ancestor && isGroupElement(ancestor) && ancestor.colorId && colorsById.has(ancestor.colorId)) {
      return ancestor.colorId;
    }
  }

  return colorsById.has(palette.defaultColorId)
    ? palette.defaultColorId
    : palette.colors[0]?.id ?? "";
};

export const resolvedElementColorMap = (
  elements: CadElement[],
  palette: DocumentPalette
): Map<ElementId, string> => {
  const states = groupStateByElementId(elements);
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const colorsById = paletteColorById(palette);
  const fallback = colorsById.get(palette.defaultColorId)?.hex ?? palette.colors[0]?.hex ?? "#31322f";

  return new Map(
    elements.map((element) => {
      const colorId = resolvedColorIdForElement({
        element,
        elementsById,
        ancestorGroupIds: states.get(element.id)?.ancestorGroupIds ?? [],
        palette
      });
      return [element.id, colorsById.get(colorId)?.hex ?? fallback];
    })
  );
};
