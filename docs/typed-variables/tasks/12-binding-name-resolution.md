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

実装済みAPI（いずれもproduction未接続のpure analysis）:

```ts
// src/scalars/bindingCatalog.ts
type BindingCatalog;
type Binding;
type BindingSeed; // legacy / iteration / elementLocal adapter input
type BindingId = string;
const buildBindingCatalog: (input: BuildBindingCatalogInput) => BindingCatalog;

// src/scalars/bindingResolution.ts
type BindingReferenceSite;
type BindingResolution =
  | { kind: "resolved"; binding: Binding }
  | { kind: "undefined"; name; scopeId; statementIndex }
  | { kind: "forward"; name; scopeId; statementIndex; bindingIds }
  | { kind: "self"; name; scopeId; statementIndex; bindingId }
  | { kind: "duplicate"; name; scopeId; statementIndex; bindingIds };
const resolveBindingReference: (catalog, name, site) => BindingResolution;
const visibleBindingsAt: (catalog, site) => readonly Binding[];

// src/dsl/bindingCatalogAdapter.ts
const buildDslBindingAdapterSeeds: (input) => {
  legacyBindings: readonly BindingSeed[];
  iterationBindings: readonly BindingSeed[];
};
```

**binding ID規則**: typed declarationとlegacy `var`は、各statement indexに
callerが注入した実stable statement identityから`binding:<identity>`を作る。
forGroup iterationは同じfor opener identityから`binding:iteration:<identity>`を
作る。element localはadapterがowner/localの実stable identityに基づく完成済みIDを
`BindingSeed.id`として渡す。catalogはstatement index、source内容、name、走査順
counterからproduction IDを合成しない。typed/legacy/forGroupのidentityが欠ける場合は
throwする。現在のdocument reconciliationはtyped declaration用identityをまだ供給しない
ため、このtaskはそのIDを捏造せず、将来のdocument adapterが全binding ownerのmappingを
渡す契約に留める。

**visibilityとorder**: catalogはdocument/iteration用effective-scope/name bucket、scope
chain、element local owner/name bucketを事前構築する。通常の`@name`はlocal、現在の
lexical scope、ancestor scopeの順に照会する。同scopeのfuture typed declarationは最も
内側の候補として保持するが、ancestor探索を止めない。ancestorにvisible bindingがあれば
それを返し、どこにもvisible bindingがない場合だけ保持したfuture候補を`forward`として
返す。typedだけが宣言位置以降のorder ruleを持つ。legacyはadapterが
`variableIsInScope`互換として渡すscope set、iteration/element localはadapter指定の
scope/rangeで可視性を決め、全bindingへ一律の「参照より前」制限は掛けない。可視element
localはiteration、document bindingより優先し、同一ownerの可視localが複数なら全候補を
持つ`duplicate`を返してdocument/iterationへfallbackしない。

**initializer**: `initializerBindingId`を指定したtyped declaration自身のinitializerで
同名を解決する場合は、現在effective scopeを飛ばしてvisible outerを探す。outerが
`resolved`ならそれを返し、なければ`self`を返す。通常参照のforward/duplicate規則を
selfへ置き換えない。

**duplicate**: document/iteration namespaceでは同一effective scopeかつ同名の
typed/legacy/iterationが`duplicate`であり、typed優先・legacy文書順fallbackは存在しない。
element local namespaceでは同一ownerかつ同名だけが`duplicate`であり、ownerの異なるlocalや
local対document/iterationの同名はduplicateではない。Task 13はcatalogが公開する
`declarationDuplicateBuckets`を使ってdiagnostic/statusを作る。

**legacy adapter**: Task 11の`legacyVariablesByScope`と既parse `DslStatement.attrs`だけを
使い、sourceを再parse/re-scanしない。short `var`に加えlong-form
`var ... = expression(... scope: group)`もTask 11 recordとして収集する。globalは全scope、
groupはnearest lexical groupとその子孫（group外ならCAD parentGroupIdなしのscope群）へ
変換し、既存`variableIsInScope` fixtureを正とする。

13は`BindingResolution`をinitializer graph/SCC/diagnosticへ、15は`resolved.binding.id`
をtyped ASTへ、26はtemplate holeへ、29はset target解析へ、39は`visibleBindingsAt`へ
利用する。いずれも名前、scope、orderを再解釈したり全documentを逆走査しない。

## 15. PR境界

name resolutionだけ。推奨branch slug: `typed-vars/12-binding-resolution`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
