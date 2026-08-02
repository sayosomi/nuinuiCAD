# nuinuiCAD DSL (`nui 3`)

`.nui` は nuinuiCAD の保存形式です。Source Editor の `sourceText` が文書の唯一の正で、編集内容は再コンパイルされてCanvas、Inspector、評価結果へ反映されます。単位は mm、作図座標は Y-up（上が正）です。新規に文書を書く・編集するときは、本文書に記載する `nui 3` の構文を使ってください。

Source Editor の値は直接編集できます。数値・boolean・choiceなど対応する値は `Alt+←` / `Alt+→` でも変更できます。Inspector は表示と該当値への移動だけを行う読み取り専用UIです。

## 基本ルール

- 最初の意味のある行は `nui 3` です。
- 要素・変数は文書順に評価されます。参照先は前にあり、enabledで、有効な形状・値でなければなりません。順序や依存関係は自動修復されず、診断で示されます。
- 要素の表示・評価は `state:` で制御します(詳細は「共通引数」参照)。
- `#` から行末はコメントです。Canvasとコマンドは対象statementだけを変更するため、無関係なコメント、空行、手書きの並びは保持されます。
- 要素名は引用できます。参照には名前、修飾名 `グループ::要素`、派生点 `線.start` などを使います。

通常の要素は category、任意の名前、construction call で書きます。引数は `key: value` で、コロンの後には空白が必要です。隣接する引数は改行した場合も含めて `,` で区切ります。最後の引数の末尾カンマは任意ですが、通常の保存・コマンド更新では付けません。

```text
nui 3

var bust = 840
point A = coordinate(
  x: 0,
  y: 0
)
point B = offset(
  from: A,
  dx: 0,
  dy: -(@bust / 4)
)
line AB = segment(
  start: A,
  end: B
)
```

1行のcallも入力できますが、通常の保存・コマンド更新では1引数1行の縦型形式になります。`var 名前 = 式` は数値専用の式変数の短形式で、offsetのdx/dyや長さ・角度など、要素のconstruction引数に使う数値パラメータはこの`var`で用意します。下記の型付き変数`const`/`let`の`number`値も、`@名前`の形でこれら数値引数の式の中に混ぜて使えます。

## 要素

categoryごとに使えるconstructionは次のとおりです。各constructionが受け取る引数はSource Editorの補完と診断で確認できます。

| category | construction |
| --- | --- |
| `point` | `coordinate`, `offset`, `polar`, `between`, `onLine`, `intersection`, `tangentOffset` |
| `line` | `segment`, `polar`, `offset`, `split`, `extend`, `copy`, `move`, `mirrorCopy`, `mirrorMove`, `edge` |
| `curve` | `bezier` |
| `arc` | `arc`, `through`, `corner` |
| `text` | `label` |
| `image` | `image` |
| `var` | `expression`, `pointDistance`, `pointAngle`, `pointLineDistance` |

代表例です。

```text
point C = between(
  start: A,
  end: B,
  ratio: 0.5
)
line shoulder = polar(
  start: A,
  angle: -12,
  length: 130
)
curve armhole = bezier(
  start: A,
  end: B,
  startAngle: -90,
  startLength: 35,
  endAngle: 180,
  endLength: 45
)
text label = label(
  text: "前身頃",
  anchor: A,
  size: 5
)
```

### パスの向きを反転する

`reverse 線名` は新しい線を作らず、その文より後で使われる対象パスの向きだけを反転します。`start`/`end`、接線、円弧の sweep、Bezier の制御点順も反転します。

```text
line AB = segment(start: A, end: B)
line CB = segment(start: C, end: B)
reverse CB
line seam = offset(sources: [AB, CB], distance: 10, side: right, closed: false)
```

`offset`、`copy`、`mirrorCopy` は sources の順序と向きをそのまま使います。前の線の `end` と次の線の `start` が一致しない場合は結果を作らず、`reverse` または sources の並びを修正する診断を表示します。

`between` と `onLine` の `distance` と `ratio` は排他的です。どちらか一方だけを指定してください。

点と点の距離・角度など、既存点線から数値を求める`var`は次のように書きます。

```text
var 肩幅 = pointDistance(from: A to: B)
```

## 型付き変数(`const` / `let` / `set`)

`var`(数値専用)とは別に、`const`/`let`でレキシカルスコープを持つ型付きの値を宣言できます。宣言には明示的な型注釈が必須です。

| 型 | 構文例 |
| --- | --- |
| `number` | `const ゆとり: number = 12` |
| `string` | `const ラベル: string = "前身頃"` |
| `boolean` | `let 見返し有: boolean = true` |
| `choice` | `const 向き: choice(right, left) = right` |

- `const` は再代入不可。`let` だけが `set 名前 = 式` の対象になれます。
- `set` の効果はその行より後だけに及びます。
- 型付きの`number`は、opt-inのproperty binding(下記)・text template・他の型付き初期化式の中に加えて、座標(`x`/`y`/`dx`/`dy`)や長さ・角度など、要素constructionの数値引数の式の中でも`@名前`として使えます。`const`/`let`のnumber初期化子とnumber型`let`への`set`右辺では、前方にある要素の`@Element.property`も使えます。

### 要素プロパティ参照 `@Element.property`

要素の測定値(長さ・角度など)は、numeric式の中で`@要素名.property`という形で参照します。`@`の後に`.`が続くかどうかだけで、typed binding参照(`@名前`)と要素プロパティ参照(`@要素名.property`)を区別します——`.`が無ければbinding、`.`が現れた時点でプロパティです。binding名と要素名が同じでも、この`.`の有無だけで解決します。

```text
nui 3
const 余白: number = 5
line AB = segment(start: A, end: B)
point C = coordinate(
  x: @余白 + @AB.length,
  y: 0
)
```

`.`を挟まない旧来の裸表記(`AB.length`)は`nui 3`では診断エラーになります。`@AB.length`と書き直してください。typed number式でも同じ表記を使えますが、lazy評価の時点ではなく宣言または`set`行の文書順で判定されるため、後方要素の参照は実行時エラーになります。

### レキシカルスコープとshadow

`group`、`if`/`else`、`for` の `{}` はそれぞれ別のscopeです。宣言はその行から有効で、hoistされません。同名の内側宣言がある場合、宣言前は外側が見え、宣言後は内側がshadowします。内側の宣言はscopeの外へ漏れません。

```text
nui 3
const outer: number = 10
group Scope {
  const usesOuterBeforeShadow: number = @outer
  const outer: number = 20
  const usesInnerAfterShadow: number = @outer
}
const usesOuterAgain: number = @outer
```

`usesOuterBeforeShadow` は外側の `10`、`usesInnerAfterShadow` は内側の `20` を参照します。`group Scope` の外の `usesOuterAgain` は引き続き外側の `10` です。

外側に同名bindingがない状態で自分自身を初期化式内で参照すると `self-initialization`、まだ宣言されていない同scope内の名前を参照すると `forward-binding-reference` という診断が出ます(その宣言だけが無効になり、文書全体は評価を継続します)。

### `set` と 分岐・繰り返し

```text
nui 3
let flag: boolean = true
let total: number = 0
if Branch (@flag) {
  set total = @total + 3
} else {
  set total = 99
}
for Loop (i, from: 0, count: 2, step: 1) {
  set total = @total + 1
}
```

- activeなif分岐での外側`let`更新はif文の後にも残ります。非activeな分岐は実行されず、静的な型検査だけを受けます。
- `for` はiterationをまたいで外側`let`の値を持ち越し、最終値がloop後に残ります。loop内で宣言した型付き変数はiterationごとに再生成され、loop外へは漏れません。
- iteration変数(上記の`i`)はbody内で読み取り専用のnumberとして使えます(`set`対象にはなりません)。

### boolean式

`!`、算術演算、数値比較、`==`/`!=`、`&&`、`||`、括弧が使えます(優先順位はこの順)。stringの等価比較は可能ですが、大小比較や文字列連結はできません。choiceの等価比較は完全一致する型同士だけです。

```text
nui 3
const 見返し有: boolean = true
const ゆとり: number = 12
let 使用する: boolean = @見返し有 && (@ゆとり > 10)
let 除外する: boolean = !@使用する || @ゆとり == 0
```

## text template

型付きのstring/numberは `label(text: "...")` のテキスト埋め込みで使えます(このconstructionが唯一の正準なテキスト作成方法です)。

```text
nui 3
const ラベル: string = "前身頃"
const 個数: number = 2
text 注記 = label(
  text: "\{draft\} {@ラベル}を{@個数}枚カット",
  anchor: none,
  size: 3
)
```

結果は `{draft} 前身頃を2枚カット` になります。`\{`/`\}` はliteral braceとして表示され、`{@ラベル}`のような穴だけが展開されます。stringの穴はそのまま挿入され、numberの穴は既存の最大3桁formatで挿入されます。boolean/choiceの値を穴に入れることはできません(`interpolation-type-mismatch`)。

対応する文字列escapeは次のとおりです: `\\`、`\"`、`\'`、`\n`、`\r`、`\t`、`\{`、`\}`。物理的な複数行にまたがるstring literalは書けません。

## 共通引数

要素callには、construction固有の引数に加えて次の共通引数を付けられます。

```text
point A = coordinate(
  x: 0,
  y: 0,
  state: hidden,
  color: pattern-black,
  steps: [x: 5],
  vars: [縫い代: 10]
)
```

`state` は要素の表示・評価状態を切り替えます。

| `state` | 評価 | 描画 |
| --- | --- | --- |
| (省略 = visible) | する | する |
| `hidden` | する | しない |
| `disabled` | しない | しない |

親が`disabled`ならその配下は評価も描画もされません。親が`hidden`は評価を止めず、描画だけを隠します。`state`と旧`visible`/`enabled`/`locked`を同じstatementに混在させると `element-state-conflict` になります(下記「nui 2以前の文書」参照)。

`state`、`color`、`steps`、`vars` は補完候補に出ます。group の `roles`、`printEnabled` もgroup引数として補完されます。`id`、`varIds`、`parent`、`branch` はインポートやフラット化の表現を保つために受理されますが、通常の編集候補には出ません。

### 型付きproperty binding(opt-in)

一部のproperty引数には、typed booleanやchoiceのbindingを直接渡せます(暗黙変換なし。choiceは宣言optionsの部分集合である必要があります)。

| property | 型 |
| --- | --- |
| `text.text` | string(text template経由) |
| `offsetLine.side` | choice |
| `offsetLine.closed` | boolean |
| `suppressTrimWarnings` | boolean |
| `intersectionPoint.useExtensions` | boolean |
| copy/move/imageの `mirrorX` | boolean |
| `group.printEnabled` | boolean |
| `forGroup.showGenerated` | boolean |

```text
nui 3
const side: choice(right, left) = left
const enabled: boolean = true
line Off = offset(
  sources: [AB],
  distance: 3,
  side: @side,
  closed: @enabled
)
```

## グループ、条件、繰り返し

`group`、`if`、`for` はブロックを作ります。インデントは見た目だけで、`{` と `}` が構造を表します。

```text
group 前身頃 (printEnabled: true, roles: [seam]) {
  point A = coordinate(
    x: 0,
    y: 0
  )
}

let 見返し有: boolean = true
if 見返し (@見返し有) {
  point C = coordinate(
    x: 10,
    y: 10
  )
} else {
  point D = coordinate(
    x: 20,
    y: 20
  )
}

for 繰返し (i, from: 0, count: 3, step: 1) {
  point P = coordinate(
  x: @i * 10,
    y: 0
  )
}
```

`if` の条件と `for` の変数名は先頭の位置引数です。条件には型付きboolean式(`@見返し有`のような単純な参照から、`&&`/`||`/比較を含む式まで)を書けます。`for` では変数名の入力中や直後の空白だけでは名前付き引数候補を出さず、次のキーの入力を始めた時点で補完します。

`group`/`if`/`else`/`for` の `{}` はそれぞれ独立したlexical scopeです(「型付き変数」節参照)。

`@stop` は、その行より前の要素だけを評価する区切りです。

```text
point A = coordinate(x: 0, y: 0)
@stop
point B = coordinate(x: 100, y: 0)
```

## 文書設定と印刷レイアウト

色、表示role/view、印刷レイアウトは専用statementで設定します。

```text
color pattern-black ("#31322f", name: "基本線", default: true)
role seam (name: "縫い代")
view 印刷 (default: true, seam: true)
activeView 印刷

printLayout A4 (
  output: pdf,
  view: 印刷,
  paper: a4,
  orientation: portrait,
  columns: 2,
  rows: 2,
  overlap: 10,
  scale: 1,
  canvas: (410, 584)
) {
  layoutVar margin = 15
  place 前身頃 (at: (0, margin), angle: 0, mirrorX: false)
}
activePrintLayout A4
```

`group.printEnabled` は`state`とは独立した軸で、typed booleanを渡せます(「共通引数」参照)。`disabled`な要素はprintEnabledの値に関わらず評価されないため、印刷にも描画されません。

## 補完

Source Editorは、文法位置に応じて次の順に補完します。

1. statement先頭のkeyword
2. categoryに対応するconstruction、または`const`/`let`/`set`
3. constructionに対応する引数名（`key: ` まで挿入）
4. 既存の値補完（`var`、typed binding、要素参照、record内の値など)

すでにある引数は再提示されません。`distance` または `ratio` を入れた後は、排他的な相手は候補から除外されます。短形式 `var 名前 = 式` はconstruction入力ではなく式として扱います。typed binding参照の補完は、その位置で有効な最内側の同名bindingを1件だけ提示し、無効な宣言は除外します(`set`のtarget補完だけは、回復可能な無効`let`も候補に残します)。choiceの補完・`Alt`によるcycle順は宣言順です。

## 無名要素と安全なrename

名前を省略した要素は有効ですが、名前で直接参照できません。

```text
point = coordinate(x: 0, y: 0)
```

コマンドライン作図で参照が必要になると、無名要素は必要な名前へ同じUndo手順内で昇格します。作成後の改名は `renameSelectedElement`（既定shortcut: F2）を使います。

このrenameはSource Editorをflushし、クリーンに解決できる文書だけで実行します。成功時は対象statementと必要な参照statementだけを変更し、1回のrenameは1 Undoです。同一scopeの衝突、dangling参照の捕獲、shadowingなどで参照解決が変わる場合は拒否されます。DSLテキストを直接編集しても参照の自動伝播は行いません。

## nui 2以前の文書

これは現行の推奨workflowではなく、既存文書を開いたときに関係する互換の説明です。新規に文書を書くときは前節までの `nui 3` 構文を使ってください。

### `nui 2` 文書

`nui 2` は `nui 3` の前段のバージョンで、`const`/`let`/`set`、`state:`は使えません(使おうとすると`typed-syntax-requires-nui3`という診断が出ます)。要素の表示・評価は`state:`ではなく次の共通引数で制御します。

```text
point A = coordinate(
  x: 0
  y: 0
  locked: true
  visible: false
  enabled: true
)
```

`visible`は描画だけを、`enabled`は評価だけを制御します(`disabled`相当は`enabled: false`)。`locked`はsource-authoritativeな現在のエディタでは意味を持たず、互換のため読み込み時に警告付きで受理されます。

`nui 2`文書は、Source Editorの診断に出るQuick Fix「nui 3 へアップグレード」で、本文を書き換えずにヘッダーだけ`nui 3`へ変更できます。その後は`const`/`let`/`set`/`state:`が使えるようになりますが、呼び出し引数は自動変換されません。旧来のスペース区切りにはカンマ不足の診断が出るため、案内に従って手動でカンマを追加してください。

### `nui 1` 文書を開く

既存の `nui 1` `.nui` ファイルは、open時に1回だけ正準 `nui 2` へ変換して開きます。変換後は未保存として扱われ、保存すると `nui 2` になります。変換ではv1のコメントと手書きレイアウトは保持されません。壊れたv1文書は部分変換せず、診断を表示して開きません。

旧 `.nuinui.json` は明示的なレガシーインポート入力だけに対応し、保存先にはなりません。
