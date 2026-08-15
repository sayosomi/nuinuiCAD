# nuinuiCAD DSL (`nui 4`)

`.nui` は nuinuiCAD の保存形式です。`sourceText` が文書の唯一の正で、Source Editor の編集結果が Canvas、Inspector、評価結果へ反映されます。単位は mm、作図座標は Y-up（上が正）です。現在の保存形式と実装対象は `nui 4` だけです。nui3 の互換 parser、converter、importer はありません。

Source Editor の値は直接編集できます。数値・boolean・choice は `Alt+←` / `Alt+→` でも変更できます。Inspector は読み取り専用で、値の編集は Source Editor または command line から行います。

## 基本ルール

- 最初の意味のある行は `nui 4` です。
- 要素は文書順に評価されます。参照先は前にあり、`disabled` ではなく、有効な形状・値でなければなりません。順序の自動修復は行わず、診断で示します。
- 要素とコンテナの activity は `visible`、`hidden`、`disabled` のいずれかです。`hidden` は評価・参照できますが描画されず、`disabled` は評価されません。
- `#` から行末はコメントです。Canvas と command は statement 単位の splice を使うため、無関係なコメント、空行、手書きのレイアウトを保持します。
- 引数は `key: value` で、複数引数はカンマで区切ります。canonical な複数行 call では末尾カンマを付けます。

## 参照とスカラー

参照には必ず `@` を付けます。名前空間や派生値は `::` と `.` で辿ります。

```text
const seam: number = 5
let angle: number = 90
set angle = 180
const showDetail: boolean = @seam > 0 and not (@angle < 0)

point A = coordinate(
  x: 0,
  y: 0,
)

point B = coordinate(
  x: 100,
  y: 0,
)

line AB = segment(
  start: @A,
  end: @B,
)

const endX: number = @AB.end.x
```

### 算術演算子

数値式では `+`、`-`、`*`、`/`、`%`、`^` を使えます。`%` は percent ではなく
remainder（剰余）です。`^` は右結合で unary より強く、`%` は `*` / `/` と同じ
優先順位で左結合です。

```text
const power: number = 2 ^ 3       # 8
const remainder: number = 5 % 3   # 2
const right: number = 2 ^ 3 ^ 2    # 512
const unary: number = -2 ^ 2       # -4
const negative: number = 2 ^ -2    # 0.25
```

剰余の 0 除算や、`^` の結果が有限値にならない計算は evaluation error です。

### 組み込み数値関数

nui4 の型付き式では、次の組み込み関数を使えます。

```text
abs(number) -> number
min(number, number) -> number
max(number, number) -> number
sqrt(number) -> number
round(number) -> number
round(number, number) -> number
floor(number) -> number
floor(number, number) -> number
ceil(number) -> number
ceil(number, number) -> number
roundTo(number, number) -> number
isClose(number, number, number) -> boolean
sin(number) -> number
cos(number) -> number
tan(number) -> number
asin(number) -> number
acos(number) -> number
atan(number) -> number
atan2(number, number) -> number
spreadAngle(length: number, spread: number) -> number
distance(point, point) -> number
angle(point, point) -> number
lineDistance(point, line) -> number
lineAngle(line, line) -> number
```

scalar-only builtin は、宣言、`set` の右辺、条件式、文字列補間、scalar
property、module の scalar 引数・body で利用できます。geometry-argument
builtin (`distance`、`angle`、`lineDistance`、`lineAngle`) は、既存の
geometry reference resolution 経路がある typed declaration initializer、
`set` の右辺、module の scalar expression で直接利用できます。

```text
const rounded: number = round(@seam / 2, 1)
const closeEnough: boolean = isClose(@seam, 100, 0.5)
const opening: number = spreadAngle(
  length: 100,
  spread: 20,
)
set angle = roundTo(@angle, 15)
text note = label(text: "幅 ${round(@seam, 1)}mm", anchor: @A, size: 3)
```

例えば geometry measurement の結果を一度 typed scalar binding に入れます。

```text
const measuredAngle: number = lineAngle(@LineA, @LineB)
point P = coordinate(x: @measuredAngle, y: 0)
```

construction numeric parameter、scalar property、text-template hole、
`printLayout` の numeric parameter で geometry measurement result を使う場合も、
このように `@measuredAngle` のような binding を参照します。Task 4 では、これらの
surface に geometry builtin 専用の evaluator / resolver 経路を追加していません。

`round`、`floor`、`ceil` の桁数は整数で、`round` の .5 はゼロから遠ざかる
方向に丸めます（`round(1.5)` は `2`、`round(-1.5)` は `-2`）。
`roundTo` の step は正数、`isClose` の tolerance は 0 以上である必要があります。
`sin`、`cos`、`tan` の入力角度と、`asin`、`acos`、`atan` の出力角度は degree
です。`asin` と `acos` の入力は `[-1, 1]` に限られ、`tan` は 90° の奇数倍
そのものを入力すると evaluation error になります。`atan2` は `atan2(y, x)` の
順で、結果は `[0, 360)` degree に正規化されます（右 0°、上 90°、左 180°、
下 270°、`atan2(0, 0)` は 0）。
`spreadAngle(length: number, spread: number)` は `spread` を弦長として、
`theta = 2 * asin(spread / (2 * length))` を degree で返します。`length > 0`、
`0 <= spread <= 2 * length` が必要で、結果は `0..180`° です。`spread = 0` は
0°、`spread = 2 * length` は 180° になります。引数または結果が有限値でない
場合も evaluation error です。
引数の型・個数が違う場合や計算結果が有限値でない場合は、診断として表示されます。
暗黙の数値変換はありません。

### scalar 関数の named arguments

named calling style を宣言した scalar builtin では、引数名と式を
`name: expression` の形で書けます。

```text
someFunction(
  second: 2,
  first: 1,
)
```

named argument の順序は意味を持ちません。複数行の引数リストでは末尾の
comma を使えます。parameter の名前・型・canonical order は builtin の
signature metadata が所有します。positional-only と named-only は semantic
に区別され、v1 では positional と named の混在は無効です。unknown、duplicate、
missing の named argument は診断になります。現在の builtin catalog は
既存 builtin では positional-only のままですが、`spreadAngle` は最初の production
named-only scalar builtin です。既存関数を遡って named-call 化は行いません。検証に
成功した named call は runtime では既存の canonical な positional typed arguments に
lower され、argument name は runtime payload に入りません。

論理演算子は `and`、`or`、`not` です。`var`、裸の名前参照、`&&` / `||` / `!` は nui4 の入力構文ではありません。型付き宣言は `const`、`let`、`set` を使います。

## 要素、グループ、制御

代表的な要素の宣言は category、名前、construction の順です。construction の参照値にも `@` を付けます。

```text
point C = between(
  start: @A,
  end: @B,
  ratio: 0.5,
)

group 前身頃 {
  line stitching = segment(
    start: @A,
    end: @B,
  )
}
```

条件分岐と反復には名前を付けません。反復変数は body 内の束縛で、参照時は `@` が必要です。

```text
if (@showDetail) {
  text note = label(
    text: "前身頃",
    anchor: @A,
    size: 3,
  )
}

for i in range(
  from: 0,
  count: 3,
  step: 1,
) {
  point notch = coordinate(
    x: @i * 10,
    y: 0,
  )
}
```

`if Name (...)`、`for Name (...)`、`{@name}`、`@stop` は廃止されています。

### Bezier方向極値点

`bezierExtremePoint` は、指定した cubic Bezier の区間で、指定方向への
射影が最大になる点を作図します。

```text
point 上端 = bezierExtremePoint(
  source: @ベジェ線,
  direction: 90,
)
```

`source` は必須です。`segmentIndex` は数値で、省略時は `0` です。canonical
serialization では省略した場合も次のように `segmentIndex: 0` が明示されます。

```text
point 上端 = bezierExtremePoint(
  source: @ベジェ線,
  segmentIndex: 0,
  direction: 90,
)
```

`direction` は必須の degree 値で、`0` が右、`90` が上、`180` が左、`270` が下です。
負の値と 360 を超える値は既存の角度 helper で `[0, 360)` に正規化されます。
`segmentIndex` は有限な 0 以上の整数で、対象区間の範囲内でなければなりません。
`direction` も有限値でなければなりません。

選択した cubic Bezier を `B(t)`、方向の単位ベクトルを `V` とすると、結果は
`dot(B(t), V)` が `0 <= t <= 1` で最大になる点です。候補は両端点と、
`dot(B'(t), V) = 0` を満たす区間内部の停留点です。候補の値が同値なら `t = 0.5`
に近いものを選び、中央からの距離も同じなら小さい `t` を選びます。射影が全区間で
flat の場合は `t = 0.5` です。

`source` は source 要素の型名ではなく、評価時の computed geometry の `kind` が
`bezierCurve` である必要があります。そのため通常の split、trim、extend が生成した
Bezier geometry は利用できますが、直線、円弧、offset line の結果はエラーになります。

### Bezier最大膨らみ点

`bezierBulgePoint` は、指定した cubic Bezier の1区間について、始点と終点を通る
基準線からの膨らみが最大になる点を作図します。

```text
point 膨らみ点 = bezierBulgePoint(
  source: @ベジェ線,
)
```

`source` は必須です。`segmentIndex` は数値で、省略時は `0` です。canonical
serialization では省略した場合も `segmentIndex: 0` が明示されます。指定できるのは
1つの cubic Bezier 区間だけで、区間番号は有限な 0 以上の整数かつ範囲内でなければなりません。

選択区間を `P0, P1, P2, P3`、その曲線を `B(t)` (`0 <= t <= 1`) とし、`D = P3 - P0`、
`L = |D|` とします。候補は `cross(D, B'(t)) = 0` を満たす区間内部の停留点です。
各候補の score は符号を持たない基準線からの垂直距離
`abs(cross(D, B(t) - P0)) / L` で比較します。そのためS字曲線では基準線の上下両側の
absolute distanceを比較します。端点は通常候補に含めず、flatな曲線では `t = 0.5` を
候補にします。score、`t = 0.5` への近さ、最後に小さい `t` という共通のtie-breakを使います。

`L <= EPSILON` の退化したchordは、基準線を定義できないgeometry errorになります。
完全にchord上のBezierは膨らみ `0` で、parameter `t = 0.5` を返します。
`source` は宣言型ではなく評価時の computed geometry の `kind` が `bezierCurve` である必要があり、
original Bezierとsplit/trim/extend後もBezier kindの結果を受け付けます。line、arc、offset line
など別のkindはgeometry error、missingまたはdisabled sourceはdependency errorです。

## モジュール

定義は `module`、呼び出しは `instance` と明示的に区別します。定義は instance より前に置き、引数は名前付きで渡します。

```text
module Panel(
  base: point,
  seam: number,
) {
  const halfSeam: number = @seam / 2

  export line outline = segment(
    start: @base,
    end: @base,
  )
}

instance front(state: hidden) = Panel(
  base: @A,
  seam: @seam,
)

reverse(
  target: @front::outline,
)
```

モジュールは外側の値を暗黙 capture しません。必要な値は signature の parameter として渡します。`export` された値は `@front::name` で参照できます。

## 文字列、停止、printLayout

文字列の補間は `${...}` です。中の式も通常の nui4 参照・型付き式として評価されます。

```text
text note = label(
  text: "縫い代 ${@seam} mm",
  anchor: @A,
  size: 3,
)
```

文書末尾の terminator は裸の `stop` です。

`printLayout` の body は通常の scope です。layout 専用の `layoutVar` はなく、ローカル `const` / `let` / `set` と `place @...` を使います。

`printLayout` は文書末尾の section です。`stop` を使う場合は `printLayout` より前に置きます。
header と `place` の numeric value は通常の typed number expression なので、`^` と
`%` も利用できます。

```text
stop

printLayout A4(
  width: 210,
  height: 297,
) {
  const margin: number = 10

  place @前身頃(
    x: @margin,
    y: @margin,
    angle: 0,
    mirrorX: false,
  )
}
```

## 編集と診断

Source Editor が canonical な保存形式を出力します。Inspector は表示と該当 source span への移動を担当し、フォームとして値を書き換えません。依存関係、型、activity、名前解決の問題は黙って修復せず、対象 element と原因を含む診断として表示します。
