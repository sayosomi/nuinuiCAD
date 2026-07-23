# 52: Legacy compatibility removal / nui 3-only production activation

## 1. タイトル

52: Legacy compatibility removal / nui 3-only production activation

## 2. 目的

全ユーザー文書の手動migration完了後、pre-nui 3互換コードとtestを全削除し、typed-variable機能をnui 3-only production経路へ正式接続する。

## 3. 依存タスク

47

## 4. 前提API・型

Task 47の完了inventory、Task 46のnui 3 serializer、Task 48〜51のdiagnostic/parity/performance/manual gate、live compiler/evaluation adapterのfeature gate removal、新document version default 3。

## 5. 対象

pre-nui 3 parser分岐、legacy `var`/activity flags、v1/v2 importer・serializer、version別round-trip、compatibility adapter、migration fallback、legacy visibility/scope bridge、old compiled-document shape、旧形式専用IPC conversion、legacy fixture/golden/parity test、旧形式だけのfeature flag/conditional branchの削除。nui 3 production wiring、new document/template default、最終残存検査。

## 6. 対象外

追加feature、自動migration、旧文書の再import、qualified reference、string concat、旧format compatibility復活。

## 7. 固定仕様

最終製品はnui 3だけを受理・保存する。pre-nui 3入力はbodyをlegacy parseせずunsupportedとして拒否してよく、open/save/semantic parityを提供しない。TS reference evaluatorとRust-first productionのnui 3 parityは維持する。

## 8. 実装方針

削除対象manifestを作り、document boundary、DSL、binding/activity bridge、serializer、IPC、fixture/testの順にlegacy ownerを除去する。中間adapterで旧shapeを延命せず全in-repo consumerをnui 3 shapeへ更新し、typed feature gateを外してdefaultを3へ切り替える。

## 9. 変更対象ファイル

document/DSL/scalar/evaluation/editor facade、Rust evaluation payload、new document/template defaults、legacy source/test/fixture directories、user documentation。

## 10. 追加・更新するテスト

nui 3 open/compile/evaluate/save/reopen、new document default、全typed scope/property/template/mutation、TS/Rust parity、unsupported pre-nui 3 boundary。旧format fixture/golden/parity testは削除し、互換testとして残さない。

## 11. 互換性条件

pre-nui 3互換は存在しない。旧文書を開けること、旧compiled/IPC shape、legacy round-trip/visibility/evaluation/performanceをmerge条件にしない。

## 12. performance条件

Task 50のnui 3 gateを同commitで再実行する。legacy-only性能は測定せず、compatibility code削除後のnui 3 regressionだけをblockingとする。

## 13. 完了条件

Task 47の未移行文書が0件。legacy parser/importer/serializer/adapter/fallback/bridge/fixture/flagの残存scanが0件またはnui 3と無関係な明示review済み例外だけ。全npm/Rust/parity/desktop gateがgreenで、production Tauriがnui 3だけをopen/saveし、typed featureがdefault有効。

## 14. 次タスクへの引き継ぎ

本計画完了。qualified reference、concat等は別計画として起票し、pre-nui 3互換は再導入しない。

## 15. PR境界

legacy compatibility全削除とnui 3-only activationだけ。推奨branch slug: `typed-vars/52-nui3-only-activation`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
