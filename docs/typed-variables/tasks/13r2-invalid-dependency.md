# 13R-2: Invalid binding dependency propagation

## 目的

Task 13R-1統合reviewで判明した、直接issueを持つbindingへの依存がcompiled scalar programへ
漏れ得る問題を修正する。

## 変更契約

- `BindingStatus`はsource上のdirect diagnosticだけを表す。`status.reason`は
  `ISSUE_PRIORITY`によるprimary direct reasonであり、唯一の原因ではない。
- direct-invalidとdependency由来のcompiled-program利用不可は`programEligibility`で分離する。
  依存伝播だけを理由に`BindingIssue`、source span、`BindingIssueCode`は追加しない。
- duplicate、cycle、self、undefined、forwardのdirect-invalidをseedにする。cycle memberは
  direct-invalid、cycle外のdependentは`invalid-dependency`でありcycle issueを持たない。
- graph edge方向は依存元→依存先のままにし、reverse adjacencyを一度構築してinvalid closureを
  O(bindings+edges)で依存元へ伝播する。bindingごとのgraph再走査はしない。
- dependency由来entryの`invalidDependencyBindingIds`は、closure確定後の2回目のedge走査で得る
  直接outgoing targetのうち利用不可なbinding IDすべてである。canonical edge順を維持し、
  traversalの発見元やtransitive root causeは保存しない。
- `selectCompiledProgramBindings`は再解析不要のeligible binding / graph viewを返す。eligible
  sourceの元edgeはすべて保持し、targetがeligibleでない場合はfail-fastする。edgeを削除して
  不変条件を満たすことはしない。

## 対象外

Task 13R-1のresolution、duplicate namespace、`declarationDuplicateBuckets`、Task 13R-3の
catalog/adapter/resolution性能線形化、production evaluator、expression parser、property、set、
rename、DSL diagnostics pipelineは変更しない。

## 検証

- missingからの直接invalid、transitive propagation、複数直接unavailable target、独立valid chain。
- duplicate/self/undefined/forward/cycleをseedとする伝播と、transitive bindingへissueを増やさないこと。
- eligible sourceの全元edgeがselectionに残り、元graphにもeligible→ineligible edgeがないこと。
- reference入力順を変えてもeligibility / selectionが一致し、既存issue順序・cycle抑制・namespace・
  resolution testが維持されること。
