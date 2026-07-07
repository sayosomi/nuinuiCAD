# nuinuiCAD DSL

nuinuiCAD DSL は、GUIで要素を1つずつ作る代わりに、テキストで作図要素を追加・編集するための記法です。

現在の主な用途は、選択範囲を書き出して編集し、同じ `id=...` の既存要素へパッチ適用することです。適用すると通常のCAD要素に変換されるので、適用後はこれまで通りGUIで選択、編集、移動、削除できます。

将来的にはDSLファイルだけから作図内容を再構築する単体インポート・エクスポートにも対応する方針です。そのため、DSLは既存GUI要素型に対応する構文を優先して拡張しています。

## 開き方

コマンドパレットで `DSLパネル` を実行します。

DSLパネルでは次の操作ができます。

- `選択を書き出し`: 選択中の要素と、その評価に必要な親要素・依存元をDSLへ変換します。何も選択していない場合は全要素を書き出します。
- `検証`: DSLを読み取り、適用できるか確認します。
- `適用`: DSLから要素を作成または更新します。

## 基本ルール

- 1行に1要素を書きます。
- `#` から行末まではコメントです。
- 単位はmmです。
- 座標はY-upです。上方向が正、下方向が負です。
- 要素は上から順に作られます。後の行から前の行を参照できます。
- `id=...` が既存要素と一致すると、その要素を更新します。
- `id=...` がない行は、同じ名前と同じ種類の既存要素があれば更新し、なければ新規作成します。
- 選択範囲の書き出しでは、選択グループの中身、親要素、評価に必要な依存元も文書順で含めます。依存解決のための自動並べ替えはしません。
- 自動で含めた依存元が評価OFF、評価エラー、順序違いの場合は、DSLパネル上で警告します。

## 選択書き出しの区分コメント

選択範囲を書き出すと、各要素の直前に `# @dsl-export: ...` コメントが入ります。
このコメントはDSLとしては通常のコメントなので、検証や適用では無視されます。

```text
# @dsl-export: parent 親要素
group 前身頃 id=group-front expanded=true

# @dsl-export: dependency 選択要素の評価に必要
point A = (0, 0) id=point-a

# @dsl-export: selected 実際に選択
line AB = point-a -> point-b id=line-ab parent=group-front
```

区分は次の意味です。

- `selected`: 実際に選択した要素です。
- `group-content`: 選択したグループに含まれる要素です。
- `parent`: `parent=...` の構造を保つために含めた親要素です。
- `dependency`: 選択要素の評価に必要な参照元です。

警告がある行には `warning=disabled`、`warning=invalid`、`warning=too-late` が付きます。
`too-late` は参照先が元の文書順で参照元より後にあることを示します。nuinuiCADは文書順評価を守るため、書き出し時に順序を自動修正しません。

## 例

```text
# バスト基準の簡単な作図
var bust = 840

point A = (0, 0)
point B = offset A dx=0 dy=-(bust / 4)
point C = offset B dx=80 dy=0

line AB = A -> B
line BC = B -> C

arc armhole center=A radius=120 start=0 end=-90
text label = "前中心" at=A size=4
```

## 点

固定座標の点:

```text
point A = (0, 0)
```

基準点からのXYオフセット:

```text
point B = offset A dx=30 dy=-120
```

基準点から角度と距離で作る点:

```text
point C = polar A angle=-45 distance=80
```

2点間の分点:

```text
point D = between A B ratio=0.5
point E = between A B distance=30
```

線・曲線上の分点:

```text
point F = on AB.start ratio=0.25
point G = on neckline.end distance=20
```

線・曲線の交点:

```text
point X = intersection AB neckline index=0 extensions=false
```

線・曲線の接線方向から作る点:

```text
point H = tangentOffset armhole base=A angle=90 distance=12
```

## 線

2点を結ぶ線:

```text
line AB = A -> B
```

始点、角度、長さで作る線:

```text
line shoulder = from A angle=-12 length=130
```

既存線・曲線の分割:

```text
line lower = split armhole at=F
```

線・曲線の端点を指定点へ延長・短縮:

```text
line adjusted = extend shoulder.end to=G
```

線・曲線のオフセット:

```text
line seam = offset [AB,armhole,BC] distance=10 side=left closed=false
```

Bezier曲線:

```text
curve armhole = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45
```

中間点を含める場合:

```text
curve armhole = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45 intermediates=[C:45:20:25]
```

## 円弧とテキスト

```text
arc neckline center=A radius=90 start=180 end=270
text label = "前身頃" at=A size=5
```

3点円弧:

```text
arc neckline = through A B C start=180 end=270
```

角R円弧:

```text
arc corner = corner shoulder.end side.start radius=10 index=0
```

## 変数と式

変数は `var` で定義します。

```text
var bust = 840
var quarterBust = bust / 4
point B = offset A dx=0 dy=-quarterBust
```

既存の数値式と同じように、線や曲線の測定値も参照できます。

```text
var hem = AB.length + 20
```

## 既存要素の編集

要素を書き出すと `id=...` が入ります。そのIDを残したまま値を変えて `適用` すると、同じ要素が更新されます。

```text
point A = (10, 20) id=freePoint-abc123
```

IDを消すと、新しい要素として追加されます。

## 全要素向けの共通構文

短い専用構文がない要素は `element` 構文で編集できます。

```text
element seam type=offsetLine baseLineIds=[AB,BC] offset=10 side=left closed=false
```

`type=` には既存の要素タイプ名を指定します。

よく使う属性:

- `id`: 更新対象の要素ID
- `name`: 表示名
- `visible`: 表示するか
- `enabled`: 評価するか
- `color`: 表示色ID
- `parent`: 親グループIDまたは名前
- `branch`: `then` または `else`

参照は名前でもIDでも書けます。名前が重複している場合はエラーになります。

## 点参照

点そのもの:

```text
A
```

線や曲線の派生点:

```text
AB.start
AB.end
neckline.center
```

座標を直接指定できるパラメータでは、次のようにも書けます。

```text
(0, -100)
```

## 注意

DSLとGUIは自動で双方向同期しません。

GUIで編集した内容をDSLに戻したい場合は、対象要素を選択してもう一度 `選択を書き出し` を実行してください。
