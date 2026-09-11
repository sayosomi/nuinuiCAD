import { legacyCreationCommandRecipeMap } from "../commands/legacyCreationRecipes";

/** The VS Code Canvas creation IDs are exactly the command-line recipe IDs. */
export type VscodeCanvasCreationCommandId = keyof typeof legacyCreationCommandRecipeMap;

export const isVscodeCanvasCreationCommandId = (
  value: unknown
): value is VscodeCanvasCreationCommandId =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(legacyCreationCommandRecipeMap, value);

type VscodeCanvasCreationPresentation = {
  quickPickLabel: string;
  keywords: readonly string[];
};

/**
 * VS Code-only presentation metadata. Membership and command semantics remain
 * owned by legacyCreationCommandRecipeMap and the shared command registry.
 */
const presentationByCommandId = {
  addFreePoint: {
    quickPickLabel: "Free Point",
    keywords: ["point", "free", "free point", "点", "追加"]
  },
  addText: {
    quickPickLabel: "Text",
    keywords: ["text", "label", "comment", "テキスト", "ラベル", "コメント", "注記", "追加"]
  },
  addOffsetPoint: {
    quickPickLabel: "Offset Point",
    keywords: ["offset", "offset point", "オフセット", "点", "追加"]
  },
  addPolarOffsetPoint: {
    quickPickLabel: "Polar Offset Point",
    keywords: ["polar", "angle", "distance", "角度", "距離", "点", "追加"]
  },
  addDivisionPoint: {
    quickPickLabel: "Division Point",
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
  addLineDivisionPoint: {
    quickPickLabel: "Line Division Point",
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
  addIntersectionPoint: {
    quickPickLabel: "Intersection Point",
    keywords: ["intersection", "cross", "line", "交点", "交差", "線", "点", "追加"]
  },
  addLineTangentOffsetPoint: {
    quickPickLabel: "Line Tangent Offset Point",
    keywords: [
      "line",
      "tangent",
      "offset",
      "angle",
      "distance",
      "線上",
      "オフセット",
      "接線",
      "角度",
      "距離",
      "点",
      "追加"
    ]
  },
  addBezierBulgePoint: {
    quickPickLabel: "Bezier Bulge Point",
    keywords: ["bezier", "curve", "bulge", "ベジェ", "曲線", "膨らみ", "最大", "点", "追加"]
  },
  addBezierExtremePoint: {
    quickPickLabel: "Bezier Extreme Point",
    keywords: ["bezier", "curve", "extreme", "direction", "ベジェ", "曲線", "極値", "方向", "点", "追加"]
  },
  addLine: {
    quickPickLabel: "Line",
    keywords: ["line", "直線", "線", "追加"]
  },
  addPolyline: {
    quickPickLabel: "Polyline",
    keywords: ["polyline", "line", "path", "折れ線", "ポリライン", "線", "追加"]
  },
  addJoinedPath: {
    quickPickLabel: "Joined Path",
    keywords: ["join", "line", "path", "結合", "パス", "線", "追加"]
  },
  addAngleLengthLine: {
    quickPickLabel: "Angle Length Line",
    keywords: ["angle", "length", "line", "角度", "距離", "長さ", "線", "追加"]
  },
  addCommonTangentLine: {
    quickPickLabel: "Common Tangent Line",
    keywords: ["common tangent", "tangent", "circle", "line", "共通接線", "接線", "円", "線", "追加"]
  },
  addArcLine: {
    quickPickLabel: "Arc Line",
    keywords: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"]
  },
  addThreePointArcLine: {
    quickPickLabel: "Three-Point Arc Line",
    keywords: ["arc", "three point arc", "3 point arc", "circle", "三点円弧", "3点円弧", "円弧", "線", "追加"]
  },
  addCornerRadiusArcLine: {
    quickPickLabel: "Corner Radius Arc Line",
    keywords: ["corner", "radius", "fillet", "arc", "角R", "角丸", "円弧", "線", "追加"]
  },
  addEdge: {
    quickPickLabel: "Edge",
    keywords: ["edge", "extend", "trim", "corner", "エッジ", "延長", "短縮", "接続", "変更", "追加"]
  },
  addExtendTrim: {
    quickPickLabel: "Extend/Trim",
    keywords: ["extend", "trim", "line", "endpoint", "延長", "短縮", "端点", "変更", "追加"]
  },
  addBezierCurve: {
    quickPickLabel: "Bezier Curve",
    keywords: ["bezier", "curve", "曲線", "ベジェ", "追加"]
  },
  addOffsetLine: {
    quickPickLabel: "Offset Line",
    keywords: ["offset", "line", "curve", "オフセット", "線", "曲線", "追加"]
  },
  addCopyLine: {
    quickPickLabel: "Copy Line",
    keywords: ["copy", "line", "curve", "コピー", "複写", "線", "曲線", "追加"]
  },
  addSymmetricCopyLine: {
    quickPickLabel: "Symmetric Copy Line",
    keywords: ["symmetric", "mirror", "copy", "line", "対称", "反転", "コピー", "線", "追加"]
  },
  addMove: {
    quickPickLabel: "Move",
    keywords: ["move", "translate", "line", "curve", "移動", "変更", "線", "曲線", "追加"]
  },
  addSymmetricMove: {
    quickPickLabel: "Symmetric Move",
    keywords: ["symmetric", "mirror", "move", "line", "対称", "反転", "移動", "変更", "線", "追加"]
  },
  addSplitLine: {
    quickPickLabel: "Split Line",
    keywords: ["split", "divide", "line", "分割", "分割線", "線", "追加"]
  }
} satisfies Record<VscodeCanvasCreationCommandId, VscodeCanvasCreationPresentation>;

export type VscodeCanvasCreationCommand = VscodeCanvasCreationPresentation & {
  commandId: VscodeCanvasCreationCommandId;
};

/** Ordered by the authoritative legacy recipe map for stable presentation. */
export const vscodeCanvasCreationCommands: readonly VscodeCanvasCreationCommand[] = (
  Object.keys(legacyCreationCommandRecipeMap) as VscodeCanvasCreationCommandId[]
).map((commandId) => {
  const presentation = presentationByCommandId[commandId];
  return {
    commandId,
    ...presentation
  };
});

/**
 * Filters the shared creation presentation without relying on VS Code's
 * native Quick Pick matching. Each non-empty term must match the label or an
 * existing presentation keyword.
 */
export const filterVscodeCanvasCreationCommands = (
  query: string
): readonly VscodeCanvasCreationCommand[] => {
  const terms = query.trim().split(/\s+/u).filter(Boolean).map((term) => term.toLowerCase());
  if (terms.length === 0) return vscodeCanvasCreationCommands;

  return vscodeCanvasCreationCommands.filter((entry) => {
    const corpus = [entry.quickPickLabel, ...entry.keywords].join(" ").toLowerCase();
    return terms.every((term) => corpus.includes(term));
  });
};
