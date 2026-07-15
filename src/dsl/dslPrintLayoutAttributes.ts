/**
 * Attribute key names accepted by `place`/`printLayout` block statements for
 * numeric and coordinate-literal values. Single source of truth shared by
 * `dslCompiler.ts` (`buildBlockPrintLayouts`, where these are compiled) and
 * `dslCompletionContext.ts` (where `@variable` completion routes on them) so
 * the two can never silently drift apart.
 */

export const placeAngleAttrKey = "angle";
export const placeAngleDegAttrKey = "angleDeg";
export const placeAtAttrKey = "at";

export const printLayoutColumnsAttrKey = "columns";
export const printLayoutRowsAttrKey = "rows";
export const printLayoutOverlapAttrKey = "overlap";
export const printLayoutOverlapMmAttrKey = "overlapMm";
export const printLayoutScaleAttrKey = "scale";
export const printLayoutCanvasAttrKey = "canvas";

/** `place`'s plain-numeric attribute keys (each accepts `@variable`). */
export const placeNumericAttrKeys: readonly string[] = [placeAngleAttrKey, placeAngleDegAttrKey];
/** `place`'s coordinate-literal `(x, y)` attribute keys. */
export const placeCoordinateAttrKeys: readonly string[] = [placeAtAttrKey];

/** `printLayout`'s own plain-numeric attribute keys. */
export const printLayoutNumericAttrKeys: readonly string[] = [
  printLayoutColumnsAttrKey,
  printLayoutRowsAttrKey,
  printLayoutOverlapAttrKey,
  printLayoutOverlapMmAttrKey,
  printLayoutScaleAttrKey
];
/** `printLayout`'s own coordinate-literal `(x, y)` attribute keys. */
export const printLayoutCoordinateAttrKeys: readonly string[] = [printLayoutCanvasAttrKey];
