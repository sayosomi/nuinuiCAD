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
VS Code TextDocument (production) / NuiLanguageSession / AutomationDocument
        ↓
@nuinuicad/nui-language document/compiler surfaces
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
VS Code Webview / Headless MCP / parity consumers
        ↓
useEvaluationEngine / rustEvaluationRunner / Rust input
        ↓
VS Code Extension Host persistent Node stdio
→ rust-evaluator evaluation_stdio → evaluate_document
TS: reference / parity / test (Vite/browser development harness)
        ↓
EvaluationResult
        ↓
VS Code Webview surface
        ↓
CanvasHostAdapter
        ↓
DrawingCanvas
        ↓
canvasRenderer + CanvasOverlay
```

Bake uses the same host-neutral target resolver and conversion planner. When
disabled geometry is explicitly included, the VS Code Canvas / Source routes
run one on-demand Rust evaluation with only the resolved disabled Bake target
IDs allowed; the result is accepted only if the captured document revision is
still current. The normal document evaluation remains disabled-aware and is
never replaced by this sandbox.

Production VS Code evaluation follows the persistent Extension Host boundary
while reusing the same Webview document/evaluation/Canvas path:

```text
VS Code TextDocument / Extension Host
→ Webview production document/evaluation/Canvas
→ Extension Host persistent stdio transport
→ shared Node evaluation_stdio process client
→ rust-evaluator evaluation_stdio binary
→ rust-evaluator::evaluate_document
```

For a root that imports a saved Module, the Module-aware Extension Host uses the
same exact graph-backed root compile for native language features and for a
narrow Canvas runtime projection. The Webview accepts that projection only when
the graph, root source/version, and publication revision still match its
authoritative root mirror; it evaluates the prepared Rust input and presents
the imported runtime without rebuilding imports or filesystem state. Graph
building/invalidating/unavailable states clear this cross-document runtime
authority rather than retaining a previous imported render. Same-file roots
continue through the local Canvas path.

Native Hover uses an Extension Host-only current-document path, so Canvas may be
closed and no Webview protocol is involved:

```text
VS Code TextDocument
→ exact-current NuiLanguageSession.hover()
→ queryDslGeometryHoverTarget
→ NuiRuntimeEvaluationService
→ shared productionEvaluationContext / rustEvaluationRunner
→ existing RustEvaluationProcessOwner
→ EvaluationResult
→ native HoverProvider
```

The Hover path is exact-current only. It resolves a compiler-owned semantic target
before starting runtime work, preserves the document evaluation limit and runtime
activity state, and drops cancelled or stale completions rather than falling back
to last-good geometry.

The explicit VS Code surface open commands are `nuinuiCAD: Open Canvas`,
`nuinuiCAD: Open Output Preview`, and `nuinuiCAD: Open Module Preview`. The same
production-oriented lifecycle also supports Source → Canvas commands such as
`nuinuiCAD: Pick Reference from Canvas` for file-scheme `.nui` documents.
Reference Pick resolves an exact-current Source target in the Extension Host,
reuses or opens the URI-matched Canvas without stealing focus, waits for
authoritative Webview hydration, and then starts the shared host-neutral pick
session. Canvas and Output Preview remain independent sessions keyed by document
URI and surface kind in `src/vscode/vscodeWebviewSession.ts`. Module Preview owns
a separate one-panel-per-document target lifecycle in
`vscode-extension/src/modulePreviewFeature.ts`: opening it again reveals and
retargets the existing panel using the exact-current Module definition identity.
All three surfaces reuse the one Extension Host Rust process owner and the shared
`replaceTextDocument` / `commitText` hydration protocol.

Coordinate point conversion is an explicit Source+Canvas command family with an
Explorer item-context entry point. `vscode-extension/src/coordinatePointConversionCommandFeature.ts`
owns the source/editor target projection, exact-current runtime evaluation,
native QuickPick lifecycle, Canvas-session routing for the explicit visual
path, and result presentation. `src/commands/coordinatePointConversionSession.ts`
owns the captured target/base-candidate session, while
`src/commands/coordinatePointConversion.ts` remains the sole eligibility,
planning, math, and statement-splice authority. Source, Canvas, and Explorer
capture the same proof-carrying request and use the Extension Host's native
QuickPick for the primary legal shared-base interaction. Native apply performs
one statement-level Source edit; Canvas-origin success crosses the host
boundary using ordinary Source ownership/source statement identity through a
narrow selection adapter, and the Webview resolves current runtime IDs after
the authoritative source edit before replacing Canvas selection. The existing
Webview conversion and point-pick path remains an explicit Canvas visual-pick adapter, and only
that choice may create or reveal Canvas for a Source-origin request. No
cross-surface sticky target or alternate conversion semantics are introduced.

Output Preview is routed to `src/vscode/OutputPreviewApp.tsx` from
`webviewSurfaceRouter.tsx`. Its active output and viewport are session-local
Webview state. It derives current print/svg candidates from the compiled
`StatementMap`, passes the selected compiled output to `evaluateOutputPlan` with
`VscodeRustTransport`, and renders the resolved `OutputPlan` as a read-only
physical plane. Source navigation crosses the host boundary only as the current
document version plus a normalized source range, which the Extension Host
validates before revealing the declaration.

Module Preview is routed to `src/vscode/ModulePreviewApp.tsx`. The Extension Host
resolves the exact-current innermost Module through `queryModulePreviewTarget`,
then the Webview re-proves that target against its authoritative source mirror and
uses `createModulePreviewSession` / `compileModulePreviewRoot` for ephemeral
parameter/default/last-good semantics and preview-root materialization. It
evaluates through the existing Rust transport and renders only the target runtime
elements through the shared `DrawingCanvas` / `CanvasHostAdapter` path. Exact-current
Module target identity and the authoritative `TextDocument` remain host-owned;
parameter/default Preview state remains ephemeral. Shared DrawingCanvas point and
Bezier gestures use Preview-only ephemeral runtime transforms. Committed
point/Bezier edits resolve runtime provenance to the real authored Module-body owner and produce
source-preserving statement `LineSplice`s through the existing
`moduleModelBridge` serialization authority. The Extension Host revalidates the
exact document/source/target proof and exact patched source before one native
`TextEditor.edit` transaction. Native VS Code Undo/Redo remains canonical history
and refreshes Preview through `onDidChangeTextDocument` and stable target identity.
Module Preview Bake Current/Base uses the authored current `StatementMap` for
source ownership and insertion lines together with the current Preview
`moduleMaterialization` and evaluation. Materialized Module-body leaves insert
beside their real authored body statements; real nested Module instances insert
beside their authored call sites in the enclosing Module/body scope. Synthetic
Preview calls and roots are never writable and no synthetic Preview invocation,
root, or parameter/context state is persisted. Bake splices use the same
authoritative TextDocument transaction as point/Bezier commits, so native VS Code
history remains canonical. Normal Canvas Bake retains its module-body to root
instance redirect semantics.
temporary target/input invalidity keeps the session's last-good preview, and loss
of exact target identity fails closed rather than rebinding by name or ancestor.

Fatal source でも current-source diagnostics は更新され、last-good compiled
document は保持される。Current source と compiled document は意図的に別
lifecycle である。

## Subsystem index

### Production host and Webview entry / orchestration

Primary:

- `vscode-extension/src/extensionEntry.ts`
- `vscode-extension/src/extension.ts`
- `src/vscode/main.tsx`
- `src/vscode/webviewSurfaceRouter.tsx`

`src/geometry/productionEvaluationContext.ts` の shared builder が last-good
compiled document を `EvaluateElementsOptions` にlowerする。Production Webview
surfaces select effective runtime elements and evaluation limits before calling
the builder and passing the result to `useEvaluationEngine`. Runtime elementsはbuilderの所有外
なので、Canvas drag previewではelementsだけをephemeralに差し替えられ、Source
Editor previewでは対応するcompiled metadataも差し替えられる。

### Canonical document state

Primary:

- `src/state/cadDocumentStore.ts`
- `packages/nui-language/src/document/automationDocument.ts`

Important current contract:

- `sourceText` = only canonical document value
- `sourceRevision` = Source Editor adapter notification revision
- `doc` = last successful compile
- `docText` = source text represented by `doc`
- `compiledDocumentRevision` = last-good compiled document identity
- Current-source diagnostics と last-good compiled document は分離される。
- Preview state は ephemeral。

`packages/nui-language/src/document/canonicalDocument.ts` の production primitives は、
`compileFreshCanonicalText` と `compileCanonicalText` を通じて次の二つの
consumer が共有する。

- `CadDocumentStore`: application document adapter、Source Editor notification、
  preview、history、file lifecycle を owner とする。
- `AutomationDocument`: React / Zustand / host APIs に依存しない host-independent
  facade。current source と current-source diagnostics、last-good compiled
  document、source lifecycle revision、compiled-document lifecycle revision を
保持する。

`AutomationDocument` は既存の parser、statement reconciler、compiler、Module
semantic / materialization path をそのまま利用し、materialized Module children
を source representation に flatten しない。Headless MCP の fresh file snapshot
もこの facade を利用し、fatal current source では `currentCompiled` の diagnostics
だけを返して last-good `doc` を current semantics として公開しない。

Current type ownership is split across the document and evaluation boundaries:
`packages/nui-language/src/model/cadDocumentTypes.ts` owns authored/compiled CAD
model contracts,
`src/geometry/evaluationTypes.ts` owns computed geometry and
`EvaluationResult`/runtime evaluation contracts, and `src/types/geometry.ts`
currently remains a compatibility/presentation facade over those owners.

`NuiLanguageSession` is the package-owned per-document facade. It owns
current source/revision proof and direct host-neutral language query invocation
over one lower-level `AutomationDocument`. It exposes no VS Code, Node, React,
DOM, Canvas, runtime geometry, or evaluator services. Single-document VS Code
providers use this facade as thin projection/localization adapters. Runtime
diagnostics and Rust runtime evaluation remain host/runtime-owned. The
multi-document/MCP migration and final transition cleanup remain incomplete
until Slice 4.

### Language Core package boundary

Primary:

- `packages/nui-language/src/`
- `packages/nui-language/src/index.ts` (`@nuinuicad/nui-language`)
- `packages/nui-language/src/document-entry.ts` (`@nuinuicad/nui-language/document`)
- `packages/nui-language/src/workspace-entry.ts` (`@nuinuicad/nui-language/workspace`)

`packages/nui-language` is the implementation owner for the host-neutral parser,
compiler, source maps, semantic indexes, canonical document lifecycle,
authored/source model contracts, compile-time scalar/binding/expression
semantics, and multi-document workspace semantics. The three package entry
points are the supported internal surfaces; the package is private and has no
additional public export paths.

Legacy `src/dsl`, `src/document`, `src/scalars`, `src/model`, `src/parameters`,
and compile-time `src/geometry` paths remain only as transitional forwarding
shims where still present. They do not retain a second semantic implementation.
Runtime computed geometry, `EvaluationResult`, Rust payload construction, and
runtime evaluator orchestration remain outside Language Core. VS Code and MCP
host migration to these package surfaces is not complete while legacy host
imports remain.

### Headless MCP

Primary:

- `mcp-server/src/server.ts`
- `mcp-server/src/documentSnapshot.ts`
- `mcp-server/src/documentEvaluation.ts`
- `src/node/rustEvaluationProcess.ts`

Repository-owned MCP server は Node の直接 entry
`mcp-server/dist/server.js` を stdio transport で起動する。stdout は MCP protocol
専用で、server diagnostics は stderr に出す。`document_inspect`、
`document_definition`、`document_references` は absolute file-backed `.nui` を
call ごとに disk から fresh read し、SHA-256 source identity と exact-current
compiler / semantic productsを利用する。

`document_evaluate` も同じ fresh snapshot boundary を使い、exact-current compiled
documentだけを shared `productionEvaluationContext` → `rustEvaluationRunner` で
production Rust inputへlowerする。Rust eligibility、process unavailable / failed、
source-unavailable、staleを明示し、成功時もerrors / warningsを含むcompact DTOだけを
返す。computed geometryやevaluated element IDsは明示的に要求された範囲だけを返し、
internal `EvaluationResult` 全体は公開しない。Rust完了後にはdisk source identityを
再取得し、変化していれば結果をstaleとして破棄する。

MCPとVS Code Extension Hostは`src/node/rustEvaluationProcess.ts`の同じNode-only
`evaluation_stdio` NDJSON client / lazy owner実装を利用する。各hostは独立したowner
instanceを持つがprotocol implementationは複製しない。binaryは既存の
`NUINUICAD_RUST_EVALUATION_BINARY` overrideまたは
`rust-evaluator/target/debug/evaluation_stdio` のrepository debug fallbackで解決し、
MCP startup時にCargo buildは起動しない。Mutable document registry、VS Code
attached observation、source mutationはHeadless MCP boundaryのownerではない。

### VS Code attached observation bridge

Primary:

- `vscode-extension/src/vscodeObservationFeature.ts`
- `vscode-extension/src/vscodeObservationState.ts`
- `vscode-extension/src/mcpObservationBridge.ts`
- `vscode-extension/src/extensionEntry.ts`
- `src/node/vscodeObservationBridge.ts`
- `mcp-server/src/vscodeObserve.ts`

`vscodeObservationFeature.ts` owns Extension Host observation lifecycle and
Canvas publication delegation. The root `extension.ts` composition supplies the
existing host-document projection and the authoritative current Canvas session
proof/document version facts. `vscodeObservationState.ts` remains the exact-
current observation state and acceptance owner; the feature delegates to it and
does not duplicate its freshness checks. The bridge reads that owner and does
not reconstruct Canvas, evaluation, selection, or diagnostic semantics.
`extensionEntry.ts` is
the packaged Extension Host entry and starts the private bridge only when
`NUINUICAD_MCP_OBSERVATION=1` or the application-scoped developer setting
`nuinuiCAD.developer.mcpObservation.enabled` is enabled. The bridge is disabled
by default and setting changes require an Extension Host reload. The developer-only
bridge snapshot also carries current `TextDocument` source text for supported
open `.nui` documents so dirty in-memory source can be returned exactly when the
MCP caller explicitly opts into that larger field.

`src/node/vscodeObservationBridge.ts` owns the shared Node-only transport and
discovery boundary: loopback-only ephemeral TCP, authenticated observe-only
NDJSON, restrictive temporary descriptor lifecycle, canonical file-path matching,
and deterministic instance resolution. Resolution uses explicit instance ID,
then an exactly-one-open-document match, then the sole live instance; remaining
multiple candidates are reported as ambiguity rather than guessed by PID,
timestamp, or window order. Candidate metadata omits the auth token.

`mcp-server/src/vscodeObserve.ts` is the read-only MCP projection boundary.
`vscode_observe` maps discovery failures to explicit `unavailable` / `ambiguous`
results, rejects a non-current Canvas runtime snapshot as `stale`, keeps the
protocol result JSON-friendly, and declares Source selection indexing as zero-based
UTF-16 line/character coordinates. Full `sourceText` is stripped from the default
MCP response and retained only for `includeSourceText: true`; no command, mutation,
shell, keyboard, pointer, screenshot, HTTP, OAuth, or host-attach surface is
introduced.

### Compilation / source mutation

Primary:

- `packages/nui-language/src/document/canonicalDocument.ts`
- `packages/nui-language/src/document/statementReconciler.ts`
- `packages/nui-language/src/document/textPatch.ts`

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

- `packages/nui-language/src/dsl/`
- `packages/nui-language/src/dsl/dslDocument.ts`
- `docs/dsl.md`

The former `src/dsl/` implementation paths are transitional forwarding shims;
they are not a second parser or compiler owner.

`docs/dsl.md` は current implemented language documentation。Current
saved-document language は nui1 only。

Drawing Profile declarations are compiler-resolved source declarations in the
ordinary source lexical namespace. Drawing Modifier `width`, `style`, `color`,
and `state` contributions merge independently: the common modifier contribution
is applied first, followed by the matching selected profile delta.

Print layout source declarations are also owned by the nui1 parser/compiler
facade: `layout` contains ordered direct `place` statements, while `print` and
`svg` contain resolved output references and physical-unit settings. Their
statement identities come from `statementReconciler`; lexical target/origin and
profile resolution comes from `sourceLexicalNamespaceIndex`; numeric fields use
the shared scalar binding compiler. `DslDocumentData` stores these three source
models and does not own an active output selection or an export/preview runtime.

### Multi-document import graph / public API

Primary:

- `packages/nui-language/src/document/multiDocumentPrimitives.ts`
- `packages/nui-language/src/document/multiDocumentImportGraph.ts`
- `packages/nui-language/src/document/multiDocumentPublicApi.ts`
- `packages/nui-language/src/document/multiDocumentModuleSemantics.ts`
- `packages/nui-language/src/document/multiDocumentLanguageQueries.ts`
- `packages/nui-language/src/dsl/dslMultiDocumentSyntax.ts`
- `packages/nui-language/src/dsl/sourceLexicalNamespaceIndex.ts`
- `vscode-extension/src/multiDocumentHost.ts`
- `vscode-extension/src/moduleMultiDocumentHost.ts`
- `src/vscode/multiDocumentGraphTransport.ts`
- `src/vscode/multiDocumentRuntimeTransport.ts`
- `src/vscode/vscodeWebviewSession.ts`

`multiDocumentImportGraph.ts` is the host-neutral owner of saved dependency graph
construction. Hosts provide an async saved-source loader and canonical
`DocumentId` / saved-source fingerprint facts; path resolution, filesystem I/O,
watchers, and host lifecycle stay outside this subsystem. Roots use current source
snapshots while imported dependencies use exact saved snapshots. Dependency
artifacts are cached only by exact `(DocumentId, savedSourceFingerprint)`, and an
invalid changed dependency never falls back to an older saved artifact.

Graph construction preserves source-ordered import edges, reports structured
missing/unreadable/stale/canceled/invalid failures, marks every participating
edge of an import cycle, and fails closed. `MultiDocumentGraphCoordinator` owns
per-root latest-request-wins installation plus the reverse dependency index used
to invalidate exactly the active root graphs that transitively contain a changed
saved dependency; the host decides when and how to rebuild those roots.

`multiDocumentPublicApi.ts` owns the family-neutral exportable declaration catalog
for module/modifier/profile/layout/layoutTemplate consumers. Generic file
re-exports flatten to the original document-qualified semantic identity rather
than manufacturing a new identity, and public/private/missing or duplicate public
names remain explicit catalog results/diagnostics. Family-specific export syntax
or semantics are supplied by later declaration contributors, not by this owner.

Import aliases participate in the existing source lexical namespace only when the
multi-document caller supplies their stable statement identities. The ordinary
lexical resolver still owns alias visibility, source order, and collisions. For
`alias::member`, only the member lookup is delegated through the optional external
namespace resolver to the imported public catalog. Existing single-document
callers do not receive external lookup variants and remain fail-closed for import
members.

`multiDocumentModuleSemantics.ts` supplies the production Module-family
declaration contributor and coordinates the existing graph, public API, lexical
resolver, and central Module semantic analyzer. It analyzes dependency artifacts
in defining-document order, preserves document-qualified Module identities, and
passes caller expressions through the caller's source namespace while resolving
defaults, bodies, helpers, exports, and nested calls in their defining document.
It does not materialize or evaluate Module runtime geometry.

`multiDocumentLanguageQueries.ts` is the host-neutral document-qualified
Definition / References / Rename layer over that graph and the existing semantic
owners. It projects exact declaration/reference occurrences onto stable
`DocumentId`-qualified identities, preserves re-exported members as occurrences
of the original public identity, and never recovers cross-file semantics through
workspace text search. An open dirty document may replace a saved target only when
the supplied current semantic view re-proves the same identity and exact range;
otherwise navigation fails closed.

Public References and Rename consume a host-supplied complete reverse-importer
query universe. The core prefers a single exact current snapshot over saved
snapshots for an open document, rejects conflicting/stale source proof, and
deduplicates repeated importer candidates. Rename additionally requires each
document semantic owner to prove the complete non-overlapping edit set against
exact expected source text; any rejected document rejects the whole plan. Import
alias rename remains importer-local. Concrete VS Code filesystem discovery,
watchers, document lifecycle, and `WorkspaceEdit`/host mutation adapters remain
outside this subsystem.

`vscode-extension/src/multiDocumentHost.ts` is the generic production VS Code
adapter for that host-neutral layer. It canonicalizes file-backed `.nui` paths
to file-URI `DocumentId`s, reads imported dependencies only through
`workspace.fs.readFile`, and fingerprints the exact saved bytes with SHA-256.
Each open root owns one coordinated graph built from its current `TextDocument`;
dependency nodes remain saved-disk snapshots even when the same file is open
and dirty. Dirty open content may contribute only an exact-current semantic view
for language queries, never replace the dependency snapshot used to construct
the graph. One saved artifact cache is shared by active-root and reverse-root
builds, and exact existing graph statement identities are reused when a saved
document is compiled as another graph root.

The host watches `**/*.nui` saves/creates/deletes and invalidates coordinator-owned
reverse dependencies before rebuilding affected open roots. Public References and
Rename use `workspace.findFiles("**/*.nui")` only to enumerate a complete candidate
universe; every candidate is parsed/semantically analyzed and the query fails
closed on incomplete or stale proof rather than using text search. Native
Definition/References/Rename providers ask this host first for document-qualified
results and otherwise retain the existing single-document query path. Rename
rechecks every exact source owner immediately before producing a `WorkspaceEdit`;
a dirty editor cannot authorize edits against an older saved dependency snapshot.

`vscode-extension/src/moduleMultiDocumentHost.ts` composes that one generic
host with the existing Module declaration contributor, graph-root
`analyzeMultiDocumentModuleSemantics` / `createModuleRuntimeContext` compile,
document-qualified identity projection, and Module rename proof factory. The
factory delegates defining-document safety to `analyzeModuleSemanticRename` and
allows importer/re-export edits only from the existing exact Module semantic
view or graph re-export occurrences. It does not own a second graph, cache,
resolver, occurrence index, workspace search, or rename planner.

`multiDocumentGraphTransport.ts` projects only JSON-safe root graph/source data.
`multiDocumentHost.ts` publishes building/current/invalidated/unavailable states
by root document URI, and `VscodeWebviewSessionRegistry` fans the latest retained
publication to every matching Canvas and Output Preview session, including a
surface opened after the graph was built. The graph is owned once by the root
document; individual Webview surfaces do not rebuild filesystem/import state.
`moduleMultiDocumentHost.ts` supplies the family-owned exact graph-root compile
and a projector that publishes `multiDocumentRuntimeTransport.ts` only for
actual cross-document Module materialization. That JSON-safe projection uses
the existing prepared Rust input and narrow materialization snapshots/origins;
it does not transport the compiler, graph, parser products, Maps, or functions.
Family-specific declaration/export/runtime semantics remain supplied by their
own semantic owners rather than by the generic VS Code host adapter.

### Lexical / name resolution

Representative owners:

- `packages/nui-language/src/scalars/lexicalScopeIndex.ts`
- `packages/nui-language/src/dsl/lexicalScopeIndexAdapter.ts`
- `packages/nui-language/src/dsl/sourceLexicalNamespaceIndex.ts`
- `packages/nui-language/src/dsl/dslReferenceTokens.ts`
- `packages/nui-language/src/dsl/dslSemanticOccurrenceIndex.ts`
- `packages/nui-language/src/dsl/dslModifierAuthoring.ts`
- `packages/nui-language/src/dsl/dslModifierAuthoringIndex.ts`
- `packages/nui-language/src/dsl/dslSourceValueStepQuery.ts`
- `packages/nui-language/src/dsl/dslDefinitionQuery.ts`
- `packages/nui-language/src/dsl/dslRenameQuery.ts`
- `packages/nui-language/src/dsl/dslReferencesQuery.ts`

既存 lexical / source namespace resolution が owner。同じ semantic concept の
second resolver を作らない。Definition、Rename、References の source
occurrence enumeration は `dslSemanticOccurrenceIndex.ts` が compiler-resolved
identity と exact physical range を共有し、各 query がそれぞれの safety
policy を持つ。

Drawing Modifier の strict property validation、authoring metadata、exact
sub-token spans は `dslModifierAuthoring.ts` が owner であり、
`dslModifierAuthoringIndex.ts` が exact-current source-only definition /
reference / property view を導出する。Completion、Definition、Rename はこの
shared source semantics を利用し、VS Code に別 parser / resolver を持たない。

Source Value Step は `dslSourceValueStepQuery.ts` が host-neutral な
exact-current edit plan を所有する。Element parameter は既存 parameter step
resolver、typed declaration / `set` は compiler-owned `BindingId` と宣言側の
number metadata、Drawing Modifier は shared authoring index / metadata を再利用する。
`dslDocument.ts` は unrelated diagnostic で canonical `document` が fatal に
なった場合も、exact-current source element products を statement index で保持し、
query が last-good document や再parseへフォールバックせず判定できる。

### Typed scalar expressions

Primary:

- `packages/nui-language/src/scalars/`

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

- `packages/nui-language/src/dsl/moduleSemantic*`
- `packages/nui-language/src/dsl/moduleMaterialization*`
- `packages/nui-language/src/dsl/moduleRuntimeContext.ts`
- `packages/nui-language/src/scalars/moduleScalarRuntime.ts`

既存 Module semantic resolution / materialization / runtime infrastructure を
再利用する。`moduleSemanticAnalysis.ts` が same-file と imported Module の
共通 semantic owner であり、document-qualified identity と external callee
resolver はその narrow adapter boundary である。Second Module runtime / resolver
を作らない。Materialized Module children を source representation として
flatten しない。

`moduleRuntimeContext.ts` は、同じ `MultiDocumentImportGraph` と
`MultiDocumentModuleSemanticAnalysis` から、各 `DocumentId` の exact parsed
statements、source lexical namespace、Module analysis、source identity を既存の
materialization / scalar / geometry runtime へ渡す narrow adapter である。Module
call の引数は caller document、definition body/default/local/record/nested call は
defining document から読み、必要な場合だけ document-qualified runtime path を
使う。Materialized origin は document-qualified statement identity、exact source
identity、source range を保持し、`sourceOwnership` はこの証明が一致しない場合に
fail closed する。Import source を連結したり、runtime 用に別の parser / resolver を
複製したりしない。生成された materialized/scalar/geometry runtime output は、既存の
production evaluator input としてそのまま評価される。

### TypeScript evaluation

`EvaluationResult.geometryMutationExecutions` is the production/reference parity fact for successful in-place geometry mutations. It contains only the runtime mutation occurrence ID and the target geometry IDs, in actual execution order; disabled, inactive, skipped, or failed mutations are absent. Rust emits the same JSON-friendly field through the ordinary evaluation payload.

`src/geometry/geometrySourceFlow.ts` joins those runtime facts with the exact-current `CompiledDslDocument`. Construction and mutation steps resolve through `sourceOwnership`; `forGroupGeneratedRows` maps generated runtime occurrences back to their source templates. The resulting host-neutral steps carry reconciler-owned source statement identity and exact physical source span. Consumers must use this structured join rather than parsing runtime IDs, searching source text, or reconstructing evaluator semantics.


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
をownerとする。`rustEvaluationRunner.ts` はUI host、Node、benchmarkから独立した
Rust request preparation / transport contractであり、既存の
`buildRustEvaluationInput` と `evaluationPayloadToResult` を再利用する。
`evaluationEngine.ts` はshared Rust orchestrationとreference / parity integrationを
担当する。`buildRustEvaluationInput` は引き続きsole JSON-shaped Rust projection
ownerである。VS CodeとHeadless MCPはそれぞれの薄いhost transportからこの共通
boundaryを利用する。

`src/vscode/useVscodeMultiDocumentRuntimeEvaluation.ts` is the VS Code-specific
consumer for a published cross-document Canvas runtime. It evaluates the
host-prepared input through `evaluatePreparedRust` and `VscodeRustTransport`,
uses the graph publication revision as its Canvas evaluation revision, ignores
stale completions, and exposes an empty failed result on transport failure.
It never reconstructs a reference evaluation or retains the preceding imported
runtime. When no cross-document projection is active, `VSCodeApp` keeps the
existing local `useEvaluationEngine` path.

`vscode-extension/src/extension.ts` owns the three Canvas Bake settings as the
VS Code configuration boundary. Hosts resolve plain Bake options before invoking
the shared command; the shared core does not read host settings APIs.

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
command registry. The VS Code Webview sends the resulting `LineSplice[]` to the
Extension Host, which applies one native TextDocument edit. Source ownership and
normalized source position queries remain the existing SAY-41 boundary; Bake does
not create a second runtime-to-source map.

### Output planning / print encoding

Primary:

- `src/output/outputCore.ts`
- `rust-evaluator/src/output/payload.rs`
- `rust-evaluator/src/output/svg.rs`
- `rust-evaluator/src/output/pdf.rs`
- `vscode-extension/src/outputPreviewFeature.ts` (Output Preview Extension Host owner)
- `vscode-extension/src/outputPreviewSourceInteractionFeature.ts` (Output Preview Source interaction adapter)

`outputCore.ts` is the host-neutral owner of the resolved output plan shared by
SVG, PDF, and future Preview. It consumes compiler-resolved layouts/outputs,
calls the existing `buildEvaluationOptions` boundary with the output's selected
Drawing Profile, and consumes the resulting `EvaluationResult` without
re-evaluating or filtering the common Canvas result. It resolves typed numeric
output values through the compiled numeric binding/runtime products, applies
ordered group-subtree placements, emits only line/arc/Bezier/offsetLine/polyline/text
drawables, and calculates deterministic stroke-inclusive/text-inclusive bounds.

The same plan owns SVG physical sizing and print tiling metadata, including
page origins, first-page usable areas derived from physical overlap, physical
page strides, overlap guides, joining labels, and deterministic text layout. It
owns a stable six-role export palette whose values match the
legacy Canvas baseline, but does not read the active Canvas theme at runtime;
it also converts modifier widths from CSS pixels to millimetres. It has no
React, host UI, command, dialog, or save flow ownership.

`rust-evaluator/src/output/payload.rs` is the JSON-friendly resolved-payload
validation boundary. `svg.rs` and `pdf.rs` are the production Rust encoding owners;
they do not parse `.nui` source or resolve source names. SVG performs the Y-up
to SVG Y-down conversion only at this boundary, while PDF preserves the
physical Y-up page coordinates.

Output Preview is the only user-facing save surface. Its current Webview plan
publishes exact document-version/output-identity availability and sends the
already-resolved `rustPayload`; the Extension Host owns the Output Preview-only
command, save dialog, default `<document>_<output>` name, stale-session checks,
and success/error notification. The shared `evaluation_stdio` process accepts a
separate `exportOutput` envelope without changing the existing `{ id, input }`
evaluation envelope or the public `evaluate_document(input)` Rust API. Encoding
finishes in memory before the selected local file is written, so payload or PDF
character validation errors do not touch the target.

`outputPreviewFeature.ts` owns the Output Preview Extension Host session
lifecycle, create/reuse/hydration and pending-open delivery, Webview routing,
Output Preview command registration, native history handoff, save flow, and
the Source interaction adapter. It reuses the shared
`VscodeWebviewSessionRegistry`, the root-owned Rust process boundary,
`handoffOutputPreviewHistory`, and the host-neutral
`outputPreviewPlaceDrag.ts` safety proof; it does not create a second session,
process, history, or source authority. `extension.ts` remains the explicit
composition root only for shared registry/process access and the narrow
Canvas-to-Output-Preview / Output-Preview-to-Canvas adapters.

### Rust evaluation

Primary:

- `rust-evaluator/src/evaluation/`
- `rust-evaluator/src/bin/evaluation_stdio.rs`
- `rust-evaluator/examples/evaluate_fixture.rs`
- `src/geometry/rustEvaluationRunner.ts` (request boundary)
- `src/node/rustEvaluationProcess.ts` (shared Node stdio process boundary)

`rust-evaluator/` is the host-neutral production Rust evaluator owner. Its
`Cargo.toml` contains evaluator-only dependencies (`kurbo`, `serde`, `serde_json`)
and does not depend on WebKit or desktop host APIs. The ordinary Rust
API is:

- `nuinuicad_rust_evaluator::evaluate_document(input)`

Rust evaluator は `.nui` source text を parse したり source name resolution を
やり直す owner ではない。TypeScript compile / lowering 側で構築された resolved
runtime payload を decode / validate / evaluate する。

Production VS Code evaluationは Webview request から Extension Host の persistent
`RustEvaluationProcess` / Node stdio boundaryを通り、`rust-evaluator` が所有する
`evaluation_stdio` NDJSON protocolへ接続して、同じ
`nuinuicad_rust_evaluator::evaluate_document`を呼び出す。Headless MCPも独立した
Node ownerから同じ client/protocol と Rust evaluatorを利用する。既定binary discoveryは
`rust-evaluator/target/debug/evaluation_stdio`で、
`NUINUICAD_RUST_EVALUATION_BINARY` overrideは維持する。

Parityのcargo exampleは `rust-evaluator/examples/evaluate_fixture.rs` から同じ
Rust evaluatorと `buildRustEvaluationInput` のprojectionを利用する。Parity harnessは
Rust evaluator自体のcorrectness検証のため、production Rust eligibilityとは独立して
Rust inputを構築できる。Current-release fixtureは別途production Rust eligibilityを
assertする。

### Rendering / hit testing

Primary:

- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/vscode/ModulePreviewApp.tsx`
- `src/vscode/ModulePreviewParametersApp.tsx`
- `src/vscode/multiDocumentRuntimeTransport.ts`
- `src/vscode/useVscodeMultiDocumentRuntimeEvaluation.ts`
- `src/vscode/modulePreviewParameterProjection.ts`
- `src/components/canvasHostAdapter.ts`
- `src/components/DrawingCanvas.tsx`
- `src/components/canvasRenderer.ts`
- `src/components/CanvasOverlay.tsx`
- `src/components/canvasTheme.ts`
- `src/components/useCanvasOverlayData.ts`
- `src/components/DrawingCanvasHitTest.ts`

Current rendering architecture は VS Code Webview surface →
CanvasHostAdapter → DrawingCanvas → canvasRenderer + CanvasOverlay。
`VSCodeDrawingCanvas`が現在のstore、command、Source Editor、画像URL、
CommandRibbonOverlayをadapterへ接続し、DrawingCanvasはhost-neutralな
interaction/rendering ownerとしてcanvasとoverlayを描画する。ModulePreviewAppも
同じDrawingCanvas / CanvasHostAdapterを使い、preview rootのtarget runtime
elementsだけを描画する。Point/Bezier source gestures remain shared
DrawingCanvas interactions with Preview-only ephemeral transforms; authored
commits cross the Module Preview source-patch boundary described above. VS Code側
に別のrendererやdrag transformは持たない。

`VSCodeDrawingCanvas` additionally accepts the narrow exact runtime projection
for an importing root. While active, the shared renderer and hit testing use
the prepared runtime elements, runtime evaluation revision, and rehydrated
Module instance presentation facts. Those elements remain presentation-only:
the canonical root store and all Source-writing commands remain unchanged, and
dependency-owned runtime IDs cannot be dragged or committed through Canvas.

Current invariants:

- DrawingCanvasのinteraction logicはhost-neutral boundary越しに既存command/document ownerを使う。
- `DrawingCanvas` passes resolved modifier strokes directly to the shared
  `canvasRenderer`; the renderer is the presentation boundary for semantic theme
  roles and does not receive modifier definitions or names. The shared
  development/test harness uses `LEGACY_CANVAS_THEME`; VS Code resolves the
  active Webview CSS variables and passes the host-neutral `CanvasTheme` through
  the same adapter.
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
dimensions; pointer moves remain presentation-local and the host decides what a
pointerup commit means. `VSCodeDrawingCanvas` adapts the separate
`nuinuiCAD.canvasRibbon.ribbons` model, the closed Ribbon command catalog, and
dynamic Lucide icon resolution through the same boundary.

### Commands / keyboard / parameters

Primary:

- `src/commands/`
- `src/commands/coordinatePointConversion.ts`
- `src/commands/coordinatePointConversionSession.ts`
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
- Rust evaluator tests in `rust-evaluator/src/evaluation/`

`test/evaluationParitySupport.ts` の`optionsFor`は同じshared production
evaluation context builderを呼ぶthin wrapperである。Rust parityは既存の
`buildRustEvaluationInput(fixture.elements, optionsFor(fixture))`から
`rust-evaluator/examples/evaluate_fixture.rs`、`evaluate_document`へ進み、Rust payload
boundaryやbenchmark protocolはこのloweringの外側にある。

### Performance comparison foundation

Primary:

- `src/performance/`
- `scripts/performance/`
- `performance/fixtures/`

VS Code and compatible historical-result comparisonで共有する benchmark protocol、
result schema、statistics、comparison logic、固定 `.nui` workload の owner。

`src/performance/` は benchmark protocol、result schema、statistics、passive
instrumentation、host-neutral benchmark execution、browser capture scenario、
VS Code capture orchestration、result assembly を owner とする。
`scripts/performance/` は VS Code capture CLI と result IO / comparison を担当する。
Benchmark state は application store や Rust state に追加せず、通常 run
ではほぼ no-op になる独立 subsystem である。

### VS Code production document lifecycle

Primary:

- `vscode-extension/src/extension.ts`
- `vscode-extension/src/extensionEntry.ts`
- `vscode-extension/src/modulePreviewFeature.ts`
- `vscode-extension/src/languageAnalysisSession.ts`
- `vscode-extension/src/completionProvider.ts`
- `vscode-extension/src/signatureHelpProvider.ts`
- `vscode-extension/src/definitionProvider.ts`
- `vscode-extension/src/referenceProvider.ts`
- `vscode-extension/src/documentSymbolProvider.ts`
- `vscode-extension/src/renameProvider.ts`
- `vscode-extension/src/choiceQuickFixProvider.ts`
- `vscode-extension/src/hoverFeature.ts`
- `vscode-extension/src/hoverProvider.ts`
- `vscode-extension/src/runtimeEvaluationService.ts`
- `vscode-extension/src/referencePickCommandFeature.ts`
- `vscode-extension/src/coordinatePointConversionCommandFeature.ts`
- `vscode-extension/src/coordinatePointConversionPresentation.ts`
- `vscode-extension/src/referencePickSourceBridge.ts`
- `vscode-extension/src/sourceValueStepCommandFeature.ts`
- `src/geometry/geometryHoverPresentation.ts`
- `src/node/rustEvaluationProcess.ts`
- `src/vscode/VSCodeApp.tsx`
- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/components/CommandLineBar.tsx`
- `src/vscode/coordinatePointConversionPick.ts`
- `src/vscode/ModulePreviewApp.tsx`
- `src/vscode/modulePreviewLifecycle.ts`
- `src/vscode/modulePreviewEvaluation.ts`
- `src/vscode/useVSCodeReferencePickSession.ts`
- `src/vscode/VSCodeReferencePickOverlay.tsx`
- `src/vscode/protocol.ts`
- `src/vscode/vscodeWebviewSession.ts`
- `src/vscode/webviewSurfaceRouter.tsx`

VS Code `TextDocument` is the production source authority. The Webview
`cadDocumentStore` is a disposable mirror hydrated from the authoritative
document and is never restored as a host-side source. The current scope is
`file:`-scheme `.nui` documents, including workspace and outside-workspace
files and dirty in-memory content; untitled and non-file documents are not
supported.

Canvas and Output Preview sessions are keyed by document URI plus surface kind
through the shared `VscodeWebviewSessionRegistry`. Module Preview has distinct
lifecycle ownership in `modulePreviewFeature.ts`: it keeps one panel per document
URI and stores the stable target Module definition identity so a repeated open can
reveal and retarget the same panel without rebinding an existing panel to another
document. The semantic Webview surface kinds are `canvas`, `outputPreview`, and
`modulePreview`; the `modulePreviewParameters` Webview View is a projection surface
in the Explorer container, not a second Module Preview session. The three rendering
surfaces are independent and may coexist for the same document. Closing the source
`TextDocument` disposes the associated Module Preview panel as well as the
registry-owned document surfaces.

The production host still ships one `webview.js` bundle. Extension Host HTML
bootstrap places the surface kind in explicit static metadata, and
`webviewSurfaceRouter.tsx` validates that value before routing `canvas` to
`VSCodeApp`, `outputPreview` to `OutputPreviewApp`, `modulePreview` to
`ModulePreviewApp`, and `modulePreviewParameters` to
`ModulePreviewParametersApp`. Malformed or unknown values fail closed.

Module Preview command eligibility and execution are exact-current. Command
Palette visibility is Source-scoped for file-scheme `.nui` documents, while the
Source context menu uses the exact current caret target. `modulePreviewFeature.ts`
resolves the innermost current Module using the same `queryModulePreviewTarget`
authority as the Webview. It preserves that definition's reconciler-owned stable
identity across source changes through `currentModulePreviewTargetByIdentity`;
when the identity disappears or the current semantic proof is stale, it sends an
unavailable target instead of falling back to a name or ancestor. Target delivery
waits until the Webview has acknowledged the exact authoritative TextDocument
version.

The same Module Preview lifecycle establishes the active binding for the production
`nuinuiCAD.modulePreviewParameters` Webview View. It assigns each panel target
generation a host-owned session identity, retains the latest JSON-safe parameter
projection, and relays value/default actions only after validating the session,
document/source freshness, target definition identity, and exact row identity.
The parameter View is hydrated from that retained projection when it resolves; it
does not create a Module Preview session or mutate canonical Source.

Geometry rows in that View expose a contextual Pick action only for point, line,
and path parameters. `modulePreviewFeature.ts` validates the exact row and
Preview session proof, while `ModulePreviewApp.tsx` derives the owning Module
definition's caller scope from the ephemeral Preview compiler projection and
reuses the shared Canvas Reference Pick candidate/session/overlay behavior.
Confirmed references return through the Preview `setValue` path only; this route
never edits canonical Source or adds a Source Undo entry.

Inside the Webview, `ModulePreviewApp` owns only surface composition. It uses
`AutomationDocument` for the authoritative source mirror,
`createModulePreviewSession` for the host-neutral ephemeral input/default/last-good
state, `buildModulePreviewEvaluationOptions` plus `VscodeRustTransport` for the
existing production evaluation path, and the shared `DrawingCanvas` /
`CanvasHostAdapter` for rendering and Preview-only ephemeral interactions.
Canonical source mutation for point/Bezier edits is performed only through the
host-owned source-patch boundary; Preview parameter/context state, synthetic root
invocation, and Reference Pick remain outside this surface lifecycle.

Explicit VS Code navigation is bidirectional and opt-in: Canvas selection does
not follow the Editor cursor, and Editor cursor movement does not change Canvas
selection. The TextDocument remains the source authority. The Extension Host /
Webview boundary transports only the TextDocument version plus a normalized LF
source position or range. Canvas source-definition responses additionally carry
the exact selected runtime ElementId; reconciler StatementIdentity remains
inside the source-ownership and graph context owners. Editor → Canvas runs the
host-neutral source-target query before opening Canvas, so non-runtime source
never creates a panel. With the production multi-document host, Canvas → Editor
resolves that runtime element through the exact graph-backed Module context and
target-document physical span, then rechecks the proven URI/source/dirty state
before reveal. The legacy root-local range is used only when no such host is
active. Both directions fail closed on stale source, version, compilation, or
session state.

Source → Canvas Reference Pick is an explicit Source command, not cursor-follow
behavior. `referencePickCommandFeature.ts` uses the same exact host-neutral
`queryDslReferencePickTarget` for context-menu eligibility and command execution,
while Command Palette visibility remains at Source scope. It reuses the existing
URI-scoped `NuiLanguageAnalysisSession` and `VscodeWebviewSessionRegistry`, creates
or reveals the matching Canvas through `createCanvasPanel(document, true)`, and
waits until that session has acknowledged the current authoritative document
version before starting Pick Mode. Canvas history handoff or in-flight Canvas
history prevents a Pick from starting.

`referencePickSourceBridge.ts` captures document URI/version plus target proof and
owns final one-edit Source mutation and Source focus/caret restoration. In the
Webview, `useVSCodeReferencePickSession.ts` independently checks the current
canonical source, compiled source/revision, and evaluation freshness before
starting the shared reference-pick session. `VSCodeReferencePickOverlay.tsx`
projects the existing candidate/hit-test/session semantics into hover, draft,
Done/Enter, and Esc UI using the established Canvas bottom-right transient hint
and Canvas theme variables. Source changes, document close, stale proof/version,
panel disposal, stale responses, or invalidated targets cancel or fail closed
without source mutation.

The Preview route uses `modulePreviewProtocol.ts`,
`useVSCodeModulePreviewReferencePickSession.ts`, and
`modulePreviewReferencePick.ts` for its exact session/row proof and Preview
target adapter. Its candidate input is the compiler-owned ephemeral Preview
statement map, semantic analysis, and lexical namespace; the route-specific
adapter shares the Canvas draft, hover, confirm, and cancel behavior without
using Source caret positions or the Source replacement bridge.

Coordinate point conversion keeps its semantic session and target/base
revalidation in `coordinatePointConversion.ts` and
`coordinatePointConversionSession.ts`, while the Extension Host owns the
document-scoped request lifecycle, native QuickPick primary interaction, source
splices, and terminal presentation. The native picker reuses
`coordinatePointConversionReferenceSuggestions` so canonical source reference
names and paths remain the searchable candidate model. In the Webview,
`CommandLineBar.tsx` and `coordinatePointConversionPick.ts` remain only for the
explicit Canvas visual-pick adapter; the normal conversion path does not depend
on CommandLineBar rendering. The visual adapter delegates Canvas picking through
`CanvasHostAdapter` and the shared `DrawingCanvas` point-pick path. An owned
visual conversion commit carries its request identity across the normal
TextDocument change echo so the terminal result remains connected to exactly
one active request; unrelated source changes, stale evaluation, panel disposal,
or document close fail closed.

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
target resolution and the shared Bake conversion. Normal Canvas target resolution
keeps the module-body to root-instance insertion redirect. Module Preview uses
authored source ownership with Preview materialization: Module-body leaves insert
in their real Module definition/body scope, real nested Module instances use their
authored call-site scope, and synthetic Preview calls are never persisted. Its
final splices use the same authoritative TextDocument transaction as point/Bezier
commits. A source-triggered request keeps Source Editor focus where possible,
rejects reusable module-definition bodies, and is accepted only after the same
authoritative source/revision/evaluation checks used by navigation.

`RustEvaluationProcess` and the shared lazy owner implementation live in
`src/node/rustEvaluationProcess.ts`. The VS Code compatibility wrapper in
`vscode-extension/src/rustEvaluationProcessOwner.ts` exposes the one active
Extension Host owner so independently registered production features can reuse it.
That one lazy process instance is shared by Canvas, Output Preview, Module Preview,
native Hover runtime evaluation, and Output Preview export encoding regardless of
document or surface identity.
A panel does not own or kill the process. Unexpected process death rejects pending
work, clears the dead process, and allows the next evaluation request to respawn
it. Headless MCP owns a separate lazy owner instance but uses the same
client/protocol implementation. The process binary is produced by `rust-evaluator`.
The existing bounded latest-wins Rust transport, stale
evaluation discard, `VscodeDragPreviewScheduler`, shared DrawingCanvas, and
production compiler/evaluator remain reused from the performance PoC path.

`src/vscode/` owns the Webview-side message bridge, Canvas and Module Preview
surface composition/adapters, and benchmark result handoff. Separable
cross-boundary message slices live with their feature owners in
`outputPreviewProtocol.ts`, `canvasObservationProtocol.ts`,
`runtimeDiagnosticsProtocol.ts`, `modulePreviewProtocol.ts`, and the existing
Reference Pick / multi-document protocol modules. `src/vscode/protocol.ts`
remains the one explicit JSON-safe aggregate authority for the two directional
message unions, Webview API, shared surface identity, and other genuinely
cross-feature transport facts. `vscode-extension/` owns the desktop-local
Extension Host: Canvas lifecycle, Output Preview lifecycle through
`outputPreviewFeature.ts`, shared Canvas/Output Preview registry composition,
Module Preview's per-document panel/target lifecycle, TextDocument edit bridge,
URI-scoped language analysis sessions, and its adapter into the shared persistent
Rust stdio process boundary.

`vscode-extension/src/sourceAuthoringPositionFeature.ts` is the single
Extension Host owner for retained Source authoring positions. It records
explicit Source authoring locations with their exact document version, fails
closed on stale or external changes, and advances command-owned positions only
after accepted edits while preserving the retained Undo/Redo history. The
Canvas free-point feature and generic Canvas creation endpoint both consume this
owner. Generic Canvas creation captures the retained position, current document
version, Canvas session, and request identity before crossing the Webview
boundary; the Webview resolves that position through
`resolveSourceCreationInsertion`, and an accepted host commit advances the
shared position from the committed statement metadata rather than using a
document-end fallback.

The Extension Host is authoritative for VS Code Canvas Ribbon configuration. It
normalizes `nuinuiCAD.canvasRibbon.ribbons`, sends the current normalized value
to each Webview session, broadcasts configuration changes, and applies only
validated `{ ribbonId, x, y }` position patches back to User Settings. The
Webview keeps presentation state local during a drag and sends one position
commit on pointerup. The `nuinuiCAD.editCanvasRibbon` command routes both
Command Palette and Ribbon host-action invocations to the normal VS Code
Settings surface.

The extension keeps one package-owned `NuiLanguageSession` per supported
document URI for local diagnostics and single-document language features.
`NuiLanguageSession` owns the current source/revision proof and directly invokes
the host-neutral language queries over its one lower-level `AutomationDocument`;
it does not expose VS Code, Node, React, DOM, Canvas, runtime geometry, or
evaluator services. `languageAnalysisSession.ts` is the thin VS Code composition
layer that adds the runtime-diagnostics sidecar and a clearly transitional
current-compiled bridge for deferred workspace consumers. `VscodeMultiDocumentHost` owns the exact
graph/watcher lifecycle, current root generation, and diagnostics refresh
notifications; saved dependencies remain disk-authoritative until the existing
watcher/coordinator rebuilds affected roots. The Module adapter supplies the
Module-family graph, semantic, and exact compiler diagnostic projection.
`extension.ts` remains the owner of the one native `DiagnosticCollection` and
composes that selected compiler/semantic layer with runtime diagnostics and
Canvas-theme warnings. A root without imported dependencies stays on the local
session path, while an imported root exposes only its exact current graph
snapshot to Problems. During incomplete root authoring, the graph owner still
loads root import edges and keeps the graph invalid for strict consumers;
Completion alone may receive a current-root tolerant semantic snapshot after
the existing dependency, public-catalog, and Module-runtime proofs succeed:

```text
VS Code TextDocument
→ one URI-scoped multi-document host / saved graph coordinator
├→ Module contributor → analyzeMultiDocumentModuleSemantics
├→ createModuleRuntimeContext → exact graph-root compile
├→ completion-only current-root bridge → same graph/catalog/runtime authority
├→ Module graph/semantic/compiler diagnostics → DiagnosticCollection
│  ├→ queryDslCompletion → CompletionItemProvider (exact or completion-only)
│  └→ queryDslSignatureHelp → SignatureHelpProvider
├→ queryMultiDocumentDefinition / queryMultiDocumentReferences
│  └→ DefinitionProvider / ReferenceProvider
└→ planMultiDocumentRename + Module document proof → RenameProvider / WorkspaceEdit

VS Code TextDocument
→ NuiLanguageSession (single-document local/fallback)
├→ diagnostics() → localized VS Code diagnostics
├→ completion(offset) → CompletionItemProvider
├→ signatureHelp(offset) → SignatureHelpProvider
├→ definition(offset) → DefinitionProvider
├→ references(offset) → ReferenceProvider
├→ documentSymbols() → DocumentSymbolProvider
├→ prepareRename()/rename() → RenameProvider / WorkspaceEdit
├→ hover(offset)/themeRoleColors() → HoverProvider
├→ sourceValueStepForSelection() → Source Value Step command/context adapter → one TextEditor edit
├→ runtimeEvaluationSnapshot() → NuiRuntimeEvaluationService → EvaluationResult
│  → geometryHoverPresentation → HoverProvider
└→ quickFixes(input) → CodeActionProvider → guarded internal apply command → WorkspaceEdit

Runtime diagnostics and Canvas-theme warnings are composed by `extension.ts`
with whichever compiler/semantic layer the exact host generation selects; they
are not alternate diagnostic owners.
```

`NuiLanguageSession` owns current raw source, source replacement, current
compiler diagnostics, source revision, and fail-closed direct language queries.
`AutomationDocument` remains its lower-level parser/compiler/document owner.
`compilerDiagnostics.ts` is now a compatibility alias for the package-owned
diagnostic DTO/projection; display-language localization and VS Code diagnostic
collection ownership remain in the host. `completionProvider.ts` first asks the active
multi-document host for its exact or completion-only current-root semantic
snapshot, then projects
`queryDslCompletion` candidates to `CompletionItem`s; it retains the session
direct completion and recovery path when that snapshot is unavailable. Completion
semantics, filtering, ranking, and truncation remain owned by the production
query. `signatureHelpProvider.ts` uses the same exact host snapshot when
available and otherwise calls the session's direct current-source operation; it
does not recover stale Module metadata. `definitionProvider.ts` keeps
the VS Code adapter thin: it synchronizes the current `TextDocument`, converts
UTF-16 raw offsets across CRLF normalization, delegates semantic resolution to
`NuiLanguageSession.definition`, and projects its exact ranges to a same-document
`DefinitionLink`. `referenceProvider.ts` uses the same session/current-source
flow and delegates to `NuiLanguageSession.references`, returning deterministic
same-document `Location`s. `documentSymbolProvider.ts` delegates to the
session's host-neutral document-symbol projection and recursively converts its
normalized source ranges and symbol kinds to VS Code `DocumentSymbol`s. Rename target and edit-plan projection similarly
remain host-neutral; VS Code `RenameProvider` and `ReferenceProvider`
registrations are adapter boundaries, not second resolvers.
`sourceValueStepCommandFeature.ts` similarly projects the shared exact edit plan
to one guarded `TextEditor.edit`, then selects the replacement. Palette target
availability and command execution both use that query; raw/normalized offset
conversion and document version/source/expected-text checks remain host adapter
responsibilities.

Native Hover is the runtime-valued exception among these language features.
`hoverProvider.ts` synchronizes the TextDocument and resolves only a current
compiler-owned target through `NuiLanguageSession.hover` before invoking
`NuiRuntimeEvaluationService`.
The service owns document-keyed current-result/in-flight reuse and delegates to
the shared production evaluation context, Rust eligibility/runner and the same
Extension Host Rust process owner. `geometryHoverPresentation.ts` consumes only
the current `CadElement` plus `EvaluationResult` to project visible/hidden,
disabled/inactive/not-evaluated/error/unavailable states and reuses
`geometryDisplay.ts` for geometry formatting. Cancellation, document-version or
source-revision changes, and target changes after await all fail closed; no
last-good runtime geometry is shown.

Diagnostics, completion, definition navigation, references, document symbols,
rename planning, and choice Quick Fix generation do not perform runtime
evaluation or start the Rust process. Choice Quick Fix reuses the current
compiler invalid-choice diagnostic and the existing `typedVariableQuickFixes`
choice-replacement descriptors; it does not use the CodeMirror adapter. The
internal apply command is authoritative only for the current open file
document/version/source and fails closed before creating a `WorkspaceEdit`.

The single-document language migration is complete for the listed providers,
but the multi-document/workspace and MCP consumers still use the existing
transition bridge and are intentionally deferred to Slice 4. Runtime
diagnostics and Rust runtime evaluation remain host/runtime-owned; the package
session is evaluator-free. Final legacy shim deletion and import-zone
enforcement are likewise not part of this slice.

`rust-evaluator/src/evaluation/*performance*` は Rust evaluator 単体の既存 performance
test であり、cross-host UI comparison foundation とは別責務。

### VS Code Explorer mock surface

The native `nuinuiCAD.elements` Tree View is registered and refreshed by
`vscode-extension/src/elementsTreeFeature.ts`; it owns the Extension Host
lifecycle only. `vscode-extension/src/elementsTreeProvider.ts` remains the
semantic/presentation adapter, projecting the exact-current Document Symbols
into the tree hierarchy. A sibling
`nuinuiCAD.explorerMock` Webview View is contributed to the same
`nuinuiCAD.explorer` View Container. `vscode-extension/src/explorerMockFeature.ts`
owns only that Webview View's host lifecycle and shared-bundle HTML bootstrap.
`src/vscode/ExplorerMockApp.tsx` owns static fixture data presentation and
React-local interaction state. The surface reuses the shared Webview bundle and
`webviewSurfaceRouter.tsx`; it has no production document, evaluation, runtime,
navigation, or mutation semantics.

The production `nuinuiCAD.modulePreviewParameters` Webview View is contributed to
the same container and registered by
`vscode-extension/src/modulePreviewParametersFeature.ts`. Its host binding and
retained projection remain owned by `vscode-extension/src/modulePreviewFeature.ts`;
`src/vscode/ModulePreviewParametersApp.tsx` renders only the live Module Preview
parameter projection and sends proof-carrying actions back through the Extension
Host. It is independent of the Explorer Mock surface and the native Elements View.

## Core architecture invariants

- `.nui` `sourceText` is canonical。
- Current source と last-good compiled document は意図的に別。
- `sourceRevision` / `compiledDocumentRevision` / `evaluationRevision` /
  `evaluationRequestRevision` は同じ revision として扱わない。
- Stable statement / element / binding identity を維持する。
- Model mutation は canonical source-text patch boundary を通す。
- Production VS Code and Headless MCP evaluation は host-neutral `rust-evaluator`
  crate を使う。
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
