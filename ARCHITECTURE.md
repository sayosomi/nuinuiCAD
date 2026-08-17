# Repository Architecture

## Purpose

- Current implementation architecture の navigation index。
- Subsystem ownership と primary entry points を素早く把握するためのもの。
- Design proposal、roadmap、history、exhaustive source tree ではない。
- Implementation details が食い違う場合は source code が authoritative。
- Durable product/engineering policy は `AGENTS.md` を参照する。

## High-level flow

```text
.nui sourceText
        ↓
CadDocumentStore application adapter or AutomationDocument
        ↓
compileCanonicalText
        ↓
parseDslSnapshot
        ↓
reconcileStatements
        ↓
compileDslDocument
        ↓
current-source diagnostics
+
last-good compiled document
        ↓
shared production evaluation context builder
        ↓
AppLayout / parity consumers
        ↓
useEvaluationEngine / rustEvaluationRunner / Rust input
        ↓
Tauri production: Rust evaluate_document
TS: reference / parity / test
        ↓
EvaluationResult
        ↓
AppLayout
        ↓
TauriDrawingCanvas
        ↓
CanvasHostAdapter
        ↓
DrawingCanvas
        ↓
canvasRenderer + CanvasOverlay
```

Tauri production evaluation follows:

```text
AppLayout
→ Tauri transport
→ existing Rust evaluate_document
```

The VS Code host path follows a separate bridge while reusing the same Webview
document/evaluation/Canvas path:

```text
VS Code TextDocument / Extension Host
→ Webview production document/evaluation/Canvas
→ Extension Host persistent stdio transport
→ existing Rust evaluate_document
```

The supported command is `nuinuiCAD: Open Canvas`, and the document lifecycle
is production-oriented for file-scheme `.nui` documents.

Fatal source でも current-source diagnostics は更新され、last-good compiled
document は保持される。Current source と compiled document は意図的に別
lifecycle である。

## Subsystem index

### App entry / orchestration

Primary:

- `src/main.tsx`
- `src/components/AppLayout.tsx`

`src/geometry/productionEvaluationContext.ts` の shared builder が last-good
compiled document を `EvaluateElementsOptions` にlowerする。`AppLayout` は
effective runtime elements と evaluation limit を選択してこのbuilderを呼び、
`useEvaluationEngine`へ渡す。Runtime elementsはbuilderの所有外なので、Canvas
drag previewではelementsだけをephemeralに差し替えられ、Source Editor preview
では対応するcompiled metadataも差し替えられる。

### Canonical document state

Primary:

- `src/state/cadDocumentStore.ts`
- `src/document/automationDocument.ts`

Important current contract:

- `sourceText` = only canonical document value
- `sourceRevision` = Source Editor adapter notification revision
- `doc` = last successful compile
- `docText` = source text represented by `doc`
- `compiledDocumentRevision` = last-good compiled document identity
- Current-source diagnostics と last-good compiled document は分離される。
- Preview state は ephemeral。

`src/document/canonicalDocument.ts` の production primitives は、
`compileFreshCanonicalText` と `compileCanonicalText` を通じて次の二つの
consumer が共有する。

- `CadDocumentStore`: application document adapter、Source Editor notification、
  preview、history、file lifecycle を owner とする。
- `AutomationDocument`: React / Zustand / Tauri に依存しない host-independent
  facade。current source と current-source diagnostics、last-good compiled
  document、source lifecycle revision、compiled-document lifecycle revision を
保持する。

`AutomationDocument` は既存の parser、statement reconciler、compiler、Module
semantic / materialization path をそのまま利用し、materialized Module children
を source representation に flatten しない。Future Evaluation Context や
Headless Rust はこの architecture の current component ではない。

### Compilation / source mutation

Primary:

- `src/document/canonicalDocument.ts`
- `src/document/statementReconciler.ts`
- `src/document/textPatch.ts`

`compileCanonicalText` の current path:

```text
sourceText
→ parseDslSnapshot
→ reconcileStatements
→ compileDslDocument
```

Model-originated edits は既存の canonical source text / line-splice boundary を
使う。Whole-file reserialization を通常の mutation path として追加しない。
Stable statement / element identity を維持する。

### Source Editor

Primary:

- `src/editor/`
- `src/editor/sourceEditSession.ts`
- `src/components/SourceEditorPane.tsx`

CodeMirror-specific ownership は `src/editor/` と `SourceEditorPane` に閉じる。
他 subsystem は plain application types / editor handles / `sourceEditSession`
boundary を使う。

### DSL

Primary:

- `src/dsl/`
- `src/dsl/dslDocument.ts`
- `docs/dsl.md`

`docs/dsl.md` は current implemented language documentation。Current
saved-document language は nui4 only。

### Lexical / name resolution

Representative owners:

- `src/scalars/lexicalScopeIndex.ts`
- `src/dsl/lexicalScopeIndexAdapter.ts`
- `src/dsl/sourceLexicalNamespaceIndex.ts`
- `src/dsl/dslReferenceTokens.ts`

既存 lexical / source namespace resolution が owner。同じ semantic concept の
second resolver を作らない。

### Typed scalar expressions

Primary:

- `src/scalars/`

既存 typed expression AST、typecheck、`BindingId`、binding versions、
dependency/runtime infrastructure を owner とする。同じ scalar semantics の
parallel implementation を作らない。

Runtime-ready な numeric element / Module / printLayout-place expression は
`TypedScalarExpression` として lowering され、TS/Rust の runtime payload を
経由して shared typed scalar evaluator まで運ぶ。legacy-only / runtime-unready
numeric expression は既存 legacy numeric evaluator path に残し、typed numeric
expression を source text に戻して legacy parser で再解釈しない。

### Module

Representative owners:

- `src/dsl/moduleSemantic*`
- `src/dsl/moduleMaterialization*`
- `src/scalars/moduleScalarRuntime.ts`

既存 Module semantic resolution / materialization / runtime infrastructure を
再利用する。Second Module runtime / resolver を作らない。Materialized Module
children を source representation として flatten しない。

### TypeScript evaluation

Primary:

- `src/geometry/useEvaluationEngine.ts`
- `src/geometry/evaluationEngine.ts`
- `src/geometry/rustEvaluationEligibility.ts`
- `src/geometry/rustEvaluationRunner.ts`
- `src/geometry/evaluate.ts`
- `src/geometry/productionEvaluationContext.ts`

`productionEvaluationContext.ts` がcompiled documentのscalar program、binding
runtime entries、text/control metadata、source/Module mutation ownersを一度だけ
element-id keyed runtime metadataへlowerする。TypeScript evaluator は reference /
parity / test path。`useEvaluationEngine` は`evaluationRevision` /
`evaluationRequestRevision`を管理し、revision/request/stale semanticsをownerとする。

`rustEvaluationEligibility.ts` はRust supported element/reference types、compiled
reference validation、binding mutation、conditional / forGroup ownerのRust eligibility
をownerとする。`rustEvaluationRunner.ts` はReact、Tauri、Node、benchmarkから独立した
Rust request preparation / transport contractであり、既存の
`buildRustEvaluationInput` と `evaluationPayloadToResult` を再利用する。
`evaluationEngine.ts` はTauri transport adapterとreference / parity integrationを
担当する。`buildRustEvaluationInput` は引き続きsole JSON-shaped Rust projection
ownerである。将来のheadless hostはこのtransport実装だけを差し替えられる。

### Rust evaluation

Primary:

- `src-tauri/src/evaluation/`
- `src/geometry/rustEvaluationRunner.ts` (request boundary)

Production Tauri evaluator。

Public command boundary:

- `evaluate_document(input)`

Rust evaluator は `.nui` source text を parse したり source name resolution を
やり直す owner ではない。TypeScript compile / lowering 側で構築された resolved
runtime payload を decode / validate / evaluate する。

Tauri productionは `evaluationEngine.ts` の `evaluate_document` transport adapter
から既存の `evaluation::evaluate_document` を呼び出す。Parityのcargo exampleは
同じRust evaluatorと `buildRustEvaluationInput` のprojectionを利用する。Parity
harnessはRust evaluator自体のcorrectness検証のため、production Rust eligibilityとは
独立してRust inputを構築できる。Current-release fixtureは別途production Rust
eligibilityをassertする。

### Rendering / hit testing

Primary:

- `src/components/AppLayout.tsx`
- `src/components/TauriDrawingCanvas.tsx`
- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/components/canvasHostAdapter.ts`
- `src/components/DrawingCanvas.tsx`
- `src/components/canvasRenderer.ts`
- `src/components/CanvasOverlay.tsx`
- `src/components/useCanvasOverlayData.ts`
- `src/components/DrawingCanvasHitTest.ts`

Current rendering architecture は AppLayout → TauriDrawingCanvas →
CanvasHostAdapter → DrawingCanvas → canvasRenderer + CanvasOverlay。TauriDrawingCanvas
が現在のstore、command、Source Editor、画像URL、CommandRibbonOverlayをadapterへ
接続し、DrawingCanvasはhost-neutralなinteraction/rendering ownerとして
canvasとoverlayを描画する。VSCodeDrawingCanvasは同じstore、command、CanvasHostAdapter、
DrawingCanvasを使い、Webviewからのcanonical source commitだけをExtension Hostへ
中継する。VS Code側に別のrendererやdrag transformは持たない。

Current invariants:

- DrawingCanvasのinteraction logicはhost-neutral boundary越しに既存command/document ownerを使う。
- Drag previewはephemeralで、pointerupだけがcanonical document commitを行う。
- Runtime `CadElement[]` identityはadapterでcloneしない。
- Performance instrumentationはproduction DrawingCanvas/evaluation/render pathを引き続き測る。

### Commands / keyboard / parameters

Primary:

- `src/commands/`
- `src/keyboard/shortcuts.ts`
- `src/parameters/parameterDefinitions.ts`

Major business operations は command に集約する。Keyboard mapping と editable
parameter metadata はそれぞれ既存 owner を使う。

### State

Document state:

- `src/state/cadDocumentStore.ts`

UI state:

- `src/state/cadUiStore.ts`

Document canonical state と ephemeral UI state を混同しない。

### Tests / parity

Representative:

- Colocated TypeScript tests
- `test/evaluationParitySupport.ts`
- `test/fixtures/evaluation/`
- Rust evaluator tests in `src-tauri/src/evaluation/`

`test/evaluationParitySupport.ts` の`optionsFor`は同じshared production
evaluation context builderを呼ぶthin wrapperである。Rust parityは既存の
`buildRustEvaluationInput(fixture.elements, optionsFor(fixture))`から
`evaluate_fixture`、`evaluate_document`へ進み、Rust payload boundaryやbenchmark
protocolはこのloweringの外側にある。

### Performance comparison foundation

Primary:

- `src/performance/`
- `scripts/performance/`
- `performance/fixtures/`

Tauri / future host で共有する benchmark protocol、result schema、statistics、
comparison logic、固定 `.nui` workload の owner。

`src/performance/` は benchmark protocol、result schema、statistics、passive
instrumentation、host-neutral benchmark execution、browser capture scenario、
Tauri / VS Code capture orchestration、result assembly を owner とする。
`scripts/performance/` は Tauri / VS Code capture CLI と result IO / comparison を
担当する。Benchmark state は application store や Rust state に追加せず、通常 run
ではほぼ no-op になる独立 subsystem である。

### VS Code production document lifecycle

Primary:

- `vscode-extension/src/extension.ts`
- `vscode-extension/src/rustEvaluationProcessOwner.ts`
- `src/vscode/VSCodeApp.tsx`
- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/vscode/protocol.ts`

VS Code `TextDocument` is the production source authority. The Webview
`cadDocumentStore` is a disposable mirror hydrated from the authoritative
document and is never restored as a host-side source. The current scope is
`file:`-scheme `.nui` documents, including workspace and outside-workspace
files and dirty in-memory content; untitled and non-file documents are not
supported.

The extension keeps one Canvas session per document URI and supports multiple
documents at once. Reopening the command for an existing URI reveals its panel;
an active-editor change never rebinds that session. Session disposal removes
only its panel/listener ownership. Closing the matching TextDocument disposes
that session, so a later open performs a fresh authoritative handshake.

Canvas pointerup commits reuse the production store's `SourceUpdate` boundary.
`model-patch` messages carry the existing `LineSplice[]` and are applied as one
visible `TextEditor.edit()` transaction after version and source checks.
`reset` is the only whole-document fallback. Successful Canvas commits are
acknowledged only by the normal `TextEditor.edit()` →
`onDidChangeTextDocument` → `commitText` echo path.

`RustEvaluationProcess` is lazy and extension-wide through
`RustEvaluationProcessOwner`; all document sessions share it. A panel does not
own or kill the process. Unexpected process death rejects pending work, clears
the dead owner, and allows the next evaluation request to respawn it. The
existing bounded latest-wins Rust transport, stale evaluation discard,
`VscodeDragPreviewScheduler`, shared DrawingCanvas, and production compiler /
evaluator remain reused from the performance PoC path.

`src/vscode/` owns the local Webview / Extension Host message bridge, VS Code
Canvas adapter, app, and benchmark result handoff. `vscode-extension/` owns the
desktop-local extension host, session registry, persistent Rust stdio relay,
TextDocument edit bridge, and the extension-wide compiler diagnostics adapter.
Compiler diagnostics keep one analysis session per supported document URI,
reuse the production `AutomationDocument` compiler boundary for current
`TextDocument` source, and publish the resulting source diagnostics through one
VS Code `DiagnosticCollection`; the adapter does not perform parsing, binding
analysis, or runtime evaluation.

`src-tauri/src/evaluation/*performance*` は Rust evaluator 単体の既存 performance
test であり、cross-host UI comparison foundation とは別責務。

## Core architecture invariants

- `.nui` `sourceText` is canonical。
- Current source と last-good compiled document は意図的に別。
- `sourceRevision` / `compiledDocumentRevision` / `evaluationRevision` /
  `evaluationRequestRevision` は同じ revision として扱わない。
- Stable statement / element / binding identity を維持する。
- Model mutation は canonical source-text patch boundary を通す。
- Tauri production evaluation は Rust。
- TypeScript evaluator は reference / parity / test。
- Rust は resolved runtime payload を受け取り、source parsing / source-name
  resolution を再実装しない。
- Existing lexical / Module / materialization / evaluation architecture を再利用する。
- 同じ semantic concept の second parser / resolver / runtime / state model を
  作らない。

## Maintenance

`ARCHITECTURE.md` は作りっぱなしにしない。Architecture-changing task では
同じTask内で更新する。

更新が必要になる代表例:

- Subsystem 間で responsibility が移動する。
- Major subsystem を追加 / 削除する。
- Primary entry point が変わる。
- Canonical document / data flow が変わる。
- Evaluation / rendering pipeline が変わる。
- Architecture-level boundary を新設する。
- `ARCHITECTURE.md` に記載された owner/module を削除・置換する。

通常は更新不要:

- 同じ ownership boundary 内の ordinary bug fix。
- Private/internal implementation detail だけの変更。
- Architecture semantics に影響しない rename / cleanup。

Documentation churn 自体を目的にしない。Future proposal を current
architecture として記載しない。
