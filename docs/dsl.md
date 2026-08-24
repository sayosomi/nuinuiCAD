# nuinuiCAD DSL (`nui 4`)

`.nui` は nuinuiCAD の保存形式です。`sourceText` が文書の唯一の正で、Source Editor の編集結果が Canvas、Inspector、評価結果へ反映されます。単位は mm、作図座標は Y-up（上が正）です。現在の保存形式と実装対象は `nui 4` だけです。nui3 の互換 parser、converter、importer はありません。

Source Editor の値は直接編集できます。数値・boolean・choice は `Alt+←` / `Alt+→` でも変更できます。Inspector は読み取り専用で、値の編集は Source Editor または command line から行います。

## 基本ルール

- 最初の意味のある行は `nui 4` です。
- 要素は文書順に評価されます。参照先は前にあり、`disabled` ではなく、有効な形状・値でなければなりません。順序の自動修復は行わず、診断で示します。
- 要素とコンテナの activity は `visible`、`hidden`、`disabled` のいずれかです。`hidden` は評価・参照できますが描画されず、`disabled` は評価されません。
- 通常のコメントは `//` から行末、または `/* ... */` のブロックです。`///` は通常の `//` コメントのうち Module documentation として意味を持つ形式です。`#` はコメント開始記号ではなく通常のソース文字です。Canvas と command は statement 単位の splice を使うため、無関係なコメント、空行、手書きのレイアウトを保持します。
- 引数は `key: value` で、複数引数はカンマで区切ります。canonical な複数行 call では末尾カンマを付けます。

## Module documentation comments

Module definition、Module parameter、Module body の `export` declaration には、`///` documentation comment で説明を記述できます。documentation は runtime geometry / evaluation semantics を変更せず、同じ `.nui` source file 内の Module semantic identity に source-semantic metadata として保持されます。

Documentation comment は次の declaration へ前向きに関連付けられます。

- Module 定義の前の `///` group → 次の `module` definition
- Module parameter list 内の `///` group → 次の parameter
- Module body 内の `///` group → 次の `export` declaration
- 空行や通常の `//` / `/* ... */` comment は association を切りません
- 実際の DSL code / declaration が途中にあれば、その地点で association は消費・切断され、後ろへ飛び越えません
- 同じ target の前に複数の `///` group があれば source order で連結されます
- 行末の trailing `///` は直前 declaration へ後付けされません

### Locale と Markdown

`/// @<locale>` で明示的な locale section を開始します。locale ID は `ja` / `en` に限定されず、`fr`、`de`、`pt-br` など VS Code-style の任意の値を保持できます。locale marker 自体は Markdown 本文には表示されません。

```nui
/// @ja
/// ポケットを生成する。
///
/// **縫い代**は含まない。
/// @en
/// Creates a pocket.
///
/// Does not include **seam allowance**.
module Pocket(
  /// @ja
  /// ポケットの幅。
  /// @en
  /// Pocket **width**.
  width: number,
) {
  /// @ja
  /// 公開された基準点。
  /// @en
  /// Exported **reference point**.
  export point Public = coordinate(x: 0, y: 0)
}
```

同じ target の同一 locale section は source order で連結され、空の section は無視されます。最初の明示的 locale marker より前に書かれた `///` payload へ implicit locale は推測しません。documentation の形式不備や locale-less block は documentation metadata がないものとして扱われ、otherwise-valid な DSL の compile/evaluation を失敗させません。

VS Code native Completion と Signature Help では、表示 locale に対して次の順序で authored documentation variant を選びます。

1. current VS Code display locale と完全一致する locale
2. `en`
3. source order で最初に authored された non-empty locale

base-language fallback はありません。たとえば display locale が `pt-br` でも `@pt` へ暗黙 fallback しません。user-authored documentation の locale 選択は nuinuiCAD-owned UI localization とは別です。

### VS Code native presentation

現行のpresentation surfaceは VS Code native language features です。

- Module callee Completion → Module documentation
- Module argument-name Completion → matching parameter documentation
- `@instance::export` qualified Completion → export documentation
- Module Signature Help → Module documentation
- active / listed Module parameter の Signature Help → corresponding parameter documentation

Authored Markdown は native `CompletionItem.documentation` / Signature Help documentation へ投影されます。documentation は untrusted のままで、command URI や trusted HTML の実行を許可しません。dirty な current in-memory `.nui` source が authoritative source であり、stale semantic metadata は表示しません。

SAY-18 の v1 は同一 `.nui` file 内の Module documentation authoring / semantic metadata / native presentation が対象です。imported Module documentation の cross-file transport は別の downstream scope です。

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

### 組み込み関数

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
string(choice(...)) -> string
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
const side: choice(right, left) = right
const sideText: string = string(@side)
set angle = roundTo(@angle, 15)
text note = label(text: "幅 ${round(@seam, 1)}mm", anchor: @A, size: 3)
text sideNote = label(text: "side=${string(@side)}", anchor: none, size: 3)
```

`string(choice(...)) -> string` は choice 値を明示的に文字列化する positional
builtin です。任意の**具体的な** `choice(...)` 型を受け取り、現在選択されている
canonical option token をそのまま `string` として返します。display label や locale
には依存しません。`number` / `boolean` / `string` は受け付けず、暗黙変換も追加しません。
また `string(right)` のような bare choice literal から option set を推論しないため、
具体的な choice 型が確定している binding/reference などを渡します。

例えば geometry measurement の結果を一度 typed scalar binding に入れます。

```text
const measuredAngle: number = lineAngle(@LineA, @LineB)
point P = coordinate(x: @measuredAngle, y: 0)
```

construction numeric parameter、scalar property、text-template hole、
layout / print / svg の numeric parameter で geometry measurement result を使う場合も、
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

## 不変 geometry 配列

nui4 で名前を持つ geometry 配列型は、正確に `point[]`、`line[]`、`path[]` の3種類です。
配列値は不変なので `const` だけで宣言し、`let` / `set` は使えません。

```text
const points: point[] = [@A, @B]
const seamLines: line[] = [@AB]
const outline: path[] = [@AB, @curve]
const emptyPaths: path[] = []
const copyOfOutline: path[] = @outline
```

配列 literal は source 順をそのまま保持し、同じ参照を複数回書いた場合も重複を保持します。
空配列 `[]` は期待される配列型が分かる位置で有効です。配列そのものを参照するときも通常の
value reference と同じく `@` が必要で、source order、lexical scope、Module private/export
の規則に従います。

- `point[]` の各 member は point interface を満たす必要があります。
- `line[]` は strict `line` だけを受け付けます。
- `path[]` は broad line-like geometry を受け付け、line、arc、Bezier などを格納できます。
- `line[]` は `path[]` を期待する位置へ渡せます。逆方向の `path[] -> line[]` はできません。
- point 配列と line/path 配列の間に暗黙変換はありません。

既存の broad line-list consumer、たとえば `offset.sources`、`transformCopy.baseLines`、
`mirrorCopy.baseLines`、`move.targets`、`mirrorMove.targets` は `path[]` を期待します。
そのため inline literal と名前付き配列は同じ意味で使えます。

```text
const targets: path[] = [@肩線, @脇線]

move(
  targets: @targets,
  from: @A,
  to: @B,
  scale: 1,
  angleDeg: 0,
  mirrorX: false,
)
```

名前付き配列を consumer へ渡しても source は `@targets` のまま保持され、保存時に
inline literal へ展開されません。一般-purpose collection API、index access、spread、
nested array、scalar array はこの geometry 配列機能には含まれません。

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

### Drawing Modifier とプロファイル

`profile` はトップレベルの Drawing Profile 宣言です。通常の source lexical
namespace に属し、宣言より前の参照は解決されません。modifier の `for` は
`@profile` を受け取り、共通プロパティに対する profile 別の差分を定義します。

```text
profile 印刷用
profile SVG用

modifier 型紙線 {
  state: visible,
  width: 1px,
  style: solid,
  color: foreground,

  for @印刷用 {
    width: 0.5px,
  }
}
```

modifier のプロパティは独立しており、`state`（`visible` / `hidden` /
`disabled`）、正の有限な `width`（px）、`style`（`solid` / `dashed` /
`dotted`）、`color`（テーマロールまたは `#RRGGBB`）を指定できます。旧形式の
`stroke: 1px solid foreground` は受け付けません。modifier は profile 差分だけ
でも定義できますが、`for @profile` ブロックの中には4つのプロパティ以外を
書けません。重複プロパティと、同じ解決済み profile への重複差分は診断になります。

実効値は外側の group、内側の group、要素の順に継承し、各 owner 内の modifier
リストは左から右へ適用します。値はプロパティ単位でマージされ、未指定値は
`1px solid foreground` です。選択した Drawing Profile がある場合は、共通値へ
その profile の差分を上書きします。直接指定または祖先の activity が visible
のときだけ modifier の state を適用し、hidden は評価するが描画せず、disabled
は評価も参照もできません。

### arc の進行方向

concrete `arc(...)` は `direction: counterclockwise | clockwise` で始角度から終角度への進行方向を指定できます。省略時は `counterclockwise` と同じ意味ですが、canonical serializer は常に `direction` を明示します。

```nui
arc A = arc(
  center: @C,
  radius: 20,
  start: 0,
  end: 90,
  direction: counterclockwise,
)

arc B = arc(
  center: @C,
  radius: 20,
  start: 90,
  end: 0,
  direction: clockwise,
)
```

runtime の方向は signed `sweepAngleDeg` が正です。反時計回りは正、時計回りは負です。`start == end` は 0 sweep で、`0 -> 360` のように明示した full turn は `counterclockwise` なら `+360`、`clockwise` なら `-360` になります。`through(...)` と `corner(...)` には `direction` 引数を追加しません。

### tangentOffset の曲率側

`tangentOffset` は、接線からの角度で方向を指定する既存の angle mode に加えて、
cubic Bezier の曲率側を指定できます。

```text
point 外側 = tangentOffset(
  line: @ベジェ線,
  base: @基準点,
  curveSide: convex,
  distance: 3,
)
```

`curveSide` は `convex` または `concave` です。`angle` と `curveSide` は同時に
指定できません。どちらも省略した場合は既存互換の `angle: 0` として扱います。
保存時は angle mode なら `angle`、curve-side mode なら `curveSide` だけが出力されます。

curve-side mode は、評価後の `computedGeometry.kind` が `bezierCurve` の場合だけ利用できます。
通常の Bezier に加えて、split、trim、extend、pathReverse 後も Bezier の computed geometry
であれば利用できます。line、arc、offset line などはエラーになります。基準点は既存の
0.001 mm tolerance で曲線上にある必要があり、距離は 0 以上です。接線が 0、曲率が
直線または inflection になる点、曖昧な内部 join では fail closed でエラーになります。

`curveSide` の choice 値は Source Editor の completion と `Alt+←` / `Alt+→` の共通 choice
操作に対応します。Inspector は read-only のままです。

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
  seam?: number,
  label?: string,
) {
  if (hasValue(@seam)) {
    const halfSeam: number = @seam / 2
  }

  export line outline = segment(
    start: @base,
    end: @base,
  )
}

instance front(state: hidden) = Panel(
  seam: @seam,
  base: @A,
)

reverse(
  target: @front::outline,
)
```

同じ名前の caller value を同名 parameter へ渡す場合は、simple relative reference
`@name` を Module argument shorthand として書けます。`@width` は
`width: @width` と完全に同じ named argument であり、positional argument ではありません。

```text
const width: number = 120

module Pocket(width: number) {
  ...
}

instance pocket = Pocket(
  @width,
)
```

shorthand にできるのは `@width`、`@縫い代幅`、`@"name with spaces"` のような、
相対・1 name segment・property なしの参照だけです。`@front::width`、`@::width`、
`@settings.width`、literal、式は shorthand にならず、通常の `name: expression` を使います。
explicit named form は常に利用できます。同じ parameter が shorthand と explicit form の両方で
指定された場合は duplicate argument の診断になります。

モジュールは外側の値を暗黙 capture しません。必要な値は signature の parameter として渡します。`export` された値は `@front::name` で参照できます。

Module parameter には scalar / 単体 geometry に加えて `point[]`、`line[]`、`path[]` を指定できます。
geometry 配列 parameter は read-only で、literal または名前付き配列を named argument として渡します。
配列 parameter に default は指定できません。`line[]` は `path[]` parameter へ渡せますが、
`path[]` を `line[]` parameter へ渡すことはできません。Module body では local `const` 配列を宣言でき、
`export const name: path[] = ...` のように export した配列は instance 外から `@instance::name` で参照できます。

scalar / geometry / geometry 配列 parameter は `name?: type` で optional にできます。optional と
default (`=`) は併用できません。instance の named argument は parameter の
宣言順に揃える必要がなく、未指定 optional は意図的な absent value になります。
これは `none`、`null`、または runtime の値ではなく、scalar の initializer / binding
も生成されません。

module body では `hasValue(@parameter)` が optional parameter 1つだけを受け取り、
presence を boolean で返します。`if` の true branch、`and` の右辺、`or` の false
branch ではその parameter を参照できます。`not` は条件を反転します。presence は
branch の外へ漏れず、boolean alias 経由では narrowing されません。scalar / geometry /
geometry 配列 reference、geometry property、builtin operand、construction parameter、template hole、
別 module への optional argument には同じ presence proof が必要です。default では
optional parameter を直接読めませんが、boolean default 内の `hasValue` は使えます。

## 文字列、停止、layout / print / svg

文字列の補間は `${...}` です。中の式も通常の nui4 参照・型付き式として評価されます。
typed interpolation hole の結果型は `string`、`number`、または `boolean` です。
`boolean` は text-template 内だけで lowercase の `true` / `false` に表示します。
これは text-template-local な presentation behavior であり、nui4 全体の
一般的な boolean -> string 暗黙変換ではありません。`choice(...)` の直接補間は
引き続き未対応ですが、`string(@choiceValue)` で明示的に string へ変換した結果は
通常の string hole として補間できます。

```text
text note = label(
  text: "縫い代 ${@seam} mm",
  anchor: @A,
  size: 3,
)
```

文書末尾の terminator は裸の `stop` です。

`layout` は通常の top-level named declaration で、body には直接の `place` だけを書きます。
`print` と `svg` は body を持たない output declaration です。名前と `@` / `::` の参照は
通常の非 hoist lexical namespace に従います。numeric value は通常の typed number expression なので、
`^` と `%` も利用できます。

```text
layout 型紙(scale: 1) {
  place @前身頃(
    origin: @前身頃::基準点,
    at: (0, 0),
    angle: 0,
    mirror: false,
  )
}

print 家庭用A4(
  layout: @型紙,
  paper: a4,
  orientation: portrait,
  overlap: 10,
)

svg 型紙SVG(layout: @型紙, margin: 0)
```

`print.overlap` is the safe-edge inset / retained glue-tab width used for print
assembly. It must be non-negative; let `Bw` and `Bh` be the stroke-inclusive
rendered bounds width and height:

```text
usableWidth  = W - 2 * overlap
usableHeight = H - 2 * overlap

columns = max(1, ceil(Bw / usableWidth))
rows    = max(1, ceil(Bh / usableHeight))

strideX = usableWidth
strideY = usableHeight
```

Page 1 starts at `x = bounds.minX - overlap`, `y = bounds.minY - overlap`;
later page origins advance by `strideX` and `strideY`. Adjacent physical sheet
rectangles overlap by `2 * overlap` mm; after one side is trimmed, the retained
glue allowance is `overlap` mm.

When `overlap > 0`, every physical page has four inset guide lines at
`left x = overlap`, `right x = W - overlap`, `bottom y = overlap`, and
`top y = H - overlap`. These are advisory printer-safety guides: geometry may
cross them, and they do not clip output or forbid placement. Corresponding
guides on adjacent pages coincide globally. Joining text labels are present
only on edges with a neighboring page; outer-edge guides have no label. When
`overlap == 0`, stride is the full paper width and height and there are no
guides or labels. Print declarations do not have a `margin` attribute;
`margin` remains an SVG-only option.

## 編集と診断

Source Editor が canonical な保存形式を出力します。Inspector は表示と該当 source span への移動を担当し、フォームとして値を書き換えません。依存関係、型、activity、名前解決の問題は黙って修復せず、対象 element と原因を含む診断として表示します。