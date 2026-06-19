import { elementTypeLabels } from "../types/geometry";
import type { CadElement, CadElementType, ElementId } from "../types/geometry";

const defaultNameBases: Record<CadElementType, string> = {
  freePoint: "点",
  offsetPoint: "オフセット点",
  polarOffsetPoint: "角度距離点",
  line: "直線",
  bezierCurve: "曲線"
};

const normalizeName = (name: string, fallbackBaseName: string) => {
  const trimmedName = name.trim();
  return trimmedName.length > 0 ? trimmedName : fallbackBaseName;
};

export const fallbackElementName = (type: CadElementType) => defaultNameBases[type];

export const makeUniqueElementName = ({
  elements,
  elementId,
  requestedName,
  fallbackBaseName
}: {
  elements: CadElement[];
  elementId?: ElementId;
  requestedName: string;
  fallbackBaseName: string;
}) => {
  const baseName = normalizeName(requestedName, fallbackBaseName);
  const usedNames = new Set(
    elements
      .filter((element) => element.id !== elementId)
      .map((element) => element.name.trim())
      .filter(Boolean)
  );

  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (usedNames.has(`${baseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
};

export const formatReferenceOptionLabel = (element: CadElement) =>
  `${element.name} - ${elementTypeLabels[element.type]}`;
