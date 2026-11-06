# Issue #1535 multiline RHS conformance fixtures

Contract: [#1535](https://github.com/sayosomi/nuinuiCAD/issues/1535).
Base: `7ab864456fac20b6f7703a654ff7e302cf257b66`.
Branch: `fix/1535-multiline-expression-continuation`.
The containing pushed commit is the corrected candidate. This evidence does not
certify independent review, protected CI, merge, or Human Manual E2E.

## Semantic changes and producing owners

`logicalStatementSourceMap.ts` remains the single continuation owner. It reuses
the declaration/next parsers for RHS extraction and the shared typed-expression
tokenizer/parser for token boundaries and expression completeness. It joins
bare RHS fragments after equals or a binary operator, or before a binary
operator with an exact declaration-relative whitespace-prefix extension.
Ordinary comments are skipped only when a real continuation follows. Blank
lines, documentation comments, independent statements, incomplete operators and
structural syntax retain containment. Existing delimiter and value-flow paths
retain priority. The physical segments remain real source intervals; inserted
logical separators never become editable source.

The causally required cross-owner correction is folding. The shared
`dslFoldingQuery.ts` previously produced only brace/delimiter folds, so a bare
multiline expression had none. The Source Editor's existing fold routing also
handled only element and Module targets. `sourceEditorFolding.ts` now projects
canonical expression folds, while `sourceEditorController.ts` routes existing
keyboard, gutter, placeholder and fold-all actions through the same source-only
collapse state and reconciled statement IDs. No command or Palette scope was
added. VS Code continues to consume the host-neutral query through its adapter.

No tokenizer, parser AST, resolver, dependency scheduler, typechecker,
evaluator, wire payload, or production host was replaced. Architecture
ownership and primary entry points are unchanged; no architecture-document
update is needed.

## Base reproduction and reductions

`base-reproduce.log.gz` independently executes exact Base Git blobs, bundled in
memory without changing the checkout or creating a worktree. The minimal
historical source `nui 1\nconst result: number =\n  (1)` produces
`empty-declaration-initializer` and `missing-statement-keyword`. Its one-line
and already-open-parenthesis controls compile at Base. The original #1415
finding remains in its README as historical evidence; its regression now checks
value `1` through TS and persistent Rust for all three forms.

`base-matrix.log.gz` records the pre-production-change run: all 168 newly valid
positive cells were rejected. That first harness also had 12 negative-cell
assertion failures because it read last-good metadata instead of the exact
current compile attempt. A later intermediate harness compared independently
allocated geometry IDs instead of reconciled identities. Those harness failures
are not product defects or PASS evidence. Final recovery checks inspect
`currentCompiled`, and equivalent-source checks reconcile from the accepted
multiline candidate before comparing canonical dependency products.

`editor-before.log.gz` records the existing Source Editor fold action returning
false. The independent Base reproduction also records that the tested
controller blob was byte-identical to Base before its correction. The shared
query regression first demonstrated missing expression ranges; the final
query and both host adapter tests pass.

## Closed matrix and independent oracle

`matrix.ts` deterministically defines exactly 188 cells:

| Family | Cells | Oracle / comparison |
| --- | ---: | --- |
| P1 | 144 | `8 + 2 = 10`, `8 - 2 = 6`, `8 * 2 = 16`, `8 / 2 = 4`, `8 % 2 = 0`, `8 ^ 2 = 64`; both RHS sites, three break positions, four comment arrangements. |
| P2 | 24 | Measurement `5 + 90 = 95`; comparison/boolean `true`; absent optional coalesces to `7`; scalar/nested precedence gives `2 + 9^2 = 83`; both RHS sites and all three breaks. |
| N1 | 14 | Seven containment boundaries at each RHS site. Require bounded error diagnostics and independently parsed subsequent declarations where applicable. |
| R1 | 6 | One-line scalar, already-open parenthesis, multiline call, existing if/match, Module body ownership, each yielding `3`. |

Every positive cell requires error-free compilation, an independently fixed
value, an equivalent one-line program, canonical dependency/reference parity,
and normalized TS/persistent-Rust result parity. Rejected or contaminated
sources never count as passing positive cells. N1 tests retain the following
statement's exact physical range and lexical enclosure. Invalid documents
retain the existing fail-closed evaluation policy: the unmodified intact
statement is independently compiled from its exact source range and evaluated
through both engines as `20`; the entire invalid document is not presented as
valid geometry. EOF cells have no following declaration.

`matrix-verified.ndjson.gz` records every cell's exact source, expected value
and asserted PASS disposition, plus accepted-source SHA-256 values. Actual
values equal the recorded expectations only after both evaluator assertions
succeed. A PASS row is written only after all assertions for that cell complete.
The integration fixture also retains nearby source-preserving rename controls.
Rust uses an isolated temporary target directory, bounded tests and existing
persistent-process transport, with explicit disposal and target cleanup.

The matrix and nearby controls contain **198 distinct compiler-accepted new
sources**. The exact DSL Reference acceptance example and its one-line control contribute
two additional unique accepted sources: **200 total**, below the ceiling of 256. Required
existing fixtures, regression suites, rejected editing drafts, and reruns are
excluded. No additional exploratory families or combinations were generated.

## Surface coverage

| Surface | Disposition |
| --- | --- |
| Logical boundary / source map | Changed; exact space/tab prefixes, all operator token spellings, comment and recovery boundaries, offset round trips, physical segments and revision rejection covered. |
| Declaration/parser/compiler | Existing canonical boundaries reused; current-source diagnostics and following statement ranges covered. |
| Resolution, typed values, dependencies, TS/Rust | Semantics unchanged; both RHS sites, numeric/typed/dependency oracles and one-line graph parity verified. |
| Completion | Semantics unchanged; core query, Source Editor and VS Code physical replacement ranges covered, including an unfinished reference. |
| Diagnostics | Existing exact physical-span projection reused; compiler and VS Code physical reference ranges covered. Logical fallback coordinates are not the authoritative range for `exactSpanOnly` diagnostics. |
| Source-preserving edits / rename | Existing patch boundary reused; comments, blank lines and untouched following source remain byte-identical. |
| Folding | Shared query and Source Editor changed; native VS Code CRLF projection and Source Editor keyboard/gutter actions covered. |
| Existing if/match/for/Module and call/list syntax | Existing owners unchanged; matrix preservation cells and neighboring regression suites cover these paths. |
| Specification / implemented reference | Updated together; #1415 evidence retained. |

## Verification results

Focused source-map, language-query, Source Editor and VS Code checks passed
498 tests. After final acceptance/control additions, the conformance file passed
191 tests (188 matrix cells plus manifest, rename-control and exact-acceptance
checks). The required gate completed consecutively after the last code change:

| Command | Result |
| --- | --- |
| Exact required #1415 Vitest command | PASS: 258 tests |
| `npm run docs:dsl:check` | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS: 742 files, 12,758 tests; 3 files / 188 tests skipped |
| `npm run test:parity` | PASS: 210 tests |
| `git diff --check` | PASS |

The first full-suite run failed 19 existing tests in two files. The first
request in each lost Rust stdout; subsequent requests reported the process was
unavailable. Both files passed all 19 tests in one isolated run. The final
bounded full-suite execution passed with the same production changes, after
adding the required exact Issue examples/control. The original transport
failure's underlying OS/process cause was not established; it is retained in
`initial-full-test.log.gz`, with isolation evidence in
`rust-failure-isolation.log.gz`. No unrelated process infrastructure or test was
changed or waived. The new conformance harness uses its own temporary Rust
target directory. Early added-code type errors and a test-regex lint error were
fixed before the final gate; their failure output is also retained.

`source-manifest.json` hashes the final intended source, tests and documents.
The containing Git commit and pushed checkpoint bind this evidence to the
corrected candidate. Independent exact-HEAD review, protected PR/CI and
Human-only GUI E2E remain separate required gates. No merge or Human E2E PASS
is claimed.
