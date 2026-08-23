import type {
  CadElement,
  ComputedGeometry,
  ComputedOffsetLine,
  OffsetLineSide
} from "../types/geometry";
import { dependencyError, geometryError, geometryWarning, numericError } from "./evaluationContext";
import { isLineLikeGeometry } from "./linePaths";
import { buildOffsetLineGeometry } from "./offsetPaths";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";

type InspectableComputedOffsetLine = ComputedOffsetLine & {
  offsetDistance: number;
  offsetSide: OffsetLineSide;
};

export const evaluateOffsetLineElement = (element: CadElement, context: ElementEvaluationContext) => {
  const {
    computedGeometry,
    elementsById,
    errors,
    warnings,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  switch (element.type) {
      case "offsetLine": {
        const offset = numericError(
          element,
          element.offset,
          computedGeometry,
          elementsById,
          errors,
          localVariableValues,
          localVariableNames
        );
        if (offset === undefined) break;

        const baseGeometries: ComputedGeometry[] = [];
        let hasMissingBase = false;
        for (const baseLineId of element.baseLineIds) {
          const geometry = computedGeometry.get(baseLineId);
          if (!isLineLikeGeometry(geometry)) {
            errors.push(dependencyError(element, baseLineId, elementsById, disabledByGroupId));
            hasMissingBase = true;
            continue;
          }
          baseGeometries.push(geometry);
        }
        if (hasMissingBase) break;

        const result = buildOffsetLineGeometry({
          elementId: element.id,
          name: element.name,
          baseLineIds: element.baseLineIds,
          baseGeometries,
          offset: element.side === "right" ? offset : -offset,
          closed: element.closed,
          suppressTrimWarnings: element.suppressTrimWarnings
        });
        if (result.error) {
          errors.push(geometryError(element, result.error));
          break;
        }
        for (const warning of result.warnings ?? []) {
          warnings.push(geometryWarning(element, warning));
        }
        if (result.geometry) {
          const geometry: InspectableComputedOffsetLine = {
            ...result.geometry,
            offsetDistance: offset,
            offsetSide: element.side
          };
          computedGeometry.set(element.id, geometry);
        }
        break;
      }

    default:
      return false;
  }
  return true;
};
