# Repository Architecture

## Purpose

This document is the current architecture navigation index for nuinuiCAD.

Use it to answer:

- which subsystem owns a concern;
- which entry points are primary;
- which boundaries must remain shared across hosts;
- how canonical source, compilation, evaluation, rendering, and host adapters connect.

This document is not a roadmap, implementation history, exhaustive source tree,
or feature-by-feature behavior specification. Source code is authoritative when
implementation details differ from this index. Durable product and engineering
policy belongs in `AGENTS.md`.

## High-level architecture

The production flow is:

```text
.nui sourceText
  -> VS Code TextDocument
  -> @nuinuicad/nui-language document/compiler surfaces
  -> canonical compilation and semantic products
  -> production evaluation context
  -> Rust production evaluator
  -> EvaluationResult
  -> VS Code Webview surfaces
  -> host-neutral Canvas / Output / Preview presentation
```

Headless MCP reuses the same Language Core and Rust evaluation boundaries without
creating another parser, resolver, evaluator, or document model.

The major architectural boundaries are:

- `.nui` source text is canonical.
- VS Code `TextDocument` is the production source authority.
- Language Core owns parser/compiler/source semantics and remains host-neutral.
- Runtime evaluation is a separate boundary from source compilation.
- Rust owns production CAD evaluation semantics.
- TypeScript evaluation remains the reference/parity/test path.
- Webviews are disposable presentation/runtime mirrors, not source authorities.
- Model-originated edits return through source-preserving text patches.
- Multi-document semantics are graph-backed and document-qualified.
- Host-specific APIs stay behind narrow adapters.

## Architecture map

| Concern | Primary owner / entry points |
| --- | --- |
| Canonical document lifecycle | `packages/nui-language/src/document/canonicalDocument.ts`, `automationDocument.ts`, `src/state/cadDocumentStore.ts` |
| Language Core package | `packages/nui-language/src/` |
| Compilation / source patches | `canonicalDocument.ts`, `statementReconciler.ts`, `textPatch.ts` |
| Lexical / source semantics | `packages/nui-language/src/dsl/`, `packages/nui-language/src/scalars/` |
| Module semantics | `moduleSemantic*`, `moduleMaterialization*`, `moduleRuntimeContext.ts` |
| Multi-document graph | `multiDocumentImportGraph.ts`, `multiDocumentPublicApi.ts`, `multiDocumentLanguageQueries.ts` |
| TypeScript reference evaluation | `src/geometry/evaluate.ts`, `evaluationEngine.ts` |
| Production Rust evaluation | `rust-evaluator/src/evaluation/` |
| Production evaluation lowering | `src/geometry/productionEvaluationContext.ts`, `rustEvaluationRunner.ts` |
| Output planning / encoding | `src/output/outputCore.ts`, `rust-evaluator/src/output/` |
| VS Code production host | `vscode-extension/src/extensionEntry.ts`, `extension.ts` |
| Webview routing | `src/vscode/main.tsx`, `webviewSurfaceRouter.tsx` |
| Canvas rendering | `DrawingCanvas.tsx`, `canvasRenderer.ts`, `CanvasOverlay.tsx` |
| Output Preview | `OutputPreviewApp.tsx`, `outputPreviewFeature.ts` |
| Module Preview | `ModulePreviewApp.tsx`, `modulePreviewFeature.ts` |
| Native language features | `vscode-extension/src/*Provider.ts`, `languageAnalysisSession.ts` |
| Headless MCP | `mcp-server/src/` |
| VS Code observation bridge | `vscodeObservationFeature.ts`, `mcpObservationBridge.ts` |
| Commands / shortcuts | `src/commands/`, `src/keyboard/` |
| UI state | `src/state/cadUiStore.ts` |
| Tests / parity | colocated tests, `test/evaluationParitySupport.ts`, Rust evaluator tests |
| Performance foundation | `src/performance/`, `scripts/performance/`, `performance/fixtures/` |

## Canonical document and Language Core

Primary:

- `packages/nui-language/src/document/canonicalDocument.ts`
- `packages/nui-language/src/document/automationDocument.ts`
- `packages/nui-language/src/model/cadDocumentTypes.ts`
- `src/state/cadDocumentStore.ts`

`sourceText` is the only canonical document value.

The document lifecycle intentionally distinguishes:

- current source text;
- current-source diagnostics;
- last successful compiled document;
- the source text represented by that compiled document;
- source lifecycle revision;
- compiled-document lifecycle revision;
- runtime evaluation revisions.

These identities are not interchangeable.

`AutomationDocument` is the host-independent document facade. It owns current
source, current-source diagnostics, last-good compiled state, and document
lifecycle revisions while reusing the canonical parser/compiler pipeline.

`CadDocumentStore` is the application-side adapter used by Webview surfaces. It
adds application notification, preview, history, and UI integration around the
same canonical document model. It is not a second source authority in the VS Code
production host.

Authored/compiled CAD model contracts live in Language Core. Runtime computed
geometry and `EvaluationResult` contracts remain under the runtime/evaluation
boundary.

### Language Core package boundary

Primary:

- `packages/nui-language/src/index.ts`
- `packages/nui-language/src/document-entry.ts`
- `packages/nui-language/src/workspace-entry.ts`

`packages/nui-language` owns host-neutral:

- parsing and compilation;
- source maps and statement identity;
- authored/source model contracts;
- lexical and semantic indexes;
- single-document document lifecycle;
- compile-time scalar, binding, and expression semantics;
- multi-document graph and workspace semantics;
- host-neutral language queries.

The package exposes the supported internal root, document, and workspace entry
points. Runtime computed geometry, Rust payload construction, runtime evaluator
orchestration, filesystem access, URI/version ownership, React, DOM, Canvas, and
VS Code APIs stay outside the package.

`NuiLanguageSession` is the per-document host-neutral facade for current source,
revision proof, diagnostics, and single-document language queries. Runtime
evaluation remains host/runtime-owned and is not part of the ordinary session
surface.

## Compilation and source mutation

Primary:

- `packages/nui-language/src/document/canonicalDocument.ts`
- `packages/nui-language/src/document/statementReconciler.ts`
- `packages/nui-language/src/document/textPatch.ts`
- `packages/nui-language/src/document/moduleModelBridge.ts`

Canonical compilation follows:

```text
sourceText
  -> parseDslSnapshot
  -> reconcileStatements
  -> compileDslDocument
```

The statement reconciler preserves stable statement identity across edits where
the authored structure permits it.

Model- or command-originated mutations use the canonical source-edit boundary and
source-preserving line/statement patches. Whole-file reserialization is not the
normal mutation path because comments, blank lines, formatting, and authored
layout remain source-owned.

Stable source identity is the bridge between language semantics, runtime source
ownership, navigation, rename, Canvas commits, Module Preview commits, and other
source-writing features.

## DSL, lexical resolution, and typed values

### DSL

Primary:

- `packages/nui-language/src/dsl/`
- `packages/nui-language/src/dsl/dslDocument.ts`
- `docs/dsl.md`

The Language Core DSL implementation owns the currently implemented nui1 source
language. `docs/dsl.md` is the implemented user-facing DSL reference.

The compiler publishes authored declarations, semantic products, source
ownership, dependency information, output declarations, Module semantics, and
runtime-lowering inputs used by downstream subsystems.

### Lexical and name resolution

Representative owners:

- `packages/nui-language/src/scalars/lexicalScopeIndex.ts`
- `packages/nui-language/src/dsl/sourceLexicalNamespaceIndex.ts`
- `packages/nui-language/src/dsl/dslSemanticOccurrenceIndex.ts`
- `packages/nui-language/src/dsl/dslDefinitionQuery.ts`
- `packages/nui-language/src/dsl/dslReferencesQuery.ts`
- `packages/nui-language/src/dsl/dslRenameQuery.ts`

Language Core owns lexical visibility, source namespace resolution, semantic
occurrence identity, and source ranges.

Definition, References, Rename, Completion, source stepping, and related language
features reuse these compiler-resolved identities instead of introducing
host-specific parsers or resolvers.

### Typed scalar expressions

Primary:

- `packages/nui-language/src/scalars/`

The scalar subsystem owns the typed expression AST, type checking, binding
identity/versioning, dependencies, and runtime-ready expression products.

Runtime-ready expressions are lowered through the common evaluation payload.
Typed scalar semantics are not reconstructed from source text in runtime hosts.

### Immutable geometry values

Language Core also owns compiled immutable geometry-value programs used by Module
and expression semantics.

These values have source declaration identity and dependency order but are not
ordinary drawable `ElementId` entries. Runtime occurrences use their own
occurrence identity. A drawable declaration materializes a value into a distinct
drawable identity through the normal evaluation boundary.

## Module semantics and materialization

Representative owners:

- `packages/nui-language/src/dsl/moduleSemantic*`
- `packages/nui-language/src/dsl/moduleMaterialization*`
- `packages/nui-language/src/dsl/moduleRuntimeContext.ts`
- `packages/nui-language/src/scalars/moduleScalarRuntime.ts`

The Module subsystem owns same-document and imported Module semantic analysis,
materialization, source ownership, runtime occurrence identity, and Module-local
scalar/geometry context.

Module calls evaluate arguments in the caller document while defaults, body
declarations, helpers, nested calls, and other definition-owned semantics resolve
against the defining document.

Materialized Module children are runtime products. They are not flattened back
into authored source representation.

Multi-document Module behavior composes the shared import graph, public API,
lexical resolver, and Module semantic analyzer rather than creating a second
Module parser or runtime.

## Multi-document architecture

Primary:

- `packages/nui-language/src/document/multiDocumentImportGraph.ts`
- `packages/nui-language/src/document/multiDocumentPublicApi.ts`
- `packages/nui-language/src/document/multiDocumentModuleSemantics.ts`
- `packages/nui-language/src/document/multiDocumentLanguageQueries.ts`
- `packages/nui-language/src/document/multiDocumentLintDiagnostics.ts`
- `vscode-extension/src/multiDocumentHost.ts`
- `vscode-extension/src/moduleMultiDocumentHost.ts`

### Import graph

`multiDocumentImportGraph.ts` is the host-neutral owner of saved dependency graph
construction.

Hosts provide canonical document identity, saved source snapshots, and loading
lifecycle. Path resolution, filesystem access, file watching, and UI state stay
outside Language Core.

Root documents use their current source snapshot. Imported dependency graph nodes
use saved-source snapshots. Graph construction owns import edges, cycle/error
reporting, artifact reuse, reverse dependency tracking, and root invalidation
coordination.

### Public API and document-qualified identity

`multiDocumentPublicApi.ts` owns exported declaration catalogs and public/private
visibility across imported documents.

Cross-document semantics preserve the defining document identity. Re-exporting a
declaration does not create a new semantic identity.

Import aliases participate in the ordinary lexical namespace. Imported member
lookup extends the existing resolver through a narrow external namespace
boundary.

### Cross-document language queries

`multiDocumentLanguageQueries.ts` owns graph-backed Definition, References, and
Rename semantics across documents.

These operations use document-qualified semantic identity and exact source proof.
Workspace text search is not a semantic resolver.

Rename planning remains all-or-nothing across the participating documents: each
document owner must prove its edit set against the expected source before the
host creates a workspace edit.

### VS Code multi-document adapter

`vscode-extension/src/multiDocumentHost.ts` owns the production VS Code adapter:

- file-backed document identity;
- saved dependency reads;
- saved-source fingerprinting;
- active root graph lifecycle;
- watcher-driven invalidation;
- current open-document semantic projections for language queries;
- host-side projection into native language features.

`moduleMultiDocumentHost.ts` adds Module-family semantics and runtime projection
on top of that shared graph. It does not own a second graph, cache, resolver,
workspace search, or rename planner.

Webviews receive narrow JSON-safe graph/runtime projections when they need
cross-document runtime presentation. They do not read the filesystem or rebuild
the import graph.

## Evaluation architecture

### Production evaluation context

Primary:

- `src/geometry/productionEvaluationContext.ts`
- `src/geometry/rustEvaluationRunner.ts`
- `src/geometry/evaluationTypes.ts`

The production evaluation context lowers the compiled document into runtime
metadata and evaluator options.

It is the shared bridge from compile-time identities, scalar programs,
dependencies, source ownership, Module runtime facts, Drawing Profile state, and
other compiler products into runtime evaluation.

The Rust request boundary is JSON-safe and host-neutral.

### TypeScript reference evaluation

Primary:

- `src/geometry/evaluate.ts`
- `src/geometry/evaluationEngine.ts`
- `src/geometry/useEvaluationEngine.ts`
- `src/geometry/rustEvaluationEligibility.ts`

The TypeScript evaluator remains the reference/parity/test implementation.

The typed dependency graph supplies dependency-first runtime order and cycle
facts. Declarative transformation recipes retain authored local order within
their owner while depending on the shared graph for prerequisites.

`evaluationEngine.ts` owns shared evaluator orchestration and parity integration.
`useEvaluationEngine.ts` owns application-side request/revision/stale-result
lifecycle for local Webview evaluation.

The evaluator produces runtime geometry, activity/error state, immutable value
results, transformation-stage results, source-related runtime metadata, and
other shared `EvaluationResult` products consumed by presentation and commands.

### Rust production evaluation

Primary:

- `rust-evaluator/src/evaluation/`
- `rust-evaluator/src/bin/evaluation_stdio.rs`
- `src/node/rustEvaluationProcess.ts`

`rust-evaluator` is the production CAD evaluator.

Rust receives the resolved runtime payload prepared by TypeScript/Language Core.
It does not parse `.nui` source or repeat source-name resolution.

The ordinary Rust API remains the host-neutral document evaluation entry. The
stdio binary exposes the persistent process protocol used by production Node
hosts.

VS Code and Headless MCP each own their process lifecycle but reuse the same
Node client/protocol implementation and Rust evaluator.

### Runtime source ownership

Runtime-to-source operations use compiler/reconciler-owned source identity and
structured runtime provenance.

Commands such as Bake, Canvas edits, navigation, and Module Preview edits do not
recover source ownership by parsing runtime IDs or searching source text.

## Output architecture

Primary:

- `src/output/outputCore.ts`
- `rust-evaluator/src/output/payload.rs`
- `rust-evaluator/src/output/svg.rs`
- `rust-evaluator/src/output/pdf.rs`
- `vscode-extension/src/outputPreviewFeature.ts`
- `src/vscode/OutputPreviewApp.tsx`

Language Core parses and resolves `layout`, `print`, and `svg` declarations.
The compiled document stores their source models and resolved references, not
active preview UI state.

`outputCore.ts` owns host-neutral output planning:

- selected Drawing Profile application;
- output/layout resolution;
- ordered placements;
- physical-unit page and SVG geometry;
- page tiling and overlap metadata;
- drawable filtering;
- deterministic bounds and presentation data.

Rust owns final SVG/PDF payload validation and encoding. The Rust encoder does
not parse source or resolve source names.

Output Preview is a read-only physical presentation surface. The Webview resolves
the active output plan and presents it; the Extension Host owns session lifecycle,
save dialogs, target file writing, source interaction, and stale-session checks.

Output Preview reuses the shared Rust process and canonical document/evaluation
boundaries rather than introducing a separate export evaluator.

## VS Code production host

Primary:

- `vscode-extension/src/extensionEntry.ts`
- `vscode-extension/src/extension.ts`
- `src/vscode/main.tsx`
- `src/vscode/webviewSurfaceRouter.tsx`
- `src/vscode/vscodeWebviewSession.ts`

### Source authority and Webview mirrors

VS Code `TextDocument` is the production source authority for supported file-backed
`.nui` documents.

Webview document state is a disposable mirror hydrated from the authoritative
TextDocument. It is never treated as the host-side saved/source authority.

Source edits from Webviews cross the host boundary as guarded source patches and
become native TextDocument edits. The normal TextDocument change echo then
rehydrates the Webview mirror.

### Webview surfaces

The production Webview surfaces are:

- Canvas;
- Output Preview;
- Module Preview.

`webviewSurfaceRouter.tsx` routes the shared Webview bundle to the correct
surface using explicit surface identity supplied by the Extension Host.

Canvas and Output Preview use the shared URI/surface session registry. Module
Preview has its own per-document target lifecycle because its semantic identity
includes the selected Module definition.

Surfaces may coexist for the same source document while remaining independent
presentation sessions.

### Canvas

Primary:

- `src/vscode/VSCodeApp.tsx`
- `src/vscode/VSCodeDrawingCanvas.tsx`
- `src/components/DrawingCanvas.tsx`

Canvas presents the current evaluable runtime and owns interactive selection,
viewport, picking, and host-neutral geometry manipulation through shared Canvas
components.

Editor/Canvas navigation is explicit. Cursor movement and Canvas selection are
not implicitly synchronized.

Canvas-origin source mutation crosses the canonical source-patch boundary. The
Webview does not directly replace the authoritative TextDocument.

Cross-document Canvas runtime is supplied by the Extension Host as a prepared
projection. Dependency-owned imported runtime remains presentation-only unless a
command explicitly resolves legal source ownership for a source edit.

### Output Preview

Primary:

- `src/vscode/OutputPreviewApp.tsx`
- `vscode-extension/src/outputPreviewFeature.ts`
- `vscode-extension/src/outputPreviewSourceInteractionFeature.ts`

Output Preview is independent from Canvas viewport and selection state. It
renders a resolved physical output plan and delegates native save/source actions
to the Extension Host.

### Module Preview

Primary:

- `src/vscode/ModulePreviewApp.tsx`
- `src/vscode/modulePreviewLifecycle.ts`
- `src/vscode/modulePreviewEvaluation.ts`
- `vscode-extension/src/modulePreviewFeature.ts`

Module Preview owns an ephemeral preview session for one exact Module target.

The Extension Host owns target identity and current TextDocument proof. The
Webview owns preview-only parameter/context state, last-good preview state, and
runtime presentation.

Preview parameter/context changes do not mutate canonical source. Source-writing
interactions such as committed geometry edits or Bake resolve real authored
source ownership and return through the normal source-patch/TextDocument
boundary.

Module Preview reuses the shared DrawingCanvas and Rust evaluation pipeline.

### Native language features

Primary:

- `vscode-extension/src/languageAnalysisSession.ts`
- `completionProvider.ts`
- `signatureHelpProvider.ts`
- `definitionProvider.ts`
- `referenceProvider.ts`
- `documentSymbolProvider.ts`
- `renameProvider.ts`
- `hoverProvider.ts`

Native VS Code language providers are thin host adapters over Language Core
queries and current-document/workspace semantic products.

Single-document language queries use the URI-scoped `NuiLanguageSession`.
Imported roots may use the active graph-backed multi-document semantic view.

The host owns:

- TextDocument synchronization;
- raw/normalized position conversion;
- VS Code DTO projection;
- native diagnostics collections;
- WorkspaceEdit application;
- cancellation and stale-document checks;
- localization/presentation.

It does not own parallel parser, compiler, lexical, rename, or completion
semantics.

Runtime-valued Hover additionally calls the shared Rust runtime evaluation
service after resolving an exact current semantic target. Other ordinary
language providers do not start runtime evaluation.

### Source authoring commands

Primary:

- `vscode-extension/src/sourceCreationCommandFeature.ts`
- `vscode-extension/src/sourceCreationFlow.ts`
- `src/commands/sourceTemplateCatalog.ts`
- `src/commands/sourceCreationInsertion.ts`
- `vscode-extension/src/sourceValueStepCommandFeature.ts`

Native Source authoring flows resolve host-neutral plans and apply them through
native TextDocument/snippet edits.

Template catalogs and materializers own product-level insertion choices and
source-safe structure. The VS Code adapter owns Quick Input and editor insertion
mechanics.

Source value stepping similarly uses a host-neutral edit plan and one guarded
native source edit.

### Reference Pick and coordinate conversion

Primary:

- `vscode-extension/src/referencePickCommandFeature.ts`
- `src/vscode/useVSCodeReferencePickSession.ts`
- `src/commands/coordinatePointConversion.ts`
- `vscode-extension/src/coordinatePointConversionCommandFeature.ts`

These features share the same architectural shape:

- resolve a current Source/runtime target through host-neutral semantics;
- use native or Canvas interaction as presentation;
- keep request/session state explicit and document-scoped;
- apply successful source changes through the canonical source-edit boundary;
- fail closed when the source/session proof becomes stale.

The interaction surface does not become a second semantic owner.

### Rust process ownership

Primary:

- `src/node/rustEvaluationProcess.ts`
- `vscode-extension/src/rustEvaluationProcessOwner.ts`

The Extension Host owns one lazy Rust process owner shared by Canvas, Output
Preview, Module Preview, native runtime Hover, and export encoding.

Panels do not own the Rust process lifecycle.

Headless MCP owns a separate lazy process owner but uses the same client/protocol
implementation.

### Protocol ownership

Primary:

- `src/vscode/protocol.ts`
- feature-owned `*Protocol.ts` modules

Feature-specific message slices stay with their feature owners.
`src/vscode/protocol.ts` remains the aggregate JSON-safe authority for shared
Webview message unions, API shape, and common surface identity.

## Rendering and hit testing

Primary:

- `src/components/canvasHostAdapter.ts`
- `src/components/DrawingCanvas.tsx`
- `src/components/canvasRenderer.ts`
- `src/components/CanvasOverlay.tsx`
- `src/components/DrawingCanvasHitTest.ts`
- `src/components/canvasTheme.ts`

The shared rendering path is:

```text
host surface
  -> CanvasHostAdapter
  -> DrawingCanvas
  -> canvasRenderer + CanvasOverlay
```

`DrawingCanvas` owns host-neutral interaction/render coordination.
`canvasRenderer` owns main geometry presentation.
`CanvasOverlay` and related helpers own interactive overlay presentation.

Canvas and Module Preview reuse the same rendering and interaction core. VS Code
does not maintain a second renderer for Preview.

Drag/gesture previews are ephemeral. Canonical source changes occur only at the
explicit commit boundary.

Theme values are resolved by the host presentation layer and passed through a
host-neutral Canvas theme contract.

Cross-document runtime projections may replace the presented runtime for an
importing root, but they do not replace the canonical source/document owner.

## Commands, keyboard, and parameters

Primary:

- `src/commands/`
- `src/keyboard/`
- `packages/nui-language/src/parameters/parameterDefinitions.ts`

Major product operations are command-owned. UI entry points dispatch commands
rather than reimplementing business logic.

Keyboard bindings are a presentation/input mapping over commands and Source
Editor transactions.

Parameter metadata is Language Core/application metadata and is consumed by
authoring, presentation, and source-editing features without making the
Inspector a mutation owner.

## State boundaries

Document state:

- `src/state/cadDocumentStore.ts`

UI state:

- `src/state/cadUiStore.ts`

Canonical document state and ephemeral UI state remain separate.

Preview state, selection, viewport, command interaction state, and other
presentation-only values do not become canonical document data.

The production source authority remains the VS Code TextDocument even when a
Webview maintains mirrored application state.

## Headless MCP

Primary:

- `mcp-server/src/server.ts`
- `mcp-server/src/documentSnapshot.ts`
- `mcp-server/src/documentEvaluation.ts`
- `src/node/rustEvaluationProcess.ts`

The repository-owned MCP server is a Node stdio server.

Document inspection/language operations read file-backed `.nui` source through a
fresh snapshot boundary and reuse Language Core semantic products.

Document evaluation lowers an exact compiled snapshot through the same
production evaluation context and Rust runner used by the production
architecture.

The MCP surface returns compact JSON-safe DTOs rather than exposing internal
`EvaluationResult` or compiler objects directly.

Headless MCP does not own VS Code document mutation, Canvas state, or a second
parser/evaluator.

## VS Code attached observation bridge

Primary:

- `vscode-extension/src/vscodeObservationFeature.ts`
- `vscode-extension/src/vscodeObservationState.ts`
- `vscode-extension/src/mcpObservationBridge.ts`
- `src/node/vscodeObservationBridge.ts`
- `mcp-server/src/vscodeObserve.ts`

The attached observation bridge is an optional read-only developer boundary for
observing current VS Code state from MCP tooling.

The Extension Host owns current observation state. The Node bridge owns local
discovery/transport. The MCP tool projects the result into a JSON-safe read-only
surface.

The bridge does not introduce command execution, source mutation, pointer/
keyboard automation, or a second Canvas/evaluation state model.

## VS Code Explorer surface

Primary:

- `vscode-extension/src/elementsTreeFeature.ts`
- `vscode-extension/src/elementsTreeProvider.ts`

The native Elements Tree View projects exact-current document symbols into a VS
Code tree.

The feature owns host lifecycle and presentation only. Semantic hierarchy comes
from Language Core document symbols.

Explorer is not a parameter-editing or independent source-authority surface.

## Tests and parity

Representative:

- colocated TypeScript tests;
- `test/evaluationParitySupport.ts`;
- `test/fixtures/evaluation/`;
- Rust tests under `rust-evaluator/src/evaluation/`.

Evaluation parity uses the same production lowering boundary before invoking the
Rust evaluator. Test infrastructure should not invent an alternate evaluator
input contract.

Subsystem tests stay near their semantic owner where practical. Cross-cutting
tests cover contracts that span compiler/runtime/host boundaries.

## Performance foundation

Primary:

- `src/performance/`
- `scripts/performance/`
- `performance/fixtures/`

The performance subsystem owns benchmark protocol, result schema, statistics,
instrumentation, capture orchestration, comparison logic, and fixed workloads.

Benchmark state remains separate from canonical application or evaluator state.
Production instrumentation should remain passive outside benchmark capture.

## Core architecture invariants

- `.nui` source text is canonical.
- VS Code `TextDocument` is the production source authority.
- Current source and last-good compiled document have separate lifecycles.
- Source, compile, evaluation, and request revisions are distinct identities.
- Stable statement, declaration, binding, and document-qualified identities are preserved across boundaries.
- Source-writing model operations return through the canonical source-patch boundary.
- Language Core is host-neutral.
- Production evaluation uses the shared Rust evaluator.
- TypeScript evaluation is reference/parity/test.
- Rust consumes resolved runtime payloads and does not repeat source parsing or source-name resolution.
- Multi-document semantics use one graph-backed document-qualified model.
- Webviews are presentation/runtime mirrors, not filesystem/source authorities.
- Host-specific UI and filesystem APIs remain behind adapters.
- Existing semantic owners are reused; do not create parallel parsers, resolvers, runtimes, or state models for one feature or host.

## Maintenance

Update this document in the same Task when current architecture materially changes,
including when:

- subsystem responsibility moves;
- a major subsystem is added or removed;
- a primary entry point changes;
- canonical document or data flow changes;
- evaluation or rendering boundaries change;
- a new architecture-level boundary is introduced;
- an owner listed here is replaced or removed.

Do not update this document for ordinary implementation detail changes that stay
within the same ownership boundary.

Keep this document as a navigation index. Prefer a small set of primary owners
and boundary descriptions over exhaustive file lists or step-by-step feature
behavior.

Do not record:

- issue history;
- migration history that no longer describes current architecture;
- proposed/future architecture as if it were current;
- incidental command labels or UI copy;
- detailed validation sequences that belong in implementation/tests;
- temporary compatibility notes whose only value is historical.

When a section grows into a feature specification, move that detail to the
appropriate implementation/specification owner and leave only the architecture
boundary and primary entry points here.
