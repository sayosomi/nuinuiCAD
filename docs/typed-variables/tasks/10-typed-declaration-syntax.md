# 10: Typed const/let declaration syntax / serializer

## 1. タイトル

10: Typed const/let declaration syntax / serializer

## 2. 目的

nui3のconst/let、型注釈、initializer、choice options、declaration spansとserializerを実装する。

## 3. 依存タスク

06, 09

## 4. 前提API・型

`DslTypedDeclarationStatement`、name/type/initializer spans、`serializeTypedDeclaration`。

## 5. 対象

line parser、explicit type grammar、initializer raw span、stable statement identity連携、declaration-only completion context metadata、canonical serializer。

## 6. 対象外

set syntax、name resolution、expression typecheck/evaluation。

## 7. 固定仕様

明示型必須。choice optionsはordered bare tokens、空/duplicate/true/falseは禁止。set parserを一切実装しない。

## 8. 実装方針

既存parser facadeへv3-only statement kindを追加し、initializer内容はraw spanとして14へ渡す。

## 9. 変更対象ファイル

DSL statement types/parser/serializer/reconciler identity tests、新規focused declaration parser。

## 10. 追加・更新するテスト

const/let全型、missing type/init、choice validation、vertical周辺行、comments、spans、v2 version error、round-trip。

## 11. 互換性条件

legacy var parser/serializerは変更しない。open/save無変更。

## 12. performance条件

1 statement parseはlength線形。1000 declaration parse sanityは00 helperを利用。

## 13. 完了条件

parse/serializeだけで完結し、set文字列をunknown statementとして扱う。

## 14. 次タスクへの引き継ぎ

11はscope node、14はinitializer AST、19はcompiled programへ接続する。

## 15. PR境界

declaration syntax/serializerだけ。推奨branch slug: `typed-vars/10-declaration-syntax`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
