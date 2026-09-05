import type { ComputedGeometry } from "../types/geometry";
import {
  numericGeometryStaticTargetForFamily,
  type NumericGeometryStaticTarget
} from "../../packages/nui-language/src/geometry/numericGeometryProperties";

export const numericGeometryStaticTargetForComputedGeometry = (
  geometry: ComputedGeometry | undefined
): NumericGeometryStaticTarget | null => {
  if (!geometry) return null;
  if (geometry.kind === "point") return numericGeometryStaticTargetForFamily("point");
  if (geometry.kind === "line") return numericGeometryStaticTargetForFamily("line");
  if (geometry.kind === "arcLine") return numericGeometryStaticTargetForFamily("arc");
  if (geometry.kind === "bezierCurve") {
    return numericGeometryStaticTargetForFamily("bezier", {
      intermediatePointCount: geometry.segments.length - 1,
      intermediatePointsProven: false
    });
  }
  if (geometry.kind === "offsetLine") return numericGeometryStaticTargetForFamily("genericPath");
  if (geometry.kind === "polyline") return numericGeometryStaticTargetForFamily("polyline");
  if (geometry.kind === "image") return numericGeometryStaticTargetForFamily("image");
  return numericGeometryStaticTargetForFamily("text");
};
