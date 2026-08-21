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

Bake uses the same host-neutral target resolver and conversion planner. When
disabled geometry is explicitly included, Tauri Canvas and the VS Code Canvas /
Source routes run one on-demand Rust evaluation with only the resolved disabled
Bake target IDs allowed; the result is accepted only if the captured document
revision is still current. The normal document evaluation remains disabled-aware
and is never replaced by this sandbox.

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

Drawing Profile declarations are compiler-resolved source declarations in the
ordinary source lexical namespace. Drawing Modifier `width`, `style`, `color`,
and `state` contributions merge independently: the common modifier contribution
is applied first, followed by the matching selected profile delta.

Print layout source declarations are also owned by the nui4 parser/compiler
facade: `layout` contains ordered direct `place` statements, while `print` and
`svg` contain resolved output references and physical-unit settings. Their
statement identities come from `statementReconciler`; lexical target/origin and
profile resolution comes from `sourceLexicalNamespaceIndex`; numeric fields use
the shared scalar binding compiler. `DslDocumentData` stores these three source
models and does not own an active output selection or an export/preview runtime.

### Lexical / name resolution

Representative owners:

- `src/scalars/lexicalScopeIndex.ts`
- `src/dsl/lexicalScopeIndexAdapter.ts`
- `src/dsl/sourceLexicalNamespaceIndex.ts`
- `src/dsl/dslReferenceTokens.ts`
- `src/dsl/dslSemanticOccurrenceIndex.ts`
- `src/dsl/dslDefinitionQuery.ts`
- `src/dsl/dslRenameQuery.ts`
- `src/dsl/dslReferencesQuery.ts`

既存 lexical / source namespace resolution が owner。同じ semantic concept の
second resolver を作らない。Definition、Rename、References の source
occurrence enumeration は `dslSemanticOccurrenceIndex.ts` が compiler-resolved
identity と exact physical range を共有し、各 query がそれぞれの safety
policy を持つ。

### Typed scalar expressions

Primary:

- `src/scalars/`

既存 typed expression AST、typecheck、`BindingId`、binding versions、
dependency/runtime infrastructure を owner とする。同じ scalar semantics の
parallel implementation を作らない。

Runtime-ready な numeric element / Module / layout-place / print / svg expression は
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

`productionEvaluationContext.ts` accepts an optional resolved
`selectedDrawingProfileId`. An omitted profile means common-only modifier
semantics and is the context used by Canvas; selected profiles add their
compiler-resolved deltas at evaluation time. The TypeScript reference evaluator
and Rust production evaluator use this same profile-aware modifier merge and
activity behavior.

`rustEvaluationEligibility.ts` はRust supported element/reference types、compiled
reference validation、binding mutation、conditional / forGroup ownerのRust eligibility
をownerとする。`rustEvaluationRunner.ts` はReact、Tauri、Node、benchmarkから独立した
Rust request preparation / transport contractであり、既存の
`buildRustEvaluationInput` と `evaluationPayloadToResult` を再利用する。
`evaluationEngine.ts` はTauri transport adapterとreference / parity integrationを
担当する。`buildRustEvaluationInput` は引き続きsole JSON-shaped Rust projection
ownerである。将来のheadless hostはこのtransport実装だけを差し替えられる。

`src/commands/bakeSettingsStorage.ts` and `src-tauri/src/bake_settings.rs` own
the three Canvas Bake settings as a separate JSON persistence boundary. Hosts
resolve plain Bake options before invoking the shared command; the shared core
does not read VS Code or Tauri settings APIs.

`EvaluationResult.effectiveDrawingModifierStrokes` is the resolved, element-id keyed
stroke presentation data crossing the evaluation boundary. The TS reference and
Rust production evaluators resolve the same ordered modifier cascade; JSON payloads
use `{ elementId, stroke }` entries and retain semantic theme-role colors. For
`forGroup` runtime geometry, generated entries are propagated from the evaluator's
structured `forGroupGeneratedRows.templateElementId` relation.

`EvaluationResult.preMutationGeometry` is evaluator-owned, runtime ElementId-keyed
data. The shared TypeScript and Rust evaluators capture a deep snapshot immediately
after each declaration successfully produces geometry, before later
extend/trim/split/move/pathReverse mutations alter final `computedGeometry`.
`instanceBaseGeometry` is captured at each concrete module materialization boundary
from the existing `ModuleMaterialization` execution plan, so caller-side mutations
after an instance do not leak into its Base shape. Both snapshot maps cross the
same JSON payload boundary and are available to the host-neutral Bake operation;
the existing Canvas Bezier editing helper narrows the generalized map to Bezier
geometry locally.

Bake-only evaluation of explicitly included disabled geometry uses the existing
Rust/TypeScript evaluation boundary with an explicit allow-list in the evaluation
payload. Normal evaluation still leaves disabled elements unevaluated; the
allow-list is only supplied by the Bake host path for its sandbox snapshot.

`src/commands/bakeGeometry.ts` owns host-neutral target resolution, exact primitive
conversion, generated declaration naming, source insertion planning, and skipped
target comments. `bakeCurrentShape` and `bakeBaseShape` dispatch through the shared
command registry. Tauri commits the resulting `LineSplice[]` through the canonical
document store; the VS Code Webview sends the same splices to the Extension Host,
which applies one native TextDocument edit. Source ownership and normalized source
position queries remain the existing SAY-41 boundary; Bake does not create a
second runtime-to-source map.

### Output planning / print encoding

Primary:

- `src/output/outputCore.ts`
- `src-tauri/src/print_output.rs`
- `src-tauri/src/print_svg.rs`
- `src-tauri/src/print_pdf.rs`

`outputCore.ts` is the host-neutral owner of the resolved output plan shared by
SVG, PDF, and future Preview. It consumes compiler-resolved layouts/outputs,
calls the existing `buildEvaluationOptions` boundary with the output's selected
Drawing Profile, and consumes the resulting `EvaluationResult` without
re-evaluating or filtering the common Canvas result. It resolves typed numeric
output values through the compiled numeric binding/runtime products, applies
ordered group-subtree placements, emits only line/arc/Bezier/offsetLine/text
drawables, and calculates deterministic stroke-inclusive/text-inclusive bounds.

The same plan owns SVG physical sizing and print tiling metadata, including
page origins, first-page usable areas derived from physical overlap, physical
page strides, overlap guides, joining labels, and deterministic text layout. It
owns a stable six-role export palette whose values match the
legacy Canvas baseline, but does not read the active Canvas theme at runtime;
it also converts modifier widths from CSS pixels to millimetres. It has no
React, host UI, command, dialog, or save flow ownership.

`print_output.rs` is the JSON-friendly resolved-payload validation boundary.
`print_svg.rs` and `print_pdf.rs` remain the production Rust encoding owners;
they do not parse `.nui` source or resolve source names. SVG performs the Y-up
to SVG Y-down conversion only at this boundary, while PDF preserves the
physical Y-up page coordinates. Tauri command registration remains in
`src-tauri/src/lib.rs`.

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
- `src/components/canvasTheme.ts`
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
- `DrawingCanvas` passes resolved modifier strokes directly to the shared
  `canvasRenderer`; the renderer is the presentation boundary for semantic theme
  roles and does not receive modifier definitions or names. Tauri supplies
  `LEGACY_CANVAS_THEME`; VS Code resolves the active Webview CSS variables and
  passes the host-neutral `CanvasTheme` through the same adapter.
- The VS Code Extension Host listens for active color-theme changes and sends a
  theme invalidation to each open Canvas session. The Webview re-reads computed
  theme variables and redraws the shared Canvas2D/SVG presentation without
  reopening the Canvas.
- Drag previewはephemeralで、pointerupだけがcanonical document commitを行う。
- Runtime `CadElement[]` identityはadapterでcloneしない。
- Performance instrumentationはproduction DrawingCanvas/evaluation/render pathを引き続き測る。

Command Ribbon presentation is host-neutral. `CommandRibbonView` owns only the
accessible visual surface, command/value item rendering, icon injection, and
pointer/wheel isolation. `CommandRibbonFloatingOverlay` owns measured
floating-position drag and viewport clamping, including label-aware rendered
dimensions; pointer moves remain presentation-local and a host decides what a
pointerup commit means. `TauriDrawingCanvas` adapts the existing persisted
`buttons` settings, Tauri icon catalog, dock behavior, and command execution
through that boundary. `VSCodeDrawingCanvas` adapts the separate
`nuinuiCAD.canvasRibbon.ribbons` model, the closed Ribbon command catalog, and
dynamic Lucide icon resolution through the same boundary.

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
- `vscode-extension/src/languageAnalysisSession.ts`
- `vscode-extension/src/completionProvider.ts`
- `vscode-extension/src/definitionProvider.ts`
- `vscode-extension/src/referenceProvider.ts`
- `vscode-extension/src/documentSymbolProvider.ts`
- `vscode-extension/src/renameProvider.ts`
- `vscode-extension/src/choiceQuickFixProvider.ts`
- `vscode-extension/src/rustEvaluationProcessOwner.ts`
- `src/vscode/VSCodeApp.tsx`
- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/vscode/protocol.ts`
- `src/vscode/vscodeWebviewSession.ts`
- `src/vscode/webviewSurfaceRouter.tsx`

VS Code `TextDocument` is the production source authority. The Webview
`cadDocumentStore` is a disposable mirror hydrated from the authoritative
document and is never restored as a host-side source. The current scope is
`file:`-scheme `.nui` documents, including workspace and outside-workspace
files and dirty in-memory content; untitled and non-file documents are not
supported.

Webview sessions are keyed by document URI plus surface kind through the shared
`VscodeWebviewSessionRegistry`. The semantic surface kinds are `canvas` and
`outputPreview`; Canvas is the currently exposed production surface. Reopening
Canvas for an existing URI reveals its existing Canvas session, while the
identity boundary leaves a different surface for that URI independent. An
active-editor change never rebinds an existing session. Disposing one surface
removes only that surface's panel/listener ownership, and closing a
`TextDocument` disposes every surface session belonging to that URI.

The production host still ships one `webview.js` bundle. Extension Host HTML
bootstrap places the surface kind in explicit static metadata, and
`webviewSurfaceRouter.tsx` validates that value before routing `canvas` to
`VSCodeApp`. `outputPreview` and malformed or unknown values fail closed; no
Output Preview renderer or user-facing surface exists yet.

Explicit VS Code navigation is bidirectional and opt-in: Canvas selection does
not follow the Editor cursor, and Editor cursor movement does not change Canvas
selection. The TextDocument remains the source authority. The Extension Host /
Webview boundary transports only the TextDocument version plus a normalized LF
source position or range; runtime ElementIds and reconciler StatementIdentity
remain Webview-local. Editor → Canvas runs the host-neutral source-target query
before opening Canvas, so non-runtime source never creates a panel. Canvas →
Editor resolves the selected runtime element through the same source-ownership
query and exact compiled physical spans. Both directions fail closed on stale
source, version, compilation, or session state.

The Webview keeps the last authoritative host source snapshot separately from
its latest host version. Navigation is allowed only when that snapshot, the
current canonical Webview source, and the current compiled source/revision
agree. Pending Editor → Canvas navigation is document-scoped, latest-request
wins, waits for Webview readiness and authoritative hydration, and activates
the Canvas only after Webview validation. Successful navigation explicitly
focuses the actual Canvas viewport DOM node; failed or stale navigation does
not steal destination focus.

Canvas pointerup commits reuse the production store's `SourceUpdate` boundary.
`model-patch` messages carry the existing `LineSplice[]` and are applied as one
visible `TextEditor.edit()` transaction after version and source checks.
`reset` is the only whole-document fallback. Successful Canvas commits are
acknowledged only by the normal `TextEditor.edit()` →
`onDidChangeTextDocument` → `commitText` echo path.

Canvas-scoped Undo/Redo keybindings route to the active Canvas session. The
Webview applies element-selection history locally while the current source
checkpoint has an inner selection step; otherwise it requests native
TextDocument Undo/Redo with an expected document version. The Extension Host
validates the session, document, version, and visible editor, executes the
native command, and forwards the authoritative document-change reason. The
Webview reconciles adjacent source checkpoints and restores Canvas focus; a
validation or checkpoint mismatch resynchronizes from the TextDocument. These
keybindings are scoped to the Canvas webview and do not intercept Source Editor
Undo/Redo.

Editor → Canvas selection replacement uses the shared selection command owner
and records one SAY-48 selection-history transition for a changed single- or
multi-element target. Identical replacements are history no-ops. Canvas →
Editor navigation does not mutate Canvas selection and therefore does not add a
selection-history entry. Native Editor Undo/Redo and F2 retain ownership after
successful explicit Canvas → Editor navigation because Canvas history handoff
context is cleared before Editor focus is transferred.

The Source+Canvas `Bake Current Shape` and `Bake Base Shape` commands are visible
from native command-palette surface predicates only. The Extension Host owns the
VS Code settings `nuinuiCAD.bake.emitSkippedComments`,
`nuinuiCAD.bake.includeHiddenGeometry`, and
`nuinuiCAD.bake.includeDisabledGeometry`, document-version isolation, and the
native edit bridge. When disabled geometry is included, the host requests the
Bake-only sandbox through the same Rust evaluation boundary. The Webview owns
target resolution and the shared Bake conversion. A source-triggered request keeps
Source Editor focus where possible, rejects reusable module-definition bodies, and
is accepted only after the same authoritative source/revision/evaluation checks
used by navigation.

`RustEvaluationProcess` is lazy and extension-wide through
`RustEvaluationProcessOwner`; all Canvas sessions share it regardless of
document or surface identity. A panel does not own or kill the process.
Unexpected process death rejects pending work, clears the dead owner, and
allows the next evaluation request to respawn it. The existing bounded
latest-wins Rust transport, stale evaluation discard,
`VscodeDragPreviewScheduler`, shared DrawingCanvas, and production compiler /
evaluator remain reused from the performance PoC path.

`src/vscode/` owns the local Webview / Extension Host message bridge, VS Code
Canvas adapter, app, and benchmark result handoff. `vscode-extension/` owns the
desktop-local extension host, Canvas session registry, persistent Rust stdio
relay, TextDocument edit bridge, and URI-scoped language analysis sessions.

The Extension Host is authoritative for VS Code Canvas Ribbon configuration. It
normalizes `nuinuiCAD.canvasRibbon.ribbons`, sends the current normalized value
to each Webview session, broadcasts configuration changes, and applies only
validated `{ ribbonId, x, y }` position patches back to User Settings. The
Webview keeps presentation state local during a drag and sends one position
commit on pointerup. The `nuinuiCAD.editCanvasRibbon` command routes both
Command Palette and Ribbon host-action invocations to the normal VS Code
Settings surface.

The extension keeps one `NuiLanguageAnalysisSession` and one production
`AutomationDocument` per supported document URI. Diagnostics, native
completion, definition navigation, document symbols, rename, and references
share that session:

```text
VS Code TextDocument
→ URI-scoped language analysis session / AutomationDocument
├→ compiler diagnostics → DiagnosticCollection
├→ queryDslCompletion → CompletionItemProvider
├→ queryDslDefinition → DefinitionProvider
├→ queryDslReferences → ReferenceProvider
├→ queryDslDocumentSymbols → DocumentSymbolProvider
├→ queryDslRenameTarget / planDslRenameEdits → RenameProvider / WorkspaceEdit
└→ current invalid-choice diagnostic → typedVariableQuickFixes choice-replacement subset
   → CodeActionProvider → guarded internal apply command → WorkspaceEdit
```

`languageAnalysisSession.ts` owns current raw source, source replacement,
current compiler diagnostics, source revision, and fail-closed semantic / exact
current source-structure snapshot access. `compilerDiagnostics.ts` remains the diagnostic DTO and range
conversion adapter. `completionProvider.ts` only normalizes VS Code positions,
projects `queryDslCompletion` candidates to `CompletionItem`s, and supplies
host insertion behavior; completion semantics, filtering, ranking, and
truncation remain owned by the production query. `definitionProvider.ts` keeps
the VS Code adapter thin: it synchronizes the current `TextDocument`, converts
UTF-16 raw offsets across CRLF normalization, delegates semantic resolution to
`queryDslDefinition`, and projects its exact ranges to a same-document
`DefinitionLink`. `referenceProvider.ts` uses the same session/current-source
flow and delegates to `queryDslReferences`, returning deterministic
same-document `Location`s. `documentSymbolProvider.ts` delegates to the
host-neutral `queryDslDocumentSymbols` projection and recursively converts its
normalized source ranges and symbol kinds to VS Code `DocumentSymbol`s. Rename target and edit-plan projection similarly
remain host-neutral; VS Code `RenameProvider` and `ReferenceProvider`
registrations are adapter boundaries, not second resolvers. Neither diagnostics,
completion, definition navigation, references, document symbols, rename planning,
nor choice Quick Fix generation performs runtime
evaluation or starts the Rust process. Choice Quick Fix reuses the current
compiler invalid-choice diagnostic and the existing `typedVariableQuickFixes`
choice-replacement descriptors; it does not use the CodeMirror adapter. The
internal apply command is authoritative only for the current open file
document/version/source and fails closed before creating a `WorkspaceEdit`.

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
