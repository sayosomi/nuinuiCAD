# nuinuiCAD DSL (`nui 2`)

`.nui` は nuinuiCAD の保存形式です。Source Editor の `sourceText` が文書の唯一の正で、編集内容は再コンパイルされてCanvas、Inspector、評価結果へ反映されます。単位は mm、作図座標は Y-up（上が正）です。

Source Editor の値は直接編集できます。数値など対応する値は `Alt+←` / `Alt+→` でも変更できます。Inspector は表示と該当値への移動だけを行う読み取り専用UIです。

## 基本ルール

- 最初の意味のある行は `nui 2` です。
- 要素・変数は文書順に評価されます。参照先は前にあり、enabled で、有効な形状でなければなりません。順序や依存関係は自動修復されず、診断で示されます。
- `visible` は描画だけを制御し、`enabled` は評価を制御します。非表示の要素は参照できますが、disabled の要素は計算結果を作りません。
- `#` から行末はコメントです。Canvasとコマンドは対象statementだけを変更するため、無関係なコメント、空行、手書きの並びは保持されます。
- 要素名は引用できます。参照には名前、修飾名 `グループ::要素`、派生点 `線.start` などを使います。

通常の要素は category、任意の名前、construction call で書きます。引数は `key: value` で、コロンの後には空白が必要です。カンマは不要です。

```text
nui 2

var bust = 840
point A = coordinate(
  x: 0
  y: 0
)
point B = offset(
  from: A
  dx: 0
  dy: -(@bust / 4)
)
line AB = segment(
  start: A
  end: B
)
```

1行のcallも入力できますが、通常の保存・コマンド更新では1引数1行の縦型形式になります。`var 名前 = 式` は式変数の短形式です。

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
  start: A
  end: B
  ratio: 0.5
)
line shoulder = polar(
  start: A
  angle: -12
  length: 130
)
curve armhole = bezier(
  start: A
  end: B
  startAngle: -90
  startLength: 35
  endAngle: 180
  endLength: 45
)
text label = label(
  text: "前身頃"
  anchor: A
  size: 5
)
```

`between` と `onLine` の `distance` と `ratio` は排他的です。どちらか一方だけを指定してください。

### 共通引数

要素callには、construction固有の引数に加えて次の共通引数を付けられます。

```text
point A = coordinate(
  x: 0
  y: 0
  locked: true
  visible: false
  enabled: true
  color: pattern-black
  steps: [x: 5]
  vars: [縫い代: 10]
)
```

`locked`、`visible`、`enabled`、`color`、`steps`、`vars` は補完候補に出ます。group の `roles` もgroup引数として補完されます。`id`、`varIds`、`parent`、`branch` はインポートやフラット化の表現を保つために受理されますが、通常の編集候補には出ません。

## グループ、条件、繰り返し

`group`、`if`、`for` はブロックを作ります。インデントは見た目だけで、`{` と `}` が構造を表します。

```text
group 前身頃 (printEnabled: true roles: [seam]) {
  point A = coordinate(
    x: 0
    y: 0
  )
}

if 見返し (@見返し有 > 0) {
  point C = coordinate(
    x: 10
    y: 10
  )
} else {
  point D = coordinate(
    x: 20
    y: 20
  )
}

for 繰返し (i from: 0 count: 3 step: 1) {
  point P = coordinate(
    x: i * 10
    y: 0
  )
}
```

`if` の条件と `for` の変数名は先頭の位置引数です。`for` では変数名の入力中や直後の空白だけでは名前付き引数候補を出さず、次のキーの入力を始めた時点で補完します。

`@stop` は、その行より前の要素だけを評価する区切りです。

```text
point A = coordinate(x: 0 y: 0)
@stop
point B = coordinate(x: 100 y: 0)
```

## 文書設定と印刷レイアウト

色、表示role/view、印刷レイアウトは専用statementで設定します。

```text
color pattern-black ("#31322f" name: "基本線" default: true)
role seam (name: "縫い代")
view 印刷 (default: true seam: true)
activeView 印刷

printLayout A4 (
  output: pdf
  view: 印刷
  paper: a4
  orientation: portrait
  columns: 2
  rows: 2
  overlap: 10
  scale: 1
  canvas: (410, 584)
) {
  layoutVar margin = 15
  place 前身頃 (at: (0, margin) angle: 0 mirrorX: false)
}
activePrintLayout A4
```

## 補完

Source Editorは、文法位置に応じて次の順に補完します。

1. statement先頭のkeyword
2. categoryに対応するconstruction
3. constructionに対応する引数名（`key: ` まで挿入）
4. 既存の値補完（変数、要素参照、record内の値など）

すでにある引数は再提示されません。`distance` または `ratio` を入れた後は、排他的な相手は候補から除外されます。短形式 `var 名前 = 式` はconstruction入力ではなく式として扱います。

## 無名要素と安全なrename

名前を省略した要素は有効ですが、名前で直接参照できません。

```text
point = coordinate(x: 0 y: 0)
```

コマンドライン作図で参照が必要になると、無名要素は必要な名前へ同じUndo手順内で昇格します。作成後の改名は `renameSelectedElement`（既定shortcut: F2）を使います。

このrenameはSource Editorをflushし、クリーンに解決できる文書だけで実行します。成功時は対象statementと必要な参照statementだけを変更し、1回のrenameは1 Undoです。同一scopeの衝突、dangling参照の捕獲、shadowingなどで参照解決が変わる場合は拒否されます。DSLテキストを直接編集しても参照の自動伝播は行いません。

## `nui 1` 文書を開く

既存の `nui 1` `.nui` ファイルは、open時に1回だけ正準 `nui 2` へ変換して開きます。変換後は未保存として扱われ、保存すると `nui 2` になります。変換ではv1のコメントと手書きレイアウトは保持されません。壊れたv1文書は部分変換せず、診断を表示して開きません。

旧 `.nuinui.json` は明示的なレガシーインポート入力だけに対応し、保存先にはなりません。
