import type { CadElementType } from "../../types/geometry";

/** C1/P9 may import these literals rather than rewriting v2 syntax ad hoc. */
export const v2CanonicalConstructions: Record<CadElementType, readonly [string, string]> = {
  freePoint: ["point", "coordinate"], offsetPoint: ["point", "offset"], polarOffsetPoint: ["point", "polar"],
  divisionPoint: ["point", "between"], lineDivisionPoint: ["point", "onLine"], intersectionPoint: ["point", "intersection"],
  lineTangentOffsetPoint: ["point", "tangentOffset"], line: ["line", "segment"], angleLengthLine: ["line", "polar"],
  offsetLine: ["line", "offset"], splitLine: ["line", "split"], extendTrim: ["line", "extend"], copyLine: ["line", "copy"],
  move: ["line", "move"], symmetricCopyLine: ["line", "mirrorCopy"], symmetricMove: ["line", "mirrorMove"], edge: ["line", "edge"],
  bezierCurve: ["curve", "bezier"], arcLine: ["arc", "arc"], threePointArcLine: ["arc", "through"],
  cornerRadiusArcLine: ["arc", "corner"], text: ["text", "label"], image: ["image", "image"], variable: ["var", "expression"],
  group: ["group", ""], conditionalGroup: ["if", ""], forGroup: ["for", ""],
};

export const v2CanonicalSettingStatements = [
  "nui 2",
  'color pattern-black ("#31322f" name: "基本線" default: true)',
  'role seam (name: "縫い代")',
  "view 通常 (default: true seam: false)",
  "activeView 通常",
  "printLayout A4 (output: pdf view: 印刷 paper: a4 orientation: portrait columns: 2 rows: 2 overlap: 10 scale: 1 canvas: (410, 584)) {",
  "layoutVar margin = 15",
  "place 前身頃 (at: (0, margin) angle: 0 mirrorX: false)",
  "activePrintLayout A4",
  "@stop",
] as const;
