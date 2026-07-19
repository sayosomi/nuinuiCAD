# 39: Typed declaration/property/template completion

## 1. タイトル

39: Typed declaration/property/template completion

## 2. 目的

typed contextsで有効binding/literal/operator/choice候補をmetadata-drivenに提示する。

## 3. 依存タスク

12, 15, 22, 26

## 4. 前提API・型

plain completion context/candidate types、binding catalog projection。CodeMirror adapterは既存editor boundary。

## 5. 対象

declaration initializer、property value、template hole、boolean/string/number/choice候補、shadow/invalid filtering。

## 6. 対象外

set target/recovery completion、Quick Fix、scope path。

## 7. 固定仕様

最内側resolved nameを1候補。same name重複なし。invalid binding除外。choice orderはdeclared/property metadata順。

## 8. 実装方針

pure candidate modulesを`src/dsl/`/`src/scalars/`へ置き、cmAutocompleteはcontext mappingだけ。

## 9. 変更対象ファイル

completion context/candidate modules、CodeMirror adapter/tests。

## 10. 追加・更新するテスト

全type/context、legacy/typed collision、shadow、forward/invalid exclusion、choice subset/order、dirty live buffer。

## 11. 互換性条件

existing numeric/geometry completionを維持。qualified候補を出さない。

## 12. performance条件

precomputed catalogを使い1000 bindings completion CPUを記録。key pressごとのcompile禁止。

## 13. 完了条件

value/property/template completionがlive sourceに追随し、set候補はまだ追加しない。

## 14. 次タスクへの引き継ぎ

40 set completion、44 value operations、50 perfへ引き継ぐ。

## 15. PR境界

typed value completionだけ。推奨branch slug: `typed-vars/39-value-completion`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
