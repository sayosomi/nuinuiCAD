# Phase 3a: パラメータ→値spanジャンプAPI(Editor基盤)

> 親文書: [phase-3-inspector.md](phase-3-inspector.md)。
> 着手前に `docs/overhaul/plan.md` →
> [phase-2-post-cutover-editor-polish.md](phase-2-post-cutover-editor-polish.md) →
> 本文書の順で読むこと。AGENTS.md の規則に従うこと。
> Phase 3の最初の子タスク。3b/3cはこのタスクの成果物に依存する。

## Context

Phase 3の中核は「見るのは右ペイン、書くのはDSL」: インスペクタのパラメータ行で
Enterを押すと、Source Editorの該当statement行の**該当パラメータの値span**が
全選択された状態でフォーカスが移る。この「parameterKey→現在行の値span」の解決は
3c(インスペクタ)のEnterジャンプと3b(数値ステップ)の対象特定の両方が必要と
する共通基盤なので、UIより先に単独タスクとして実装する。

値spanの抽出はpost-cutover polishで実装済みの `src/dsl/dslValueSpans.ts` が
唯一の定義(click選択・Tab移動・Line Lensが既に共有)。本タスクはこのモジュール
を**ラベル付きspan**へ拡張し、`SourceEditorHandle` にジャンプAPIを追加する。
Inspector専用の別解析を作ってはならない。

## 目的

1. `dslValueSpans.ts` を、各spanがどのpayload key / attr名に属するかを持つ
   ラベル付きAPIへ拡張する(既存の無ラベルAPIの挙動は不変)。
2. `ParameterDefinition.key`(例: `startAngleDeg`)→ DSL上のattr名/payload key
   (例: `start`)の対応を、全要素型について一元的に解決するpure helperを作る。
3. `SourceEditorHandle` に「要素の特定パラメータの値spanへジャンプして全選択+
   フォーカス」するメソッドを追加する。

UIの変更はしない。このタスク完了時点でアプリの見た目・操作は一切変わらない。

## 開始時点の前提

* Phase 2完了+post-cutover polish完了(値span基盤・IME guard・selection-only
  Undo除外・`statementRangeIndex` が利用可能)。
* `SourceEditorHandle.jumpToElement(elementId)` がstatement行頭ジャンプとして
  存在する(`src/editor/sourceEditorTypes.ts` / `sourceEditorController.ts`)。
* `parameterDefinitions.ts` は未縮小(縮小は3d)。`getParameterDefinitions` /
  `findParameterDefinition` は現行のまま使える。

## 変更対象ファイル

* `src/dsl/dslValueSpans.ts` — ラベル付きspan抽出の追加(既存export群は不変)。
* `src/dsl/dslValueSpans.test.ts` — 追加分のテスト。
* 新規 `src/dsl/dslParameterSpans.ts`(命名は実装時に確定可)—
  parameterKey→DSL span解決のpure helperとelement型別マッピング。
* 新規 `src/dsl/dslParameterSpans.test.ts` — 全要素型×パラメータ種別の行列テスト。
* `src/editor/sourceEditorTypes.ts` — `SourceEditorHandle` へメソッド追加。
* `src/editor/sourceEditorController.ts` — 実装。
* `src/components/SourceEditorPane.tsx` — handle委譲の1行追加。
* `src/editor/sourceEditorController.test.ts` — controller層テスト。

## 実装手順

1. **ラベル付きspan**: `dslValueSpans.ts` に、`dslLineValueSpans` と同じ抽出・
   除外規則(非element文除外、error行除外、block開始行の合成close、keyword span
   除外、重複除去、source順)で `{ start, end, source: "payload" | "attr",
   key: string }` を返す関数を追加する。既存 `dslLineValueSpans` はこの新関数の
   投影(ラベルを落とすだけ)として再実装し、**既存テストを一切変更せずに**
   greenのまま保つ。click/Tab/Line Lensの挙動は変えない。
2. **parameterKey→DSL keyマッピング**: `dslParameterSpans.ts` に
   `(element, parameterKey) → DSL上のkey候補` を返すpure関数を作る。
   * 正は `dslSerializer.ts` の出力形。**parameterKeyとDSL attr名は同一では
     ない**(確認済みの例: `arcLine.startAngleDeg` は `start=` として
     serializeされる。`forGroup.start` も `start=`)。element型ごとの
     対応表またはserializer構造からの導出で解決する。
   * point anchor系(`printAnchor` 等の複合パラメータ)や payload位置の値
     (座標・参照)のように1パラメータが複数span/非attr spanに対応する場合の
     規則もここで確定する(先頭spanを選ぶ等、テストで固定)。
3. **span解決**: `(lineText, element, parameterKey) → ラベル付きspan | null`
   を組み立てる。行テキストは常に呼び出し側(controller)がlive CM docから
   渡す。dirty bufferでも行単独reparseで正しく解決される。
4. **controller実装**: `jumpToParameterValue(elementId, parameterKey): boolean`
   (命名は実装時に調整可。CM型を返さない・受けない)を追加する。
   * `protocol.composing` 中は何もせず `false`。
   * `statementRanges.get(elementId)` → live docの該当行テキスト → 手順3で
     span解決 → `EditorSelection.single(line.from + start, line.from + end)` を
     `Transaction.addToHistory.of(false)` +scrollIntoViewでdispatchし、
     編集用フォーカスを与える。selection発行はCanvas cursor投影と同じく
     選択ループを起こさないこと(既存 `canvasCursorOrigin` annotationの扱いを
     踏襲)。
   * span未解決(パラメータがその行にserializeされていない・行がerror等)は
     `jumpToElement` の行頭ジャンプへfallbackして `false` を返す。
5. **handle委譲**: `SourceEditorPane.tsx` の `useImperativeHandle` に1行追加。

## 公開API・型

* `src/dsl/dslValueSpans.ts`(追加。既存exportは変更しない):
  * `DslLabeledValueSpan = { start: number; end: number; source: "payload" | "attr"; key: string }`
  * `dslLineLabeledValueSpans(lineText: string): DslLabeledValueSpan[]`
* `src/dsl/dslParameterSpans.ts`:
  * `resolveParameterValueSpan(lineText, element, parameterKey, context?)` — parameterKeyから
    値spanを解決する。`context.committedLineText` はdirty時のdynamic record対応を
    証明するためだけに使い、証明できない場合は`null`を返す。
  * `resolveParameterTargetAt(lineText, element, selection, context?)` — caretまたは
    selectionから最も具体的なparameter spanとparameterKeyを解決する。3bはこれを
    使い、独自のparameter mapping/span包含判定を持たない。
* `src/editor/sourceEditorTypes.ts`:
  * `SourceEditorHandle.jumpToParameterValue(elementId: ElementId, parameterKey: string): boolean`

いずれもCodeMirror型を含まないこと。

## 状態とデータフロー

* 読み取り: `cadDocumentStore.elements`(パラメータ定義解決用)、CM live doc
  (行テキスト)、`statementRangeIndex`(elementId→行範囲)。
* 書き込み: CMへのselection-only dispatch(Undo履歴外)とフォーカスのみ。
  storeへの書き込みは既存 `jumpToElement` と同等の選択同期
  (`setSelectedElementId`)まで。**文書テキストは一切変更しない。**
* dirty buffer中: committed textではなく現在のCM行テキストを基準に解決する
  (`dslLineValueSpans` 系が行単独reparseなのでそのまま成立する)。
  dynamic record(`vars` / `intermediates`)は、live行とcommitted要素の対応を
  一意に証明できる場合だけ解決する。削除・並替え・重複・空fieldで別recordを
  推測してはならず、解決不能時は`null`→行頭fallbackとする。

## 守るべき不変条件

全Phase 3子タスク共通:

* `sourceText` が唯一の文書上の正。
* CodeMirror型・importを `src/editor/` と `SourceEditorPane.tsx` の外へ漏らさない。
* selection-only操作は `Transaction.addToHistory.of(false)` でUndo履歴へ追加しない。
* dirty bufferでは現在のCMテキスト(行単独reparse)を基準にする。
* IME composition中にjump・patch・数値変更を実行しない。
* `dslLineValueSpans` 系が「編集可能な値」の唯一の定義。Inspector専用の
  値span解析を作らない。
* main editorとLine Lensで意味論を重複実装しない。
* Phase 4(autocomplete・コマンドライン・DslPanel削除)に触れない。
* Phase 5のハードクリーンアップを先取りしない。

本タスク固有:

* 既存の無ラベル `dslLineValueSpans` の返すspan集合・順序を変えない
  (click/Tab/Line Lensの挙動保証)。
* ジャンプは該当パラメータの**値span全体**を選択する(行頭でも値の先頭
  cursorでもなく)。
* `name` は既存のvalue span集合へ加えず、parameter resolverだけがname tokenを
  選択する。Phase 3aでは通常のテキスト編集導線に限定し、参照のリネーム伝播は
  絶対に行わない。
* 解決失敗は例外ではなくfallback(行頭ジャンプ)+ `false`。

## 必須自動テスト

* **行列テスト**(pure層): 全要素型(現在27種。`elementTypeLabels` が正)に
  ついて、`dslSerializer` で1行serialize→各 `getParameterDefinitions` の
  parameterKeyが正しいspanへ解決されること。値種別(数値・式・参照・選択肢・
  色・真偽・テキスト)を網羅し、DSL行にserializeされないパラメータは
  「解決不能でnull」を明示的に固定する。
* ラベル付きspanが無ラベル `dslLineValueSpans` と同一のspan境界・順序を返す
  こと(投影の整合)。
* controller層: dirty bufferで編集後の行に対して正しく解決すること/
  composing中はno-opで `false` /解決失敗時のfallback/ジャンプがCM undo
  depthとstore履歴を汚さないこと。
* dynamic record: vars/intermediatesの削除・並替え・重複・空fieldは誤選択せず
  `null`へ落ちること。caret/selection→最具体parameter spanの逆引きも、座標子span
  を含めてforward mappingと同じ意味論であること。
* 既存 `dslValueSpans.test.ts`・click/Tab・Line Lens関連テストが**無変更で**
  greenのままであること。

## 手動確認

* 既存アプリ操作(click値選択・Tab移動・Canvas同期・Undo)に退行がないこと。
* devツール等からhandleの新メソッドを呼び、値span全選択+フォーカスが
  visually正しいことを1度確認する(UIは3cで付く)。

## 明示的な対象外

* インスペクタUI・RightPanel変更(3c)。
* 数値ステップコマンド(3b)。
* フォームエディタ削除・`parameterDefinitions` 縮小・コマンド削除(3d)。
* `dslValueSpans` の既存挙動の変更(値の定義変更はPhase 3の仕事ではない)。

## 完了条件

* `npm test` / `npm run build` / `npm run lint` が成功。
* 上記の必須テストが存在しgreen。
* UI・既存操作に挙動変更がない。
* CM型がhandle境界の外に現れていない。

## 確認事項(実装時に確定して報告)

* parameterKey→DSL keyマッピングの持ち方(明示テーブル vs serializer構造からの
  導出)。どちらでも良いが、serializerと乖離したらテストが割れる形にすること。
* 複合パラメータ(point anchor系)・複数spanに跨るパラメータの選択規則。
* handleメソッドの最終名称。

## 次タスクへの引き継ぎ

* 3b(数値ステップ)は本タスクの `resolveParameterTargetAt` とラベル付きspanを
  使ってstep対象と `stepLevels` を特定する。3b側でparameter mapping/span解析を
  追加しない。
* 3c(インスペクタ)はEnterジャンプを `jumpToParameterValue` に接続する。
* 行列テストのfixture(全要素型のserialize済み1行サンプル)は3b/3cでも
  再利用できるよう、単一のtest utilにまとめておくこと。
* Phase 5では安全なリネーム伝播を別途設計・実装する。最終形でInspectorの名前行を
  この単純なテキスト編集導線のまま残すか、安全なリネームcommandへ再配線するかは、
  Phase 5で判断する。本タスクはその判断を先取りしない。
