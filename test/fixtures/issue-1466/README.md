# Issue #1466 — nested Module numbers consumed by geometry

Contract: <https://github.com/sayosomi/nuinuiCAD/issues/1466>.
Base: `17591f7c5aa61d9d227f4096c75e48138eaf4528`.
Checkout: `/Users/yosomi/Code/nuinuiCAD`.
Topic: `sayosomi/issue-1466-nested-scalar-geometry-hunt`.

Human startup evidence, verbatim:

```text
LOCAL CHECK PASS mode=new issue=sayosomi/nuinuiCAD#1466 branch=sayosomi/issue-1466-nested-scalar-geometry-hunt main=17591f7c5aa61d9d227f4096c75e48138eaf4528 local_head=17591f7c5aa61d9d227f4096c75e48138eaf4528 ancestry=exact human_clear=yes
LOCAL CHECK is not GitHub Issue authorization; agent must recheck volatile state immediately before mutation.
```

The bounded `git fetch origin --prune` exited 0. Remote `main`, fetched
`origin/main` and clean local `main` exactly equaled Base; the topic did not
exist locally or remotely. No active claim, lock, audit reservation or native
E2E generation was present. Historical released E2E receipts were preserved.
The registered Human-test checkout was not changed. Latest GitHub Project
Context and current Issue/body/comments were read. Remote policy blobs:
`CHECKOUTS.md` `e04c67d502ef97f29c0c6287f25cf043a58cea6a`,
`CODING-AGENT.md` `98e6d57e552c65f5f441ca245f503456e4acd391`,
`ISSUES.md` `628f2ada1960da6ab174bbdebac783c6a9d1cd87`.
The latter two differed from their local dev-context copies; remote policy
was authoritative. No dev-context file was changed.

## Historical input and authority

`historical-seed.json` retains I04 exactly as found in
`../issue-1464/history/base-first.json.gz`. Original gzip SHA-256:
`86d251bfd7e45fd2df32008bf2885c9629e113ad6d7fff1014bfe489db6d6a5c`;
uncompressed SHA-256:
`d3bb55a6140d41b2f699e414805a9a7a7826c4e7856b88571578dbeed9a6640f`.
The original record contains no initial compiler/payload snapshot: it stopped
before storing that field. The original `base-first.log` member in
`../issue-1464/history/command-logs.tar.gz` records the initial Rust error:
`Kid::n` could not be found while evaluating parent point `P`. No composed
source transformation had executed. That evidence has not been overwritten
or relabeled. The exact current Base re-execution supplies the missing
compiler, normal eligibility, stdio payload and TS-control evidence.

The source is **legal**. Child `v=5`, exported `n=v+1=6`, child point `(5,2)`,
parent offset `(5+6,2+1)=(11,3)`, downstream line from `(11,3)` to `(20,9)`,
length `sqrt(9^2+6^2)=sqrt(117)` mm. Base accepts without error, ordinarily
selects Rust, and fails the parent numeric input. It is F1 below, a new
standalone evaluation defect, not one of #1464's five transformation repairs.

Normative owners are `docs/nui1/spec.md` (namespace/scope, expressions,
canonical properties, Modules and instance atomicity) and
`docs/dsl/en/modules.md`. Source identity and dependency selection belong to
the canonical compiler; the production Rust evaluator consumes its products.
TS is a secondary control. No specification was changed to accommodate code.

## Independent oracles and scope

`primaries.json` freezes all 24 initial sources and independent hand-calculated
geometry/scalars. `extensions-reducers.json` records evidence-triggered units.
The `freeze-*.json` records were written before their sources' first runs;
source hashes are checked by the executable harness. `reference-oracles.json`
names intended authored consumer, instance and export declarations literally;
those routes are checked against occurrence identities and canonical binding
IDs, not inferred from evaluator agreement. `supplemental-oracles.json`
strengthens curve control and orientation assertions. `oracle-notes.json`
discloses test-author corrections; none count as product bugs.

The default permanent integration test executes all primary/triggered units,
canonical compilation, ordinary eligibility, one owned persistent Rust stdio
process with 15-second request timeout/8-MiB response cap, analytic oracles,
TS controls, diagnostic ownership, occurrence isolation and C06's reconciled
source revision. Child close/error listeners are installed before teardown;
the process is disposed and its close awaited. Gate subprocesses have explicit
bounds and own process groups. No GUI E2E or external resource was used.

There are 37 labeled investigation units: 24 primary, X01–X08 and R01–R05.
R06–R08 are NOT_TRIGGERED. Two nearest-legal variants (B06 and D06)
and C06's prescribed revised source bring the conservative count to **40
actual distinct authored source revisions**, within the 40-unit ceiling.
No new random corpus or broad source search was used to consume capacity.
Existing suite fixtures are verification, not discoveries.

B06 initially expected partial geometry from a failed parent. The normative
atomicity rule explicitly forbids that output; it is a supported rejection,
not another defect. The legal variant adds an independent enabled nested
neighbor whose `(14,2)` output must survive. D06 initially used `end.y`, which
is not a public scalar property. Its original CONTRACT_INVALID rejection is
retained; the nearest legal `endPoint.y` variant is tested. Scalar-payload tag,
arc/Bezier runtime-kind, C06 API-call and X05 diagnostic-code corrections are
also disclosed in `oracle-notes.json`, with all original failed logs preserved.

## Independently confirmed causal repairs

| Family | First incorrect producing owner | Distinguishing proof |
| --- | --- | --- |
| F1 | `scalars/moduleNumericRuntime.ts` rejects `deferredModuleScalarExport` while assembling numeric bindings | A01/A02/R01 Base FAIL; same-semantics A03 alias PASS; repaired direct references PASS; F1 removal fails R01 while A03 stays PASS |
| F2 | `dsl/expressionReferenceToken.ts` lets a bare head swallow the sigil after unary minus | D01/R02 `-@alias` lacks numeric binding while `+@alias`, grouped minus and multiplication controls discriminate; scanner boundary correction restores canonical lowering; removal fails R02/X01 |
| F3 | `scalars/bindingResolution.ts` rejects an already-resolved absolute qualified export because its display name includes the instance prefix | R03 and still-smaller root X07 are legal but Base rejects `::Copy::n`; compare canonical normalized path segments while retaining virtual-rename stale-name protection; removal reproduces rejection |
| F4 | `dsl/dslDocument.ts` drops `path.absolute` at two first-segment Module export lookups | C05/R04 select nearer Copy instead of root Copy; X06 wrong-kind nearer scalar guard; after F3 isolation, wrong value 17 replaces expected 3. Reuse canonical lexical-path resolution; individual removal restores wrong identity/value |
| F5 | `dslDocument.ts`/`typedDependencyGraph.ts` omit numeric occurrences without root statement-index keys, then existing execution staging fences forward linear prerequisites by source position | C03/R05 and repeated signed X03 have valid lowered IDs but missing graph edges/late initializer; X08 uses a typed alias to prove the same family independently of F1 on exact Base. Pass exact runtime numeric owners into the existing canonical graph; project only forward-input linear prerequisite closure into existing TS/Rust dependency staging. Graph, TS and Rust removals independently fail R05; reordered C04 stays PASS |

F5's directly affected runtime owners are `src/geometry/evaluate.ts`,
`scalarProgramEvaluation.ts`, `src/scalars/linearMutationEvaluator.ts`, Rust
`conditional_dependency_runtime.rs`, `mod.rs` and `scalars/mutation.rs`.
They extend the existing graph projection and execution cursor; no second
resolver, evaluator or scheduler, fake slot, source reordering or fallback was
introduced. The Rust schedule's existing test constructor supplies an empty
early-binding set. No historic assertion has been weakened.

The initial overbroad early-execution candidate broke 15 existing Module
collection/carry regressions. It was discarded in favor of the graph-proven
forward-input closure. The first full suite also exposed materialized
record-reference/span and activation-namespace handling in F5's new graph
join; those failures are retained and corrected at the join, without editing
the existing tests. These implementation iterations are not new families.

`check-mutations.py` replaces only task-owned changed implementation bytes with
exact Base or an explicit individual counterfactual, then restores all candidate
bytes in `finally`. `base-confirmed.json.gz` and `mutations.json` retain real
Base/repair-removal failures, passing neighbors, exact code-content hashes and
repaired replays. The Git revision while testing uncommitted changes is Base;
the implementation hashes distinguish each candidate truthfully.

## Language and architecture impact

Affected: numeric source scanning of existing legal syntax, numeric lowering,
canonical dependency projection, reference identity acceptance, execution
staging, focused fixtures and regressions. Intentionally unchanged: grammar,
AST syntax, nominal type policy, authored serialization and source edits,
completion/navigation/rename owners, physical spans/statement identities,
editor integrations and native hosts. The shared scanner's existing tests and
full regressions exercise its other callers. Architecture ownership and data
flow are unchanged; no ARCHITECTURE.md rewrite or new DSL feature is needed.

## Evidence and final verification

`gates.jsonl` records actual exits and bounds, including unsuccessful attempts.
The runner refuses to overwrite labels. Compressed snapshots retain compiler,
semantic occurrences, dependency graph, production input/output and TS results.
Final ledger and verification summaries accompany these raw records.

Human-observed before/after weekly or five-hour quota readings: **UNAVAILABLE**.
No token, runtime or case-count proxy is reported as quota cost.

The topic is left for independent exact-pushed-HEAD blocking review by ChatGPT.
No PR creation, merge, Issue closure or GUI E2E is part of this execution.
#1460 remains separate; prior hunt fixes are comparison controls, not recounted.

Final dispositions (complete per-ID records: `dispositions.json`):

- BUG→FIXED→REPASS: A01–A02, A04–A06, B01–B05, C01–C06, D01–D05,
  X01–X03, X06–X08, R01–R05.
- PASS: A03.
- SUPPORTED_REJECTION: B06, X04, X05; B06's independent enabled neighbor PASS.
- CONTRACT_INVALID: original D06; legal `endPoint.y` variant BUG→FIXED→REPASS.
- NOT_TRIGGERED: R06–R08. All eight X slots were evidence-triggered.

Final gates, all exit **0**:

| Gate | Result |
| --- | --- |
| Focused Module/compiler/Inline/#1464/scanner/resolution plus new matrix | 393 PASS |
| Final default matrix after individual counterfactuals | 37 PASS |
| `npm test -- --maxWorkers=2` | 11,172 PASS; 187 existing skips; 693 files PASS, 2 skipped |
| `npm run test:parity` | 207 PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm run docs:dsl:check` | PASS |
| Rust production `evaluation_stdio` build/ordinary eligibility/actual stdio | PASS |
| `cargo fmt --manifest-path rust-evaluator/Cargo.toml --check` | PASS |
| `cargo check --manifest-path rust-evaluator/Cargo.toml` | PASS |
| Focused Rust conditional-dependency tests | 4 PASS |
| `cargo test --manifest-path rust-evaluator/Cargo.toml -- --test-threads=2` | 625 PASS, 9 existing ignored |
| `cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings` | PASS |
| Tracked/staged `git diff --check` | PASS |

The final implementation's byte hashes match
`sealed-fixed-after-mutations.json.gz` in the history archive and
`verification.json`. Exact Base F4's first-owner resolver output is recorded
even though downstream F3 masks it with a compiler rejection: the expected
root-instance binding ID differs from the actual nearer-instance binding ID.
X08 additionally proves F5 on exact Base without F1 contamination. F5's final
three removal runs cover graph wiring, TS and Rust independently, with C04
passing alongside the failures. No gate timed out, no test was skipped to
hide a failure, and no historical assertion was weakened.

Raw logs and compressed snapshots are losslessly packed in `history.tar.gz`;
`history-manifest.json` maps original names to exact members, byte lengths and
SHA-256 hashes (including uncompressed snapshot hashes). Original #1464 bytes
remain in their original location. The task's runner and counterfactual script
can write new explicitly labeled records beside these fixtures; historical
labels and failures in the archive remain intact.

Final remote main recheck remained exact Base and the Issue contract had no
new comments or body drift. All task-owned evaluator/test/build processes
finished. The Human-test checkout was only inspected read-only; final state
was clean and detached at `938b30ff9319106badef883a09f7292c707d821f`.
The topic commit, normal push and clean local/remote HEAD readback are recorded
in the GitHub Issue checkpoint, avoiding a recursive self-commit hash here.
