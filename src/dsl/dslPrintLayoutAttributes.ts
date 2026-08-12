/**
 * Attribute key names accepted by `place`/`printLayout` block statements for
 * numeric and coordinate-literal values. Single source of truth shared by
 * `dslCompiler.ts` (`buildBlockPrintLayouts`, where these are compiled) and
 * `dslCompletionContext.ts` (where `@variable` completion routes on them) so
 * the two can never silently drift apart.
 */

// v2: place/printLayout の別名属性(angleDeg=, overlapMm= 等)は廃止(plan.md
// 確定仕様1.2「削除されるv1構文」)。正準キーのみを唯一の正とする。
export const placeAngleAttrKey = "angle";
export const placeAtAttrKey = "at";
export const placeXAttrKey = "x";
export const placeYAttrKey = "y";

export const printLayoutColumnsAttrKey = "columns";
export const printLayoutRowsAttrKey = "rows";
export const printLayoutOverlapAttrKey = "overlap";
export const printLayoutScaleAttrKey = "scale";
export const printLayoutCanvasAttrKey = "canvas";
export const printLayoutViewAttrKey = "view";
export const printLayoutPaperAttrKey = "paper";
export const printLayoutWidthAttrKey = "width";
export const printLayoutHeightAttrKey = "height";

/** `place`'s plain-numeric attribute keys (each accepts `@variable`). */
export const placeNumericAttrKeys: readonly string[] = [placeXAttrKey, placeYAttrKey, placeAngleAttrKey];
/** `place`'s coordinate-literal `(x, y)` attribute keys. */
export const placeCoordinateAttrKeys: readonly string[] = [placeAtAttrKey];

/** `printLayout`'s own plain-numeric attribute keys. */
export const printLayoutNumericAttrKeys: readonly string[] = [
  printLayoutWidthAttrKey,
  printLayoutHeightAttrKey,
  printLayoutColumnsAttrKey,
  printLayoutRowsAttrKey,
  printLayoutOverlapAttrKey,
  printLayoutScaleAttrKey
];
/** `printLayout`'s own coordinate-literal `(x, y)` attribute keys. */
export const printLayoutCoordinateAttrKeys: readonly string[] = [printLayoutCanvasAttrKey];
