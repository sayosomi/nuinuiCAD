# 13: Binding diagnostics / initializer graph

## 1. タイトル

13: Binding diagnostics / initializer graph

## 2. 目的

binding resolution結果からinitializer dependency graph、SCC cycle、order diagnosticsとexact source issuesを生成する。

## 3. 依存タスク

12

## 4. 前提API・型

`analyzeBindings`、binding/reference records、diagnostic codes、initializer graph/SCC output。

## 5. 対象

undefined、forward、self、duplicate、cycle分類、invalid binding status、source span mapping。

## 6. 対象外

expression型diagnostic、evaluation、property/set/rename。

## 7. 固定仕様

cycle SCCはgeneric forwardより優先してcycleを各bindingへ報告。invalid bindingは通常completion除外用statusを持つ。

## 8. 実装方針

12 resultからgraphを作りTarjan/Kosarajuをpure moduleで実装、message formattingとanalysis dataを分離する。

## 9. 変更対象ファイル

新規`bindingAnalysis.ts`、`bindingDiagnostics.ts`、tests/fixtures。

## 10. 追加・更新するテスト

self、2/3-node cycle、forward chain、undefined、duplicate、outer shadow、複数issue span、deterministic order。

## 11. 互換性条件

legacy numeric evaluation結果は変更しない。analysis未接続。

## 12. performance条件

O(bindings+refs)。250/1000 CPU median/p95とscalingを00 protocolで記録。

## 13. 完了条件

const evaluatorがname/order/cycleを再判定せずvalid binding listを受け取れる。

## 14. 次タスクへの引き継ぎ

実装済みAPI（いずれもproduction未接続のpure analysis）:

```ts
// src/scalars/bindingAnalysis.ts
type InitializerReference = {
  fromBindingId: BindingId;
  occurrenceIndex: number; // caller契約: 同一fromBindingId内で0始まり・連続・一意
  name: string;
  span: DslSpan | null;
  resolution: BindingResolution; // Task 12の結果そのもの、再判定しない
};
type AnalyzeBindingsInput = { catalog: BindingCatalog; initializerReferences: readonly InitializerReference[] };
type InitializerGraphEdge = { toBindingId: BindingId; reference: InitializerReference };
type InitializerGraph = { nodeIds: readonly BindingId[]; edgesByFromBindingId: ReadonlyMap<BindingId, readonly InitializerGraphEdge[]> };
type StronglyConnectedComponent = { bindingIds: readonly BindingId[]; isCycle: boolean };
type BindingIssueCode =
  | "duplicate-binding" | "binding-cycle" | "self-initialization"
  | "undefined-binding" | "forward-binding-reference";
const ISSUE_PRIORITY: readonly BindingIssueCode[]; // duplicate > cycle > self > undefined > forward
type BindingIssueOrigin = { kind: "declaration" } | { kind: "reference"; reference: InitializerReference };
type BindingIssue = { code; bindingId; span; relatedBindingIds; origin };
// `reason` is the primary direct issue by ISSUE_PRIORITY, not the only issue.
type BindingStatus = { kind: "valid" } | { kind: "invalid"; reason: BindingIssueCode };
type BindingProgramEligibility =
  | { kind: "eligible" }
  | { kind: "ineligible"; reason: "direct-invalid" }
  | { kind: "ineligible"; reason: "invalid-dependency"; invalidDependencyBindingIds: readonly BindingId[] };
type BindingAnalysisEntry = { bindingId: BindingId; status: BindingStatus; programEligibility: BindingProgramEligibility };
type CompiledProgramBindingSelection = { bindingIds; entries; graph: InitializerGraph };
type BindingAnalysis = { catalog; graph; components; entries; entriesById; compiledProgram; issues };
const buildInitializerGraph: (catalog, references) => InitializerGraph;
const findStronglyConnectedComponents: (graph) => readonly StronglyConnectedComponent[];
const analyzeBindings: (input: AnalyzeBindingsInput) => BindingAnalysis;
const selectCompiledProgramBindings: (analysis: BindingAnalysis) => CompiledProgramBindingSelection;

// src/scalars/bindingDiagnostics.ts
type BindingDiagnosticMessage = { code; bindingId; span; message: string; relatedBindingNames: readonly string[] };
const formatBindingIssue: (analysis: BindingAnalysis, issue: BindingIssue) => BindingDiagnosticMessage;
const buildBindingDiagnosticMessages: (analysis: BindingAnalysis) => readonly BindingDiagnosticMessage[];
```

**入力契約**: `InitializerReference`はcaller（将来はTask 14以降のexpression parser接続層）が
`@name`出現ごとに、既にTask 12の`resolveBindingReference`を呼んだ結果をそのまま渡す構造体
である。Task 13はname/scope/order/resolutionを一切再判定しない。`fromBindingId`は必ず
catalog上`kind==="typed"`のbindingを指す。`occurrenceIndex`は同一`fromBindingId`内で
0始まり・連続・一意でなければならず、違反（重複または欠番）は`analyzeBindings`と
`buildInitializerGraph`の両方がthrowする（`bindingCatalog.ts`が重複IDでthrowするのと同じ
fail-fastスタイル）。`span`は診断表示専用で、順序決定には一切使わない。

**エッジ生成規則**: `resolution.kind==="resolved"`（target=`binding.id`、1本）と
`"forward"`（target=各`bindingIds`、複数本になり得るのは同名重複宣言時のみ。Task 12が
`bindingsByEffectiveScopeAndName`構築時に確定した順のまま使う）だけがエッジを作る。
`"self"`, `"undefined"`, `"duplicate"`はエッジを作らない。

**issue生成規則**:
- `duplicate-binding`（declaration起源）はcatalogの`declarationDuplicateBuckets`から発行し、
  bucketメンバー自身に1件ずつ付く。このAPIはdocument/iterationを同一effective scope/name、
  element localを同一owner/nameで既に分離しているため、Task 13はnamespace規則を再判定
  しない。`relatedBindingIds`はbucket全体（自分を含む）を指す共有配列で、bindingごとの
  コピーは作らない。
- 参照resolutionの`"duplicate"`からは、参照元binding（`fromBindingId`）へ
  `duplicate-binding`（`origin.kind==="reference"`）を1件発行する。同じcodeを2つの起源
  （`origin`フィールドで区別）で使うのは、plan.mdが定義する最小限のstable diagnostic
  code集合から逸脱しないため。
- `binding-cycle`はSCC（サイズ>1、またはサイズ1で自己ループedge保有）のメンバー全員へ
  binding単位で1件ずつ発行し、`relatedBindingIds`はcomponent全体（自分を含む）の共有配列。
  あるbindingの特定のforward参照について、その候補binding idの少なくとも1つが参照元
  binding自身と同じcycle componentに属する場合、その参照の`forward-binding-reference`は
  抑制される（cycle issueに包含されるため）。SCC外のforward chainはこの条件に該当しない
  ため誤って抑制されない。
- `self-initialization`/`undefined-binding`/`forward-binding-reference`/reference起源
  `duplicate-binding`は参照出現ごとに独立して発行する（同一bindingに複数出現があれば
  複数issue）。declaration起源`duplicate-binding`/`binding-cycle`はbinding単位の性質で
  あり、同じ原因で複数issueを量産しない。

**優先順位**（`entries[].status.reason`決定にのみ使用、`issues`自体は全件保持）:
`duplicate-binding > binding-cycle > self-initialization > undefined-binding >
forward-binding-reference`（`ISSUE_PRIORITY`）。

**決定的順序**: 比較ソート（`Array.prototype.sort`等）は本モジュール内で一切使用しない。
全順序キーは`(bindingRank, codeRank, originRank, occurrenceIndex)`の4値。`bindingRank`は
`catalog.bindings`配列の位置そのもの（Task 12が`statementIndex`昇順・kind順
typed<legacy<iteration<elementLocalで確定済み、Task 13は再ソートしない）。edge/
component/issueはすべて「`catalog.bindings`を1パス走査しながら固定長バケットへO(1)で
配置する」方式で構築し、Map/Setの挿入順は「事前に確定した順序をそのまま反映しただけ」で
ある（偶然の走査順には依存しない）。`initializerReferences`という配列自体の並び順を
シャッフルしても出力は完全に同一になる。

**計算量**: 通常入力でO(bindings+references)。比較ソートを使わず、bucketごとの
`relatedBindingIds`共有配列を1回だけ計算するため、単一の巨大bucket/componentがあっても
O(bindings)に収まる。既知の限界: forwardの複数ターゲット（同名重複宣言が密集する場合）は
edge数自体を増やし得るが、これは重複宣言側で別途`duplicate-binding`によりinvalid化される
output size起因のコストであり、アルゴリズムの欠陥ではない。

**self-loopに関する防御的正しさ**: 現行の`resolveBindingReference`は直接自己名参照を必ず
`self` kindで返しエッジを作らないため、実運用上`self-initialization`と1ノードSCCの
`binding-cycle`は排他的である。ただし`findStronglyConnectedComponents`自体は汎用
アルゴリズムとして実装し、「resolvedエッジが自分自身を指す1ノードSCC」を正しくcycle
判定できることをTask 12を経由しない合成入力で直接テストしている（Tarjanの典型的な
落とし穴への回帰防止）。SCCは反復Tarjan（明示スタック、再帰なし）で計算する。

**互換性・接続状態**: legacy numeric evaluationおよび既存DSL diagnostics pipelineは
未変更。`analyzeBindings`/`buildBindingDiagnosticMessages`はどこからも呼ばれない
pure subsystemのままで、`DslDiagnostic`への変換は本タスクでは行わない
（フィールド名`span`/`message`/`code`は揃えてあるため、将来の変換は機械的に書ける）。

**direct diagnostic と compiled-program eligibility**: `status`はsourceに直接付くissue
だけを表す。`status.reason`は`ISSUE_PRIORITY`によるprimary direct reasonであり、bindingが
持つ唯一のissueを意味しない。依存先がdirect-invalidまたはdependency由来で利用不可になっても、
依存元へ新しい`BindingIssue`を発行せず、`programEligibility`だけを
`invalid-dependency`にする。duplicate/cycle/self/undefined/forwardのいずれかのdirect issueを
持つbindingは伝播の起点であり、cycle memberは全員direct-invalidである。graphの既存方向
（依存元→依存先）を維持したままreverse adjacencyを一度構築し、閉包をO(bindings+edges)で
依存元へ伝播する。

`invalid-dependency.invalidDependencyBindingIds`は閉包確定後にgraphを再走査して求める、
そのbindingの直接outgoing targetのうち利用不可なIDすべてである。reverse traversalの発見元、
最初の原因、transitive root causeは記録しない。ID順は既存canonical edge順で、同じtargetを
複数回参照しても最初のedgeに対応する1 IDだけを保持する。

19は`selectCompiledProgramBindings(analysis)`を使い、name/order/cycle/eligibilityを再解析せず
compiled programへloweringする。selectionはeligible bindingだけをcatalog順で返すが、その
initializer graphではeligible sourceの元のoutgoing edgeを一切除去しない。selection構築時に
各targetもeligibleであることを検証し、違反はfail-fastする。この不変条件により、selection
graphに利用不可targetを指すedgeは残らない。
36は`InitializerGraph`/`StronglyConnectedComponent`をdependency graph表示に使う。
41は`BindingIssue`のcode/span/relatedBindingIdsをQuick Fix候補選定に使う。いずれも
resolution・graph・spanを再計算・再走査しない。

## 15. PR境界

13R-3 handoff: analysis receives canonical batch-resolution output. Catalog
rank is the deterministic order source; no analysis consumer re-sorts or
re-resolves references.

binding diagnostics/graphだけ。推奨branch slug: `typed-vars/13-binding-diagnostics`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
