import type { CadElement, ElementId } from "../types/geometry";
import { dependencyError, geometryError, getPointAnchorOrError } from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";
import type { MirrorCopyPreview } from "./evaluationTypes";
import { EPSILON, lineLength } from "./offsetPathMath";
import { copyPathGeometry } from "./copyPathGeometry";
import { sourceSegmentsForGeometry } from "./offsetSourceSegments";
import { isLineLikeGeometryInput } from "./linePaths";
import { resolveLineGeometryInputAt } from "./lineGeometryInput";

export type MirrorCopyPreviewEvaluationContext = {
  mirrorCopyPreviews: Map<ElementId, MirrorCopyPreview>;
};

/** Evaluates mirrorCopy into display-only primitive groups. */
export const evaluateSymmetricCopyLineElement = (
  element: CadElement,
  context: ElementEvaluationContext,
  previewContext: MirrorCopyPreviewEvaluationContext
) => {
  if (element.type !== "symmetricCopyLine") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    computedGeometryValues,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  const axisPoint1 = getPointAnchorOrError(
    element,
    element.axisPoint1,
    "axisPoint1",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId,
    undefined,
    computedGeometryValues
  );
  const axisPoint2 = getPointAnchorOrError(
    element,
    element.axisPoint2,
    "axisPoint2",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId,
    undefined,
    computedGeometryValues
  );
  if (!axisPoint1 || !axisPoint2) return true;
  if (lineLength(axisPoint1, axisPoint2) <= EPSILON) {
    errors.push(geometryError(element, `${element.name} の対称軸は同じ点を2回指定できません。`));
    return true;
  }

  if (element.baseLineIds.length === 0) {
    errors.push(geometryError(element, `${element.name} は基準線から作図できる線分がありません。基準線を指定してください。`));
    return true;
  }

  const groups: MirrorCopyPreview["groups"] = [];
  let hasMissingBase = false;
  for (const [index, baseLineId] of element.baseLineIds.entries()) {
    const geometry = resolveLineGeometryInputAt(context, "baseLineIds", index, baseLineId);
    if (!isLineLikeGeometryInput(geometry)) {
      errors.push(dependencyError(element, baseLineId, elementsById, disabledByGroupId));
      hasMissingBase = true;
      continue;
    }
    const segments = sourceSegmentsForGeometry(geometry);
    if (segments.length === 0) continue;
    const reflected = copyPathGeometry(segments, {
      kind: "mirror",
      axis1: axisPoint1,
      axis2: axisPoint2
    });
    if (!reflected || reflected.segments.length === 0) continue;
    groups.push({
      ...(baseLineId && elementsById.has(baseLineId) ? { sourceElementId: baseLineId } : {}),
      segments: reflected.segments
    });
  }
  if (hasMissingBase) return true;
  if (groups.length === 0) {
    errors.push(geometryError(element, `${element.name} は基準線から作図できる長さの線分がありません。`));
    return true;
  }

  previewContext.mirrorCopyPreviews.set(element.id, { groups });
  return true;
};
