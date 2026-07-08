# Phase 4: コマンドライン作図 + DSL補完(DslPanel削除)

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 3 と相互独立(並行実装可)。ともに Phase 2 に依存。

## 目的

最短手数の作図フローを2系統実装する:

1. **AutoCAD風コマンドライン**: 作成コマンド発行→必須参照・数値を順に
   プロンプト(Canvasクリック or 名前タイプ+補完)→名前ステップ→Enter確定。
   選択中の要素は「Enterで採用できる候補」としてのみ提示し、勝手に基準に
   しない。
2. **DSL直接タイプ**: エディタ内オートコンプリート(キーワード・参照名・
   属性キー)。

あわせてフローティングDslPanelを削除する(常設エディタが完全に代替)。

## 変更対象

* 新規 `src/components/CommandLineBar.tsx` — Canvas下部の常設1行バー。
  表示: 現在コマンド/プロンプト(例 `始点を指定 [クリック / 名前入力 /
  Enter=選択中: BP]`)/補完付き入力/確定済み引数チップ。
* 新規 `src/commands/commandLineSession.ts` — セッション状態機械
  (`cadUiStore` にセッション状態)。Escでキャンセル+ピック状態クリア
  (`clearPickMode`)。
* 新規 `src/commands/creationRecipes.ts` — 要素型ごとの宣言的レシピ:

  ```ts
  type CreationRecipe = {
    type: CadElementType;
    steps: Array<
      | { kind: "point"; key: string; prompt: string; allowCoordinate?: true }
      | { kind: "line"; key: string; prompt: string }
      | { kind: "endpoint"; key: string; prompt: string }
      | { kind: "number"; key: string; prompt: string; default?: string }
      | { kind: "name"; autoSuggest: true }  // Enter=候補採用/タイプ=上書き/スキップ=無名
    >;
    emit: (args) => string; // DSL文1行
  };
  ```

  `parameterDefinitions.ts` の値種別・ラベルと突き合わせるテストを付け、
  乖離を防ぐ。
* `src/commands/pickCommands.ts` + `pickCommandDefinitions.ts` — 既存ピック
  機構の再利用: pick target に `{kind: "commandLine", stepIndex}` 判別子を追加し、
  解決したアンカー/線/数値参照をセッションへルーティング。キーボードピック
  カーソル(`activePickCursor`)はそのまま動くこと。
* `src/commands/creationCommandDefinitions.ts` / `elementCreationCommands.ts` —
  作成コマンドは即時挿入ではなくセッション開始に変更。
  `nameEntryAfterCreation.ts` は削除(名前ステップが代替)。
* 新規 `src/editor/cmAutocomplete.ts` — 文脈補完: 行頭=要素キーワード、
  参照位置=名前空間対応の要素名(`名前.端点` 派生形含む)、属性位置=
  `parameterDefinitions.ts` 由来のキーと `choiceOptions`。
* **挿入位置 = エディタのカーソル行**(=評価順位置)。`commitText` スプライスで
  1 Undoステップ。確定後: 新要素を選択し、カーソルをその行に置く。
* **ゴーストプレビュー**: セッション中、部分文が暫定コンパイル可能なら
  `previewDocumentChange` で表示。不能なら表示しない(偽のデフォルト値で
  コンパイルを通さない)。
* **無名要素の自動昇格**: ピックで無名要素が参照された場合、
  `makeUniqueElementName`(名前空間対応)で命名し、参照行の挿入と同一
  Undoステップでその要素の行もパッチする。
* **削除**: `DslPanel.tsx`(ローカル履歴含む)、`DslEditor.tsx`、DSLパネル系
  コマンド・`cadUiStore` のパネル窓状態。
* レシピは段階投入: 点・線・曲線系を完全実装し、ロングテールは汎用
  `element` フォールバックレシピ(型指定+属性を順に聞く)でカバー。

## 守るべき不変条件

* **選択中要素を暗黙に消費しない**: 候補としての提示+Enter明示採用のみ。
  これは本改修の最重要ユーザー要求。
* キーボードだけで全ステップ完結(名前タイプ+補完、キーボードピック
  カーソル、数値タイプ)。マウス(Canvasクリック)は等価な代替手段。
* 1作成=1 Undoステップ(自動昇格の行パッチも同一ステップに含める)。
* 挿入は行スプライス(コメント・空行・他の行は不変)。
* グローバルショートカットとバーの入力欄の非干渉(フォーム入力除外の原則)。
* Escの挙動が予測可能: セッション中のEscはセッションキャンセルのみ
  (他のモードやダイアログを巻き込まない)。

## Phase開始時点の前提

* Phase 2 完了済み: 常設エディタ・カーソル行・`commitText`・補完基盤
  (アダプタ層)。
* `parameterDefinitions.ts` は Phase 3 で縮小されている可能性がある
  (ラベル・値種別・`stepLevels`・`choiceOptions` は存続保証)。Phase 3 と
  並行する場合は存続部分のみに依存すること。

## 完了条件

* 代表シナリオがキーボードのみ・最短手数で成立:
  「点Aから角度45°長さ120mmの線」= コマンド起動→基点(名前タイプ or
  クリック or Enter採用)→角度タイプ→長さタイプ→名前(Enter=候補/スキップ=
  無名)→確定。
* エディタ内で新規行タイプ時に文脈補完が機能。
* DslPanel系ファイルが削除され、旧「書き出し→適用」フローの参照が残っていない。
* `npm test` / `npm run build` / `npm run lint` 成功。

## 必須テスト

* レシピ状態機械(純粋): 各ステップ遷移・デフォルト採用・スキップ・
  キャンセル・emit行のゴールデンテスト。
* ピックルーティング: Canvasピック/キーボードピック→正しいステップへ充填。
* **選択が自動消費されないこと**の明示テスト(選択がある状態でセッション
  開始→ピックせず次入力→選択は使われない)。
* 無名要素スキップ→後のピックで自動昇格(命名+同一Undoステップ)。
* 補完コンテキスト(行頭・参照位置・属性位置・名前空間内)。
* レシピと `parameterDefinitions.ts` の整合性チェックテスト。
* 挿入位置(カーソル行・グループ内・`@stop` 前後)の行スプライス検証。

## やってはいけないこと

* 選択中要素の暗黙使用(現行の不満の根源。いかなる「便利化」でも復活させない)。
* 部分文を偽デフォルトで補完してプレビューを無理に出すこと。
* 全26要素型の専用レシピを一度に書こうとすること(点・線・曲線+汎用
  フォールバックで着地し、残りは追補)。
* インスペクタ(Phase 3 の領分)への変更。
* `pickCommands.ts` の既存パラメータ充填経路(インスペクタ経由でない
  ジャンプ編集等)を壊すこと。
