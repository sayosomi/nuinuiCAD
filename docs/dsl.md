# nuinuiCAD DSL

`.nui` は nuinuiCAD の保存形式です。ファイル全体が DSL テキストであり、
Source Editor の内容 (`sourceText`) が文書の唯一の正です。テキストを編集すると
再コンパイルされ、Canvas・Inspector・評価結果へ反映されます。旧
`.nuinui.json` は明示的なレガシーインポート入力だけに対応し、保存はしません。

Source Editor では値 span を選択して直接入力できます。数値・choice など
対応する値は `Alt+←` / `Alt+→` でも変更できます。Inspector は値の表示と
該当 span への移動を担う読み取り専用 UI です。

## 基本ルール

- 文書の最初の意味のある行は `nui 1` です。
- 要素・変数・文書設定は文書順に評価されます。参照先は先に評価可能でなければ
  なりません。欠落・disabled・invalid・順序違いは自動修復せず診断します。
- 単位は mm、座標は Y-up（上が正）です。
- `#` から行末まではコメントです。Canvas 操作とコマンドは対象文だけを
  スプライスするため、無関係なコメント・空行・順序は保持されます。
- 要素名は引用できます。参照は名前、修飾名 `グループ::要素`、または適用可能な
  派生点（`線.start` など）で書きます。名前の重複や曖昧な参照は診断します。

```text
nui 1

var bust = 840
point A = (0, 0)
point B = offset A dx=0 dy=-(bust / 4)
line AB = A -> B
curve armhole = A -> B startAngle=-90 startLength=35 endAngle=180 endLength=45
```

## 要素と文書構造

代表的な要素構文です。

```text
point A = (0, 0)
point C = polar A angle=-45 distance=80
point X = intersection AB armhole index=0 extensions=false
line shoulder = from A angle=-12 length=130
line seam = offset [AB,armhole] distance=10 side=left closed=false
arc neckline center=A radius=90 start=180 end=270
text label = "前身頃" at=A size=5
```

グループ・条件・繰り返し・印刷レイアウトはブレースのブロックで表します。
インデントは見た目だけで、開き行・内容行・閉じ行は別々の行です。

```text
group 前身頃 {
  point A = (0, 0)
  point B = (100, 0)
}

if 見返し condition=1 {
  point C = (10, 10)
} else {
  point D = (20, 20)
}

printLayout A4 output=pdf paper=a4 orientation=portrait columns=2 rows=2 {
  layoutVar margin = 15
  place 前身頃 at=(0, margin) angle=0 mirrorX=false
}
```

`@stop` はその前までの要素文だけを評価する区切りです。省略時は全要素を
評価します。

```text
point A = (0, 0)
@stop
point B = (100, 0)
```

## 無名要素と属性

名前を省略した要素文は有効ですが、名前で直接参照できません。

```text
point = (0, 0)
```

コマンドライン作図で無名要素を参照する必要が生じた場合は、参照に必要な名前へ
自動昇格し、同じ Undo ステップで文書へ反映します。作成後の任意の改名は下記の
rename コマンドを使います。

`id=`、`parent=`、`branch=` は正式な DSL 文法です。レガシーインポータは
評価順と親子関係を保つためにこれらを出力します。`id=` はレコード ID であり、
明示 `id=` を持つ同一 scope の重名は DSL として受理されます。非連続な
グループ子孫も `parent=` / `branch=` を使うフラットな表現になります。

```text
group 前身頃 id=front
point A = (0, 0) id=front-a parent=front
point A = (100, 0) id=back-a parent=back
```

`expanded=` と `elseExpanded=` は折りたたみ状態を表す DSL 属性ではなく、
正準出力には含まれません。

## 安全な rename

選択した 1 要素はコマンド `renameSelectedElement`（表示名: 「選択要素の名前を変更」）で
改名できます。normal と Source Editor の既定 shortcut は F2 です。ダイアログは
単一選択だけで開き、無名要素への命名にも使えます。成功時は対象文へジャンプして
Source Editor に focus を戻します。拒否時は入力を保持してダイアログを閉じません。

rename は Source Editor を flush し、エラー・未解決参照を含まないクリーンな
正準文書だけで実行します。1 回の成功は 1 document change・1 Undo で、対象文と
必要な参照文だけを更新します。same-name rename は bridge の前で成功 no-op となり、
非正準行の字面、履歴、revision は変えません。

安全性は rename 対象を特別扱いせず、全参照 slot の解決状態を before/after で
比較して判定します。以下は拒否されます。

- 同一 scope の rename 先衝突。明示 `id=` がある重名文も、rename 先としては
  保守的に衝突扱いです。
- dangling 参照の捕獲、shadowing、その他の参照先変化（`resolution-change`）。
- 名前として表現できない入力、対象不在、または安全性を証明できない文書。
- 既存の dangling を含む文書。これはクリーン文書ゲートで拒否されます。

テキストを直接編集して要素名を変えても参照は伝播しません。通常どおり
dangling 診断を修正してください。解析 API の `occurrences` は、rename 対象または
グループ子孫へ解決し、かつ owner 文が serializer 比較で実際に変わる参照だけです。
printLayout は行対応を証明できるときだけ行単位に精密化し、証明できない block は
block 全体を期待パッチ行として扱います。

現在の安全側制約として、`documentDslRefs` が絶対パスを出力できないため、意味的には
安全な一部の rename も `resolution-change` で拒否されることがあります。
