import type { LegacyDocumentPalette } from "./palette";
import { groupStateByElementId, isGroupElement } from "../model/groups";
import type {
  CadElement,
  ElementId
} from "../types/geometry";
import { paletteColorById } from "./palette";

const legacyColorId = (element: CadElement) =>
  (element as CadElement & { colorId?: string }).colorId;

export const resolvedColorIdForElement = ({
  element,
  elementsById,
  ancestorGroupIds,
  palette
}: {
  element: CadElement;
  elementsById: Map<ElementId, CadElement>;
  ancestorGroupIds: ElementId[];
  palette: LegacyDocumentPalette;
}) => {
  const colorsById = paletteColorById(palette);
  const elementColorId = legacyColorId(element);
  if (elementColorId && colorsById.has(elementColorId)) return elementColorId;

  for (let index = ancestorGroupIds.length - 1; index >= 0; index -= 1) {
    const ancestor = elementsById.get(ancestorGroupIds[index]);
    const ancestorColorId = ancestor ? legacyColorId(ancestor) : undefined;
    if (ancestor && isGroupElement(ancestor) && ancestorColorId && colorsById.has(ancestorColorId)) {
      return ancestorColorId;
    }
  }

  return colorsById.has(palette.defaultColorId)
    ? palette.defaultColorId
    : palette.colors[0]?.id ?? "";
};

export const resolvedElementColorMap = (
  elements: CadElement[],
  palette: LegacyDocumentPalette
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
