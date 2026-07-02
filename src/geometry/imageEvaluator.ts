import type { CadElement } from "../types/geometry";
import {
  geometryError,
  getPointAnchorOrError,
  numericError
} from "./evaluationContext";
import type { ElementEvaluationContext } from "./elementEvaluatorTypes";

const MM_PER_INCH = 25.4;

export const evaluateImageElement = (
  element: CadElement,
  context: ElementEvaluationContext
) => {
  if (element.type !== "image") return false;

  const {
    computedGeometry,
    elementsById,
    errors,
    disabledByGroupId,
    localVariables: { localVariableValues, localVariableNames }
  } = context;

  const origin = getPointAnchorOrError(
    element,
    element.originPoint,
    "origin",
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (!origin) return true;

  const scale = numericError(
    element,
    element.scale,
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  const angleDeg = numericError(
    element,
    element.angleDeg,
    computedGeometry,
    elementsById,
    errors,
    localVariableValues,
    localVariableNames,
    disabledByGroupId
  );
  if (scale === undefined || angleDeg === undefined) return true;

  if (
    element.naturalWidthPx <= 0 ||
    element.naturalHeightPx <= 0 ||
    element.sourceDpi <= 0 ||
    scale <= 0
  ) {
    errors.push(
      geometryError(
        element,
        `${element.name} は画像寸法、DPI、倍率が0以下のため配置できません。画像を読み込み直すか、倍率を正の値にしてください。`
      )
    );
    return true;
  }

  computedGeometry.set(element.id, {
    kind: "image",
    elementId: element.id,
    name: element.name,
    sourcePath: element.sourcePath,
    origin,
    naturalWidthPx: element.naturalWidthPx,
    naturalHeightPx: element.naturalHeightPx,
    sourceDpi: element.sourceDpi,
    targetPixelsPerMm: element.targetPixelsPerMm,
    scale,
    angleDeg,
    mirrorX: element.mirrorX,
    widthMm: (element.naturalWidthPx / element.sourceDpi) * MM_PER_INCH * scale,
    heightMm: (element.naturalHeightPx / element.sourceDpi) * MM_PER_INCH * scale
  });
  return true;
};
