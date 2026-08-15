# command ID対応表(確定版)

旧command ID → 新ID/最終挙動の統合対応表。current shortcut migration と
retired command ID の対応を1箇所に集約している。

**実装の正はコード**: 保存済みshortcut設定の正規化は
`src/keyboard/shortcutSettingsStorage.ts` の `legacyBindingIdMap`(移行)と
`retiredCommandIds`(除去)が担う。本表と実装の一致は
`test/commandIdMap.test.ts` で検証する。

正規化の共通規則(Phase 3dで確立、以後不変):

* 設定は `bindingId`(`<scope>.<commandId>`)を保存する。代替先がある行のみ
  旧binding IDを新binding IDへ移行する。
* 新IDの既存overrideを優先し、同じ新bindingへ移る複数の旧bindingは保存順で
  重複しないchordを併合する。
* 代替不能な廃止ID・**未知ID・不正recordは安全に無視・除去**する。
* 正規化済み設定はlocalStorageとTauri設定へ書き戻す。書戻し失敗は読込済み
  設定の利用を妨げない。

## 1. 移行(旧binding ID → 新binding ID)

| 旧 | 新 |
|---|---|
| `global.newDocument` | `crossFocus.newDocument` |
| `global.openDocument` | `crossFocus.openDocument` |
| `global.saveDocument` | `crossFocus.saveDocument` |
| `global.saveDocumentAs` | `crossFocus.saveDocumentAs` |
| `global.openCommandPalette` | `crossFocus.openCommandPalette` |
| `global.focusElementSearch` | `crossFocus.focusElementSearch` |
| `global.undo` | `normal.undo` |
| `global.redo` | `normal.redo` |
| `global.enterElementListMode` | `normal.focusSourceEditor` |
| `normal.focusElementList` | `normal.focusSourceEditor` |
| `normal.enterElementListMode` | `normal.focusSourceEditor` |
| `modeInvariant.toggleInspectorPanel` | `normal.toggleInspectorPanel` |
| `modeInvariant.toggleShortcutHelp` | `crossFocus.toggleShortcutHelp` |
| `normal.openShortcutSettings` | `crossFocus.openShortcutSettings` |
| `modeInvariant.toggleElementInfoPanel` | `modeInvariant.toggleInspectorPanel` |
| `normal.toggleElementInfoPanel` | `normal.toggleInspectorPanel` |
| `parameter.incrementSelectedParameter` | `sourceEditor.stepSourceValueForward` |
| `parameter.decrementSelectedParameter` | `sourceEditor.stepSourceValueBackward` |
| `normal.commandLineAddFreePoint` | `normal.addFreePoint` |
| `normal.commandLineAddOffsetPoint` | `normal.addOffsetPoint` |
| `normal.commandLineAddPolarOffsetPoint` | `normal.addPolarOffsetPoint` |
| `normal.commandLineAddDivisionPoint` | `normal.addDivisionPoint` |
| `normal.commandLineAddLineDivisionPoint` | `normal.addLineDivisionPoint` |
| `normal.commandLineAddIntersectionPoint` | `normal.addIntersectionPoint` |
| `normal.commandLineAddLineTangentOffsetPoint` | `normal.addLineTangentOffsetPoint` |
| `normal.commandLineAddLine` | `normal.addLine` |
| `normal.commandLineAddAngleLengthLine` | `normal.addAngleLengthLine` |
| `normal.commandLineAddArcLine` | `normal.addArcLine` |
| `normal.commandLineAddThreePointArcLine` | `normal.addThreePointArcLine` |
| `normal.commandLineAddCornerRadiusArcLine` | `normal.addCornerRadiusArcLine` |
| `normal.commandLineAddEdge` | `normal.addEdge` |
| `normal.commandLineAddExtendTrim` | `normal.addExtendTrim` |
| `normal.commandLineAddBezierCurve` | `normal.addBezierCurve` |
| `normal.commandLineAddOffsetLine` | `normal.addOffsetLine` |
| `normal.commandLineAddCopyLine` | `normal.addCopyLine` |
| `normal.commandLineAddSymmetricCopyLine` | `normal.addSymmetricCopyLine` |
| `normal.commandLineAddMove` | `normal.addMove` |
| `normal.commandLineAddSymmetricMove` | `normal.addSymmetricMove` |
| `normal.commandLineAddSplitLine` | `normal.addSplitLine` |
| `normal.commandLineAddText` | `normal.addText` |

Phase 5cでは `focusElementList` と `enterElementListMode` を統合し、正常系の
`focusSourceEditor`（normal scope・既定 `g`・palette表示あり）だけを残した。
旧3 bindingは上表どおり直接この bindingへ移行する。連鎖解決は行わない。

## 2. 廃止(retired。保存済みbindingは代替先なしで安全除去)

| retired command ID |
|---|
| `openDslPanel` |
| `exportDslSelection` |
| `validateDslPanel` |
| `applyDslPanel` |
| `closeDslPanel` |
| `enterParameterEditMode` |
| `enterDependencyJumpMode` |
| `exitParameterEditMode` |
| `exitDependencyJumpMode` |
| `selectNextParameter` |
| `selectPreviousParameter` |
| `selectNextDependencyJumpTarget` |
| `selectPreviousDependencyJumpTarget` |
| `activateSelectedParameter` |
| `jumpToSelectedDependencyTarget` |
| `focusInspectorParameterRows` |
| `focusInspectorDependencyRows` |
| `exitInspector` |
| `selectNextInspectorRow` |
| `selectPreviousInspectorRow` |
| `activateInspectorRow` |
| `startInspectorParameterPick` |
| `selectParameterByKey` |
| `focusSelectedParameterInput` |
| `increaseSelectedParameterStep` |
| `decreaseSelectedParameterStep` |
| `cycleSelectedReferenceForward` |
| `cycleSelectedReferenceBackward` |
| `toggleSelectedParameterValue` |
| `toggleSelectedPointAnchorMode` |
| `setSelectedPointAnchorReferenceMode` |
| `setSelectedPointAnchorCoordinateMode` |
| `toggleSelectedBooleanParameter` |
| `toggleBooleanParameterByDirectKey` |
| `toggleElementLocked` |
| `toggleSelectedElementLocked` |
| `toggleExpressionInsertTray` |
| `openExpressionInsertTray` |
| `closeExpressionInsertTray` |
| `toggleElementVisibility` |
| `toggleElementEnabled` |
| `toggleSelectedElementVisibility` |
| `toggleSelectedElementEnabled` |
| `commandLineAddVariable` |

## 3. ID不変で挙動が変わったもの(移行不要)

* 作成コマンド一式(`addFreePoint` 等): Phase 4gで即時挿入→コマンドライン
  セッション開始へ差し替え。ID・shortcut・palette登録は不変。

## 4. Phase 5での追加(新規ID。移行対象外)

| ID | 内容 | 状態 |
|---|---|---|
| `renameSelectedElement` | 選択要素の安全なrename（伝播つき）プロンプト起動。single selection のみ、既定 F2 | **実装済み** |

## 更新規則

* 5c / 5g は完了済み。`renameSelectedElement` は normal と Source Editor に
  登録され、Source Editor の F2 は `editorTransaction` 所有の function-key
  binding である。
* 以後、command IDの廃止・リネームを行うPhaseはこの表へ追記し、
  `legacyBindingIdMap` / `retiredCommandIds` との機械突き合わせテストを
  更新すること。
