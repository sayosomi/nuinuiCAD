/** Numeric/source attribute keys shared by the layout/output compiler and
 * typed numeric binding compiler. The file name remains stable for the
 * editor's existing import boundary; the legacy printLayout vocabulary does
 * not. */
export const layoutScaleAttrKey = "scale";

export const placeAtAttrKey = "at";
export const placeOriginAttrKey = "origin";
export const placeScaleAttrKey = "scale";
export const placeAngleAttrKey = "angle";
export const placeMirrorAttrKey = "mirror";

export const printOverlapAttrKey = "overlap";
export const svgMarginAttrKey = "margin";

export const placeNumericAttrKeys: readonly string[] = [placeScaleAttrKey, placeAngleAttrKey];
export const placeCoordinateAttrKeys: readonly string[] = [placeAtAttrKey];
export const layoutNumericAttrKeys: readonly string[] = [layoutScaleAttrKey];
export const printNumericAttrKeys: readonly string[] = [printOverlapAttrKey];
export const svgNumericAttrKeys: readonly string[] = [svgMarginAttrKey];
