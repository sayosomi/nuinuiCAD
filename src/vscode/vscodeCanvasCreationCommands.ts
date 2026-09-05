import { legacyCreationCommandRecipeMap } from "../commands/legacyCreationRecipes";

export const VSCODE_CANVAS_QUICK_CREATE_SETTING = "nuinuiCAD.canvasQuickCreate.commands";
export const VSCODE_CANVAS_CREATION_COMMAND_PREFIX = "nuinuiCAD.create.";

/** The VS Code Canvas creation IDs are exactly the command-line recipe IDs. */
export type VscodeCanvasCreationCommandId = keyof typeof legacyCreationCommandRecipeMap;

export const isVscodeCanvasCreationCommandId = (
  value: unknown
): value is VscodeCanvasCreationCommandId =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(legacyCreationCommandRecipeMap, value);

export const vscodeCanvasCreationCommandIdFor = (
  commandId: VscodeCanvasCreationCommandId
): string => `${VSCODE_CANVAS_CREATION_COMMAND_PREFIX}${commandId}`;

type VscodeCanvasCreationPresentation = {
  title: string;
  quickPickLabel: string;
  keywords: readonly string[];
};

/**
 * VS Code-only presentation metadata. Membership and command semantics remain
 * owned by legacyCreationCommandRecipeMap and the shared command registry.
 */
const presentationByCommandId = {
  addFreePoint: {
    title: "nuinuiCAD: Create Free Point",
    quickPickLabel: "Free Point",
    keywords: ["point", "free", "free point", "点", "追加"]
  },
  addText: {
    title: "nuinuiCAD: Create Text",
    quickPickLabel: "Text",
    keywords: ["text", "label", "comment", "テキスト", "ラベル", "コメント", "注記", "追加"]
  },
  addOffsetPoint: {
    title: "nuinuiCAD: Create Offset Point",
    quickPickLabel: "Offset Point",
    keywords: ["offset", "offset point", "オフセット", "点", "追加"]
  },
  addPolarOffsetPoint: {
    title: "nuinuiCAD: Create Polar Offset Point",
    quickPickLabel: "Polar Offset Point",
    keywords: ["polar", "angle", "distance", "角度", "距離", "点", "追加"]
  },
  addDivisionPoint: {
    title: "nuinuiCAD: Create Division Point",
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
    title: "nuinuiCAD: Create Line Division Point",
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
    title: "nuinuiCAD: Create Intersection Point",
    quickPickLabel: "Intersection Point",
    keywords: ["intersection", "cross", "line", "交点", "交差", "線", "点", "追加"]
  },
  addLineTangentOffsetPoint: {
    title: "nuinuiCAD: Create Line Tangent Offset Point",
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
    title: "nuinuiCAD: Create Bezier Bulge Point",
    quickPickLabel: "Bezier Bulge Point",
    keywords: ["bezier", "curve", "bulge", "ベジェ", "曲線", "膨らみ", "最大", "点", "追加"]
  },
  addBezierExtremePoint: {
    title: "nuinuiCAD: Create Bezier Extreme Point",
    quickPickLabel: "Bezier Extreme Point",
    keywords: ["bezier", "curve", "extreme", "direction", "ベジェ", "曲線", "極値", "方向", "点", "追加"]
  },
  addLine: {
    title: "nuinuiCAD: Create Line",
    quickPickLabel: "Line",
    keywords: ["line", "直線", "線", "追加"]
  },
  addPolyline: {
    title: "nuinuiCAD: Create Polyline",
    quickPickLabel: "Polyline",
    keywords: ["polyline", "line", "path", "折れ線", "ポリライン", "線", "追加"]
  },
  addAngleLengthLine: {
    title: "nuinuiCAD: Create Angle Length Line",
    quickPickLabel: "Angle Length Line",
    keywords: ["angle", "length", "line", "角度", "距離", "長さ", "線", "追加"]
  },
  addCommonTangentLine: {
    title: "nuinuiCAD: Create Common Tangent Line",
    quickPickLabel: "Common Tangent Line",
    keywords: ["common tangent", "tangent", "circle", "line", "共通接線", "接線", "円", "線", "追加"]
  },
  addArcLine: {
    title: "nuinuiCAD: Create Arc Line",
    quickPickLabel: "Arc Line",
    keywords: ["arc", "arc line", "radius", "円弧", "円弧線", "半径", "線", "追加"]
  },
  addThreePointArcLine: {
    title: "nuinuiCAD: Create Three-Point Arc Line",
    quickPickLabel: "Three-Point Arc Line",
    keywords: ["arc", "three point arc", "3 point arc", "circle", "三点円弧", "3点円弧", "円弧", "線", "追加"]
  },
  addCornerRadiusArcLine: {
    title: "nuinuiCAD: Create Corner Radius Arc Line",
    quickPickLabel: "Corner Radius Arc Line",
    keywords: ["corner", "radius", "fillet", "arc", "角R", "角丸", "円弧", "線", "追加"]
  },
  addEdge: {
    title: "nuinuiCAD: Create Edge",
    quickPickLabel: "Edge",
    keywords: ["edge", "extend", "trim", "corner", "エッジ", "延長", "短縮", "接続", "変更", "追加"]
  },
  addExtendTrim: {
    title: "nuinuiCAD: Create Extend/Trim",
    quickPickLabel: "Extend/Trim",
    keywords: ["extend", "trim", "line", "endpoint", "延長", "短縮", "端点", "変更", "追加"]
  },
  addBezierCurve: {
    title: "nuinuiCAD: Create Bezier Curve",
    quickPickLabel: "Bezier Curve",
    keywords: ["bezier", "curve", "曲線", "ベジェ", "追加"]
  },
  addOffsetLine: {
    title: "nuinuiCAD: Create Offset Line",
    quickPickLabel: "Offset Line",
    keywords: ["offset", "line", "curve", "オフセット", "線", "曲線", "追加"]
  },
  addCopyLine: {
    title: "nuinuiCAD: Create Copy Line",
    quickPickLabel: "Copy Line",
    keywords: ["copy", "line", "curve", "コピー", "複写", "線", "曲線", "追加"]
  },
  addSymmetricCopyLine: {
    title: "nuinuiCAD: Create Symmetric Copy Line",
    quickPickLabel: "Symmetric Copy Line",
    keywords: ["symmetric", "mirror", "copy", "line", "対称", "反転", "コピー", "線", "追加"]
  },
  addMove: {
    title: "nuinuiCAD: Create Move",
    quickPickLabel: "Move",
    keywords: ["move", "translate", "line", "curve", "移動", "変更", "線", "曲線", "追加"]
  },
  addSymmetricMove: {
    title: "nuinuiCAD: Create Symmetric Move",
    quickPickLabel: "Symmetric Move",
    keywords: ["symmetric", "mirror", "move", "line", "対称", "反転", "移動", "変更", "線", "追加"]
  },
  addSplitLine: {
    title: "nuinuiCAD: Create Split Line",
    quickPickLabel: "Split Line",
    keywords: ["split", "divide", "line", "分割", "分割線", "線", "追加"]
  }
} satisfies Record<VscodeCanvasCreationCommandId, VscodeCanvasCreationPresentation>;

export type VscodeCanvasCreationCommand = VscodeCanvasCreationPresentation & {
  commandId: VscodeCanvasCreationCommandId;
  vscodeCommandId: string;
  quickPickDescription: string;
};

/** Ordered by the authoritative legacy recipe map for stable presentation. */
export const vscodeCanvasCreationCommands: readonly VscodeCanvasCreationCommand[] = (
  Object.keys(legacyCreationCommandRecipeMap) as VscodeCanvasCreationCommandId[]
).map((commandId) => {
  const presentation = presentationByCommandId[commandId];
  return {
    commandId,
    vscodeCommandId: vscodeCanvasCreationCommandIdFor(commandId),
    ...presentation,
    quickPickDescription: presentation.keywords.join(" ")
  };
});

/** The native submenu has one ordered slot for each current catalog entry. */
export const VSCODE_CANVAS_QUICK_CREATE_SLOT_COUNT = vscodeCanvasCreationCommands.length;

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

export const normalizeVscodeCanvasQuickCreateCommands = (
  input: unknown
): VscodeCanvasCreationCommandId[] => {
  if (!Array.isArray(input)) return [];
  const normalized: VscodeCanvasCreationCommandId[] = [];
  const seen = new Set<VscodeCanvasCreationCommandId>();
  for (const value of input) {
    if (!isVscodeCanvasCreationCommandId(value) || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
};
