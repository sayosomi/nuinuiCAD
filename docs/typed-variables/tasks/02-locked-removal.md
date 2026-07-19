# 02: Obsolete locked behavior removal

## 1. タイトル

02: Obsolete locked behavior removal

## 2. 目的

source-authoritative DSLで不要なlocked state、enforcement、UI、commandsを削除する。

## 3. 依存タスク

00

## 4. 前提API・型

legacy parserは`locked`を認識して`legacy-locked-ignored` warningを返す。runtime modelにはlockedを残さない。

## 5. 対象

type/factory/normalization、lock helpers、destructive command guards、parameter definition、gutter/menu/ribbon/shortcut、serializerを整理する。

## 6. 対象外

activity 3-state実装、他のdestructive command semantics変更。

## 7. 固定仕様

open時はsource textを保持。再生成statementではlockedを出力しない。lockにより拒否されていたoperationは通常実行可能になる。

## 8. 実装方針

先にwarning/compat parserを置き、参照を`rg`で全列挙してproduction enforcementを削除する。

## 9. 変更対象ファイル

geometry/factory/parameter、`elementLocks.ts`とcallers、selection commands、editor state rail、serializer、shortcut metadata。

## 10. 追加・更新するテスト

legacy locked parse warning、open/save無変更、statement regenerationでdrop、delete/move/renameがlockで拒否されない、shortcut registry整合。

## 11. 互換性条件

legacy sourceは読めるが意味は無視。保存だけでは削除しない。

## 12. performance条件

lock ancestor走査削除により悪化不可。専用benchmark不要。

## 13. 完了条件

production sourceにlockedによる分岐がなく、legacy warningとsource preservation testがgreen。

## 14. 次タスクへの引き継ぎ

03はlocked actionのない3-state UIを構築する。

## 15. PR境界

locked removalだけ。推奨branch slug: `typed-vars/02-locked-removal`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
