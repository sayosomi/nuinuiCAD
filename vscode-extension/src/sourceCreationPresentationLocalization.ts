import {
  SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceControlFlowTemplateCatalog";
import {
  sourceCalculationMeasurementTemplatePlans
} from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import {
  sourceGeometryValueTemplateGroups
} from "../../src/commands/sourceGeometryValueTemplateCatalog";
import {
  SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceModuleTemplateCatalog";
import {
  SOURCE_OUTPUT_TEMPLATE_DEFINITIONS
} from "../../src/commands/sourceOutputTemplateCatalog";
import {
  SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceStyleProfileTemplateCatalog";
import {
  SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS
} from "../../src/commands/sourceTemplateCatalog";
import {
  SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS
} from "../../src/commands/sourceValueMatchTemplateCatalog";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const sourceCreationPresentationTranslationCatalog = {
  "sourceCreation.family.geometry": { en: "Geometry", ja: "ジオメトリ" },
  "sourceCreation.family.geometry-value": { en: "Geometry Value", ja: "ジオメトリ値" },
  "sourceCreation.family.calculation-measurement": { en: "Calculation / Measurement", ja: "計算 / 計測" },
  "sourceCreation.family.control-flow": { en: "Control Flow", ja: "制御フロー" },
  "sourceCreation.family.value-match": { en: "Value / Match", ja: "値 / Match" },
  "sourceCreation.family.module": { en: "Module", ja: "Module" },
  "sourceCreation.family.style-profile": { en: "Style / Profile", ja: "Style / Profile" },
  "sourceCreation.family.output-print": { en: "Output / Print", ja: "出力 / Print" },

  "sourceCreation.geometryValue.group.point": { en: "Point", ja: "点" },
  "sourceCreation.geometryValue.group.line": { en: "Line", ja: "線" },
  "sourceCreation.geometryValue.group.path": { en: "Path", ja: "パス" },

  "sourceCreation.calculationMeasurement.distance": { en: "Distance between points", ja: "2点間の距離" },
  "sourceCreation.calculationMeasurement.angle": { en: "Angle between points", ja: "2点間の角度" },
  "sourceCreation.calculationMeasurement.lineDistance": { en: "Point-to-line distance", ja: "点から線までの距離" },
  "sourceCreation.calculationMeasurement.lineAngle": { en: "Angle between lines", ja: "2本の線の間の角度" },
  "sourceCreation.calculationMeasurement.spreadAngle": { en: "Spread angle", ja: "角度の広がり" },

  "sourceCreation.controlFlow.group": { en: "Group", ja: "Group（グループ）" },
  "sourceCreation.controlFlow.if": { en: "If", ja: "If（条件分岐）" },
  "sourceCreation.controlFlow.for-range": { en: "For Range", ja: "For Range（範囲反復）" },
  "sourceCreation.controlFlow.for-collection": { en: "For Collection", ja: "For Collection（コレクション反復）" },
  "sourceCreation.controlFlow.for-range-carry": { en: "For Range + Carry", ja: "For Range + Carry（範囲反復 + Carry）" },
  "sourceCreation.controlFlow.for-collection-carry": { en: "For Collection + Carry", ja: "For Collection + Carry（コレクション反復 + Carry）" },

  "sourceCreation.valueMatch.choice-declaration": { en: "Choice Declaration", ja: "Choice Declaration（Choice 宣言）" },
  "sourceCreation.valueMatch.collection-declaration": { en: "Collection Declaration", ja: "Collection Declaration（Collection 宣言）" },
  "sourceCreation.valueMatch.value-if": { en: "Value If", ja: "Value If（条件値）" },
  "sourceCreation.valueMatch.choice-match": { en: "Choice Match", ja: "Choice Match（Choice の Match）" },
  "sourceCreation.valueMatch.optional-match": { en: "Optional Match", ja: "Optional Match（Optional の Match）" },
  "sourceCreation.valueMatch.collection-value-for": { en: "Collection Value For", ja: "Collection Value For（Collection 値の反復）" },

  "sourceCreation.module.module": { en: "Module", ja: "Module（モジュール定義）" },
  "sourceCreation.module.export-module": { en: "Export Module", ja: "Export Module（公開 Module）" },
  "sourceCreation.module.module-instance": { en: "Module Instance", ja: "Module Instance（Module インスタンス）" },

  "sourceCreation.styleProfile.profile": { en: "Profile", ja: "Profile（設定プロファイル）" },
  "sourceCreation.styleProfile.style": { en: "Style", ja: "Style（スタイル）" },
  "sourceCreation.styleProfile.style-profile-override": {
    en: "Style + Profile Override",
    ja: "Style + Profile Override（Style + Profile の上書き）"
  },

  "sourceCreation.outputPrint.layout-print": { en: "Layout + Print", ja: "Layout + Print（レイアウト + 印刷）" },
  "sourceCreation.outputPrint.layout": { en: "Layout", ja: "Layout（レイアウト）" },
  "sourceCreation.outputPrint.place": { en: "Place", ja: "Place（配置）" },
  "sourceCreation.outputPrint.print": { en: "Print", ja: "Print（印刷）" },
  "sourceCreation.outputPrint.svg": { en: "SVG", ja: "SVG" },

  "sourceCreation.message.stale": {
    en: "nuinuiCAD: The Source changed while Insert Template was open. Retry the command.",
    ja: "nuinuiCAD: Insert Template の表示中に Source が変更されました。コマンドをもう一度実行してください。"
  },
  "sourceCreation.message.unsafeInsertion": {
    en: "nuinuiCAD: Could not establish a safe Source statement boundary. Move the caret between statements and retry.",
    ja: "nuinuiCAD: 安全な Source 文の挿入位置を特定できませんでした。文と文の間にキャレットを移動して、もう一度実行してください。"
  },
  "sourceCreation.message.moduleNoCandidates": {
    en: "nuinuiCAD: No legal Module callees are available at this Source insertion target.",
    ja: "nuinuiCAD: この Source 挿入位置で呼び出せる Module がありません。"
  },
  "sourceCreation.message.exportModuleTopLevel": {
    en: "nuinuiCAD: Export Module is legal only at the document top level.",
    ja: "nuinuiCAD: Export Module はドキュメントのトップレベルでのみ使用できます。"
  },
  "sourceCreation.message.profileTopLevel": {
    en: "nuinuiCAD: Profile is legal only at the document top level.",
    ja: "nuinuiCAD: Profile はドキュメントのトップレベルでのみ使用できます。"
  },
  "sourceCreation.message.placeScope": {
    en: "nuinuiCAD: Place is legal only directly inside a layout body.",
    ja: "nuinuiCAD: Place は layout 本体の直下でのみ使用できます。"
  },
  "sourceCreation.message.outputTopLevel": {
    en: "nuinuiCAD: This template is legal only at the document top level.",
    ja: "nuinuiCAD: このテンプレートはドキュメントのトップレベルでのみ使用できます。"
  }
} satisfies TranslationCatalog;

export type SourceCreationMessageId =
  | "stale"
  | "unsafeInsertion"
  | "moduleNoCandidates"
  | "exportModuleTopLevel"
  | "profileTopLevel"
  | "placeScope"
  | "outputTopLevel";

export const sourceCreationTranslatorFor = (displayLanguage: string) =>
  createTranslator(sourceCreationPresentationTranslationCatalog, resolveLocale(displayLanguage));

export const sourceCreationMessageFor = (
  messageId: SourceCreationMessageId,
  displayLanguage: string
): string => sourceCreationTranslatorFor(displayLanguage)(`sourceCreation.message.${messageId}`);

export const sourceTemplateFamilyPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.family.${item.id}`)
  }));
};

export const sourceGeometryValueGroupPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return sourceGeometryValueTemplateGroups().map((group) => ({
    label: translate(`sourceCreation.geometryValue.group.${group.id}`),
    id: group.id,
    group
  }));
};

export const sourceGeometryValueConstructionPickerItemsFor = (
  group: ReturnType<typeof sourceGeometryValueTemplateGroups>[number]
) => group.plans.map((plan) => ({ label: plan.construction, plan }));

export const sourceGeometryValueFormPickerItemsFor = (
  plan: ReturnType<typeof sourceGeometryValueTemplateGroups>[number]["plans"][number]
) => plan.forms.map((form) => ({
  label: form.exclusiveChoices.map(({ selectedArgName }) => selectedArgName).join(" + "),
  form
}));

export const sourceCalculationMeasurementPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return sourceCalculationMeasurementTemplatePlans().map((plan) => ({
    id: plan.id,
    label: translate(`sourceCreation.calculationMeasurement.${plan.id}`),
    plan
  }));
};

export const sourceControlFlowPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.controlFlow.${item.id}`)
  }));
};

export const sourceValueMatchPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.valueMatch.${item.id}`)
  }));
};

export const sourceModulePickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.module.${item.id}`)
  }));
};

export const sourceStyleProfilePickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.styleProfile.${item.id}`)
  }));
};

export const sourceOutputPrintPickerItemsFor = (displayLanguage: string) => {
  const translate = sourceCreationTranslatorFor(displayLanguage);
  return SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map((item) => ({
    ...item,
    label: translate(`sourceCreation.outputPrint.${item.id}`)
  }));
};
