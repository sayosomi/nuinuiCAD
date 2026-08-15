import { addImage } from "./imageCreationCommands";
import {
  addBezierIntermediatePoint,
  addNumericVariable,
  deleteBezierIntermediatePoint,
  deleteNumericVariable
} from "./parameterCommands";
import type { Command, CommandContext, CommandId } from "./commandTypes";
import { startCommandLineCreationForRecipe } from "./commandLineSessionCommands";
import { creationRecipeForLegacyCommand } from "./legacyCreationRecipes";

const startCreationSessionForCommand = (commandId: CommandId, context?: CommandContext) => {
  const recipe = creationRecipeForLegacyCommand(commandId);
  return recipe ? startCommandLineCreationForRecipe(recipe, context) : false;
};

export const creationCommandDefinitions = {
  addFreePoint: {
    id: "addFreePoint",
    label: "free point を追加",
    palette: { order: 1, keywords: ["point", "free", "free point", "点", "追加"] },
    run: (context) => startCreationSessionForCommand("addFreePoint", context)
  },
  addText: {
    id: "addText",
    label: "テキストを追加",
    palette: { order: 21.75, keywords: ["text", "label", "comment", "テキスト", "ラベル", "コメント", "注記", "追加"] },
    run: (context) => startCreationSessionForCommand("addText", context)
  },
  addOffsetPoint: {
    id: "addOffsetPoint",
    label: "offset point を追加",
    palette: { order: 2, keywords: ["offset", "offset point", "オフセット", "点", "追加"] },
    run: (context) => startCreationSessionForCommand("addOffsetPoint", context)
  },
  addPolarOffsetPoint: {
    id: "addPolarOffsetPoint",
    label: "polar offset point を追加",
    palette: { order: 3, keywords: ["polar", "angle", "distance", "角度", "距離", "点", "追加"] },
    run: (context) => startCreationSessionForCommand("addPolarOffsetPoint", context)
  },
  addDivisionPoint: {
    id: "addDivisionPoint",
    label: "点間分点を追加",
    palette: {
      order: 4,
      keywords: [
        "division",
        "between",
        "ratio",
        "distance",
        "分点",
        "点間",
        "中点",
        "割合",
        "距離",
        "点",
        "追加"
      ]
    },
    run: (context) => startCreationSessionForCommand("addDivisionPoint", context)
  },
  addLineDivisionPoint: {
    id: "addLineDivisionPoint",
    label: "線上分点を追加",
    palette: {
      order: 5,
      keywords: [
        "division",
        "line",
        "endpoint",
        "ratio",
        "distance",
        "分点",
        "線上",
        "端点",
        "割合",
        "距離",
        "点",
        "追加"
      ]
    },
    run: (context) => startCreationSessionForCommand("addLineDivisionPoint", context)
  },
  addIntersectionPoint: {
    id: "addIntersectionPoint",
    label: "交点を追加",
    palette: { order: 6, keywords: ["intersection", "cross", "line", "交点", "交差", "線", "点", "追加"] },
    shortcuts: [{ keys: "x" }],
    run: (context) => startCreationSessionForCommand("addIntersectionPoint", context)
  },
  addLineTangentOffsetPoint: {
    id: "addLineTangentOffsetPoint",
    label: "線上オフセット点を追加",
    palette: {
      order: 7,
      keywords: ["line", "tangent", "offset", "angle", "distance", "線上", "オフセット", "接線", "角度", "距離", "点", "追加"]
    },
    run: (context) => startCreationSessionForCommand("addLineTangentOffsetPoint", context)
  },
  addBezierExtremePoint: {
    id: "addBezierExtremePoint",
    label: "Bezier方向極値点を追加",
    palette: {
      order: 7.5,
      keywords: ["bezier", "curve", "extreme", "direction", "ベジェ", "曲線", "極値", "方向", "点", "追加"]
    },
    run: (context) => startCreationSessionForCommand("addBezierExtremePoint", context)
  },
  addLine: {
    id: "addLine",
    label: "line を追加",
    palette: { order: 8, keywords: ["line", "直線", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addLine", context)
  },
  addAngleLengthLine: {
    id: "addAngleLengthLine",
    label: "角度距離線を追加",
    palette: { order: 8.5, keywords: ["angle", "length", "line", "角度", "距離", "長さ", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addAngleLengthLine", context)
  },
  addArcLine: {
    id: "addArcLine",
    label: "円弧線を追加",
    palette: { order: 9, keywords: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addArcLine", context)
  },
  addThreePointArcLine: {
    id: "addThreePointArcLine",
    label: "三点円弧線を追加",
    palette: {
      order: 10,
      keywords: [
        "arc",
        "three point arc",
        "3 point arc",
        "circle",
        "三点円弧",
        "3点円弧",
        "円弧",
        "線",
        "追加"
      ]
    },
    run: (context) => startCreationSessionForCommand("addThreePointArcLine", context)
  },
  addCornerRadiusArcLine: {
    id: "addCornerRadiusArcLine",
    label: "角R円弧線を追加",
    palette: { order: 11, keywords: ["corner", "radius", "fillet", "arc", "角R", "角丸", "円弧", "線", "追加"] },
    shortcuts: [{ keys: "Shift+R" }],
    run: (context) => startCreationSessionForCommand("addCornerRadiusArcLine", context)
  },
  addEdge: {
    id: "addEdge",
    label: "エッジを追加",
    palette: { order: 12, keywords: ["edge", "extend", "trim", "corner", "エッジ", "延長", "短縮", "接続", "変更", "追加"] },
    run: (context) => startCreationSessionForCommand("addEdge", context)
  },
  addExtendTrim: {
    id: "addExtendTrim",
    label: "延長短縮を追加",
    palette: { order: 13, keywords: ["extend", "trim", "line", "endpoint", "延長", "短縮", "端点", "変更", "追加"] },
    run: (context) => startCreationSessionForCommand("addExtendTrim", context)
  },
  addBezierCurve: {
    id: "addBezierCurve",
    label: "Bezier curve を追加",
    palette: { order: 14, keywords: ["bezier", "curve", "曲線", "ベジェ", "追加"] },
    shortcuts: [{ keys: "c", label: "曲線を追加" }],
    run: (context) => startCreationSessionForCommand("addBezierCurve", context)
  },
  addOffsetLine: {
    id: "addOffsetLine",
    label: "オフセット線を追加",
    palette: { order: 15, keywords: ["offset", "line", "curve", "オフセット", "線", "曲線", "追加"] },
    shortcuts: [{ keys: "Shift+O" }],
    run: (context) => startCreationSessionForCommand("addOffsetLine", context)
  },
  addCopyLine: {
    id: "addCopyLine",
    label: "コピー線を追加",
    palette: { order: 16, keywords: ["copy", "line", "curve", "コピー", "複写", "線", "曲線", "追加"] },
    shortcuts: [{ keys: "Shift+C" }],
    run: (context) => startCreationSessionForCommand("addCopyLine", context)
  },
  addSymmetricCopyLine: {
    id: "addSymmetricCopyLine",
    label: "対称コピー線を追加",
    palette: { order: 17, keywords: ["symmetric", "mirror", "copy", "line", "対称", "反転", "コピー", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addSymmetricCopyLine", context)
  },
  addMove: {
    id: "addMove",
    label: "移動を追加",
    palette: { order: 18, keywords: ["move", "translate", "line", "curve", "移動", "変更", "線", "曲線", "追加"] },
    run: (context) => startCreationSessionForCommand("addMove", context)
  },
  addSymmetricMove: {
    id: "addSymmetricMove",
    label: "対称移動を追加",
    palette: { order: 19, keywords: ["symmetric", "mirror", "move", "line", "対称", "反転", "移動", "変更", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addSymmetricMove", context)
  },
  addImage: {
    id: "addImage",
    label: "画像を追加",
    palette: { order: 19.5, keywords: ["image", "picture", "photo", "画像", "下絵", "読込", "追加"] },
    run: (context) => {
      void addImage(context);
    }
  },
  addSplitLine: {
    id: "addSplitLine",
    label: "分割線を追加",
    palette: { order: 20, keywords: ["split", "divide", "line", "分割", "分割線", "線", "追加"] },
    run: (context) => startCreationSessionForCommand("addSplitLine", context)
  },
  addNumericVariable: {
    id: "addNumericVariable",
    label: "要素内変数を追加",
    palette: { order: 21, keywords: ["variable", "共有", "共通", "要素内", "変数", "追加"] },
    run: () => addNumericVariable()
  },
  deleteNumericVariable: {
    id: "deleteNumericVariable",
    label: "要素内変数を削除",
    palette: {
      order: 22,
      keywords: ["variable", "共有", "共通", "要素内", "変数", "削除"],
      isAvailable: (context) => Boolean(context?.variableId)
    },
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierNumericVariable: {
    id: "addBezierNumericVariable",
    label: "曲線の要素内変数を追加",
    run: () => addNumericVariable()
  },
  deleteBezierNumericVariable: {
    id: "deleteBezierNumericVariable",
    label: "曲線の要素内変数を削除",
    run: (context) => deleteNumericVariable(context?.variableId)
  },
  addBezierIntermediatePoint: {
    id: "addBezierIntermediatePoint",
    label: "曲線の中間点を追加",
    palette: { order: 23, keywords: ["bezier", "curve", "middle", "中間点", "追加"] },
    run: () => addBezierIntermediatePoint()
  },
  deleteBezierIntermediatePoint: {
    id: "deleteBezierIntermediatePoint",
    label: "曲線の中間点を削除",
    palette: {
      order: 24,
      keywords: ["bezier", "curve", "middle", "中間点", "削除"],
      isAvailable: (context) => Boolean(context?.intermediatePointId)
    },
    run: (context) => deleteBezierIntermediatePoint(context?.intermediatePointId)
  }
} satisfies Partial<Record<CommandId, Command>>;
