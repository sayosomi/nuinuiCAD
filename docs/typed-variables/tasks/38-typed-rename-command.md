# 38: Typed binding propagated rename command

## 1. タイトル

38: Typed binding propagated rename command

## 2. 目的

safe analysis結果をstatement-level text splicesとして1 Undoで適用するcommandを実装する。

## 3. 依存タスク

37

## 4. 前提API・型

`renameTypedBindingWithPropagation(bindingId,newName)` command; editor-independent splice plan。

## 5. 対象

flush、analysis、declaration/reference/set/template/property patches、selection/focus restoration、Undo。

## 6. 対象外

rename form UIの再設計、qualified path rename、direct typing propagation。

## 7. 固定仕様

Source Editor flush失敗/IME中は中止。analysis reject時はsource無変更。affected span以外を触らない。

## 8. 実装方針

existing element rename command boundaryを再利用し、37のaffected exact spansからdescending splice listを作る。

## 9. 変更対象ファイル

commands rename definitions/bridge、source edit session adapter、command tests。

## 10. 追加・更新するテスト

all reference contexts、comments/layout preservation、1 Undo、collision rejection、flush blocked、selection/focus。

## 11. 互換性条件

existing element F2 rename chord/command挙動維持。新default shortcut不要。

## 12. performance条件

affected refsに比例。whole-file serialize禁止。

## 13. 完了条件

safe typed renameがcommand entryから完走し、unsafe caseはatomic no-op。

## 14. 次タスクへの引き継ぎ

48 diagnostics E2E/51 manual E2Eで確認する。

## 15. PR境界

typed rename commandだけ。推奨branch slug: `typed-vars/38-rename-command`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
