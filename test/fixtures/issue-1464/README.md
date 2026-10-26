# Issue #1464 composite source transformations

Base: `30e376a1efdb00c1645bab9a0f17a622e3e11a14`.
Project Context read at remote `3208462494b04d4328e571a03280cfb3b052cfad`.
Checkout: `/Users/yosomi/Code/nuinuiCAD`; topic:
`sayosomi/issue-1464-composite-source-transform-hunt`.

Human startup evidence, verbatim:

```text
LOCAL CHECK PASS mode=new issue=sayosomi/nuinuiCAD#1464 branch=sayosomi/issue-1464-composite-source-transform-hunt main=30e376a1efdb00c1645bab9a0f17a622e3e11a14 local_head=30e376a1efdb00c1645bab9a0f17a622e3e11a14 ancestry=exact human_clear=yes
LOCAL CHECK is not GitHub Issue authorization; agent must recheck volatile state immediately before mutation.
```

The subsequent bounded fetch, exact remote-main/local-HEAD read-back, unused
local/remote topic, clean tracked/untracked state and live ownership-marker
checks passed before the ordinary topic creation. No reset, stash, rebase,
force, extra checkout, legacy lifecycle or Human-test mutation was used.

## Reproducible sources and independent oracles

`cases.ts` contains the 24 primary initial sources and ordered operations;
`extensions.ts` contains five observation-triggered X cases; `reducers.ts`
contains five independent reductions. `references.ts` supplies independently
authored declaration/qualified-instance routes. The sources, action order and
numeric expectations were authored before their first execution. The final
integrity index `freeze.json` pins their source and oracle hashes; it was
written after exploration and does not pretend to be an earlier timestamped
freeze. Earlier execution records retain the actual pre-execution inputs.

The integration test uses the actual Extract/Inline planners, Rename query and
physical splice projection, Coordinate Conversion planner and revalidation,
Source Value Step query, Bake planner/apply path, store commits and canonical
recompilation. Every successful intermediate is normally Rust eligible and
evaluated through the production persistent `evaluation_stdio` process, with
independent analytic point/line/arc/scalar assertions and a secondary TS check.
No parity result is used as the expected geometry. XY differences, wrapped
polar angles and distances, intended literal deltas, line endpoints and signed
clockwise arc sweeps have explicit millimeter oracles (absolute tolerance 1e-7).

Reference assertions compare named source declarations and parameter slots,
including independent instance routes for same-spelled leaves. Untouched
declaration IDs and bytes outside splice footprints are checked. Rename also
checks every occurrence's exact shifted physical range and stable identity.
Source revisions/history are checked per commit; the actual IME guard rejects
protected commits; stale Bake and conversion plans reject without mutation;
S06 exercises real undo/redo, a no-op and a fresh Bake retry. Wrong-reference
sources are detected by compiler diagnostics or explicit Rust ineligibility
and reference evaluation diagnostics, never counted as positive fallback runs.

## Five independently repaired first owners

| Family | First incorrect owner | Independent Base failure and correction |
| --- | --- | --- |
| F1 | `inlineModulePlanner.ts::verifyPreservedSemanticOwners` | R01's `@A::P` / `@B::P` have distinct values 2/7. Matching by spelling reused A's member for B and rejected safe Inline. Proof slots now retain exact physical spans. |
| F2 | `dslSemanticOccurrenceIndex.ts::addTypedOccurrences` / qualified projection | R02 Extract→Inline keeps `read=4`. A synthetic Module runtime binding was emitted as an authored aggregate reference, while the inlined group reference had another shape. Module semantics own runtime-backed paths; ordinary typed qualified paths now project their segments and resolved final typed identity. |
| F3 | `moduleSemanticEditor.ts::createModuleSemanticRangeIndex` | R03 Extract→Inline must keep `read=@P.x=3`. The existing root scalar pass omitted geometry-property references, making the owner disappear and safe Extract/instance Rename reject. The pass now calls its existing property projector. |
| F4 | `moduleSemanticAnalysis.ts::resolveSourceScalar` | R04 Extract→Inline emits `const width = @::width`, which must read root value 6. The Module scalar pass treated the absolute single-segment path as an ordinary name, overwriting a correctly resolved initializer with a null typed reference. Rust rejected the declaration payload. Absolute paths now use the existing lexical path resolver. |
| F5 | `extractModulePlanner.ts::planExtractModule` | R05's multiline numeric declaration evaluates to 3. Extract used the single-line non-block range and moved only the opening line. It now includes the statement header's physical `endLine`, while retaining complete block ranges. |

Each family has exact Base FAIL, a smaller compiler-accepted composed source,
candidate PASS, a repair-removal FAIL and an adjacent PASS. `mutations.json`
records the producer hashes and verified restoration. All five producer files
were also temporarily restored together to exact `git show Base:path` bytes:
`base-confirmed` records genuine original-code results without switching Git
refs or creating a worktree. The five individual mutation runs each exited 1
as expected, with their neighboring normal case passing. These expected failures
are evidence, not successful verification exits.

No new resolver, parser, scheduler, runtime semantics, document model, public
language contract or external dependency was introduced. Existing production
owners and canonical source identities remain authoritative. Architecture and
normative/reference documentation need no semantic update; the DSL reference
gate remains required. No Rust source was changed.

## Complete disposition ledger

34 distinct initial inputs were attempted: 24 primary +5 X +5 R, below 40.
X03 ends atomically at its supported Extract guard before the generated Inline
target exists; this is not claimed as a completed successful two-operation
composition. Replays, sensitivity mutations, failed harness setup, and gates
do not create extra exploration units.

| Units | Final disposition | Explanation |
| --- | --- | --- |
| E01 | PASS | Adjacent point/segment, external endpoint consumer. |
| E02 | BUG→FIXED→REPASS | F2/F4; exported scalar and dependent point. |
| E03 | BUG→FIXED→REPASS | F4; independent second instance 17 vs first 6. |
| E04 | PASS | Nested group, same-spelled outer point/value. |
| E05 | BUG→FIXED→REPASS | F3; CRLF multiline point and external length read. |
| E06 | BUG→FIXED→REPASS | F3; two exported point routes and typed property reads. |
| I01 | PASS | Generated point Rename and external consumer. |
| I02 | BUG→FIXED→REPASS | F1; selected instance local Rename, independent other instance. |
| I03 | PASS | One of two instances Inline→Bake. |
| I04 | PASS | Nested Module, geometry/value alias chain, dependent Bake. |
| I05 | SUPPORTED_REJECTION + PASS | Disabled default guard; explicit hidden Inline and moved Rename pass. |
| I06 | PASS | Pre-Inline Bake rejected after revision; fresh retry passes. |
| C01 | PASS | XY conversion and base Rename. |
| C02 | PASS | Polar negative-quadrant wrap and target Rename. |
| C03 | PASS with supported partial rejection | Free point converted; relational point skipped byte-identically; successful target renamed. |
| C04 | PASS | Emitted dx 6→7; point/line x 16→17. |
| C05 | SUPPORTED_REJECTION + PASS | Scalar width 5→6 updates x 10→12; bound target rejected; stale neighbor plan rejected; fresh free-neighbor conversion passes. |
| C06 | PASS | Conversion and dependent line Bake. |
| S01 | BUG→FIXED→REPASS | F3/F4; Extract→instance Rename→Inline. |
| S02 | PASS | Inline→Rename→Bake avoids ancestor `Seam_bake` capture. |
| S03 | PASS | Polar distance 5→6 moves (5,7)→(5.6,7.8), then Bake. |
| S04 | PASS | Extract→Inline yields authored point eligible for conversion. |
| S05 | PASS | Rename→Extract→Bake retains -90° clockwise arc and 5π length. |
| S06 | PASS | Three committed APIs, real undo/redo, stale rejection, no-op, fresh retry. |
| X01 | BUG→FIXED→REPASS; supported Rename guard | E05/R02 triggered CRLF multiline scalar axis; F5 fixed. Qualified scalar member Rename remains capture-rejected atomically; nearest legal generated parameter Rename passes on the same source. |
| X02 | BUG→FIXED→REPASS | I02/R01 triggered reversed inline order with repeated instance leaf/property references; F1/F3-sensitive. |
| X03 | SUPPORTED_REJECTION | E03/R04 triggered two different dependencies both named `width`; explicit `parameter-name-collision`, no patch/history change and no invented Inline target. |
| X04 | BUG→FIXED→REPASS | E02/E03 triggered fractional refinement: 2.5→3 after Extract/Inline updates point/read 3.5→4; F2/F4-sensitive. |
| X05 | BUG→FIXED→REPASS | E02/E06/S01 triggered mixed scalar/geometry export routes; F2/F3-sensitive. |
| X06–X08 | NOT_TRIGGERED | No further independent suspicious observation after affected replays. |
| R01–R05 | BUG→FIXED→REPASS | Independently reduced F1–F5, respectively. |
| R06–R08 | NOT_TRIGGERED | No additional new first-owner failure requiring reduction. |

## Historical inputs, limits, and residuals

Initial harness attempts are retained, including mistakes corrected before
claiming product findings: binding statement-index lookup, invalid negative
Rust eligibility assumptions, source-range oracle/parameter correspondence,
and an invalid arc keyword/argument fixture. I04's first compiled input failed
initial Rust evaluation on nested `@Kid::n` used by a geometry expression,
before any transform. The neighboring case uses an outer typed alias and still
tests nested geometry/value forwarding. That initial standalone evaluator
observation is retained in `history/base-first.json.gz`; it is outside this
composition hunt, is not repaired or counted as a family, and is not claimed
to pass. No new standalone evaluator hunt was started.

X01's final guarded scalar-member Rename is not a repaired Rename family:
the pure safety replay cannot prove the qualified `Part::b` substitution and
rejects it. Its source, revision and history remain unchanged. The same source
then successfully renames the local generated parameter. This guarded residual
is disclosed rather than counted as a successful member Rename.

`history-manifest.json` lists gzip archives (including named members of
`history/command-logs.tar.gz`) with exact original UTF-8 byte lengths and
SHA-256 hashes. Compression is lossless: no historical failure observation
or command log was rewritten as PASS. `gates.jsonl` records actual command exits, time bounds and elapsed
durations. The runner refuses to overwrite an existing log label.

## Verification and handoff

Final command results are recorded in `verification.json`; historical failed
gates remain in `gates.jsonl`. Full Rust fmt/check/test/clippy are not required
because no Rust source changed. The production binary rebuild, ordinary Rust
eligibility and production requests at each successful intermediate are
mandatory and exercised. Full npm regression, parity, build, lint, focused
source-transform regressions, DSL reference and whitespace checks are required.

Human-observed weekly/five-hour before/after remaining quota: **UNAVAILABLE**.
No inferred quota cost is reported. No GUI E2E was run; #1460 remains separate.
Independent exact-pushed-HEAD review belongs to ChatGPT. The agent creates no
PR, merge or Issue closure and leaves the topic checkout for that review.

The first full suite exposed a regression introduced during F2's correction:
giving every supplied final target priority mixed a materialized geometry ID
with the authored Module body's identity in Definition. The final correction
limits that priority to typed scalar targets. The unchanged existing Definition
test detects the mistake; its failure and the first full-suite exit 1 are
retained. The corrected full suite passed 11,135 tests with 187 existing skips,
and parity passed all 207 tests. F2's removal sensitivity was rerun against
this corrected candidate (`mutation-F2-corrected`, expected exit 1), followed
by a fresh positive replay. This iteration is not a sixth discovered family.

Final gate exits: focused composite/Definition replay 0; existing transform
regressions 0; build 0; lint 0; complete npm suite with two workers 0;
Rust/TS parity 0; production Rust binary rebuild 0; DSL reference check 0;
unstaged and staged whitespace checks 0. No gate timed out. Historical lint's
one `prefer-const` error and the first full-suite failure remain recorded.
The first staged whitespace check exited 2 solely because untouched raw test
logs ended in blank lines. Those logs, including that check's own failure
output, were losslessly archived rather than edited; the final staged check
then passed.
