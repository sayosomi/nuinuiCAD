# 13R-5: Legacy visibility lookup linearization

## 目的

compact legacy visibility descriptorを維持したまま、group subtree内の
referenceがroot `outsideGroups` bucketを走査して捨てる`O(B×R)`経路を除く。

## Lookup namespace

- `global`はnameごとのglobal laneへ一度だけ登録し、全scopeがroot lexical
  levelで参照する。scope数分の複製はしない。
- `outsideGroups`はnameごとのroot/outside laneへ一度だけ登録する。rootまたは
  `effectiveGroupScopeId === null`のscopeだけがこのlaneを選択し、group/nested
  group lookupへは登録しない。
- group-scoped legacyとiterationは`rootScopeId → name`のscoped-static laneへ
  登録し、対象scope entryでのみactiveにする。siblingsは同じlaneを共有しない。
- typed lexical bindingは既存どおり宣言後にtyped laneへ、element-localは既存の
  owner namespaceへ入る。document/iteration duplicate判定は引き続き
  `(effectiveScopeId, name)`であり、lookup laneはこれを置換しない。

各lane bucketはcatalog rank順である。同じlexical levelの全対象laneの候補数が1件の
ときだけ`resolved`とする。複数ならlane内だけの場合も`duplicate`で全候補を返し、
複数laneならbucket全体をcatalog rankのlinear mergeで統合する。内側levelに候補が
あれば外側levelのlaneは走査しない。比較sortは使わない。

## 計算量と観測

scope/index準備を含むproduction-equivalent pipelineは
`O(N + S + B + R + E)`である。`E`は実際に返すduplicate/forward candidate数であり、
candidateとして走査したbindingは必ずresolved/duplicate/forward出力に含まれる。
不可視またはshadow済みcandidateを`E`として読み捨てない。

test-only batch traceは同一canonical batch resolverを観測するだけで、production
public surfaceを増やさない。registration数、request数、visibility kindごとのemitted
candidate visitを記録し、group requestが`outsideGroups` candidateを0件走査することを
固定する。単発resolverやcompatibility shimは追加しない。

## 検証

- root/outside-groups、global、group-subtree、iterationのscope matrixと
  `variableIsInScope` parity。
- lane内duplicate、lane間catalog-rank merge、typed/local precedence、outer
  fallback/self/shadow、duplicate namespace、cycle/forward/invalid-dependency/
  eligibility、shuffle決定性。
- rootに同名outside-groups bindingを多数、groupに同名referenceを多数置く構造test。
  group lookupのoutside visitが0で、workがregistration `B` + request `R` + output `E`
  に比例すること。
- Task 00の250/1000 mixed fixtureはadapter、catalog、batch resolution、analysis、
  program eligibilityを一括で測り、root/outside、global、group-subtree、iteration、
  typed、root/group/nested/sibling referenceと少数のoutput-sensitive caseを含む。

## 対象外

parser、evaluator、property、set、rename、DSL diagnostics pipeline、stable scope/binding
ID、Task 13R-2 direct status/eligibility意味論、Task 13R-4 owner validationとforward
candidate orderは変更しない。
