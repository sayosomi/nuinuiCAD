# Phase 3d command ID対応表

この表はPhase 3dで削除または再配線する旧command IDの完全な対応表である。旧IDは
registry、palette、default binding、`CommandId` 型に残さない。shortcut設定は
`bindingId` を保存するため、読込時は同じ対応で旧binding IDを新binding IDへ移行する。
新IDの既存overrideを優先し、同じ新bindingへ移る複数の旧bindingは保存順で重複しない
chordを併合する。代替不能な廃止ID、未知ID、不正recordは安全に無視・除去する。

| 旧command ID | 新ID／最終挙動 | 保存済みshortcut |
|---|---|---|
| `toggleElementInfoPanel` | `toggleInspectorPanel` | 移行 |
| `enterParameterEditMode` | `focusInspectorParameterRows` | 移行 |
| `enterDependencyJumpMode` | `focusInspectorDependencyRows` | 移行 |
| `exitParameterEditMode` | `exitInspector` | 移行 |
| `exitDependencyJumpMode` | `exitInspector` | 移行 |
| `selectNextParameter` | `selectNextInspectorRow` | 移行 |
| `selectPreviousParameter` | `selectPreviousInspectorRow` | 移行 |
| `selectNextDependencyJumpTarget` | `selectNextInspectorRow` | 移行 |
| `selectPreviousDependencyJumpTarget` | `selectPreviousInspectorRow` | 移行 |
| `activateSelectedParameter` | `activateInspectorRow` | 移行 |
| `jumpToSelectedDependencyTarget` | `activateInspectorRow` | 移行 |
| `incrementSelectedParameter` | `stepSourceValueForward` | 移行 |
| `decrementSelectedParameter` | `stepSourceValueBackward` | 移行 |
| `selectParameterByKey` | 廃止 | 無視 |
| `focusSelectedParameterInput` | 廃止 | 無視 |
| `increaseSelectedParameterStep` | 廃止 | 無視 |
| `decreaseSelectedParameterStep` | 廃止 | 無視 |
| `cycleSelectedReferenceForward` | 廃止。InspectorのP pickへ | 無視 |
| `cycleSelectedReferenceBackward` | 廃止。InspectorのP pickへ | 無視 |
| `toggleSelectedParameterValue` | 廃止。Source Editor編集へ | 無視 |
| `toggleSelectedPointAnchorMode` | 廃止。Source Editor編集へ | 無視 |
| `setSelectedPointAnchorReferenceMode` | 廃止。Source Editor編集へ | 無視 |
| `setSelectedPointAnchorCoordinateMode` | 廃止。Source Editor編集へ | 無視 |
| `toggleSelectedBooleanParameter` | 廃止。Source Editor編集へ | 無視 |
| `toggleBooleanParameterByDirectKey` | 廃止 | 無視 |
| `toggleExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |
| `openExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |
| `closeExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |

移行または除去後の正規化済み設定はlocalStorageとTauri設定へ書き戻す。書戻し失敗は
読込済み設定の利用を妨げない。
