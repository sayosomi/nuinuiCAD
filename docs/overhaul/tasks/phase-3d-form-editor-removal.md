# Phase 3d: フォーム編集廃止とマウス専用Inspector

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 3cで導入したInspectorのキーボード行ナビは一時的な着地状態であり、
> 3d最終仕様では廃止する。

## 目的

右ペインを読み取り専用の `InspectorPanel` に限定し、フォーム型編集UI、
旧parameter edit mode、direct key、dependency jump互換を除去する。
InspectorはマウスクリックによるジャンプとCanvas pick開始のみを担い、
文書を書き換えない。

`ExpressionInsertTray` は削除せず、テンプレート挿入専用ヘルパーとして残す。

## 完成後の操作

* parameter行クリックで `jumpToParameterValue(elementId, parameterKey)` を呼び、
  Source Editorの対応値spanへジャンプする。
* dependency行クリックで対象要素を選択し、対応DSL行へ移動する。
* pick可能なparameter行の行内ボタンで、point / line / numeric referenceの
  既存Canvas pick commandを開始する。
* `i` / `toggleInspectorPanel` はInspectorの折り畳み操作として維持する。
* Inspectorはfocusable listboxではなく、`activeRowKey`、`aria-activedescendant`、
  return-focus管理を持たない。

## キーボードファースト経路

Inspectorにキーボード操作を持たせない。Phase 3のキーボードファースト要件は、
次の既存経路を正とする。

1. Canvasで要素を選択する。gesture確定後にSource Editorへfocusが渡る。
2. `Tab` / `Shift+Tab` で同一statementの編集可能値spanを循環移動する。
3. 直接入力、または `Alt+←` / `Alt+→` で値を変更する。

通常scopeの `e` / `j` / `P` はInspector操作へ割り当てない。
Inspector専用の `e` / `j` / `↑` / `↓` / `Enter` / `Esc` / `P` bindingは代替先なしで廃止する。

## 実装変更

* `InspectorPanel` からfocus command用handle、行選択state、scroll/focus effect、
  keyboard activation、return-focus配線を削除する。
* `AppLayout` / `RightPanel` / `CommandContext` からInspector refとfocus管理を削除する。
* command registryと `CommandId` から `focusInspectorParameterRows`、
  `focusInspectorDependencyRows`、`selectNextInspectorRow`、
  `selectPreviousInspectorRow`、`activateInspectorRow`、`exitInspector`、
  `startInspectorParameterPick` を削除する。`toggleInspectorPanel` は残す。
* keyboard registryから `inspector` scopeとInspector専用default bindingを削除する。
* 旧parameter/dependency bindingからInspector commandへのshortcut migrationを削除し、
  読込み正規化で代替先なしに除去する。

## 守るべき不変条件

* `sourceText` が唯一の文書上の正。Inspectorは値を書き換えない。
* `dslLineValueSpans` 系が編集可能な値の唯一の定義。
* Inspectorのparameter/dependency行クリック、行内Canvas pickボタン、
  Source Editor jump、RightPanelレイアウトを維持する。
* IME composition中にjump・patch・数値変更を実行しない。

## 必須テスト・検証

* Inspectorのparameter行クリック、dependency行クリック、行内pickボタンを検証する。
* Inspectorがlistbox / `aria-activedescendant` を持たないことを検証する。
* registry、default bindings、shortcut scope、`CommandId` からInspector navigationが
  消え、通常時の `e` / `j` / `P` / `Enter` / `Esc` が代替Inspector commandを返さないこと。
* 保存済みの旧parameter/dependency/Inspector navigation bindingが新bindingへ移行せず、
  安全に正規化除去されること。
* Canvas選択→Source Editor focus→Tab/Shift+Tab値span移動→Alt+左右による
  値変更を実コンポーネント経路で回帰テストする。
* `npm test` / `npm run build` / `npm run lint` を実行する。
