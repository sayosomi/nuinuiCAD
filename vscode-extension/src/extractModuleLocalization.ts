import type {
  ExtractModuleRejectCode,
  ExtractModuleRejection
} from "../../src/document/extractModulePlanner";
import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export type ExtractModuleCanvasExecutionRejection = "materialized-module-body-descendant";

export const extractModuleTranslationCatalog = {
  "extractModule.input.instanceName": {
    en: "Instance name",
    ja: "インスタンス名"
  },
  "extractModule.input.moduleName": {
    en: "Module name",
    ja: "Module 名"
  },
  "extractModule.choice.useModuleName": {
    en: "Use module name: {moduleName}",
    ja: "Module 名に {moduleName} を使用"
  },
  "extractModule.choice.renameModule": {
    en: "Rename module...",
    ja: "Module 名を変更..."
  },
  "extractModule.source.noTarget": {
    en: "nuinuiCAD: No authored Extract target is selected at the current Source position.",
    ja: "nuinuiCAD: 現在の Source 位置に、抽出する authored 対象が選択されていません。"
  },
  "extractModule.canvas.noTarget": {
    en: "nuinuiCAD: No authored Extract target is selected on the current Canvas.",
    ja: "nuinuiCAD: 現在の Canvas に、抽出する authored 対象が選択されていません。"
  },
  "extractModule.canvas.materialized-module-body-descendant": {
    en: "nuinuiCAD: The Canvas selection includes a materialized Module body descendant. Extract Module can use only authored Source owners or concrete Module instances; clear the selection and try again.",
    ja: "nuinuiCAD: Canvas の選択に materialized Module body の子要素が含まれています。Extract Module で使用できるのは authored Source owner または具体的な Module instance だけです。選択を解除してから再試行してください。"
  },
  "extractModule.exactCurrent": {
    en: "nuinuiCAD: Extract Module requires a current Source semantic snapshot.",
    ja: "nuinuiCAD: Extract Module には現在の Source の意味解析スナップショットが必要です。"
  },
  "extractModule.stateChanged": {
    en: "nuinuiCAD: Source or Canvas state changed. No changes were made; run Extract Module again.",
    ja: "nuinuiCAD: Source または Canvas の状態が変更されたため、変更しませんでした。Extract Module をもう一度実行してください。"
  },
  "extractModule.sourceChangedBeforeApply": {
    en: "nuinuiCAD: Source changed before Extract Module could be applied. No changes were made.",
    ja: "nuinuiCAD: Extract Module を適用する前に Source が変更されたため、変更しませんでした。"
  },
  "extractModule.completed": {
    en: "nuinuiCAD: Extracted {moduleName} from {instanceName}.",
    ja: "nuinuiCAD: {instanceName} から {moduleName} を抽出しました。"
  },
  "extractModule.rejection.stale-semantic-snapshot": {
    en: "Extract Module could not use the current Source semantics. Run the command again.",
    ja: "Extract Module で現在の Source の意味解析を利用できませんでした。コマンドをもう一度実行してください。"
  },
  "extractModule.rejection.invalid-target": {
    en: "The selected Extract target is no longer available. Run the command again.",
    ja: "選択した抽出対象を利用できなくなりました。コマンドをもう一度実行してください。"
  },
  "extractModule.rejection.non-authored-target": {
    en: "Extract Module can use only authored Source statements or concrete Module instances.",
    ja: "Extract Module で使用できるのは authored Source statement または具体的な Module instance だけです。"
  },
  "extractModule.rejection.cross-scope-target": {
    en: "The selected Extract targets must belong to the same Source scope.",
    ja: "選択した抽出対象は同じ Source スコープに属している必要があります。"
  },
  "extractModule.rejection.non-contiguous-target": {
    en: "The selected Extract targets must form one contiguous Source range.",
    ja: "選択した抽出対象は Source 上で連続した範囲を形成する必要があります。"
  },
  "extractModule.rejection.unsupported-statement": {
    en: "The selected Source contains a statement that Extract Module cannot move.",
    ja: "選択した Source に Extract Module で移動できない statement が含まれています。"
  },
  "extractModule.rejection.invalid-name": {
    en: "Enter a valid Module or instance name.",
    ja: "有効な Module 名またはインスタンス名を入力してください。"
  },
  "extractModule.rejection.name-collision": {
    en: "That Module or instance name is already used in this Source scope.",
    ja: "その Module 名またはインスタンス名は、この Source スコープですでに使用されています。"
  },
  "extractModule.rejection.unresolved-semantic-identity": {
    en: "Extract Module could not resolve one of the selected Source statements.",
    ja: "選択した Source statement の意味上の識別子を解決できませんでした。"
  },
  "extractModule.rejection.parameter-name-collision": {
    en: "An extracted parameter name conflicts with an existing name.",
    ja: "抽出したパラメータ名が既存の名前と競合しています。"
  },
  "extractModule.rejection.unrepresentable-dependency": {
    en: "A dependency of the selected Source cannot be represented in the extracted Module.",
    ja: "選択した Source の依存関係を抽出した Module で表現できません。"
  },
  "extractModule.rejection.cross-boundary-mutation": {
    en: "The selected Source changes data outside the extracted Module boundary.",
    ja: "選択した Source が抽出した Module の境界外のデータを変更します。"
  },
  "extractModule.rejection.unrepresentable-export": {
    en: "An exported value cannot be represented by the extracted Module.",
    ja: "エクスポートする値を抽出した Module で表現できません。"
  },
  "extractModule.rejection.existing-public-interface": {
    en: "The selected Source already exposes a public interface that cannot be extracted safely.",
    ja: "選択した Source には、抽出時に安全に扱えない公開インターフェースがすでにあります。"
  },
  "extractModule.rejection.unsafe-rewrite": {
    en: "Extract Module could not prove that the Source rewrite is safe. No changes were made.",
    ja: "Source の書き換えが安全であることを証明できなかったため、変更しませんでした。"
  },
  "extractModule.rejection.identity-loss": {
    en: "Extract Module would change the identity of an existing Source statement. No changes were made.",
    ja: "Extract Module により既存の Source statement の識別子が変わるため、変更しませんでした。"
  }
} satisfies TranslationCatalog;

export const extractModuleTranslatorFor = (displayLanguage: string) =>
  createTranslator(extractModuleTranslationCatalog, resolveLocale(displayLanguage));

export const extractModuleRejectionMessageFor = (
  rejection: Pick<ExtractModuleRejection, "code">,
  displayLanguage: string
): string => extractModuleTranslatorFor(displayLanguage)(
  `extractModule.rejection.${rejection.code as ExtractModuleRejectCode}`
);

export const extractModuleCanvasExecutionRejectionMessageFor = (
  reason: ExtractModuleCanvasExecutionRejection,
  displayLanguage: string
): string => extractModuleTranslatorFor(displayLanguage)(`extractModule.canvas.${reason}`);
