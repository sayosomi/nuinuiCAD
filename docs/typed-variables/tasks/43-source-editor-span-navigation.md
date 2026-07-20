# 43: Source Editor typed span / navigation API

## 1. タイトル

43: Source Editor typed span / navigation API

## 2. 目的

declaration/set/property/templateのplain source spansとjump/select APIをSource Editor境界へ接続する。

## 3. 依存タスク

10, 22, 26, 29

## 4. 前提API・型

typed value/name/type/target/RHS/hole span index、statement ID→range、editor handle jump method。

## 5. 対象

click/Inspector jump、Tab/value navigation order、multiline construction text property、dirty source。

## 6. 対象外

Alt value mutation、completion、rename analysis、Canvas picker。

## 7. 固定仕様

CodeMirror typesはeditor外へ出さない。exact value spanを使い、statement全体replaceを値操作APIにしない。

## 8. 実装方針

parser/compiler analysisからplain offset indexを作り、SourceEditorControllerはindex→CodeMirror selectionだけ担当する。

## 9. 変更対象ファイル

DSL/scalar span index、editor handle/controller adapter、navigation tests。

## 10. 追加・更新するテスト

全typed syntax、escaped string/hole、set target/RHS、vertical label、comments、dirty invalid source、selection positions。

## 11. 互換性条件

existing numeric/reference value spanとTab orderを維持。

## 12. performance条件

compile時index構築。navigationごとのsource再parse禁止。

## 13. 完了条件

38/44/42がplain span APIだけでjump/patchできる。

## 14. 次タスクへの引き継ぎ

38 rename command、44 value ops、45 Inspector runtime jumpへ引き継ぐ。

## 15. PR境界

span/navigationだけ。推奨branch slug: `typed-vars/43-source-spans`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
