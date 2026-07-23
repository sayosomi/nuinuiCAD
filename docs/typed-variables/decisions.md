# 型付き変数計画 Decision Log

Status: 確定 / Open blocking decisionなし

## D01: 新規bindingは明示型

`const`/`let`は`: number|string|boolean|choice(...)`を必須とする。initializer型推論だけの宣言は追加しない。同一bindingの型変更は不可、nested shadowでは別型を許可する。

根拠: property metadataとRust payloadをcompile時に確定でき、暗黙変換を排除できる。

## D02: mutabilityはconst/let、変更はset

`const`は再代入不可、`let`だけが`set`対象。setは文書順で後続だけに効く。失敗versionはpoisonし、後続の正常setで回復する。

ifのactive branch更新は後続へ残り、forGroupはiteration間で持ち越して最終値をloop後へ残す。

## D03: 全brace blockがlexical scope

group、then、else、forGroup bodyは別scope。宣言は宣言行から有効でhoistしない。inner declarationの前はouterが見え、後だけshadowする。

initializerはpre-declaration environmentで解決する。

- outer同名bindingが見える: outerを参照。
- outerがない: self-initialization diagnostic。
- 同scope後方に別宣言がある: forward-reference。

## D04: qualified scope pathは初期対象外

`@::name`、`@Group::name`、qualified set、scope path completion/renameは追加しない。`@name`は既に宣言済みの最内側bindingだけを解決する。shadow後にouter同名bindingへ明示accessする機能は後続。

## D05: legacy varとtyped bindingは同じnamespace

同じeffective scopeの同名legacy/typed宣言はduplicate。nested scopeのshadowは許可する。element localとforGroup iteration bindingはdocument bindingより優先する。typed優先の暗黙fallbackは作らない。

rename probeはlegacy/typed captureを拒否し、completionは同じ名前を重複表示しない。

現行legacy scopeの根拠は`src/geometry/variableScope.ts`と`src/dsl/dslVariableCompletionCandidates.ts`。globalは全体、groupは宣言groupとdescendantであり、この意味を互換入力に残す。

## D06: measurementは既存numeric expressionを再利用

新規lexical measurementはtyped number initializerで既存`distance`、`angle`、点線距離関数を使う。legacy pointDistance/pointAngle/pointLineDistance constructionは互換用に残し、自動migrationしない。

根拠: `src/geometry/numericExpressions.ts`とRust numeric evaluatorにpoint/line function評価が既にあり、新しいmeasurement型やconstructionを増やす必要がない。

## D07: choice identity

choice typeはoptionsと順序が完全一致するときだけ同一。順序はcompletionとAlt cycle順でもある。binding代入とequalityは完全一致型を要求する。

property assignmentだけはbinding optionsがproperty choice optionsの部分集合なら許可する。runtime payload optionsが宣言型と一致しない場合はcompile/Rust runtimeの両方で拒否する。

## D08: text templateとescape

初期対応escapeは`\\`、`\"`、`\'`、`\n`、`\r`、`\t`、`\{`、`\}`。物理複数行stringは禁止。未知escapeはnui 3でexact value span diagnostic。

`{@ラベル}`はstring bindingならstring、numberなら既存formatで挿入する。boolean/choiceは暗黙string化しない。string連結と汎用template expressionは後続。

canonical text constructionは`src/dsl/dslConstructions.ts`で確認した`text ... = label(...)`を使う。想像上の`text(...)`へ変えない。

## D09: boolean expression ownership

typed expression subsystemがlexer/parser/AST/typecheck/reference evaluator/Rust evaluatorを所有する。条件group taskは完成済みboolean expressionを接続するだけで、別parserを作らない。

numeric comparison、equality、`!`、`&&`、`||`を初期対応する。string equality可。choice equalityは完全一致choice型だけ。string/choice relational、concat、choice演算は後続。

## D10: property opt-in

初期対象は`text.text`、`offsetLine.side`、通常boolean、`group.printEnabled`、`forGroup.showGenerated`。通常property、print state、control flowを別taskで接続し、activityへ混ぜない。

`visible`/`enabled`、identity、parent、color、sourcePath、placement discriminatorはscalar property binding対象外。`angleLengthLine.direction`は現行modelにないため追加しない。

## D11: activityは3状態

内部型は`visible|hidden|disabled`。

- visible: evaluate + draw
- hidden: evaluate、drawしない
- disabled: evaluateもdrawもしない

activity内部model/legacy bridgeはnui 3と独立してproductionへ入れ、v2文書も利用する。v3 `state:` syntaxはversion基盤後の別task。gutter/UIはproduction activity modelだけへ接続する。

`locked`はsource-authoritative editorでは不要。legacy syntaxはwarning付きで受理し、model/command/UI/enforcementから削除する。

## D12: activity DSL canonical

v2はvisibleならflags省略、hiddenは`visible: false`、disabledは`enabled: false`。v3はvisibleなら`state`省略、hidden/disabledは`state: hidden|disabled`。

v3で`state:`とlegacy flagsを混在させたstatementは`element-state-conflict`でfail-closed。open/saveだけでは既存sourceをnormalizeしない。

## D13: activity command

gutter clickはvisible→hidden→disabled→visibleをcycle。context menu/ribbonは3状態を直接指定し、同じcommand domainをdispatchする。既定shortcutなし。旧`A`を削除し、`V`へ自動移行しない。

## D14: DivisionPlacement

DSL syntaxは維持し、内部だけ`{kind:"distance",value}`/`{kind:"ratio",value}`へ移す。

調査根拠:

- `dslCallParser.ts`: both指定をdiagnostic。
- `dslApplyArgs.ts`: both時はgroup先頭のdistanceを選択。
- `elementFactory.ts`: neither時はratio 0.5。
- `dslSerializeElement.ts`: active側だけ出力。
- legacy v1 compiler: distance優先。
- TS/Rust evaluatorとdrag: distance以外はratio分岐。
- duplication/forGroup: structured clone。
- evaluationEngine: elements JSONをIPCへそのまま渡す。

characterization fixtureを先にmergeし、その後1つのmigration PRで全consumerを切り替える。

## D15: version upgrade

nui 3はlegacy varとlegacy activity flagsを受理する。nui 2でv3専用syntaxはdiagnostic。header-only upgradeは本文をserializeせず1 splice/1 Undo。legacy importerはnui 2を出力し、新規文書だけ最終activation後にnui 3。

## D16: binding coreがconst evaluatorより先

scope index、stable binding ID、shadow/order、legacy collision、undefined/forward/self、initializer graph、SCC、exact spansを先に完成させる。const evaluatorは解決済みIDだけを使う。

set target IDはset解析で解決してよいが、version/old value/control-flow mutationは後続mutation taskが所有する。

## D17: TS/Rust境界

TSがsourceをtyped JSON ASTへcompileし、Rustはname resolutionを行わずpayloadを防御検証して評価する。`evaluate_document(input)`は維持。typed statementsはfake geometry elementにせず、source-order scalar programとして渡す。

## D18: Inspectorを2段階に分割

metadata表示はcompiled declaration完成後に実装できる。runtime表示はproperty、linear set、conditional set、forGroup set完了後にだけ実装し、最終computed value、poison、recoveryを表示する。既存literal parameter操作は維持。

## D19: performance測定

既存`statementReconciler.performance.test.ts`に合わせ、250/1000件、worker CPU time、100 warm-up、21 trials、trial内複数run、median/p95、scaling ratioを使う。

binding analysis、TS reference、Rust production、forGroup mutationを別々に測る。baselineのない絶対閾値は先に決めず、00 taskは記録専用。後続performance taskがbaselineとCI分散を根拠にgateを決める。Rustは既存ignored benchmark方式も使う。

## D20: branch名

子taskにはprefixなしの推奨slugだけを記す。実際のbranch prefixは実装環境とrepository運用に従う。

## D21: legacy `var`互換のblocking範囲

legacy `var`互換は、既存文書をtyped `const`/`let`へ移行するためのbest-effort支援と位置づける。

- legacy-onlyの意味差や軽微なvisibility差で、手動でtyped declarationへ書き換え可能なものは、後続typed-variableタスクを止めるblockingとしない。
- blockingとするのは、データ消失、クラッシュ、ファイルを開けない、または手動移行が不可能な問題だけ。
- この方針はlegacy `var`互換処理をどのtaskのparser/compilerへ追加するかとは無関係であり、特定taskへ互換処理を追加する理由にはならない(Task 14のTS expression parserはこの方針を理由に一切のlegacy `var`処理を持たない)。

根拠: D05/D06/D15が個別に確認したlegacy `var`互換の各契約(namespace共有、measurement再利用、version upgrade時の受理)を横断する、blocking判定そのものの基準をユーザーが明示指定した。

## D22: nui 3単一保存形式・手動migration・legacy全削除

最終製品が受理・保存するdocument formatは`nui 3`だけとする。現存するpre-nui 3 parser、serializer、importer、adapter、fallback、bridge、fixture、conditional branchは、少数の既存文書を手動で更新するまでの一時的な開発用bridgeであり、最終製品契約ではない。

- 自動migration tool、wizard、transparent upgrade、恒久fallbackは作らない。
- typed-variables機能とnui 3 production経路を完成させた後、既存ユーザー文書をすべてinventory化し、復元可能な原本を確保して手動でnui 3へ更新する。
- 更新済み文書はnui 3専用経路でopen、compile、Rust-first evaluate、save、reopenできることを個別に確認する。
- 手動migration完了後、nui 2以前のparser分岐、legacy `var`/activity flags、v1/v2 importer・serializer、version別round-trip、compatibility adapter、migration fallback、legacy visibility/scope bridge、旧compiled/IPC shape、旧fixture/golden/parity test、旧形式だけのfeature flagを削除する。
- 旧形式の完全round-trip、意味・visibility parity、compiled/IPC shape、legacy-only performanceはrelease条件にしない。旧形式は修正箇所を特定できる位置diagnosticを出してfail-closedでよい。
- 旧形式でblockingなのは、crashまたはsource確認不能、source破壊・消失、位置情報不足で修正箇所を特定不能、保存前sourceへ戻れず手動修正が実質不可能、の4種類だけとする。
- nui 3のデータ消失、誤評価、scope/type/runtime parity違反は従来どおりblockingとする。

このDecisionは次の過去Decisionを部分的にsupersedeする。履歴を隠さないため過去本文は削除しない。

- D05: legacy `var`とtyped bindingのnamespace共有・collision維持は移行期間だけ。最終nui 3 namespaceにはlegacy bindingを残さない。
- D06: legacy measurement constructionを互換用に残す部分。typed number measurementの現行仕様は維持する。
- D11: activity内部3状態は維持するが、legacy bridgeをv2文書へ恒久提供する部分は廃止する。
- D12: v2 serializerとlegacy activity flags受理・混在診断は移行期間だけ。最終serializer/inputはnui 3 `state:`だけとする。
- D15: nui 3でlegacy `var`/flagsを恒久受理すること、legacy importerがnui 2を出力し続けること、v2を保存対象として維持することを廃止する。
- D21: best-effort互換のblocking範囲を上記4条件へ置き換え、手動migration後の全削除を追加する。

## Open decisions

なし。

これは推測による打ち切りではない。上記D01〜D22はユーザー指定で確定した事項、または現行sourceから確認できたcontractである。D22がsupersedeしたlegacy contract以外のmeasurement syntax、text construction、performance方法、DivisionPlacement挙動は維持し、初期範囲外のqualified referenceやstring演算は明示的に後続へ分離した。
