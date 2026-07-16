# P9: 値 span v2 解決

種別: 未接続 / 依存: P1, P5, P7

## 目的

v2 論理テキスト上でパラメータ → 値 span を解決する registry 駆動実装を作る。
現行 `src/dsl/dslParameterSpans.ts` の 311 行型別 switch の置換先。Alt+←/→・
クリック選択・Canvas ピック・jump-to-parameter が依存する中核。

## 対象範囲

- 新規モジュール(例 `src/dsl/dslParameterSpansV2.ts`):
  - `resolveParameterValueSpan` 互換のシグネチャ(論理テキスト + element +
    parameterKey [+ committedLineText])で v2 形式を解決。
  - 一般則: `argNameForParameter(type, parameterKey)`(P1)で引数キーを引き、
    論理テキスト上のその引数の値 span を返す(P2 スキャナを流用してよい)。
  - 特殊ケースの維持: 要素名 span、`variable:{id}:value`(vars record 内)、
    `intermediate:…`(record 内)、座標の `:x` / `:y` サブ span、
    distance/ratio(placementMode の実在側)、コンテナの位置引数
    (if.condition / for.variable)、`var` 短形式の式 span。
- ユニットテスト。

## 対象外

- 既存 `dslParameterSpans.ts` / `dslValueSpans.ts` / controller の変更(C1 で
  差し替え)。物理 span 射影(既存 projection 層のまま)。

## 実装要点

- 対象テキストは P5 の `serializeElementStatementLogical` 出力(正準 1 行)と、
  非正準の手書き 1 行形式の両方で解決できること(現行も committed/live の
  2 テキストで解決している — `committedLineText` フィンガープリント方式を踏襲)。
- 現行実装の呼び出し規約(戻り値の span 形・見つからない場合の null)を変えない。
  C1 での差し替えを「import 先の変更 + 旧 switch 削除」だけにする。
- record 内サブ span(vars / intermediates)は現行のフィンガープリント一致方式を
  移植する。

## テスト

- 全 27 型 × 全 parameterKey: P7 の正準リテラル上で span が値文字列と一致すること
  (`getParameterDefinitions` の全キーを機械的に回す網羅テスト)。
- 座標サブ span・vars/intermediates record・distance/ratio・コンテナ位置引数・
  `var` 短形式。
- 非正準入力(引数順の入れ替え・余分な空白)でも解決できること。

## 受入条件

- `npm test` / `npm run build` / `npm run lint` green。製品コードからの import なし。
- 全 parameterKey 網羅テストが green(解決不能キーはゼロ。意図的に span を持たない
  キーがあればテスト内で明示リスト化)。

## 次タスクへの引き継ぎ

- C1 が `dslParameterSpans.ts` の switch を削除し本実装を最終名で配線する。
  モジュール名の「V2」は C1 で除去(リネーム)する。
- `src/dsl/dslParameterSpansV2.ts` は依存グラフどおり P1(`argNameForParameter`)を
  引数名⇄parameterKey の唯一の正として使うが、実装の土台には依存グラフ外の
  P3 `dslCallParser.ts`(`parseDslCallStatement`)を採用した。P9 タスク文書は
  「P2 スキャナを流用してよい」とのみ書いていたが、P3 は既に完了済みで
  category/construction/名前/位置引数の解析と registry 突き合わせ済みの
  `payloadSpans: Record<string, DslSpan>` を提供するため、これを土台にすると
  P6 `applyArgs` が実際に値を書き込むのと同じ parse 結果を span 解決にも使う
  ことになり、「ハイライト表示と実際に適用される値が一致する」という正しさが
  構造的に保証される。P3 も他の P 群と同様に製品コードから import されていない
  (確認済み)ため未接続方針には反しない。C1 実装者は `dslValueStep.ts` /
  `dslCompletionMetadata.ts` / `sourceEditorController.ts` /
  `sourceEditorPickSelection.ts` の import 元切替だけで配線できる。
- 公開 API は `resolveParameterValueSpanV2` に加え、v1 の
  `resolveParameterTargetAtV2` / `resolveParameterKeyForValueSpanV2` 相当も
  同梱した(Alt+←/→・クリック選択が依存する「もっとも具体的な一致」解決)。
  ロジックは v1 と同型の純粋な集合演算で、C1 の配線を「import 切替+旧ファイル
  削除」に留めるための追加。
- `DslParameterValueSpanV2.source` は v1 の `"name" | "payload" | "attr"` 3種
  から `"name" | "arg"` 2種に簡略化した。v1 の `attr`/`payload` 区別は
  `key=value` 属性構文と位置糖衣が併存した v1 文法特有のもので、v2 は
  `key: value` 呼び出しに統一されたため対応概念がない。
  `dslCompletionMetadata.ts` は現在 `span.source === "attr"` で「属性として
  補完すべきパラメータ」を絞り込んでいる(v1 の `key=value` 属性構文専用の
  区別)。C1 でこの import を切り替える際は、この絞り込みが v2 で何を意味す
  べきか(削除するのか、別の基準に置き換えるのか)を再検討すること。
- 意図的に解決不能な3種類のキー(P9 テストで固定して検証済み。生成した
  populated/minimal fixture では非表示になるため一般則の対象外とした):
  - `placementMode`(divisionPoint / lineDivisionPoint): 選択そのものは
    テキスト上に存在しない(distance/ratio どちらが書かれているかから推論
    される)。
  - `distance` / `ratio` の非アクティブ側: P5 が `shouldSerializeConstructionArg`
    で `element.placementMode` と一致する側だけを出力するため、非アクティブ側
    はテキストに存在しない。手書きで両方書かれた場合でも
    `element.placementMode` を優先し、非アクティブ側は無視するようにした
    (テストで固定)。
  - `scope`(variable の pointDistance/pointAngle/pointLineDistance 構成):
    P1 registry を確認した結果、`scope` は `var/expression` の construction
    spec にしか登録されておらず、他の3構成の args に含まれない。P5 は
    これら3構成では `scope` を一切シリアライズしない(registry の既存挙動。
    P9 では変更していない)。
  - また、P5 は `locked`/`visible`/`enabled`/`colorId` を型ごとの
    `getParameterDefinitions` に関わらず `CadElement` の実フィールド値が
    非デフォルトなら出力する(例: `edge`/`extendTrim`/`move`/`symmetricMove`
    は colorId を Inspector に公開しないが、色が設定されていれば
    `color: …` は出力される。`variable` は `visible` を公開しないが、同様に
    出力されうる)。これは型固有の欠落ではなく P5 の既存仕様なので、P9 の
    テストではこの4キーを「必ずしも型固有 parameterKey に対応しない共通引数」
    として区別して扱った。
- v1 には無かったが P9 で新たに解決可能になったキー(v1 switch の対象外
  だった、v1 に対する範囲拡大): variable の測定モード
  (pointDistance/pointAngle/pointLineDistance)の `point1`/`point2`/
  `point`/`lineId`。image の `sourcePath`/`naturalWidthPx`/`naturalHeightPx`/
  `sourceDpi`/`targetPixelsPerMm`(P1 の引き継ぎで名指しされていた項目)。
- テストは P7 の `v2CanonicalElementStatements`(全27要素型 + variable 4
  construction、populated/minimal)を実際に `parseDslCallStatement` +
  `applyArgs` で要素化し、双方向で検証する:
  (1) 解析された `payloadSpans` の各引数名が何らかの parameterKey に
  対応していること(populated が要求する「出力された全引数が解決できる」網羅)、
  (2) `getParameterDefinitions` の各キーについて、対応する引数がテキストに
  存在するときだけ解決できること(minimal が要求する「存在する引数は解決・
  省略された引数は null」)。vars/intermediates レコードの中身と座標
  `(x, y)` サブ span の中身は、P5 の `documentDslRefs`(`refs.numeric`/
  `refs.anchor`)による独立した再シリアライズと突き合わせて検証した。
  `line` の `startPoint`/`endPoint` が(Inspector の `allowCoordinate` 表示
  ヒントに関わらず)座標リテラルを実際に受理・シリアライズすることを
  `dslReferences.ts`/`dslSerializer.ts` で確認したうえで座標サブ span の
  テストに使った。
- `npm test` / `npm run build` / `npm run lint` は green。Rust・parity 対象外。
