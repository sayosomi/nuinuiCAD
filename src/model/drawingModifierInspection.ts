import type {
  DrawingModifierState,
  DrawingModifierStrokeColor,
  DrawingModifierStrokeStyle,
  ElementId,
  EvaluationResult
} from "../types/geometry";

/**
 * Exact-current authored winner for one effective Drawing Modifier property.
 *
 * `modifierName` is the current document's canonical modifier identity: the
 * compiler and StatementMap both key top-level modifier source ownership by
 * this unique name. A selected profile override additionally carries the
 * compiler-resolved profile declaration id so later source navigation never
 * needs to parse a runtime id or search source text.
 */
export type DrawingModifierPropertyWinner = {
  ownerElementId: ElementId;
  modifierName: string;
  selectedProfileDelta: {
    profileId: string;
    profileName: string;
  } | null;
};

export type DrawingModifierPropertyResolution<T> = {
  value: T;
  winner: DrawingModifierPropertyWinner | null;
};

/**
 * Winner-only Drawing Modifier/Profile inspection for one runtime element.
 * Built-in defaults deliberately use `winner: null` rather than inventing a
 * source location. `state` is the final effective activity after the existing
 * direct element/group hard gate; when that hard gate wins, its modifier
 * winner is likewise null and existing activity ownership remains authoritative.
 */
export type EffectiveDrawingModifierResolution = {
  state: DrawingModifierPropertyResolution<DrawingModifierState>;
  widthPx: DrawingModifierPropertyResolution<number>;
  style: DrawingModifierPropertyResolution<DrawingModifierStrokeStyle>;
  color: DrawingModifierPropertyResolution<DrawingModifierStrokeColor>;
};

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
