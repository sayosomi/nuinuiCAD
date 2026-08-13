// Task 48: the single runtime issueCode -> message table, shared verbatim by
// the Inspector's runtime section (typedBindingRuntimeInspectorPresentation.ts)
// && the gutter/Problems runtime diagnostic converter
// (runtimeScalarDiagnostics.ts) - moved out of the Inspector presentation
// module so neither surface can drift from the other's wording. Every
// runtime issueCode a ScalarEvaluation error can carry, both engines
// (src/scalars/*.ts, src-tauri/src/evaluation/scalars/*.rs) - kept in sync by
// hand since Rust never sends a code TS doesn't also define. Unknown codes
// still get a message (fail-closed, never blank) rather than being dropped.
const RUNTIME_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  "poisoned-binding": "評価に失敗し無効化されています。",
  "evaluation-binding-unavailable": "参照先のbindingを解決できません。",
  "evaluation-runtime-value-type-mismatch": "値の型が宣言と一致しません。",
  "evaluation-binding-cycle-guard": "循環参照が検出されました。",
  "evaluation-binding-version-unavailable": "この時点のsetがまだ評価されていません。",
  "evaluation-divide-by-zero": "0での除算が発生しました。",
  "evaluation-non-finite-result": "計算結果が数値として不正です。",
  "evaluation-static-type-null": "型を確定できませんでした。",
  "evaluation-numeric-adapter-failure": "数値の評価に失敗しました。",
  "evaluation-geometry-property-unavailable": "要素プロパティはこの位置では評価できません。参照先が前方にあり、有効で、正常に評価済みか確認してください。"
};

export const runtimeIssueMessage = (issueCode: string): string => RUNTIME_ISSUE_MESSAGES[issueCode] ?? "実行時エラーが発生しました。";
