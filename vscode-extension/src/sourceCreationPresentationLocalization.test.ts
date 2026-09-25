import { describe, expect, it } from "vitest";
import { SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS } from "../../src/commands/sourceTemplateCatalog";
import { sourceGeometryValueTemplateGroups } from "../../src/commands/sourceGeometryValueTemplateCatalog";
import { sourceCalculationMeasurementTemplatePlans } from "../../src/commands/sourceCalculationMeasurementTemplateCatalog";
import { SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS } from "../../src/commands/sourceControlFlowTemplateCatalog";
import { SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS } from "../../src/commands/sourceValueMatchTemplateCatalog";
import { SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS } from "../../src/commands/sourceModuleTemplateCatalog";
import { SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS } from "../../src/commands/sourceStyleProfileTemplateCatalog";
import { SOURCE_OUTPUT_TEMPLATE_DEFINITIONS, sourceOutputTemplateSnippetFor } from "../../src/commands/sourceOutputTemplateCatalog";
import { materializeSourceGeometryValueTemplate } from "../../src/commands/sourceGeometryValueTemplateMaterializer";
import { materializeSourceCalculationMeasurementTemplate } from "../../src/commands/sourceCalculationMeasurementTemplateMaterializer";
import { materializeSourceControlFlowTemplate } from "../../src/commands/sourceControlFlowTemplateMaterializer";
import { materializeSourceValueMatchTemplate } from "../../src/commands/sourceValueMatchTemplateMaterializer";
import { materializeSourceModuleTemplate } from "../../src/commands/sourceModuleTemplateMaterializer";
import { materializeSourceStyleProfileTemplate } from "../../src/commands/sourceStyleProfileTemplateMaterializer";
import {
  sourceCalculationMeasurementPickerItemsFor,
  sourceControlFlowPickerItemsFor,
  sourceCreationMessageFor,
  sourceCreationTranslatorFor,
  sourceGeometryValueConstructionPickerItemsFor,
  sourceGeometryValueFormPickerItemsFor,
  sourceGeometryValueGroupPickerItemsFor,
  sourceModulePickerItemsFor,
  sourceOutputPrintPickerItemsFor,
  sourceStyleProfilePickerItemsFor,
  sourceTemplateFamilyPickerItemsFor,
  sourceValueMatchPickerItemsFor
} from "./sourceCreationPresentationLocalization";

describe("Source creation presentation localization", () => {
  it("localizes family labels while preserving stable IDs, membership, and order", () => {
    const english = sourceTemplateFamilyPickerItemsFor("en-US");
    const japanese = sourceTemplateFamilyPickerItemsFor("ja-JP");

    expect(english.map(({ id }) => id)).toEqual(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map(({ id }) => id));
    expect(japanese.map(({ id }) => id)).toEqual(english.map(({ id }) => id));
    expect(english.map(({ label }) => label)).toEqual(SOURCE_TEMPLATE_FAMILY_QUICK_PICK_ITEMS.map(({ label }) => label));
    expect(japanese.map(({ label }) => label)).toEqual([
      "ジオメトリ",
      "ジオメトリ値",
      "計算 / 計測",
      "制御フロー",
      "値 / Match",
      "Module",
      "Style / Profile",
      "出力 / Print"
    ]);
  });

  it("localizes every translatable template family and keeps semantic rows in catalog order", () => {
    const englishGroups = sourceGeometryValueGroupPickerItemsFor("en");
    const japaneseGroups = sourceGeometryValueGroupPickerItemsFor("ja");
    expect(englishGroups.map(({ id }) => id)).toEqual(japaneseGroups.map(({ id }) => id));
    expect(englishGroups.map(({ label }) => label)).toEqual(["Point", "Line", "Path"]);
    expect(japaneseGroups.map(({ label }) => label)).toEqual(["点", "線", "パス"]);
    for (const groups of [englishGroups, japaneseGroups]) {
      expect(groups.map(({ group }) => group.plans.map(({ construction }) => construction)))
        .toEqual(sourceGeometryValueTemplateGroups().map(({ plans }) => plans.map(({ construction }) => construction)));
    }

    const englishCalculations = sourceCalculationMeasurementPickerItemsFor("en");
    const japaneseCalculations = sourceCalculationMeasurementPickerItemsFor("ja");
    expect(englishCalculations.map(({ id, plan }) => [id, plan.builtinName]))
      .toEqual(japaneseCalculations.map(({ id, plan }) => [id, plan.builtinName]));
    expect(englishCalculations.map(({ label }) => label)).toEqual(sourceCalculationMeasurementTemplatePlans().map(({ label }) => label));
    expect(japaneseCalculations.map(({ label }) => label)).toEqual([
      "2点間の距離", "2点間の角度", "点から線までの距離", "2本の線の間の角度", "角度の広がり"
    ]);

    const englishControl = sourceControlFlowPickerItemsFor("en");
    const japaneseControl = sourceControlFlowPickerItemsFor("ja");
    expect(englishControl.map(({ id }) => id)).toEqual(SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS.map(({ id }) => id));
    expect(japaneseControl.map(({ id }) => id)).toEqual(englishControl.map(({ id }) => id));
    expect(englishControl.map(({ label }) => label)).toEqual(SOURCE_CONTROL_FLOW_TEMPLATE_QUICK_PICK_ITEMS.map(({ label }) => label));
    expect(japaneseControl.map(({ label }) => label)).toEqual([
      "Group（グループ）", "If（条件分岐）", "For Range（範囲反復）", "For Collection（コレクション反復）",
      "For Range + Carry（範囲反復 + Carry）", "For Collection + Carry（コレクション反復 + Carry）"
    ]);

    const englishValueMatch = sourceValueMatchPickerItemsFor("en");
    const japaneseValueMatch = sourceValueMatchPickerItemsFor("ja");
    expect(englishValueMatch.map(({ id }) => id)).toEqual(SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS.map(({ id }) => id));
    expect(japaneseValueMatch.map(({ id }) => id)).toEqual(englishValueMatch.map(({ id }) => id));
    expect(englishValueMatch.map(({ label }) => label)).toEqual(SOURCE_VALUE_MATCH_TEMPLATE_QUICK_PICK_ITEMS.map(({ label }) => label));
    expect(japaneseValueMatch.map(({ label }) => label)).toEqual([
      "Choice Declaration（Choice 宣言）", "Collection Declaration（Collection 宣言）", "Value If（条件値）",
      "Choice Match（Choice の Match）", "Optional Match（Optional の Match）", "Collection Value For（Collection 値の反復）"
    ]);

    const englishModules = sourceModulePickerItemsFor("en");
    const japaneseModules = sourceModulePickerItemsFor("ja");
    expect(englishModules.map(({ id }) => id)).toEqual(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS.map(({ id }) => id));
    expect(japaneseModules.map(({ id }) => id)).toEqual(englishModules.map(({ id }) => id));
    expect(englishModules.map(({ label }) => label)).toEqual(SOURCE_MODULE_TEMPLATE_QUICK_PICK_ITEMS.map(({ label }) => label));
    expect(japaneseModules.map(({ label }) => label)).toEqual([
      "Module（モジュール定義）", "Export Module（公開 Module）", "Module Instance（Module インスタンス）"
    ]);

    const englishStyles = sourceStyleProfilePickerItemsFor("en");
    const japaneseStyles = sourceStyleProfilePickerItemsFor("ja");
    expect(englishStyles.map(({ id }) => id)).toEqual(SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS.map(({ id }) => id));
    expect(japaneseStyles.map(({ id }) => id)).toEqual(englishStyles.map(({ id }) => id));
    expect(englishStyles.map(({ label }) => label)).toEqual(SOURCE_STYLE_PROFILE_TEMPLATE_QUICK_PICK_ITEMS.map(({ label }) => label));
    expect(japaneseStyles.map(({ label }) => label)).toEqual([
      "Profile（設定プロファイル）", "Style（スタイル）", "Style + Profile Override（Style + Profile の上書き）"
    ]);

    const englishOutput = sourceOutputPrintPickerItemsFor("en");
    const japaneseOutput = sourceOutputPrintPickerItemsFor("ja");
    expect(englishOutput.map(({ id }) => id)).toEqual(SOURCE_OUTPUT_TEMPLATE_DEFINITIONS.map(({ id }) => id));
    expect(japaneseOutput.map(({ id }) => id)).toEqual(englishOutput.map(({ id }) => id));
    expect(englishOutput.map(({ label }) => label)).toEqual(["Layout + Print", "Layout", "Place", "Print", "SVG"]);
    expect(japaneseOutput.map(({ label }) => label)).toEqual([
      "Layout + Print（レイアウト + 印刷）", "Layout（レイアウト）", "Place（配置）", "Print（印刷）", "SVG"
    ]);
  });

  it("keeps geometry construction/form rows and materialization data independent of localized labels", () => {
    const englishGroup = sourceGeometryValueGroupPickerItemsFor("en")[0]!;
    const japaneseGroup = sourceGeometryValueGroupPickerItemsFor("ja")[0]!;
    const englishConstructions = sourceGeometryValueConstructionPickerItemsFor(englishGroup.group);
    const japaneseConstructions = sourceGeometryValueConstructionPickerItemsFor(japaneseGroup.group);
    expect(japaneseConstructions.map(({ plan }) => plan.construction))
      .toEqual(englishConstructions.map(({ plan }) => plan.construction));
    const englishPlan = englishConstructions[0]!.plan;
    const japanesePlan = japaneseConstructions[0]!.plan;
    const englishForms = sourceGeometryValueFormPickerItemsFor(englishPlan);
    const japaneseForms = sourceGeometryValueFormPickerItemsFor(japanesePlan);
    expect(japaneseForms.map(({ label, form }) => [label, form.exclusiveChoices]))
      .toEqual(englishForms.map(({ label, form }) => [label, form.exclusiveChoices]));
    expect(materializeSourceGeometryValueTemplate(englishPlan, englishForms[0]!.form))
      .toEqual(materializeSourceGeometryValueTemplate(japanesePlan, japaneseForms[0]!.form));

    expect(sourceCalculationMeasurementPickerItemsFor("en").map(({ plan }) => materializeSourceCalculationMeasurementTemplate(plan)))
      .toEqual(sourceCalculationMeasurementPickerItemsFor("ja").map(({ plan }) => materializeSourceCalculationMeasurementTemplate(plan)));
    expect(sourceControlFlowPickerItemsFor("en").map(({ id }) => materializeSourceControlFlowTemplate(id)))
      .toEqual(sourceControlFlowPickerItemsFor("ja").map(({ id }) => materializeSourceControlFlowTemplate(id)));
    expect(sourceValueMatchPickerItemsFor("en").map(({ id }) => materializeSourceValueMatchTemplate(id)))
      .toEqual(sourceValueMatchPickerItemsFor("ja").map(({ id }) => materializeSourceValueMatchTemplate(id)));
    expect(sourceModulePickerItemsFor("en").slice(0, 2).map(({ id }) => materializeSourceModuleTemplate(id)))
      .toEqual(sourceModulePickerItemsFor("ja").slice(0, 2).map(({ id }) => materializeSourceModuleTemplate(id)));
    expect(sourceStyleProfilePickerItemsFor("en").map(({ id }) => materializeSourceStyleProfileTemplate(id)))
      .toEqual(sourceStyleProfilePickerItemsFor("ja").map(({ id }) => materializeSourceStyleProfileTemplate(id)));
    expect(sourceOutputPrintPickerItemsFor("en").map(({ id }) => sourceOutputTemplateSnippetFor(id)))
      .toEqual(sourceOutputPrintPickerItemsFor("ja").map(({ id }) => sourceOutputTemplateSnippetFor(id)));
  });

  it("localizes all confirmed runtime and legality messages", () => {
    const messageIds = [
      "stale", "unsafeInsertion", "moduleNoCandidates", "exportModuleTopLevel", "profileTopLevel", "placeScope", "outputTopLevel"
    ] as const;
    for (const messageId of messageIds) {
      expect(sourceCreationMessageFor(messageId, "ja-JP")).not.toBe(sourceCreationMessageFor(messageId, "en-US"));
    }
    expect(sourceCreationMessageFor("stale", "ja")).toContain("Source が変更されました");
    expect(sourceCreationMessageFor("unsafeInsertion", "ja")).toContain("安全な Source 文の挿入位置");
    expect(sourceCreationMessageFor("moduleNoCandidates", "ja")).toContain("呼び出せる Module がありません");
    expect(sourceCreationMessageFor("exportModuleTopLevel", "ja")).toContain("Export Module");
    expect(sourceCreationMessageFor("profileTopLevel", "ja")).toContain("Profile");
    expect(sourceCreationMessageFor("placeScope", "ja")).toContain("layout 本体の直下");
    expect(sourceCreationMessageFor("outputTopLevel", "ja")).toContain("トップレベル");
    expect(sourceCreationMessageFor("stale", "en")).toBe(
      "nuinuiCAD: The Source changed while Insert Template was open. Retry the command."
    );
  });

  it("uses the shared locale resolver with English fallback for unsupported languages", () => {
    expect(sourceCreationTranslatorFor("fr-FR")("sourceCreation.family.geometry"))
      .toBe(sourceCreationTranslatorFor("en")("sourceCreation.family.geometry"));
  });
});
