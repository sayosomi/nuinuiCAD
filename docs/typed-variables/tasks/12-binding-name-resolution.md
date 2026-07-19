# 12: Binding name resolution / legacy collision

## 1. タイトル

12: Binding name resolution / legacy collision

## 2. 目的

通常の`@name`を最内側かつ宣言済みbinding IDへ一意解決する。

## 3. 依存タスク

11

## 4. 前提API・型

`BindingCatalog`、`resolveBindingReference`、resolution result with resolved/undefined/forward/self/duplicate、visible binding query。

## 5. 対象

typed/legacy同namespace、effective scope duplicate、shadow、pre-declaration initializer、element local/iteration precedence adapter。

## 6. 対象外

initializer SCC、typecheck、set version、qualified reference。

## 7. 固定仕様

typed優先fallbackなし。inner initializerはvisible outerがあればouter、なければself。same effective scope collisionはduplicate。

## 8. 実装方針

11 index上にname bucket/order indexを構築し、legacy global/group visibilityをadapterで参加させる。

## 9. 変更対象ファイル

新規binding catalog/resolution modules、legacy variable adapter、focused tests。

## 10. 追加・更新するテスト

before/after shadow、duplicate legacy/typed、nested shadow、outer initializer/self、forward、then/else、loop/local precedence。

## 11. 互換性条件

legacy global/group visibilityを現行`variableIsInScope` fixtureと一致させる。

## 12. performance条件

lookupをprecomputed map/ancestor chainで行い、参照ごとの全document逆走査を禁止。

## 13. 完了条件

全referenceがstable IDかtyped failureへ解決し、ambiguous優先順位がない。

## 14. 次タスクへの引き継ぎ

13/15/26/29/39がresolution resultを利用する。

## 15. PR境界

name resolutionだけ。推奨branch slug: `typed-vars/12-binding-resolution`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
