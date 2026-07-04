import type { CadElement } from "../types/geometry";

export const normalizedElementFields = (element: CadElement): CadElement => {
  if ((element.type === "copyLine" || element.type === "move") && element.scale === undefined) {
    return { ...element, scale: 1 };
  }
  return element;
};
