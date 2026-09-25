import {
  createTranslator,
  resolveLocale,
  type TranslationCatalog
} from "./localization";

export const modulePreviewTranslationCatalog = {
  "modulePreview.panelTitle": {
    en: "Module Preview",
    ja: "Module Preview"
  },
  "modulePreview.requiresSourceEditor": {
    en: "nuinuiCAD: Open Module Preview requires an active .nui Source Editor.",
    ja: "nuinuiCAD: Module Preview を開くには、アクティブな .nui Source Editor が必要です。"
  },
  "modulePreview.placeCaret": {
    en: "nuinuiCAD: Place the Source Editor caret inside a current Module definition.",
    ja: "nuinuiCAD: 現在の Module 定義の中に Source Editor のキャレットを置いてください。"
  },
  "modulePreview.valuesUnavailable": {
    en: "nuinuiCAD: Module Preview values are unavailable. Reopen the Module Preview panel and try again.",
    ja: "nuinuiCAD: Module Previewの値を利用できません。Module Previewパネルを開き直して、もう一度お試しください。"
  },
  "modulePreview.valueEdit.pickFromCanvas": { en: "Pick from Canvas", ja: "Canvasから選択" },
  "modulePreview.valueEdit.enterExpression": { en: "Enter expression...", ja: "式を入力..." },
  "modulePreview.valueEdit.chooseMethod": {
    en: "Choose how to edit {definition}.{parameter}",
    ja: "{definition}.{parameter}の編集方法を選択"
  },
  "modulePreview.valueEdit.prompt": {
    en: "{group} {definition}.{parameter}",
    ja: "{group} {definition}.{parameter}"
  },
  "modulePreview.valueEdit.siteLabel": {
    en: "{group}: {definition}.{parameter}",
    ja: "{group}: {definition}.{parameter}"
  },
  "modulePreview.valueEdit.context": { en: "Context", ja: "コンテキスト" },
  "modulePreview.valueEdit.target": { en: "Target", ja: "対象" },
  "modulePreview.valueEdit.explicit": { en: "Explicit: {value}", ja: "明示値: {value}" },
  "modulePreview.valueEdit.omittedDefaulted": { en: "Omitted; default: {default}", ja: "省略・デフォルト: {default}" },
  "modulePreview.valueEdit.omittedOptional": { en: "Omitted; optional", ja: "省略・任意" },
  "modulePreview.valueEdit.requiredMissing": { en: "Required value missing", ja: "必須値がありません" },
  "modulePreview.valueEdit.invalid": { en: "Invalid: {value}", ja: "無効: {value}" },
  "modulePreview.valueEdit.parameterDetail": { en: "parameter", ja: "パラメータ" },
  "modulePreview.valueEdit.typedParameterDetail": { en: "{type} parameter", ja: "{type} パラメータ" },
  "modulePreview.valueEdit.selectPlaceholder": {
    en: "Select a Module Preview value to edit",
    ja: "編集するModule Previewの値を選択"
  },
  "modulePreview.insert.staleSession": {
    en: "Module Preview session is no longer authoritative.",
    ja: "Module Previewセッションが現在の状態ではありません。"
  },
  "modulePreview.insert.staleValues": {
    en: "The current Module Preview values are not exact-current.",
    ja: "現在のModule Previewの値は最新状態ではありません。"
  },
  "modulePreview.insert.staleTarget": {
    en: "The Module Preview target is stale.",
    ja: "Module Previewの対象が古くなっています。"
  },
  "modulePreview.insert.staleSourceAfterPublish": {
    en: "The source document changed after the current Module Preview values were published.",
    ja: "現在のModule Previewの値が公開された後にSource文書が変更されました。"
  },
  "modulePreview.insert.staleBeforeApply": {
    en: "The Source editor or Module Preview values changed before insertion.",
    ja: "挿入前にSource EditorまたはModule Previewの値が変更されました。"
  },
  "modulePreview.insert.staleDuringApply": {
    en: "The source document changed while inserting the Module instance.",
    ja: "Moduleインスタンスの挿入中にSource文書が変更されました。"
  },
  "modulePreview.insert.rejectedTargetGroupMissing": {
    en: "The current Module Preview has no exact target value group.",
    ja: "現在のModule Previewに正確な対象値グループがありません。"
  },
  "modulePreview.insert.rejectedIncompleteValues": {
    en: "Complete the required target values before inserting an instance.",
    ja: "インスタンスを挿入する前に必須の対象値を入力してください。"
  },
  "modulePreview.insert.rejectedEmptyArgument": {
    en: "The current Module Preview contains an empty explicit argument.",
    ja: "現在のModule Previewに空の明示引数があります。"
  },
  "modulePreview.insert.rejectedSourceEditorUnavailable": {
    en: "The current same-document Source editor is not available.",
    ja: "同じ文書を表示する現在のSource Editorを利用できません。"
  },
  "modulePreview.insert.rejectedSourceEdit": {
    en: "VS Code rejected the Module instance source edit.",
    ja: "VS CodeがModuleインスタンスのSource編集を拒否しました。"
  },
  "modulePreview.insert.planner.incompleteSource": {
    en: "The current source has no complete Module semantic snapshot.",
    ja: "現在のSourceに完全なModule意味情報がありません。"
  },
  "modulePreview.insert.planner.invalidCaret": {
    en: "The current Source editor caret is outside the current source.",
    ja: "現在のSource EditorのキャレットがSourceの範囲外です。"
  },
  "modulePreview.insert.planner.targetNotExactCurrent": {
    en: "The Module Preview target is no longer the exact current Module definition.",
    ja: "Module Previewの対象は現在の正確なModule定義ではありません。"
  },
  "modulePreview.insert.planner.targetSemanticDefinitionMissing": {
    en: "The Module Preview target has no current Module semantic definition.",
    ja: "Module Previewの対象に現在のModule意味定義がありません。"
  },
  "modulePreview.insert.planner.invalidExplicitArgument": {
    en: "Module Preview contains an invalid or multiline explicit argument.",
    ja: "Module Previewに無効または複数行の明示引数があります。"
  },
  "modulePreview.insert.planner.illegalStatementBoundary": {
    en: "The current caret is not at a legal whole-statement insertion boundary.",
    ja: "現在のキャレット位置は文全体を挿入できる境界ではありません。"
  },
  "modulePreview.insert.planner.unknownLexicalScope": {
    en: "The current caret is not inside a known lexical scope.",
    ja: "現在のキャレット位置の字句スコープを特定できません。"
  },
  "modulePreview.insert.planner.statementIdentitiesMissing": {
    en: "The current source has no stable statement identities.",
    ja: "現在のSourceに安定した文の識別情報がありません。"
  },
  "modulePreview.insert.planner.targetNotVisible": {
    en: "The target Module is not visible at the current source insertion position.",
    ja: "現在のSource挿入位置では対象のModuleを参照できません。"
  },
  "modulePreview.insert.planner.undeclaredArgument": {
    en: "Module Preview contains an argument that is not declared by the target Module.",
    ja: "Module Previewに対象Moduleで宣言されていない引数があります。"
  },
  "modulePreview.insert.planner.spliceRejected": {
    en: "The current source cannot accept the planned Module instance insertion.",
    ja: "現在のSourceに計画したModuleインスタンスを挿入できません。"
  },
  "modulePreview.insert.planner.candidateInvalid": {
    en: "The generated Module instance did not pass current semantic validation.",
    ja: "生成したModuleインスタンスが現在の意味検証に通りませんでした。"
  }
} satisfies TranslationCatalog;

export const modulePreviewTranslatorFor = (displayLanguage: string) =>
  createTranslator(modulePreviewTranslationCatalog, resolveLocale(displayLanguage));
