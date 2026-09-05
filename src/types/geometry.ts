export * from "../model/cadDocumentTypes";
export * from "../geometry/evaluationTypes";

import type { CadElementType } from "../model/cadDocumentTypes";

export type CadElementCategory = "group" | "container" | "point" | "line" | "modification";

export const elementTypeLabels: Record<CadElementType, string> = {
  group: "グループ",
  conditionalGroup: "ifブロック",
  forGroup: "forブロック",
  moduleInstance: "module instance",
  freePoint: "free point",
  offsetPoint: "offset point",
  polarOffsetPoint: "polar offset point",
  divisionPoint: "点間分点",
  lineDivisionPoint: "線上分点",
  intersectionPoint: "交点",
  lineTangentOffsetPoint: "線上オフセット点",
  bezierExtremePoint: "Bezier方向極値点",
  bezierBulgePoint: "Bezier最大膨らみ点",
  line: "line",
  angleLengthLine: "角度距離線",
  commonTangentLine: "共通接線",
  arcLine: "arc line",
  threePointArcLine: "three-point arc line",
  cornerRadiusArcLine: "角R円弧線",
  edge: "エッジ",
  extendTrim: "延長短縮",
  pathReverse: "反転",
  bezierCurve: "Bezier curve",
  offsetLine: "オフセット線",
  polyline: "折れ線",
  splitLine: "分割線",
  copyLine: "コピー線",
  symmetricCopyLine: "対称コピー線",
  move: "移動",
  symmetricMove: "対称移動",
  image: "画像",
  text: "テキスト"
};

export const elementTypeCategories: Record<CadElementType, CadElementCategory> = {
  group: "group",
  conditionalGroup: "group",
  forGroup: "group",
  moduleInstance: "container",
  freePoint: "point",
  offsetPoint: "point",
  polarOffsetPoint: "point",
  divisionPoint: "point",
  lineDivisionPoint: "point",
  intersectionPoint: "point",
  lineTangentOffsetPoint: "point",
  bezierExtremePoint: "point",
  bezierBulgePoint: "point",
  line: "line",
  angleLengthLine: "line",
  commonTangentLine: "line",
  arcLine: "line",
  threePointArcLine: "line",
  cornerRadiusArcLine: "line",
  edge: "modification",
  extendTrim: "modification",
  pathReverse: "modification",
  bezierCurve: "line",
  offsetLine: "line",
  polyline: "line",
  splitLine: "line",
  copyLine: "line",
  symmetricCopyLine: "line",
  move: "modification",
  symmetricMove: "modification",
  image: "modification",
  text: "modification"
};

export const elementCategoryLabels: Record<CadElementCategory, string> = {
  group: "グループ",
  container: "コンテナ",
  point: "点",
  line: "線",
  modification: "変更"
};
