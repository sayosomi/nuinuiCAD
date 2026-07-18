# F3: docs・性能・残骸削除

種別: 後続 / 依存: C1, F1

## 目的

文書を v2 仕様に揃え、性能を確認し、切替の残骸を掃除して移行本体を完了させる。

## 対象範囲

- `docs/dsl.md` — v2 文法へ全面改訂([plan.md](../plan.md) 確定仕様 1〜2 を
  ユーザー向けに書き直す。基本ルール・要素構文・コンテナ・設定文・コメント規則・
  無名要素・rename 仕様・v1 からの変換)。
- `docs/overhaul/tasks/phase-0-dsl-grammar.md` — 冒頭に superseded 注記
  (本計画 `docs/dsl2/` へ誘導)を 1 段落だけ追加(内容は書き換えない)。
  記載の「全 26 要素型」が stale(実際は 27)である旨も注記に含める。
- 性能 sanity テスト — 1,000 要素(≈8,000 行)文書で `compileDslDocument` +
  全 serialize + 単一 statement `buildTextPatch` が緩い上限内(既存
  `*Cost.test.ts` パターン。実測は `--disable-console-intercept` 付きで確認)。
- 残骸削除 — live コードに残る v1 受理・出力の残骸を grep で棚卸しして削除
  (`dslPrintLayoutAttributes.ts` の別名キー定数、未使用 export、W2 の暫定
  アダプタ痕跡、C1 で消し損ねた分岐)。
- `AGENTS.md` は方針変更がないため原則据え置き(DSL 表層の記述があれば最小修正)。

## 対象外

- `src/document/legacyDsl/` の削除(F4)。`sample.v1.nui` の削除(F4)。
  新機能・仕様変更。

## 実装要点

- docs/dsl.md は「現行ソースの真実」から書く(plan.md の仕様と食い違う実装が
  あれば docs を実装に合わせず、まず不一致として引き継ぎ欄へ記録し判断を仰ぐ)。
- 1,000 要素文書はテスト内で生成する(fixture 化しない)。上限は CI 揺れに耐える
  緩い値にし、実測値はログで読める形にする。

## テスト

- 性能 sanity テスト自体。既存全テスト green(削除による回帰なし)。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。
- `docs/dsl.md` が v2 のみを記述(v1 記述は「変換」節のみ)。
- v1 残骸 grep(`key=value` parse・`->` 糖衣・`element type=`・バックスラッシュ
  継続)が live コードでゼロ(`legacyDsl/` を除く)。

## 次タスクへの引き継ぎ

- F4 へ: 削除できなかった残骸があれば理由付きで列挙。

### 実施内容

- `docs/dsl.md` を `nui 2` 専用の利用ガイドへ更新し、縦型call、container、設定文、
  common args、安全なrename、v1 open時変換を記載した。F2補完については
  keyword → construction → 引数名 → 値の4階層、for位置引数の入力中抑制、
  排他的引数の候補除外を明記した。
- common args は利用者向けの `locked` / `visible` / `enabled` / `color` / `steps` /
  `vars` だけを補完する。`id` / `varIds` / `parent` / `branch` は互換・フラット化用に
  受理を維持するが候補には出さない。
- 1,000要素・8,001物理行をテスト内で生成し、初期化とfixture生成を計測外にして
  warm-up後3回中央値を測定した。実測は compile 230.87ms、全serialize 3.28ms、
  単一要素 `buildTextPatch` 4.73ms。各5秒上限は極端な退行検出専用で、
  環境非依存の性能保証ではない。
- v1残骸は文字列検索だけで判断せず、live parserの category/settings dispatch、
  v2 serializer、text patchの呼び出し経路を確認した。旧構文を受理するparserは
  `nui 1` open時の `legacyV1Import` からだけ到達し、live v2 parserは旧arrow・
  `element type=`・`key=value` を診断する。live出力に旧形式の分岐はなかったため、
  到達可能コードの削除は不要だった。古いv1表記を含むliveコメントは更新した。

### F4へ

- `src/document/legacyDsl/` とv1 importは、既存 `nui 1` を開くための明示的な
  一回変換経路として残る。live v2 parser/compiler/serializerへv1受理を戻さないこと。
