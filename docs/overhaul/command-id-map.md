# command ID対応表(確定版)

旧command ID → 新ID/最終挙動の統合対応表。Phase 3d・4g・4iで分散していた
対応を1箇所に集約し、Phase 5の変更を追記する。

**実装の正はコード**: 保存済みshortcut設定の正規化は
`src/keyboard/shortcutSettingsStorage.ts` の `legacyBindingIdMap`(移行)と
`retiredCommandIds`(除去)が担う。本表と実装の一致は 5c の機械検証テストで
固定する。歴史的経緯は
[tasks/phase-3d-command-id-map.md](tasks/phase-3d-command-id-map.md) を参照。

正規化の共通規則(Phase 3dで確立、以後不変):

* 設定は `bindingId`(`<scope>.<commandId>`)を保存する。代替先がある行のみ
  旧binding IDを新binding IDへ移行する。
* 新IDの既存overrideを優先し、同じ新bindingへ移る複数の旧bindingは保存順で
  重複しないchordを併合する。
* 代替不能な廃止ID・**未知ID・不正recordは安全に無視・除去**する。
* 正規化済み設定はlocalStorageとTauri設定へ書き戻す。書戻し失敗は読込済み
  設定の利用を妨げない。

## 1. 移行(旧binding ID → 新binding ID)

### Phase 3d由来

| 旧 | 新 |
|---|---|
| `modeInvariant.toggleElementInfoPanel` | `modeInvariant.toggleInspectorPanel` |
| `normal.toggleElementInfoPanel` | `normal.toggleInspectorPanel` |
| `parameter.incrementSelectedParameter` | `sourceEditor.stepSourceValueForward` |
| `parameter.decrementSelectedParameter` | `sourceEditor.stepSourceValueBackward` |

### Phase 4c〜4g由来(暫定コマンドラインIDの正式ID合流)

`normal.commandLineAdd<X>` → `normal.add<X>`。対象: FreePoint / OffsetPoint /
PolarOffsetPoint / DivisionPoint / LineDivisionPoint / IntersectionPoint /
LineTangentOffsetPoint / Line / AngleLengthLine / ArcLine / ThreePointArcLine /
CornerRadiusArcLine / Edge / ExtendTrim / BezierCurve / OffsetLine / CopyLine /
SymmetricCopyLine / Move / SymmetricMove / SplitLine / Variable / Text
(23件。全数は `legacyBindingIdMap` を正とする)。

### Phase 5予定(5cで確定させる)

| 旧 | 新 | 状態 |
|---|---|---|
| `focusElementList`(全scopeのbinding) | `focusSourceEditor`(仮。5cで衝突確認のうえ確定) | **予定(5c)** |
| `enterElementListMode` | 5cで再分類(`focusSourceEditor` へ統合 or リネーム) | **予定(5c)** |

## 2. 廃止(retired。保存済みbindingは代替先なしで安全除去)

### Phase 3d由来(パラメータ編集モード・Inspector行ナビ・ExpressionInsertTray)

`enterParameterEditMode` / `exitParameterEditMode` /
`enterDependencyJumpMode` / `exitDependencyJumpMode` /
`selectNextParameter` / `selectPreviousParameter` /
`selectNextDependencyJumpTarget` / `selectPreviousDependencyJumpTarget` /
`activateSelectedParameter` / `jumpToSelectedDependencyTarget` /
`selectParameterByKey` / `focusSelectedParameterInput` /
`increaseSelectedParameterStep` / `decreaseSelectedParameterStep` /
`cycleSelectedReferenceForward` / `cycleSelectedReferenceBackward` /
`toggleSelectedParameterValue` / `toggleSelectedPointAnchorMode` /
`setSelectedPointAnchorReferenceMode` / `setSelectedPointAnchorCoordinateMode` /
`toggleSelectedBooleanParameter` / `toggleBooleanParameterByDirectKey` /
`toggleExpressionInsertTray` / `openExpressionInsertTray` /
`closeExpressionInsertTray` / `focusInspectorParameterRows` /
`focusInspectorDependencyRows` / `exitInspector` / `selectNextInspectorRow` /
`selectPreviousInspectorRow` / `activateInspectorRow` /
`startInspectorParameterPick`

(各IDの廃止理由・代替は
[tasks/phase-3d-command-id-map.md](tasks/phase-3d-command-id-map.md) の表)

### Phase 4i由来(DslPanel削除)

`openDslPanel` / `exportDslSelection` / `validateDslPanel` / `applyDslPanel` /
`closeDslPanel`

## 3. ID不変で挙動が変わったもの(移行不要)

* 作成コマンド一式(`addFreePoint` 等): Phase 4gで即時挿入→コマンドライン
  セッション開始へ差し替え。ID・shortcut・palette登録は不変。

## 4. Phase 5での追加(新規ID。移行対象外)

| ID | 内容 | 状態 |
|---|---|---|
| `renameSelectedElement` | 選択要素のrename(伝播つき)プロンプト起動 | **予定(5g)** |

## 更新規則

* 5c / 5g の実装完了時に「予定」行を確定へ更新する(5hで最終確認)。
* 以後、command IDの廃止・リネームを行うPhaseはこの表へ追記し、
  `legacyBindingIdMap` / `retiredCommandIds` との機械突き合わせテストを
  更新すること。
