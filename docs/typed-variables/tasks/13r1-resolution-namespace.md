# 13R-1: Binding resolution / namespace correction

## 目的

Task 11〜13の統合reviewで判明した、pre-declaration outer fallbackとelement-local
duplicate namespaceの2件を修正する。

## 変更契約

- 同scopeのfuture typed declarationはforward候補として保持するがancestor探索を止めない。
  ancestorにvisible bindingがあればresolvedし、visible bindingがなければ最も内側の
  future候補だけをforwardとして返す。
- declaration後はinner bindingがouterをshadowする。typed initializerの同名self判定は、
  visible outerがあればresolved、なければselfのまま維持する。
- document/iteration namespaceのduplicate単位は`(effectiveScopeId, name)`、element local
  namespaceのduplicate単位は`(ownerId, name)`である。
- site ownerに可視な同名element localが複数ある場合は全候補IDの`duplicate`を返し、
  document/iteration bindingへfallbackしない。異owner localはsite ownerの候補ではない。
- `bindingAnalysis`はcatalogの`declarationDuplicateBuckets`だけを使い、duplicate namespaceを
  再判定しない。

## 対象外

Task 13R-2のinvalid dependency伝播、Task 13R-3の性能線形化、production evaluator、
expression parser、property、set、renameは変更しない。

## 検証

- pre-declaration outer fallback、post-declaration shadow、outer不在forward、initializer
  outer/self境界を固定する。
- same-owner local duplicateとそのdocument/iteration fallback禁止、異owner localのsite-owner
  分離、local対document/iterationのduplicate非発行を固定する。
- Task 12/13のcycle、diagnostic、決定的順序を回帰する。
