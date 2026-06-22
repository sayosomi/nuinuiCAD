import type { CommandId } from "./commandTypes";

export type CommandPaletteItem = {
  commandId: CommandId;
  label: string;
  keywords: string[];
};


export const paletteCommandIds: CommandId[] = [
  "addFreePoint",
  "addOffsetPoint",
  "addPolarOffsetPoint",
  "addDivisionPoint",
  "addLineDivisionPoint",
  "addIntersectionPoint",
  "addLineTangentOffsetPoint",
  "addLine",
  "addArcLine",
  "addThreePointArcLine",
  "addBezierCurve",
  "addOffsetLine",
  "startPointPick",
  "startLinePick",
  "startNumericReferencePick",
  "addNumericVariable",
  "deleteNumericVariable",
  "addBezierIntermediatePoint",
  "deleteBezierIntermediatePoint",
  "zoomInCanvas",
  "zoomOutCanvas",
  "resetCanvasView",
  "undo",
  "redo",
  "selectNextElement",
  "selectPreviousElement",
  "moveSelectedElementUp",
  "moveSelectedElementDown",
  "groupSelectedElements",
  "ungroupSelectedGroup",
  "toggleGroupExpanded",
  "indentSelectedElements",
  "outdentSelectedElements",
  "selectParentGroup",
  "toggleSelectedElementVisibility",
  "toggleSelectedElementEnabled",
  "deleteSelectedElement",
  "focusCanvas",
  "focusElementList",
  "focusElementSearch",
  "enterElementListMode",
  "toggleShortcutHelp",
  "toggleElementInfoPanel",
  "enterDependencyJumpMode",
  "enterParameterEditMode",
  "exitParameterEditMode",
  "focusSelectedParameterInput"
];

export const paletteKeywords: Partial<Record<CommandId, string[]>> = {
  addFreePoint: ["point", "free", "free point", "点", "追加"],
  addOffsetPoint: ["offset", "offset point", "オフセット", "点", "追加"],
  addPolarOffsetPoint: ["polar", "angle", "distance", "角度", "距離", "点", "追加"],
  addDivisionPoint: ["division", "between", "ratio", "distance", "分点", "点間", "中点", "割合", "距離", "点", "追加"],
  addLineDivisionPoint: ["division", "line", "endpoint", "ratio", "distance", "分点", "線上", "端点", "割合", "距離", "点", "追加"],
  addIntersectionPoint: ["intersection", "cross", "line", "交点", "交差", "線", "点", "追加"],
  addLineTangentOffsetPoint: ["line", "tangent", "offset", "angle", "distance", "線上", "オフセット", "接線", "角度", "距離", "点", "追加"],
  addLine: ["line", "直線", "線", "追加"],
  addArcLine: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"],
  addThreePointArcLine: [
    "arc",
    "three point arc",
    "3 point arc",
    "circle",
    "三点円弧",
    "3点円弧",
    "円弧",
    "線",
    "追加"
  ],
  addBezierCurve: ["bezier", "curve", "曲線", "ベジェ", "追加"],
  addOffsetLine: ["offset", "line", "curve", "オフセット", "線", "曲線", "追加"],
  startNumericReferencePick: ["number", "reference", "measurement", "数値", "参照", "選択"],
  startLinePick: ["line", "reference", "base", "基準線", "線", "選択"],
  addNumericVariable: ["variable", "共有", "共通", "変数", "追加"],
  deleteNumericVariable: ["variable", "共有", "共通", "変数", "削除"],
  addBezierNumericVariable: ["bezier", "curve", "variable", "共有", "変数", "追加"],
  deleteBezierNumericVariable: ["bezier", "curve", "variable", "共有", "変数", "削除"],
  addBezierIntermediatePoint: ["bezier", "curve", "middle", "中間点", "追加"],
  deleteBezierIntermediatePoint: ["bezier", "curve", "middle", "中間点", "削除"],
  zoomInCanvas: ["zoom", "in", "拡大", "キャンバス"],
  zoomOutCanvas: ["zoom", "out", "縮小", "キャンバス"],
  resetCanvasView: ["zoom", "reset", "pan", "origin", "リセット", "原点", "キャンバス"],
  undo: ["undo", "戻す"],
  redo: ["redo", "やり直す"],
  selectNextElement: ["select", "next", "次", "要素"],
  selectPreviousElement: ["select", "previous", "前", "要素"],
  moveSelectedElementUp: ["move", "up", "上", "並べ替え"],
  moveSelectedElementDown: ["move", "down", "下", "並べ替え"],
  groupSelectedElements: ["group", "folder", "グループ", "まとめる"],
  ungroupSelectedGroup: ["ungroup", "group", "解除", "グループ"],
  toggleGroupExpanded: ["group", "expand", "collapse", "開閉", "折り畳み"],
  indentSelectedElements: ["indent", "group", "入れ子", "インデント"],
  outdentSelectedElements: ["outdent", "group", "解除", "アウトデント"],
  selectParentGroup: ["parent", "group", "親", "グループ"],
  toggleSelectedElementVisibility: ["visibility", "visible", "hide", "show", "表示", "非表示"],
  toggleSelectedElementEnabled: ["enabled", "active", "evaluate", "評価", "有効", "無効"],
  deleteSelectedElement: ["delete", "remove", "削除"],
  focusCanvas: ["focus", "canvas", "キャンバス"],
  focusElementList: ["focus", "element list", "構成リスト", "要素リスト"],
  focusElementSearch: ["focus", "find", "search", "element", "検索", "要素"],
  enterElementListMode: ["mode", "element list", "構成リスト", "要素リスト"],
  toggleShortcutHelp: ["shortcut", "help", "ショートカット", "ヘルプ"],
  toggleElementInfoPanel: ["information", "info", "要素詳細", "折り畳み", "表示"],
  enterDependencyJumpMode: ["dependency", "parent", "child", "親子", "ジャンプ"],
  enterParameterEditMode: ["parameter", "edit", "パラメーター", "編集"],
  exitParameterEditMode: ["parameter", "edit", "escape", "パラメーター", "終了"],
  focusSelectedParameterInput: ["parameter", "input", "direct", "パラメーター", "入力"]
};


const normalizePaletteText = (text: string) => text.trim().toLowerCase();

export const filterCommandPaletteItems = (items: CommandPaletteItem[], query: string) => {
  const normalizedQuery = normalizePaletteText(query);
  if (!normalizedQuery) return items;

  return items.filter((item) => {
    const searchableText = [item.commandId, item.label, ...item.keywords]
      .map(normalizePaletteText)
      .join(" ");
    return searchableText.includes(normalizedQuery);
  });
};
