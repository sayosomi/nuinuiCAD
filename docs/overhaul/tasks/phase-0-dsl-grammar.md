# Phase 0: 文書完全表現のDSL文法(挙動変更なし)

> **Superseded:** この文書は旧DSL計画の履歴です。現行の `nui 2` 仕様と移行状況は
> `docs/dsl2/` を参照してください。ここにある「全26要素型」の記述は古く、現行は27要素型です。

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

## 目的

DSLの文法・パーサ・シリアライザ・コンパイラを拡張し、CAD文書の100%
(要素・パレット・表示ロール/プロファイル・印刷レイアウト・評価リミット)を
テキストで無損失に表現できるようにする。保存形式はまだJSONのまま。
アプリのユーザー可視挙動は一切変えない。

## 変更対象

* `src/dsl/dslParser.ts` — ブレースブロック、`if/else`/`for`、無名文、
  新文(`nui` / `color` / `@stop` / `activePrintLayout` / printLayoutブロック)、
  属性トークンスパン
* `src/dsl/dslTypes.ts` — 文型の拡張。`DslAttribute` を
  `{key, value, valueStart, valueEnd}` に拡張(後続Phaseのカーソルジャンプ用)
* `src/dsl/dslSerializer.ts` — 文書全体シリアライザ(ネスト+2スペース
  インデント、パレット、完全な印刷レイアウト、無名要素の出力、
  `includeIds: false` 経路の堅牢化)
* `src/dsl/dslCompiler.ts` — ブロック→`parentGroupId`/`conditionalBranch` 付与、
  パレット/レイアウト/評価リミットの組み立て、同名要素のパーサ診断化
* `src/dsl/dslHighlight.ts`, `src/dsl/dslTokens.ts` — ブレース・新キーワード
* 新規 `src/dsl/dslDocument.ts` — 文書全体の serialize / parse ファサード
  (`CompiledDocument` 相当の形を返す)

## 文法仕様

* 先頭非空行は `nui 1`(バージョン指令)。未知メジャーバージョンは明確な
  診断で拒否。
* グループ: `group 前身頃 roles=[外周] { ... }`。インデントは見た目のみで
  意味を持たない。パーサは2パス(行パース+ブロックスタック)。
* 条件: `if 名前? condition=式 { ... } else { ... }`。`} else {` は1構造行。
  `for 名前 i start=0 count=5 step=1 { ... }`。既存の
  `conditionalGroup` / `forGroup` 要素型にコンパイルする。
* `parent=` / `branch=` 属性: パースは受理し**非推奨診断(warning)**を出す。
  シリアライザは出力しない。削除はPhase 5。
* **無名文**: 要素キーワードの直後が `=` / `{` / 属性(`k=v`)なら無名
  (`element.name = ""`)。無名要素は名前参照不可。表示ラベルは既存の
  fallback名生成で合成し、テキストには書き戻さない。
* 同名要素はパーサ診断(error: 同名要素)。黙ってリネームしない。
* 新文:
  * `color <id> "#rrggbb" name="本体" [default]` — `PaletteColor` 1行ずつ。
    `default` フラグが `defaultColorId` を代替。
  * `printLayout <名前> output=pdf view=完成 paper=a4 orientation=portrait
    columns=2 rows=3 overlap=10 scale=1 { place <グループ名> at=(x,y) angle=0
    mirrorX=false / layoutVar n=式 }` — 完全な `PrintLayout`。placement の
    永続IDは廃止(パース時再生成)。
  * `activePrintLayout <名前>`(`activeView` と対称)。
  * `@stop` — 評価リミット位置のマーカー行。最大1つ。無し=全評価。
* 永続化から**削除**するもの: `numericParameterSteps`(アプリ設定へ移動、
  本Phaseでは単に出力しない)、選択状態、`printLayout` ミラー、`savedAt`
  (シリアライザが出すコメント行に含めてもよい)。

## 守るべき不変条件

* 1文=1行の行指向を維持(ブロックの開き行・メンバー行・閉じ行もそれぞれ1行)。
  後続Phaseの「行単位外科的パッチ」がこれに依存する。
* 決定論・文書順評価・明示的依存エラー(AGENTS.md)。パースやコンパイルで
  要素を自動並べ替え・自動修復しない。
* 既存のDSLパネルワークフロー(書き出し→編集→適用)は従来どおり動くこと。
* mm単位・Y-up。座標値の変換を入れない。
* Rust側(`src-tauri/`)には触れない。

## Phase開始時点の前提

* 先行Phaseなし。main の現状から開始。
* 現行DSLの挙動リファレンス: `src/dsl/dslCompiler.test.ts` と `docs/dsl.md`。

## 完了条件

* `dslDocument.ts` 経由で、任意の `CadDocumentSnapshot` 相当データ(選択等の
  UI状態を除く)を DSL テキストへシリアライズし、パース+コンパイルで意味的に
  等価なデータへ戻せる。
* 属性・名前・ペイロードのトークンスパンが全文型で記録される。
* 既存テストが全て通る(`npm test`)。`npm run build` / `npm run lint` 成功。
* アプリの挙動・保存形式は無変更(DSLパネルの入出力に新構文が現れるのは可)。

## 必須テスト

* **ラウンドトリップ行列**: 全26要素型 × 参照形式(ID参照/派生アンカー/
  座標リテラル/式)で `parse(serialize(model)) ≡ model`(ID無視の意味的等価)。
* **冪等性**: シリアライザ産テキストに対し `serialize(parse(text))` がバイト一致。
* ブロックネスト(group入れ子・if/else・for)、無名要素、
  palette / printLayout / `@stop` / `activePrintLayout` のラウンドトリップ。
* `parent=` 受理+非推奨診断、同名要素エラー、未知バージョン拒否。
* サンプル文書のゴールデンファイルテスト。
* 式の名前⇄ID正規化(`normalizeNumericExpressionInput` 系)の非対称がないこと。

## やってはいけないこと

* 保存形式(JSON)・ストア・UIコンポーネント・コマンドに触れること。
* インデントに構文的意味を持たせること。
* 同名要素やdangling参照の「自動修復」(リネーム・削除・並べ替え)。
* Rustコードの変更。
* 既存 `serializeElementsToDsl` の選択書き出し用途(DSLパネル)を壊すこと。
