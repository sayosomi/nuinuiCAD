# nui4 migration plan

This plan freezes the nui4 language contract and defines a direct, destructive
replacement of the former nui3 surface. There is no compatibility layer,
converter, importer, or migration wizard. Task 8 implementation is applied,
but manual E2E verification is still pending; `docs/dsl.md` documents the
implemented nui4 language.

## Task 1 — language contract / policy freeze

This task is the current documentation-only freeze:

- add `docs/nui4/spec.md`
- add `docs/nui4/plan.md`
- update the nui4 saved-format and migration policy in `AGENTS.md`
- make no production behavior change

Parser, AST, compiler, serializer, runtime, Rust evaluation, completion,
rename, navigation, UI, and `docs/dsl.md` remain unchanged.

## Task 2 — unified `@` reference frontend

Change the reference surface so every reference has the form
`@qualifiedName` or `@qualifiedName.property`.

- Reuse `src/dsl/dslReferenceTokens.ts` for `::` path parsing and formatting.
- Use one reference representation for typed scalar references, geometry
  references, derived points, endpoints, and property references.
- Do not build separate path splitters for each reference consumer.
- This task does not yet redesign unified namespace semantics.

Old nui3 reference spellings are removed as part of this direct replacement;
they are not retained as a permanent dual grammar.

## Task 3 — unified lexical namespace / resolution

Generalize the lexical namespace so declarations participate in one coherent
scope and name-resolution model.

- Generalize `src/dsl/sourceLexicalNamespaceIndex.ts`.
- Align module definition, module instance, group, geometry, typed scalar, and
  control-container declarations under the same namespace rules.
- Reuse source-order, non-hoisted scopes and stable statement identity from
  `src/scalars/lexicalScopeIndex.ts` and
  `src/dsl/lexicalScopeIndexAdapter.ts`.
- Preserve actionable missing, disabled, invalid, private, and too-late
  dependency diagnostics.

Do not create a second namespace resolver.

## Task 4 — Module nui4 surface

Convert the Module v1 surface to the nui4 contract while retaining its existing
architecture:

- `instance` keyword for calls
- preparation for a path-aware parameter interface
- scalar exports
- generalized `export` visibility modifiers
- instance `state: visible|hidden|disabled` syntax
- updated completion, rename, and navigation behavior

Retain stable identity, materialization, origin maps, read-only geometry aliases,
and private/export namespaces. Do not rebuild those systems. Module definitions
remain non-hoisted, closed-scope, named-argument-only interfaces with no
recursion or mutual recursion.

## Task 5 — `path` geometry interface

Add the module/interface types `point`, `line`, and `path`.

- Describe the current broad line-like compatibility behavior as `path`.
- Keep `line` as the interface type for straight-line-compatible geometry.
- Do not rename internal `CadElement` types or existing element categories just
  to match the new interface name.
- Avoid unnecessary TypeScript/Rust geometry representation changes.

`path` is an interface-level broad type, not a reason to introduce a new
persisted geometry category.

## Task 6 — control / text / stop / printLayout syntax

Switch the destructive surface grammar as one control/text cutover:

- `if (@cond)` with no named container form
- `for i in range(...)` with an immutable body binding
- `${...}` text interpolation
- bare `stop`
- ordinary `const` / `let` inside `printLayout`
- removal of `layoutVar`

Do not maintain the old syntax as a permanent dual grammar. Preserve stable
statement identity for control containers and keep document-order evaluation.

## Task 7 — unified typed-expression frontend/runtime connection

Connect the common typed-expression model across:

- construction arguments
- universal property values
- module arguments
- conditions
- scalar initializers
- `set` right-hand sides
- array members

Remove the current property-specific binding opt-in. Reuse the existing scalar
AST and type checking, stable `BindingId` and binding versions, and Rust compiled
payload path as far as possible.

Keep the Rust/TypeScript boundary deterministic:

- Rust must not parse source text again.
- Rust must not re-resolve names.
- TypeScript and Rust must continue to agree on typed payloads and evaluation.
- The existing Rust compiled representation and binding identity remain the
  connection between frontend resolution and runtime evaluation.

## Task 8 — nui4-only cutover / cleanup / final gates

Status: implementation complete; manual E2E verification pending. The
repository supports and documents the nui4 implementation; the remaining
checklist below records the final-cutover contract and verification scope.

Make nui4 the only supported language and remove temporary nui3-only paths:

- set supported/default version to 4
- remove nui3-only parser branches
- remove old `var`
- remove old bare geometry references
- remove old Module call syntax
- remove old `if` and `for` syntax
- remove `@stop`
- remove `{@...}` interpolation
- remove `layoutVar`
- remove the property-binding opt-in bridge
- remove old serializer branches
- remove obsolete completion, diagnostic, and test fixtures
- update `docs/dsl.md` to implemented nui4 user documentation

Do not add a nui3-to-nui4 converter, importer, or migration wizard. Finish with
the full TypeScript, Rust, parity, and manual end-to-end gates.

## Architecture reuse

The migration reuses the following existing foundations:

### Document identity and editing

- `src/document/statementReconciler.ts`
- `src/document/statementIdentity.ts`

These preserve stable source statement identity while the grammar and scope
rules change. Statement-level source editing remains the mutation boundary.

### Scope and reference infrastructure

- `src/scalars/lexicalScopeIndex.ts`
- `src/dsl/lexicalScopeIndexAdapter.ts`
- `src/dsl/sourceLexicalNamespaceIndex.ts`
- `src/dsl/dslReferenceTokens.ts`

The existing source-order scope and reference-token infrastructure are
generalized, not duplicated.

### Typed scalar and expression infrastructure

- `src/scalars/expression*`
- `src/scalars/*typecheck*`
- typed `BindingId` and binding versions

These provide the base for one typed-expression model across scalar, property,
construction, module, control, and array positions.

### Module infrastructure

- `src/dsl/moduleSemantic*`
- `src/dsl/moduleMaterialization*`
- `src/dsl/moduleGeometryRuntime*`
- Module source origin mapping

The existing Module v1 materialization, origin, read-only alias, visibility, and
atomic evaluation behavior remain the runtime foundation.

### Evaluation and parity

- Rust `evaluate_document(input)`
- the TypeScript reference evaluator
- the existing parity infrastructure

Rust remains the production evaluation source of truth in Tauri. The TypeScript
evaluator remains the browser/test reference and compatibility fallback, not a
separate product runtime. Rust receives resolved compiled payloads and does not
reparse source or resolve names a second time.

## Non-duplication invariants

The implementation must preserve these invariants throughout Tasks 2–8:

- do not create a second parser
- do not create a second namespace resolver
- do not create a second Module runtime
- do not reparse source text in Rust
- do not re-resolve names in Rust
- do not flatten materialized Module children into source
- do not discard stable statement, element, or binding identity

## Task 8 completion gate

The cutover is complete only when all of the following are true:

1. nui4 is the supported/default version and nui3-only branches are removed.
2. TypeScript unit tests and build/lint gates pass.
3. Rust formatting, tests, clippy, and the desktop build pass when Rust or Tauri
   evaluation paths changed.
4. The TypeScript reference evaluator and Rust evaluator pass parity checks.
5. Manual editor, dependency-error, activity-state, Module, text, control, and
   print-layout flows are verified.
6. `docs/dsl.md` documents the implemented nui4 surface.

No compatibility artifact is required or permitted to satisfy this gate.
