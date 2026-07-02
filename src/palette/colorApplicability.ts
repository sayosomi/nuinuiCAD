import type { CadElement } from "../types/geometry";

export const elementSupportsDisplayColor = (element: CadElement): boolean => {
  switch (element.type) {
    case "group":
    case "conditionalGroup":
    case "forGroup":
    case "freePoint":
    case "offsetPoint":
    case "polarOffsetPoint":
    case "divisionPoint":
    case "lineDivisionPoint":
    case "intersectionPoint":
    case "lineTangentOffsetPoint":
    case "splitLine":
    case "line":
    case "arcLine":
    case "threePointArcLine":
    case "cornerRadiusArcLine":
    case "bezierCurve":
    case "offsetLine":
    case "copyLine":
    case "symmetricCopyLine":
      return true;
    case "variable":
    case "edge":
    case "extendTrim":
    case "move":
    case "symmetricMove":
    case "image":
      return false;
  }
};
