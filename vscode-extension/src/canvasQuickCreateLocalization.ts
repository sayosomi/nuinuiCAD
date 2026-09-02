import type { VscodeCanvasCreationCommandId } from "../../src/vscode/vscodeCanvasCreationCommands";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const canvasQuickCreateTranslationCatalog = {
  "canvasQuickCreate.placeholder.createGeometry": {
    en: "Create geometry",
    ja: "ジオメトリを作成"
  },
  "canvasQuickCreate.placeholder.addCommand": {
    en: "Add Quick Create command",
    ja: "クイック作成コマンドを追加"
  },
  "canvasQuickCreate.title.configure": {
    en: "Configure Quick Create",
    ja: "クイック作成を設定"
  },
  "canvasQuickCreate.placeholder.configuredCommands": {
    en: "Configured creation commands",
    ja: "設定済みの作成コマンド"
  },
  "canvasQuickCreate.button.add": { en: "Add", ja: "追加" },
  "canvasQuickCreate.button.moveUp": { en: "Move Up", ja: "上へ移動" },
  "canvasQuickCreate.button.moveDown": { en: "Move Down", ja: "下へ移動" },
  "canvasQuickCreate.button.remove": { en: "Remove", ja: "削除" },
  "canvasQuickCreate.description.create": {
    en: "Create {action}",
    ja: "{action}を作成"
  },
  "canvasQuickCreate.command.addFreePoint": { en: "Free Point", ja: "自由点" },
  "canvasQuickCreate.command.addText": { en: "Text", ja: "テキスト" },
  "canvasQuickCreate.command.addOffsetPoint": { en: "Offset Point", ja: "オフセット点" },
  "canvasQuickCreate.command.addPolarOffsetPoint": { en: "Polar Offset Point", ja: "極座標オフセット点" },
  "canvasQuickCreate.command.addDivisionPoint": { en: "Division Point", ja: "分点" },
  "canvasQuickCreate.command.addLineDivisionPoint": { en: "Line Division Point", ja: "線上の分点" },
  "canvasQuickCreate.command.addIntersectionPoint": { en: "Intersection Point", ja: "交点" },
  "canvasQuickCreate.command.addLineTangentOffsetPoint": { en: "Line Tangent Offset Point", ja: "線の接線方向オフセット点" },
  "canvasQuickCreate.command.addBezierBulgePoint": { en: "Bezier Bulge Point", ja: "ベジェ膨らみ点" },
  "canvasQuickCreate.command.addBezierExtremePoint": { en: "Bezier Extreme Point", ja: "ベジェ極値点" },
  "canvasQuickCreate.command.addLine": { en: "Line", ja: "線" },
  "canvasQuickCreate.command.addAngleLengthLine": { en: "Angle Length Line", ja: "角度・長さ線" },
  "canvasQuickCreate.command.addCommonTangentLine": { en: "Common Tangent Line", ja: "共通接線" },
  "canvasQuickCreate.command.addArcLine": { en: "Arc Line", ja: "円弧線" },
  "canvasQuickCreate.command.addThreePointArcLine": { en: "Three-Point Arc Line", ja: "3点円弧線" },
  "canvasQuickCreate.command.addCornerRadiusArcLine": { en: "Corner Radius Arc Line", ja: "コーナー半径円弧線" },
  "canvasQuickCreate.command.addEdge": { en: "Edge", ja: "エッジ" },
  "canvasQuickCreate.command.addExtendTrim": { en: "Extend/Trim", ja: "延長/短縮" },
  "canvasQuickCreate.command.addBezierCurve": { en: "Bezier Curve", ja: "ベジェ曲線" },
  "canvasQuickCreate.command.addOffsetLine": { en: "Offset Line", ja: "オフセット線" },
  "canvasQuickCreate.command.addCopyLine": { en: "Copy Line", ja: "コピー線" },
  "canvasQuickCreate.command.addSymmetricCopyLine": { en: "Symmetric Copy Line", ja: "対称コピー線" },
  "canvasQuickCreate.command.addMove": { en: "Move", ja: "移動" },
  "canvasQuickCreate.command.addSymmetricMove": { en: "Symmetric Move", ja: "対称移動" },
  "canvasQuickCreate.command.addSplitLine": { en: "Split Line", ja: "分割線" }
} satisfies TranslationCatalog;

export const canvasQuickCreateTranslatorFor = (displayLanguage: string) =>
  createTranslator(canvasQuickCreateTranslationCatalog, resolveLocale(displayLanguage));

export const canvasQuickCreateLabelFor = (
  commandId: VscodeCanvasCreationCommandId,
  displayLanguage: string
): string => canvasQuickCreateTranslatorFor(displayLanguage)(`canvasQuickCreate.command.${commandId}`);

export const canvasQuickCreateDescriptionFor = (
  commandId: VscodeCanvasCreationCommandId,
  displayLanguage: string
): string => {
  const translator = canvasQuickCreateTranslatorFor(displayLanguage);
  return translator("canvasQuickCreate.description.create", {
    action: canvasQuickCreateLabelFor(commandId, displayLanguage)
  });
};
