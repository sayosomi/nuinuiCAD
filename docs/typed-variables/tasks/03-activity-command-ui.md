# 03: Activity command / gutter UI

## 1. タイトル

03: Activity command / gutter UI

## 2. 目的

production activity modelへ、keyboard-friendlyなcycle/direct-set commandと分かりやすい1-icon gutter UIを接続する。

## 3. 依存タスク

01, 02

## 4. 前提API・型

activity cycle commandとvisible/hidden/disabled direct-set command。UIはcommand dispatchだけを行う。

## 5. 対象

command registry/palette、gutter click、context menu、ribbon action、eye/eye-off/stop表示、Undoとsource statement splice。

## 6. 対象外

v3 state syntax。v2ではlegacy flagsを01のserializer mappingで更新する。

## 7. 固定仕様

cycle順はvisible→hidden→disabled→visible。既定shortcutなし。旧Aを削除しVへ移行しない。saved custom command bindingはcommand IDが存続する限り維持。

## 8. 実装方針

純粋なnext-state関数とcommandを先に実装し、CodeMirror extensionはline→element ID解決とdispatchだけにする。

## 9. 変更対象ファイル

commands/command registry、keyboard defaults、editor state rail/evaluation extension、context/ribbon definitions、icons/tests。

## 10. 追加・更新するテスト

3-state cycle、multi-selection/direct set、1 Undo、vertical statement header anchoring、hidden evaluated表示、shortcutなし、全entry同command。

## 11. 互換性条件

v2 source更新は01 canonical mapping。typed variable gateに依存しないproduction UI。

## 12. performance条件

gutter decorationはprecomputed status indexを使い、renderごとの全ancestor探索をしない。

## 13. 完了条件

旧visible/enabled/locked actionがUIから消え、3-state command/UI E2Eがgreen。

## 14. 次タスクへの引き継ぎ

51 manual E2Eでmouse/keyboard/menu/ribbonを確認する。

## 15. PR境界

activity interactionだけ。推奨branch slug: `typed-vars/03-activity-ui`。

共通仕様は[plan.md](../plan.md)、判断根拠は[decisions.md](../decisions.md)を正とする。
