# Phase 1d: `.nui` 保存/読込への切替 + レガシーインポータ

> 全体計画: `docs/overhaul/plan.md` を必ず先に読むこと。AGENTS.md の規則に従うこと。

## 目的

保存ファイルを DSL テキスト(拡張子 `.nui`)に切り替え、JSON保存経路を廃止する。
旧 `.nuinui.json` を新形式へ変換する一回限りのインポータコマンドを追加する。
ストア(Phase 1cで完成)には触れない。

## 変更対象

* `src/document/documentFile.ts` — 保存: `sourceText` をそのまま書き出す
  (拡張子 `.nui`、ダイアログフィルタ更新)。読込: テキストを読み
  `commitText`(パース診断があってもファイルは開き、診断を表示する)。
* `src/document/documentFormat.ts` — JSON**保存**側のコード
  (`serializeCadDocumentFile` / `cadDocumentFileFromSnapshot`)を削除。
  パース側(`parseCadDocumentFile` / `parseDocumentObject`)はインポータ専用として
  残す(新規参照を増やさない)。
* 新規 `src/document/legacyImport.ts` — 旧JSON→新DSLテキスト変換:
  `parseCadDocumentFile` → `dslDocument.ts` の文書シリアライザ。
  * 旧文書はID参照依存のため、**空名の要素には変換時に一意な名前を生成**する
    (`makeUniqueElementName`、名前空間対応)。
  * 選択状態・`printLayout` ミラー・`numericParameterSteps` は変換で捨てる。
  * 画像 `sourcePath` の相対/絶対解決は既存 `imageFilePaths.ts` の挙動を踏襲。
* `src/commands/documentCommandDefinitions.ts` — コマンド
  「旧形式(.nuinui.json)をインポート」を追加(コマンドパレットから起動可能)。
  変換結果は**無題文書**として開く(`currentFilePath = null`、保存は必ず
  Save As。元ファイルには一切書き込まない)。
* `src-tauri/` — 変更不要のはず(`document_file.rs` は内容非依存)。ダイアログの
  拡張子フィルタはTS側 `@tauri-apps/plugin-dialog` の引数のみ。

## 守るべき不変条件

* インポートは読み取り専用: 元の `.nuinui.json` を絶対に変更・削除しない。
* パース診断のある `.nui` も開ける(壊れた行はエラー要素/診断として表示し、
  ファイルを開くこと自体は拒否しない。ただし `nui` バージョン指令の
  未知メジャーは拒否)。
* 保存はテキストの逐語書き出し(コメント・空行・順序を保つ)。整形・再
  シリアライズをしない。
* `evaluate_document` 境界・評価挙動に変更なし。

## Phase開始時点の前提

* Phase 1c 完了済み: `sourceText` が正準、`commitText` が存在、保存時のJSON
  生成が `documentFile.ts` に隔離されている。
* Phase 0 の文書シリアライザが文書100%を表現できる。

## 完了条件

* 新規作成→保存で `.nui` テキストファイルができ、再起動→読込で完全復元される。
* 旧 `.nuinui.json` をインポートすると、評価結果(要素数・幾何・エラー/警告)が
  旧アプリでの評価と一致する文書が無題で開く。
* JSON保存経路のコードが削除されている(パースはインポータ裏にのみ存続)。
* `npm test` / `npm run build` / `npm run lint` 成功。
* 実アプリ手動確認: 保存→Finderでファイル内容がDSLテキストであること、
  手編集(テキストエディタで1行変更)→再読込が反映されること。

## 必須テスト

* `.nui` 保存→読込ラウンドトリップ(コメント・空行入りテキストがバイト単位で
  保存されること)。
* レガシーインポート: 全26要素型・palette・roles/profiles・printLayouts・
  評価リミットを含む旧形式フィクスチャ →変換→ コンパイル結果が意味的等価。
  空名要素の命名、ID参照→名前参照の変換を含む。
* インポート結果が無題(`currentFilePath === null`)で dirty であること。
* 診断付きテキストの読込(開ける+診断表示)。未知バージョンの拒否。
* 保存ダイアログの拡張子フィルタ(ユニットで可能な範囲)。

## やってはいけないこと

* ストア・Undo・ブリッジの変更(Phase 1cで完成済み)。
* 旧JSON形式への**保存**機能を残すこと。
* インポータに「変換できない場合の自動修復」を入れること。変換不能な参照は
  明示的な診断としてユーザーに見せる。
* UIレイアウトの変更(Phase 2以降)。
* Rustコードの変更(必要になった場合はタスク報告で理由を明記して最小限)。
