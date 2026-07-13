# Phase 3d command ID対応表

この表はPhase 3dで削除または再配線する旧command IDの完全な対応表である。旧IDは
registry、palette、default binding、`CommandId` 型に残さない。shortcut設定は
`bindingId` を保存するため、代替先がある行のみ旧binding IDを新binding IDへ移行する。
Inspector navigationと旧parameter/dependency navigationは代替先なしで安全に除去する。
新IDの既存overrideを優先し、同じ新bindingへ移る複数の旧bindingは保存順で重複しない
chordを併合する。代替不能な廃止ID、未知ID、不正recordは安全に無視・除去する。

| 旧command ID | 新ID／最終挙動 | 保存済みshortcut |
|---|---|---|
| `toggleElementInfoPanel` | `toggleInspectorPanel` | 移行 |
| `enterParameterEditMode` | 廃止。Source Editor値span経路へ統一 | 無視 |
| `enterDependencyJumpMode` | 廃止。Inspector依存行はマウス操作 | 無視 |
| `exitParameterEditMode` | 廃止 | 無視 |
| `exitDependencyJumpMode` | 廃止 | 無視 |
| `selectNextParameter` | 廃止 | 無視 |
| `selectPreviousParameter` | 廃止 | 無視 |
| `selectNextDependencyJumpTarget` | 廃止 | 無視 |
| `selectPreviousDependencyJumpTarget` | 廃止 | 無視 |
| `activateSelectedParameter` | 廃止 | 無視 |
| `jumpToSelectedDependencyTarget` | 廃止 | 無視 |
| `incrementSelectedParameter` | `stepSourceValueForward` | 移行 |
| `decrementSelectedParameter` | `stepSourceValueBackward` | 移行 |
| `selectParameterByKey` | 廃止 | 無視 |
| `focusSelectedParameterInput` | 廃止 | 無視 |
| `increaseSelectedParameterStep` | 廃止 | 無視 |
| `decreaseSelectedParameterStep` | 廃止 | 無視 |
| `cycleSelectedReferenceForward` | 廃止。Inspectorの行内pickボタンへ | 無視 |
| `cycleSelectedReferenceBackward` | 廃止。Inspectorの行内pickボタンへ | 無視 |
| `toggleSelectedParameterValue` | 廃止。Source Editor編集へ | 無視 |
| `toggleSelectedPointAnchorMode` | 廃止。Source Editor編集へ | 無視 |
| `setSelectedPointAnchorReferenceMode` | 廃止。Source Editor編集へ | 無視 |
| `setSelectedPointAnchorCoordinateMode` | 廃止。Source Editor編集へ | 無視 |
| `toggleSelectedBooleanParameter` | 廃止。Source Editor編集へ | 無視 |
| `toggleBooleanParameterByDirectKey` | 廃止 | 無視 |
| `toggleExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |
| `openExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |
| `closeExpressionInsertTray` | 廃止。テンプレートローカルUIへ | 無視 |
| `focusInspectorParameterRows` | 廃止。Inspectorはマウス専用 | 無視 |
| `focusInspectorDependencyRows` | 廃止。Inspectorはマウス専用 | 無視 |
| `exitInspector` | 廃止 | 無視 |
| `selectNextInspectorRow` | 廃止 | 無視 |
| `selectPreviousInspectorRow` | 廃止 | 無視 |
| `activateInspectorRow` | 廃止 | 無視 |
| `startInspectorParameterPick` | 廃止。行内pickボタンが直接既存pick commandを呼ぶ | 無視 |

移行または除去後の正規化済み設定はlocalStorageとTauri設定へ書き戻す。書戻し失敗は
読込済み設定の利用を妨げない。
