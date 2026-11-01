# Issue #1525 conformance evidence

Fixed Base: `8f9bcb07d61368154bf1826590d171bd4c91a78a`.
The only production change rejects statements whose source or document-range
revision is obsolete before producing folding ranges. The existing compiler,
lexer, source map, canonical document and real `NuiLanguageSession` are reused.
There is no new parser, abstraction, DSL semantics or dependency.

## Frozen inputs and reproducibility

`oracle.json` was authored before any candidate query output was inspected.
It preserves exact raw/normalized source, SHA-256, explicit UTF-16 line starts,
name/full ranges, ordered symbol trees, host SymbolKind/range projection,
folding ranges and controls. Expected offsets were computed from authored line
and token anchors, not parser or query output. Inline and standalone braces,
ELSE physical lines, current EOF, CRLF and supplementary characters are covered.
`X1-oracle.json` and `D1-oracle.json` were separately frozen before testing
the evidence-triggered obsolete-statement hypothesis and two-line reducer.

The first harness incorrectly treated the direct-query synthetic revision 0
as the real session's initial revision. `compileFreshCanonicalText` constructs
an empty baseline then calls `compileCanonicalText`, producing revision 1 for
these sources. `initial-harness.log` preserves that failure;
`session-lifecycle-oracle.json` independently records the lifecycle correction.
The original source/symbol/folding oracle was not rewritten after failure.
Direct queries intentionally exercise revisions starting at 0; real sessions
start at 1, and both increase across edits. H2/H3 use separate URI sessions.

Run the complete deterministic matrix:

```sh
npx vitest run test/fixtures/issue-1525/conformance.test.ts --maxWorkers=2
```

Each primary runs direct Language Core queries, real session queries, actual
production document-symbol/folding providers, and actual Elements tree APIs
under deterministic VS Code DTO mocks. R2 additionally rejects obsolete A
statements when bytes cycle A→B→A. H4 injects a controlled invalid source-map
proof through the session query boundary and verifies provider/tree rejection
and restoration. Host documents carry increasing versions; URI isolation and
unsupported inputs are checked before session routing. Existing tree nodes are
snapshots, with no invented persistent-identity promise.

## Completed matrix

| Unit | Axes | Result |
| --- | --- | --- |
| S1 | Flat geometry, typed/profile/style/Module declarations, order/kinds/details, selection, exclusions | PASS |
| S2 | Module/group/for/THEN/ELSE ancestry, duplicate branch names, containment | PASS |
| S3 | Style overrides, modifiers, comments/settings/actions and exclusions | PASS |
| S4 | Partial block, sibling/current children, EOF extent, repaired close | PASS |
| F1 | Nested/split braces, THEN/ELSE, exact ordered 1→0-based lines | PASS |
| F2 | Mixed multiline delimiters, quoted delimiters and trailing comments | PASS |
| F3 | Separate consecutive/full block comments; single/trailing exclusions | PASS |
| F4 | Mismatch, unclosed delimiters, malformed ELSE, invalid continuation; valid neighbors for each | PASS |
| R1 | CRLF, Japanese name, preceding astral character, UTF-16/raw offsets, unchanged bytes | PASS |
| R2 | A→B→A current results and increasing source/host revisions; obsolete ranges rejected | PASS after repair |
| R3 | Valid→incomplete→valid; current partial structure, no last-good contamination | PASS |
| R4 | Same-spelled names reordered/renamed/moved across scopes | PASS |
| H1 | Real session and actual provider DTO/kind/range/fold conversion | PASS |
| H2 | Two file URIs, overlapping names, unsupported type/scheme isolation | PASS |
| H3 | Active-document switching, refresh/disposal, nested item metadata and collapsibility | PASS |
| H4 | Edit/recovery versions, controlled invalid proof, current provider/tree authority | PASS |

X1: PASS. D1: PASS. X2–X6 and D2–D6: NOT_TRIGGERED.
Distinct accepted units: **18/28**. F4's four predeclared malformed regions,
revision transitions, negative controls and verification replays are subcontrols,
not extra exploration units. No unsupported primary substitution was needed.

## Causal evidence

One confirmed defect family, first incorrect producer:
`packages/nui-language/src/dsl/dslFoldingQuery.ts`, `queryDslFolding`.
The guard checked source-map text/revision but accepted obsolete statements or
obsolete `documentRange.sourceRevision`. Brace folds therefore escaped from
old statements, while the document-symbol query correctly rejected them.

- `base-primary-pass.log`: initial 16 primary cases passed before adding the
  R2 obsolete-statement subcontrol.
- `base-fail.log`: X1 and D1 failed on exact Base; current-input folds and stale
  document-symbol rejection passed as nearby controls. 16 PASS / 2 FAIL.
- `repair-removal-fail.log`: removing only the four-line repair restored the
  same X1/D1 failures. 16 PASS / 2 FAIL.
- `restored-pass.log`: restoring the repair gave 18 PASS / 0 FAIL.
- `focused-pass.log`: final matrix including strengthened R2/H4 controls and
  existing symbol/folding/session/offset/provider/tree suites, 72 PASS / 0 FAIL.

`matrix-observations.json` retains compact exact direct-result fingerprints and
folds. `verification.json` records exits/counts and unit dispositions.
`final-command.json` and `final-gates.log` retain the exact required ordered
command block and its results. No tests or oracle were weakened.

## Scope and limits

Changed production owner: folding query only; tests/evidence stay in this
Issue-owned directory. Scope deviations: none. Architecture and normative/user
DSL documentation need no change because ownership and language behavior are
unchanged. The fixture and evidence are reusable regression assets, not an
obsolete implementation plan.

Manual E2E: **Not Required** under the current MANUAL-E2E decision rule: all
acceptance is deterministic, and no host wiring, lifecycle or interaction was
changed. Real GUI/session behavior has not been tested or claimed. The controlled
stale input establishes Language Core fail-closed behavior; it does not assert
that the real host normally produces an inconsistent statement/map pair.
Rust/parity gates were not run because evaluation/lowering did not change.
Independent exact-pushed-HEAD review, protected PR/CI and merge remain downstream.
