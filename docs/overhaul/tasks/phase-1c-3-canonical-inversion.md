# Phase 1c-3: 正準反転コア — sourceTextが正・commitText・統合Undo

> 全体計画: `docs/overhaul/plan.md`、親文書: `phase-1c-text-canonical.md` を
> 必ず先に読むこと。AGENTS.md の規則に従うこと。
> Phase 1c は 1c-1 → 1c-2 → 1c-3 → 1c-4 の直列4分割で実装する。
> 本タスクはその第3段(最大Stage)。1c-1(foldモデル外出し)と
> 1c-2(previewElements分離)の完了が前提。

## 目的

Phase 1b で実戦検証済みの影テキストを**正準**に反転する。以後 `sourceText` が
文書の唯一の真実、コンパイル済みモデルは派生キャッシュとなる。Undo履歴を
テキストベースの一本に統合する。保存形式はまだJSON(保存時に `doc` から
スナップショットを生成)。

**selection 4フィールドは本Stageでは docストアに暫定的に残す**(1c-4で移動)。
新履歴(TextSnapshot)が先にselectionを運び、undo/redoは「selectionが今
どこに居ようと」書き戻す設計にすることで、どの時点でも「Undoで選択が
戻らない」退行が生じない。

## 状態型(書き換え後)

```ts
type TextSnapshot = {
  text: string;
  selectionElementIds: ElementId[];
  cursorLine: number | null; // 暫定表現(下記)。Phase 2まで消費者なし
};

type CadDocumentState = {
  // ── 正準(唯一の真実)──
  sourceText: string;
  past: TextSnapshot[];               // 上限200
  future: TextSnapshot[];
  currentFilePath: string | null;
  dirtySinceSave: boolean;

  // ── 派生(sourceTextから計算。直接書き換え禁止)──
  doc: CompiledDslDocument & { document: DslDocumentData; statementMap: StatementMap };
      // 「最後に成功したcompile結果」。document非null保証
  docText: string;                    // docが対応するテキスト。=== sourceText なら同期
  diagnostics: DslDiagnostic[];       // 現在のsourceTextに対する全診断(fatal含む)

  // ── 一時状態(1c-2から)──
  previewElements: CadElement[] | null;

  // 暫定(1c-4で移動): selectedElementId / selectedElementIds /
  // selectionAnchorElementId / selectedParameterKey
  // actions...
};
```

* `shadowText` / `shadowCompiled` は `sourceText` / `doc` へ改名・昇格。
* `CadDocumentSnapshot` 型はstoreの状態型から消え、保存境界専用の変換関数
  `docToLegacySnapshot(doc.document, selection)` の戻り値型として
  `documentFormat.ts` 側へ縮退させる。
* `docText !== sourceText` が「fatal編集中テキスト」状態を型で表す。

## 変更入口3つ

### (a) `commitText(nextText, origin: "file" | "test" | "bridge-internal")`

```
1. 履歴push {sourceText(現), selectionElementIds(現), cursorLine(現)}
   → past(200cap・pushでslice)/ future=[]
2. parseDsl(nextText)                                     … 1 parse
3. reconcileStatements(
     { oldStatements: doc.statements, oldLines: doc.sourceLines,
       oldElementIds: doc.statementMap.elementIdByStatementIndex },
     新parse結果)                                          … ID照合
4. compileDslDocument(nextText, { assignedElementIds, preparsed })  … 1 compile
   (CompileDslDocumentOptions に preparsed?: 事前parse結果 を追加して
    二重parseを排除する。dslDocument.ts:552 は内部でpreparsed再利用構造を
    既に持つため小改修)
5. 成否分岐(下記状態機械)
6. previewElements=null, dirtySinceSave=true, selection正規化
   (存在しないIDの除去)
```

### commitText 状態機械(3ケース)

| | (A) valid | (B) dangling warningのみ | (C) fatal(parse/semantic error) |
|---|---|---|---|
| `sourceText` | 新テキスト | 新テキスト | **新テキスト(失わない)** |
| `docText` | =sourceText(同期) | =sourceText(同期) | 旧のまま(**非同期**) |
| `doc` | 新compile結果 | 新compile結果(document非null、生参照トークン保持) | **直前のlast-goodのまま(stale)** |
| `diagnostics` | [] | warning列(行番号付き) | fatal診断列 |
| `statementMap` | 新 | 新 | stale(docと一体) |
| Canvas/評価 | 新elements | 新elements(dangling要素は依存エラー表示、TS evaluatorフォールバック既存挙動) | **last-good elementsを表示し続ける** |
| 履歴push | 1 | 1 | **1(undoで正常テキストへ戻れる)** |
| `dirtySinceSave` | true | true | true |
| ブリッジ | 通常動作 | 通常動作 | **拒否**: 非同期中の `commitDocumentChange` は console.error + no-op |

* (C)のブリッジ拒否が実害ゼロの根拠: 本Phaseには生テキスト編集UIが存在せず、
  `commitText` の呼び出し元はファイル読込とテストのみ。読込テキストは
  シリアライザ産で構造的にvalid。fatal状態はテストでのみ作れるが、状態型と
  しては既に表現でき、Phase 2でエディタが来ても型変更不要。
* 参照warningとfatalを一括降格しない(親文書のdangling引き継ぎ事項どおり)。

### (b) `commitDocumentChange(change)` — 署名維持のブリッジ

```
1. before = 現doc.document(selection系keyはchangeから分離して従来どおり
   stateへ反映 — 1c-4まではdocストア内のフィールド)
2. afterDoc = {...doc.document, ...change文書キー} を DslDocumentData 化
   (normalizeSnapshotは通さない — 下記「正規化の退役」)
3. buildTextPatch({ old: doc, newDocument: afterDoc })
   → applyLineSplices(sourceText)
4. compileWithZippedIds(patchedText, afterDoc.elements)   … positional zip継続
5. 【要素オブジェクト同一性の保存】成功時、doc.document.elements には
   recompile産の新オブジェクトではなく afterDoc.elements(呼び出し元が渡した
   モデルオブジェクト)を採用する。statementMap・診断はcompile産を採用。
   dev assertが「recompile結果 ≡ afterDoc」を毎コミット検証するので安全。
   これにより未変更要素の参照同一性が保たれ、React memo・評価memoの
   再計算粒度が現行と変わらない。
6. 履歴push(1エントリ)・sourceText=docText=patchedText・previewElements=null
7. 失敗時: 1bと同じ自己修復(モデルからの全体再生成)。それも失敗なら
   現状維持+console.error(safeGenerateShadowFromModel 相当は最終防衛線として
   存続。danglingだけでは発火しないことのテストを維持)
```

* 現行の `withShadowCommit` 直呼び18箇所(`updateElement` / `renameElement` /
  可視性・パレット・印刷レイアウト系アクション)は全てこのブリッジfunnelへ
  付け替える。**外部呼び出し元(非テスト13ファイル)は署名・動作とも無変更。**
* `commitDocumentChangeFromSnapshot` は1c-2で `commitDocumentChange` と
  実質等価になっている。署名維持のまま同じfunnelへ。
* no-op判定は「`patchedText === sourceText`」の文字列比較に置換
  (`snapshotEquals` は廃止)。

### (c) `previewDocumentChange(change)` — 1c-2のまま(previewElementsのみ)

### undo / redo

past/futureからTextSnapshotをpop/push。履歴push以外は commitText 手順2-6と
同一(parse→reconcile→compile→selection復元)。**全体再シリアライズは
行わない**(テキストが履歴に入っているため。現行undoの `regenerateShadow` は
消える)。復元selectionは existing IDでフィルタし、primary=先頭、anchor=先頭、
parameterKeyは `normalizeParameterKey` で再正規化。

### cursorLine の暫定表現

現在cursor行の状態は存在しない(最も近いのは `selectedElementId`)。push時に
`doc.statementMap.byElementId.get(selectedElementId)?.range.startLine ?? null`
を計算して格納する。undo/redoで値は復元されるがPhase 2まで消費者なし
(CodeMirror導入時にカーソル復元へ接続)。専用のcursor状態を今作らない。

## statementReconciler 本番投入の使い分け

* **ブリッジ経路は positional zip を継続**(`shadowText.ts:66-80`)。
  `layoutElementTree` はelements配列順に1要素1文を出力し、textPatchはその構造を
  鏡写しにするため、パッチ後テキストの要素文列は `afterDoc.elements` と
  構造的に1:1対応する。zipは厳密・O(n)・1bで全経路実証済み。
* **reconcilerは「位置対応が使えない経路」= `commitText` と undo/redo で
  本番使用**。6段階照合でIDを最大限継承する。
* compile失敗(fatal)時: `assignedIds` は破棄。docはlast-goodのまま。
  次の成功コミットはlast-good docを旧側として照合するため、fatal期間を
  跨いでもIDは継承される。
* Undo/Redo時のID継承: リネームのundoは段階3、行移動undoは段階2、
  group跨ぎ移動undoは段階5で継承(Phase 1a仕様表の帰結)。選択・評価
  キャッシュ・Rustペイロードは実行時IDのまま無変更で動く。Rust変更なし。

## normalizeSnapshot の退役

**不変条件: sourceText上の情報をモデル正規化で逆流的に消失させない。**

* **コミット経路から全廃**: ブリッジは `normalizeSnapshot` を通さない。
  未知colorId・未知roleVisibilityキー・未知group placement等は生トークンとして
  テキストへシリアライズされ、compileがwarning診断として報告する(dangling
  対応で整備済みの経路。AGENTS.mdの「明示的依存エラー」方針と一致)。
  compilerは非破壊デフォルトを既に持つ(`dslDocument.ts:579-594`: profile 0件→
  default 1件、activeId→先頭fallback、evaluationLimitIndex→要素数。これらは
  テキストへ書き戻されない派生デフォルト)。
* **JSON読込境界に集約して存続**: `parseDocumentObject`
  (`documentFormat.ts:25-85`)の正規化はディスク由来JSONの防衛として全て残す。
  `normalizePrintLayout` の `preserveDanglingReferences: true` オプション
  (`printLayout.ts:156-211`)を読込経路でも有効化し、JSON形状が保持できる
  dangling参照は落とさない。
* `replaceDocument` 相当の読込アクションは読込境界の正規化に一本化する
  (store内の `normalizeSnapshot` 呼び出しは消える)。
* **既知の一時制約(許容・明記)**: JSONスナップショット形状が表現できない
  dangling情報(例: 未知groupへのplacement)は保存→読込を跨ぐと失われ得る。
  セッション内(コミット経路)では失われない。Phase 1d(.nuiテキスト保存)で
  解消。

## dev assert の存続

1bの `assertShadowEquivalent` + `assertReconcileSane` を「コミット後
recompile ≡ 意図モデル」assertとして存続(`import.meta.env.DEV` ゲート、
`shadowTextAssert.ts:14`)。失敗時は console.error + 全体再生成でユーザー操作を
止めない。テスト実行時は常時有効。

## 暫定JSON保存(形式不変)

* **保存**: `docToLegacySnapshot(doc.document, 現selection)` で従来形状
  (schemaVersion 5、`printLayout` ミラー含む)を組み立て → 既存
  `serializeCadDocumentFile` → Tauri `write_document_file`。
  parse/compile/serialize追加コストゼロ(純粋なオブジェクト整形のみ)。
* **読込**: `parseCadDocumentFile` → `parseDocumentObject`(正規化)→
  `serializeDocumentToDsl(snapshotToDslData(snapshot))`(1全体シリアライズ)→
  `commitText(text, "file")` 相当で `sourceText` 初期化。履歴リセット・
  `dirtySinceSave=false`・`currentFilePath` 設定は読込専用アクションで行う。
* 保存→読込でコメント・空行が正規化される一時制約は許容済み(親文書の
  「意図した一時制約」節)。生テキスト編集UIは無いため実害なし。

## dirty state

`dirtySinceSave` は現行のまま粗いboolean(全コミット/undo/redoでtrue、
保存・読込でfalse)。精緻化はスコープ外。

## 性能予算(1操作あたりの parse / compile / serialize 回数)

実測基準: 1000要素 compile ≈212ms、advanceShadow prod ≈554ms / dev ≈722ms。

| 操作 | parse | compile | serialize | 備考 |
|---|---|---|---|---|
| ブリッジcommit(prod) | 1 | 1 | 変更文の単文serializeのみ | 現行advanceShadow prodと同一構成。`preparsed` オプションで2parse→1parseに削減 |
| ブリッジcommit(dev追加) | +1 | 0 | +2(全体、等価assert) | 現行1bと同一 |
| `commitText` | 1 | 1 | 0 | reconcileは1a実測で1000文<5ms |
| previewフレーム | 0 | 0 | 0 | previewElementsのみ |
| undo/redo | 1 | 1 | 0 | 現行(全体再シリアライズ+2parse+compile)より軽い |
| 保存 | 0 | 0 | 0 | JSON.stringifyのみ |
| 読込 | 1 | 1 | 1(全体) | 正当な全体シリアライズ経路 |

同一コミット内の重複compile禁止。全体再シリアライズが正当な経路は
**読込と自己修復fallbackのみ**。

## Phase開始時点の前提

* Phase 1c-1 / 1c-2 完了済み。
* dangling referenceはcompile warning(document非null)。
  `safeGenerateShadowFromModel` はdanglingでは発火しないことがテスト済み。

## 完了条件

* 正準反転後、既存テストが全て通る(モデル結果の後方互換をフィクスチャで確認)。
* 実アプリ動線: 新規作成→作図→保存→再起動→読込→Undo/Redo→Canvasドラッグ→
  DslPanel適用。
* Undo/Redoで選択が復元される(cursorLineは格納のみ)。履歴200cap。
* `npm test` / `npm run build` / `npm run lint` / `npm run test:parity` 成功。
* full suite 10回連続実行でflake未再現を記録(失敗時は報告のみ)。

## 必須テスト

* ブリッジ等価スイート: 既存コマンドテスト全リプレイ+毎ステップ
  `parse(sourceText) ≡ doc`(1bの影assertの昇格)。
* `commitText`(valid / warning / fatal)の状態機械テスト(上表を固定)。
* fatal→undo→正常復帰、fatal中(docText非同期中)のブリッジ拒否。
* テキスト編集(`commitText`)とモデル編集(ブリッジ)を交互に行う混在
  Undo/Redoシーケンス。
* Canvasドラッグ相当(preview連打→commit)で履歴+1のみ。
* コメント・空行入りテキストへのモデル経由編集の保存性(commitTextで注入)。
* reconciler経由undoのID継承(リネームundo・行移動undo・group跨ぎundo)。
* 保存→読込ラウンドトリップ(JSON)の意味的等価。
* 履歴200cap、`dirtySinceSave` 遷移。
* property test(`documentTestGenerators`)を正準反転後の全経路で再有効化。

## やってはいけないこと

* ファイル形式・拡張子の変更(Phase 1d)。CodeMirror導入(Phase 2)。
* selection 4フィールドの cadUiStore 移動(1c-4)。
* 呼び出し元13ファイルの「ついで」リファクタ。ブリッジで吸収しきれない箇所が
  見つかった場合は最小限の変更に留め、タスク報告に明記する。
* コミット経路への全体再シリアライズ追加(読込・自己修復を除く)。
* 投機的性能最適化(incremental parser / rope / 永続キャッシュ / 文単位メモ化。
  1000要素で予算超過の実測が出た場合は計測結果を報告し、対応はユーザー判断)。
* Rust側dependency error対応(focused fixture + parityを伴う別タスク)。
