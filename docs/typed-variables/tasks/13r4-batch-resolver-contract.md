# 13R-4: Batch resolver owner contract / forward candidate order

## 目的

Task 13R-3統合再reviewで判明した、batch initializer resolutionの2件のblockingを
修正する。

1. self判定が必須の`fromBindingId`ではなく任意の`site.initializerBindingId`に
   依存していた。
2. reverse sweepで収集した複数forward候補がcatalog順と逆順で返っていた。

## 変更契約

- initializer ownerの唯一のsource of truthは`InitializerResolutionRequest.fromBindingId`
  である。`BindingReferenceSite`から`initializerBindingId`を削除し、site情報は
  `scopeId`/`statementIndex`/`elementLocal`という純粋な位置情報だけを持つ。
- `fromBindingId`はcatalog上`kind==="typed"`のbindingを指し、かつそのbinding自身の
  `statementIndex`が参照siteの`statementIndex`と一致しなければならない
  (`validatedOwner`)。initializer参照は必ず自身の宣言statement内にあるため、
  不一致はcaller契約違反としてfail-fastする。既存の未知binding/非typed
  fail-fastと合わせ、この一致検証が「矛盾したinitializer owner入力」の意味である。
- initializerでは現在の宣言自身だけを未登録として扱う。同scopeの先行可視bindingが
  あればresolved、複数あればduplicate、ancestorにだけ可視bindingがあればouterへ
  resolvedする。可視候補がなければselfとする。selfは`request.owner`
  (`fromBindingId`が指すbinding)と参照名の一致だけで判定し、site上のどのfieldにも
  依存しない。initializer自身より後の同scope宣言はforwardへの分類理由にならない
  (self/undefined判定は`direct`分類で確定し、forward昇格はdirect結果が`undefined`の
  ときにだけ働く)。
- 複数forward候補は`bindingIds`を必ずcatalog binding rank昇順で返す。reverse sweepは
  statementを末尾から先頭へ辿るため同一scope/nameのbucketは降順で溜まる。格納直前に
  1回`.reverse()`するだけで昇順に正規化し、候補数に比例する`O(candidates.length)`
  (総和`O(E)`)で済む。比較sortは使わない。
- Task 13の`buildInitializerGraph`はforwardの`bindingIds`をそのままedge順へ写すだけ
  なので、この修正で forward edge順も自動的にcatalog順になる。`bindingAnalysis.ts`
  自体には変更を入れない。
- `resolveInitializerReferences`だけがinitializer resolutionの公開production API
  である。旧`resolveBindingReference`(3引数、単発lookup)はproduction exportから
  削除した。単発lookupが必要な箇所は2つに分離する。
  - `visibleBindingsAt`(Task 39が使うbulk visibility API)は、self概念を持たない
    非公開の内部query (`resolveAtSite`、owner常にnull) を使う。initializer resolver
    とは別の内部queryとして扱い、公開互換APIの形にしない。
  - `duplicate`/`forward`/`undefined`の詳細を直接assertしたいtestだけが使う
    `resolveBindingReferenceForTests(catalog, name, site, fromBindingId?)`を
    test専用exportとして残す。`fromBindingId`を渡した場合は`validatedOwner`で
    productionと同じfail-fast検証を行う。
  - `bindingResolutionPublicSurface.test.ts`が`src/`全体を走査し、`*.test.ts`と
    定義ファイル自身を除くどのfileも`resolveBindingReferenceForTests`を参照しない
    ことを固定する。Task 14/15以降のproduction callerはこれによって単発resolverへ
    到達できない。

## 対象外

Task 13R-5のlegacy visibility性能修正、production evaluator、expression parser、
property、set、rename、DSL diagnostics pipelineは変更しない。`bindingAnalysis.ts`の
graph/cycle/issue/program eligibility意味論も変更しない(新規回帰testのみ追加)。

## 検証

- `const x: number = @x`がsite側の任意fieldなしで(top-level `fromBindingId`だけで)
  selfになることをbatch API直接呼び出しで固定する。
- 同scopeの先行同名bindingがあればresolved、複数あればduplicate、ancestorにだけ
  あればouterへresolvedすることをbatch API直接呼び出しで固定する。
- 自身より後に同名bindingがあってもinitializerはforwardではなくselfのままである
  ことを固定する。
- `fromBindingId`と`site.statementIndex`が矛盾する入力がfail-fastすることを固定する。
- 複数forward候補の`bindingIds`がcatalog順であること、request配列をshuffleしても
  順序が変わらないことを固定する。
- forward reference由来のgraph edge順もcatalog順であることを固定する。
- 既存のouter fallback、shadow、duplicate namespace、legacy visibility、
  element-local precedence、cycle、program eligibilityの各testが回帰なく通ることを
  固定する。
- `resolveBindingReferenceForTests`が`*.test.ts`以外のどの`src/`fileからも
  参照されないことをgrep相当のtestで固定する。

## 13R-5 handoff

`resolveInitializerReferences`のpublic surface、owner validation、canonical request
order、forward candidate catalog-rank orderはそのまま維持する。13R-5のlookup lane
linearizationは同一batch sweep内の候補登録だけを変更し、test-only traceはproduction
APIではない。
