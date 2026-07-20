# 型付き変数・レキシカルスコープ・要素activity 実装計画

Status: 設計確定 / 実装未着手

## 目的

nuinuiCADの数値専用document variableを、`number`、`string`、`boolean`、`choice(...)`を扱う型付きbindingへ拡張する。新規bindingは通常のプログラミング言語に近いレキシカルスコープと`const`/`let`/`set`を使い、text合成、boolean条件、choice property参照までTS/Rust parityを保ってproductionへ接続する。

同じ計画で、現在の`visible`/`enabled`/`locked`を`visible`/`hidden`/`disabled`のactivityへ整理し、`DivisionPlacement`のstring discriminatorをtagged unionへ直す。ただし各変更は独立PRとし、型付き変数のactivationへ不要な結合を作らない。

## 不変条件

- 永続データの正は`.nui` source text。whole-file reserializationを編集経路へ追加しない。
- 既存`nui 2`文書を開く、保存するだけでは本文を変更しない。
- 既存numeric `var`の構文、評価、global/group scope、保存結果を壊さない。
- production Tauri評価はRust-first。TSはreference evaluatorとparity oracle。
- `evaluate_document(input)`のcommand名を維持し、IPCはJSON配列とplain objectだけにする。
- 文書順評価を維持し、後方参照や壊れた依存を自動reorderで隠さない。
- Inspectorの既存literal parameter操作を削除しない。typed binding情報だけをread-only表示する。
- CodeMirror APIは`src/editor/`と`SourceEditorPane.tsx`の境界外へ漏らさない。

## 現在、変数が数値専用になっている経路

1. `src/types/geometry.ts`の`VariableElement`と`ComputedVariable`が数値valueを前提にする。
2. `src/dsl/dslCallParser.ts`、`dslCompiler.ts`、`dslApplyArgs.ts`がshort `var`とmeasurement constructionをnumeric valueへloweringする。
3. `src/geometry/numericExpressions.ts`とRust `numeric_expression.rs`が`computedVariables`を`f64`として参照する。
4. Rust `variable_evaluator.rs`はexpression、pointDistance、pointAngle、pointLineDistanceをすべて数値として出力する。
5. `src/geometry/variableScope.ts`と`dslVariableCompletionCandidates.ts`がlegacy global/group scopeを前提にする。
6. `src/model/dependencies.ts`、rename analysis、completionがnumeric referenceだけを収集する。
7. `parameterDefinitions.ts`のvariable expressionは`kind: number`で、scopeをchoice parameterとして公開する。
8. serializer、round-trip golden、legacy importerがnumeric `VariableElement` shapeを保存する。
9. Source Editor value span、`Alt+←/→`、pickerはnumeric/legacy parameterを前提にする。
10. text evaluatorは`{...}`をnumeric expressionとしてだけ評価する。

## DSL version境界

### nui 2

- 現行syntaxだけをcanonical出力する。
- legacy `var`と`visible`/`enabled`/`locked`を現在どおりparseする。
- v3専用の`const`、`let`、`set`、型注釈、`state:`にはversion diagnosticを出す。
- open/saveだけでは`nui 3`へ上げない。

### nui 3

- typed declaration、`set`、`state:`を受理する。
- legacy `var`とlegacy activity flagsも互換入力として受理する。
- `state:`と`visible`/`enabled`を同じstatementに書いた場合は`element-state-conflict`。
- header upgradeは先頭の`nui 2`だけをstatement spliceで`nui 3`へ変更し、本文をbyte-for-byte維持して1 Undoにする。
- 新規文書の既定を`nui 3`へ変えるのは最終activation taskだけ。

## 型モデル

```ts
type ScalarType =
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "boolean" }
  | { kind: "choice"; options: readonly string[] };

type ScalarValue =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "choice"; value: string; options: readonly string[] };

type ScalarEvaluation =
  | { status: "ok"; type: ScalarType; value: ScalarValue }
  | { status: "error"; type: ScalarType; issueCode: string; bindingId?: string };
```

choice identityはoptionと順序の完全一致。choice literalは宣言optionsのmemberでなければならない。binding同士の代入とchoice equalityは完全一致型だけを許可する。property assignmentだけはbinding optionsがproperty optionsの部分集合なら安全な代入として許可する。runtime payloadのoptionsが宣言型と一致しない場合、Rustは拒否する。

暗黙変換は行わない。型不一致はcompile diagnosticとruntime defensive errorの両方でfail-closedにする。

## 宣言と代入

```nui
const ラベル: string = "前身頃"
let 表示する: boolean = true
const 方向: choice(right, left) = right
const ゆとり: number = 12

set 表示する = false
```

- typed declarationは明示型必須。initializerからの宣言型推論はしない。
- 同じbindingの型変更は禁止。nested scopeのshadowでは別型を許可する。
- 同一effective scopeの同名legacy var/typed bindingはduplicate diagnostic。
- `const`は`set`不可。`let`だけがtargetになれる。
- `set`の効果はその行より後だけ。initializerをversion 0、各`set`を後続versionとして扱う。
- 評価失敗versionはbindingをpoisonする。後続の正常な`set`で回復する。
- typed numberは既存numeric expressionを使える。新しいmeasurementは`distance(A, B)`、`angle(A, B)`、既存点線距離関数をtyped number initializerで使う。
- 既存pointDistance/pointAngle/pointLineDistance `var`はlegacy compatibilityとして残し、自動変換しない。

## string literalとtext template

typed stringは一重・二重quoteを受理し、serializerは二重quoteをcanonicalとする。物理改行は禁止。次のescapeを初期対応する。

- `\\`、`\"`、`\'`
- `\n`、`\r`、`\t`
- `\{`、`\}`

未知escapeはnui 3でescapeの正確なvalue spanへdiagnosticを出す。

canonical text constructionは現行registryどおり`label`である。

```nui
const ラベル: string = "前身頃"

text 注記 = label(
  text: "{@ラベル}を2枚カット"
)
```

結果は`前身頃を2枚カット`。template scannerはraw quoted sourceを見て、escaped braceとholeを区別してからstring unescapeを行う。

- 単一string binding holeはstringを挿入する。
- number bindingまたは既存numeric expression holeは現在の最大3桁formatを維持する。
- boolean/choiceは暗黙string化せず`interpolation-type-mismatch`。
- `\{`/`\}`はliteral brace。
- string連結、汎用string expression、nested holeは対象外。

## boolean expression

初期typed expressionはnumeric arithmetic、numeric comparison、`==`、`!=`、`!`、`&&`、`||`、括弧を扱う。precedenceは`!`、算術、比較、equality、`&&`、`||`の順。

stringは`==`/`!=`だけ。choice equalityは完全一致choice型だけ。string/choiceの大小比較、choice演算、string連結は追加しない。`true`/`false`はscalar expressionの予約語であり、初期choice optionには使えない。

## レキシカルスコープ

- top-levelをroot scopeとする。
- group、if then、else、forGroup bodyのすべての`{}`が別scope。
- bindingは宣言行から有効。hoistしない。
- `@name`は文書順で既に宣言済みの最内側bindingを選ぶ。
- 内側同名宣言の前は外側が見え、宣言後だけ内側がshadowする。
- initializerはpre-declaration environmentで解決する。外側同名bindingが見えれば外側を参照し、なければself-initialization。
- visibleな外側がなく同scopeの後方に宣言があればforward-reference。
- then/elseの宣言は相互にも外側にも漏れない。
- forGroup iteration bindingはbody内read-only numberで、iterationごとに再生成する。
- loop内typed declarationもiterationごとに再生成し、loop外へ漏れない。
- element local、forGroup iteration、document bindingの優先順を維持する。layoutVarはprint専用numeric namespace。
- nested `set`はvisibleな外側`let`を更新できる。
- legacy varとtyped bindingは同じdocument reference namespace。同じeffective scopeで同名ならduplicate、nested shadowは許可。
- rename probeはlegacy/typed間のcaptureも拒否し、completionで同名を重複表示しない。

今回、`@::name`、`@Group::name`、qualified set target、scope path completion/renameは追加しない。shadow後に外側同名bindingを明示参照する機能は後続。

## control flow mutation

- active if branchのouter `let`更新はif後に残る。
- inactive branchは実行しないが静的型検査する。
- forGroupはiteration間でouter `let`の値を持ち越し、最終値をloop後へ残す。
- loop local declarationはiteration終了時に破棄する。
- iteration binding、element local、layoutVar、legacy measurement varは`set`不可。
- forGroup mutationは既存generated ID、generated row、evaluation limit、enabled maskの意味を変えない。

## property対応

初期opt-in対象は次だけ。

| 型 | property | 接続責務 |
|---|---|---|
| string | `text.text` | text template runtime |
| choice | `offsetLine.side` | standard property runtime |
| boolean | `intersectionPoint.useExtensions` | standard property runtime |
| boolean | `offsetLine.closed`、`suppressTrimWarnings` | standard property runtime |
| boolean | copy/move/image `mirrorX` | standard property runtime |
| boolean | `group.printEnabled` | print-state runtime |
| boolean | `forGroup.showGenerated` | boolean control-flow runtime |

`visible`/`hidden`/`disabled`はactivityでありboolean variable propertyにはしない。name、ID、parent、color、sourcePath、placement discriminatorも対象外。`angleLengthLine`に`direction` propertyは存在しないため追加しない。

## activity model

```ts
type ElementActivity = "visible" | "hidden" | "disabled";
```

- visible: evaluateしてdrawする。
- hidden: evaluateするがdrawしない。
- disabled: evaluateもdrawもしない。
- parent disabledが最優先。parent hiddenは評価を止めず、描画だけを隠す。
- Canvasとprintはeffective draw stateを使い、dependencyはeffective evaluation stateを使う。
- v2 serializerはvisibleならflag省略、hiddenなら`visible: false`、disabledなら`enabled: false`。
- nui 3 serializerはvisibleなら`state`省略、hidden/disabledなら`state: hidden|disabled`。
- legacy `visible:false enabled:false`はdisabled。
- activity内部モデルとlegacy bridgeはnui 3より先にproduction化し、v2もそのmodelで動かす。
- `locked`は削除する。legacy inputはwarning、sourceは明示編集まで保持、再生成時には出力しない。

activity command/UIは1つのcommand domainを正とする。gutter clickはvisible→hidden→disabled→visibleをcycleし、context menu/ribbonは3状態を直接指定する。既定shortcutは置かず、旧`A`を削除して`V`へ移行しない。

## DivisionPlacement

DSLの`distance`/`ratio`は変えず、内部を次へ移す。

```ts
type DivisionPlacement =
  | { kind: "distance"; value: NumericValue }
  | { kind: "ratio"; value: NumericValue };
```

現状はboth指定をparserが診断しcompilerはdistanceを選ぶ。neitherはfactoryのratio 0.5。legacy v1もdistance優先。serializerはactive側だけ、dragはactive側だけ更新、duplicate/forGroup cloneは全field copy、IPCはJSONをそのまま渡し、Rustは`distance`以外をratio扱いする。characterization fixtureでこれを固定してから、compiler/factory/serializer/evaluator/drag/import/clone/IPCを1回のunion migrationで切り替える。

## binding resolutionと評価データ

TS compilerはsource nameをstable binding IDへ解決し、Rustへ名前を再解決させない。

```ts
type ScalarProgramStatement =
  | { kind: "declare"; bindingId: string; scopeId: string; sourceOrder: number; declaration: TypedDeclaration }
  | { kind: "set"; targetBindingId: string; sourceOrder: number; expression: TypedExpression };
```

geometry elementsは従来の`elements`配列に残す。typed declarationとsetをfake geometry elementにはしない。evaluation inputへJSON-friendlyなscalar programを追加し、statement ID/source span indexはTS側analysisに保持する。

binding解析はconst評価より先に完成させる。scope index、stable ID、shadow/order、legacy collision、undefined/forward/self、initializer graph、SCC cycle、exact spansをbinding coreが担当する。const evaluatorは解決済み結果だけを使う。

## TS/Rust責務

### TypeScript

- DSL scanner/parser、raw string/template span
- scope indexとbinding resolution
- typed expression ASTとtypecheck
- initializer graph/SCC、dependency、rename safety
- completion、Quick Fix、Inspector analysis、Source Editor metadata
- reference evaluatorとparity payload生成

### Rust

- serialized typed ASTの防御的validation
- production const/let/set/condition/loop/property/template評価
- choice payload identity/member検証
- typed issue codeとbinding/statement/element ID返却

TS adapterはRust issue IDをsource spanへ再結合する。Rustでsource文字列のname resolutionを再実装しない。

## diagnostics

最低限、次のstable codeを定義する。

- `typed-syntax-requires-nui3`
- `invalid-string-escape`、`unterminated-string`、`physical-newline-in-string`
- `invalid-choice-type`、`invalid-choice-literal`、`choice-set-mismatch`
- `duplicate-binding`、`undefined-binding`、`forward-binding-reference`
- `self-initialization`、`binding-cycle`
- `const-assignment`、`invalid-set-target`
- `scalar-type-mismatch`、`property-type-mismatch`
- `invalid-runtime-binding-payload`、`poisoned-binding`
- `unterminated-interpolation`、`interpolation-type-mismatch`
- `element-state-conflict`、`legacy-locked-ignored`

diagnosticは対象tokenのexact span、expected/actual type、binding名とID、property名、依存先を可能な限り持つ。invalid bindingは通常value completionから除外するが、invalid `let`は回復用set target候補には残す。

## serializerとround-trip

- serializer APIはmajor versionを必須入力にし、v2/v3を暗黙推測しない。
- typed declarationは明示型とmutabilityを必ず出力する。
- stringはdouble quoteと定義済みescapeへcanonicalizeする。
- setは`set <name> = <expression>`へcanonicalizeする。
- source open/saveはnormalizeしない。command/Canvas/Source Editor操作で対象statementを再生成したときだけcanonical化する。
- header upgradeは本文serializerを呼ばない。
- legacy JSON importerとv1 importerは互換上`nui 2`を出力し続ける。
- 新規文書だけ最終activation後に`nui 3`。

## UI

- Inspector declaration sectionはkind、declared type、raw initializer、binding IDをread-only表示する。
- runtime sectionは全set/if/forGroup後のfinal value、poison、recovery、propertyの`@variable`参照を表示する。
- runtime Inspector taskはforGroup mutation完了後にだけ着手する。
- typed reference completionは最内側の有効bindingを1件だけ提示し、invalid bindingを除外する。
- set completionはvisibleなletとinvalid let recovery targetだけを提示する。
- choice completion/cycle順はdeclared/property metadata順。
- `Alt+←/→`はnumericを維持し、boolean literalをtoggle、choice literalをcycleする。stringとbinding reference全体はstep対象外。
- Canvas pickerはgeometry referenceだけに維持し、typed scalar bindingをCanvasで選ばせない。

## performance規約

baseline taskは同構造の250/1000要素fixtureを作る。既存`statementReconciler.performance.test.ts`規約に合わせ、worker CPU time、100 warm-up、21 trials、trial内複数run、median/p95、250→1000 scaling ratioを記録する。

測定を次に分離する。

1. binding analysis
2. TS reference evaluation
3. Rust production evaluation
4. forGroup mutation

| target | size | warm-up / trials | metric | initial gate |
|---|---|---|---|---|
| binding analysis | 250 / 1000 statements | 100 warm-up、21 trials、20 runs/trial | worker CPU median/p95 | finite、1000件5秒未満、250→1000 median比8倍未満 |
| TS reference evaluation | 250 / 1000 elements+bindings | 20 warm-up、21 trials、5 runs/trial | worker CPU median/p95 | finite、1000件5秒未満、scaling比8倍未満 |
| Rust production evaluation | 250 / 1000 payload | 5 warm-up、21 trials | wall-time median/p95 | ignored benchmarkで記録、通常CI gateにしない |
| forGroup mutation | 250 / 1000 generated rows | TSは20 warm-up/21 trials/5 runs、Rustは5 warm-up/21 trials | TS CPU、Rust wall time | TSはfinite/5秒/scaling 8倍、Rustは記録専用 |

既存測定がない領域の絶対閾値はbaseline実測前に発明しない。baseline PRは記録専用とし、実測値と既存CI変動から後続performance taskでgate値を決める。倍率gateは250→1000で既存reconcilerの8倍上限を暫定安全柵として記録するが、typed-variable gate採用はbaseline結果を根拠にする。Rust benchmarkは既存ignored `bench:evaluation`方式でwall timeを記録し、通常CI gateとは分ける。

## ファイル構成方針

新責務を既存巨大ファイルへ追加しない。

- TSは`src/scalars/`へtypes、literal scanner、AST、scope index、resolution、typecheck、program、templateを分離する。
- Rustは`src-tauri/src/evaluation/scalars/`へtypes、payload validation、expression、bindings、mutation、templateを分離する。
- `geometry.ts`、`dslCompiler.ts`、`numericExpressions.ts`、Rust `numeric_expression.rs`、`sourceEditorController.ts`、`parameterDefinitions.ts`はadapter/既存互換変更に限定する。
- 新規sourceは原則300行未満。400行超はPR説明に理由、600行超の既存fileへ新責務を足さない。

## 今回含めない機能

- string concatenationと一般的template expression
- boolean/choiceのstring化
- string/choiceの大小比較、choice演算
- qualified scope reference/set/completion/rename
- shadow後の外側同名bindingへの明示access
- choice optionとしての`true`/`false`
- activityへのvariable binding
- identity/control外propertyの無制限なvariable化
- `angleLengthLine.direction`追加
- generic constraint solver

## 品質gate

各実装PRは`npm test`、`npm run build`、`npm run lint`を通す。Rust/評価変更では`npm run test:parity`、`cargo fmt --check`、`cargo test`、`cargo clippy --all-targets -- -D warnings`を追加する。Tauri command/payload/production Rust評価の変更では`npm run desktop:build`も実行する。

最終activation条件とタスク依存は[README.md](README.md)、判断根拠は[decisions.md](decisions.md)を正とする。
