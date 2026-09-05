import type { ElementId, EvaluationResult } from "../types/geometry";
import type { EffectiveDrawingModifierResolution } from "../../packages/nui-language/src/model/drawingModifierInspection";

/**
 * EvaluationResult extension owned by runtime inspection metadata. Keeping
 * this narrow avoids making the base geometry type own feature-specific
 * inspection contracts while remaining structurally compatible with every
 * existing EvaluationResult consumer.
 */
export type EvaluationResultWithDrawingModifierInspection = EvaluationResult & {
  effectiveDrawingModifierResolutions?: ReadonlyMap<ElementId, EffectiveDrawingModifierResolution>;
};

export const effectiveDrawingModifierResolutionsFromResult = (
  result: EvaluationResult
): ReadonlyMap<ElementId, EffectiveDrawingModifierResolution> =>
  (result as EvaluationResultWithDrawingModifierInspection).effectiveDrawingModifierResolutions ?? new Map();
