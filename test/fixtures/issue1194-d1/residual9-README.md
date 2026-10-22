# #1194 ninth D1 closure-focused checkpoint

Base `87ae4dd2a7552b73435f8627ec540f5e53b784a6`; branch `sayosomi/issue-1194-closure-d1`. Refs #1194. One new independently confirmed family, **F49**, is repaired in the existing Module scalar lowering owner. F01–F48 remain historical controls. No #1260 implementation or #1439 grammar feature is included.

## First incorrect owner and correction

`packages/nui-language/src/scalars/moduleScalarRuntime.ts` registers Module record-field bindings through both the flat-field and nested-field views. A declaration can therefore occupy several runtime events. `eventOrderByBindingId` retains the effective final event, but `eventOrderByPathAndStatementIndex` previously retained the first event. `runtimeEventPositionForValue` used that first event to place a following record-field geometry construction.

The exact `B-min-construct-fixed` Base product has `B.n` at source order **5** and its following segment construction at **4.5**. The existing initializer graph edge and concrete geometry occurrence are present, but TS advances only through 4.5, resolves `B.n` as `evaluation-binding-unavailable`, and later reports `evaluation-geometry-property-unavailable` for L. Finalization computes B.n too late for that geometry. Normal persistent production Rust returns the independently expected **L=5**. Adding the sibling scalar observer changes the event boundary and hides this error; it is a passing contrast, not a repair.

The correction retains the **final** event for each Module path/statement in the existing map. The original construction is now placed at **5.5**, after B.n. A record with several distinct scalar fields likewise exposes its complete declaration boundary. No event list, authored source order, scheduler, graph walker, identity scheme, record accessor or evaluator is replaced. No Rust or transport source changes.

This is a #1194 record/Module lowering defect. The earlier residual8 proposed scheduler routing for **B-min-construct-dynamic** and **B-min-construct-fixed** was not established; F49 supersedes that proposal for these two inputs. They are now exercised without deferred skips by the ninth runner. Historical eighth source hashes and original evidence are unchanged.

## Frozen proof and closed contrasts

`residual9-cases.json` references the existing seventh/eighth exact sources instead of duplicating them, and adds four independently authored discriminators. `residual9-freeze.json` records the exact ordered source/bundle SHA-256 and oracle before execution. No random generator is used; seed is not applicable.

- Original fixed and dynamic selectors: L=5 in both evaluators after repair.
- Genuine adjacent Base PASS: the same constructor source with sibling scalar observation; map-free direct numeric construction is another PASS discriminator.
- Two-field Seed records: dynamic two-instance results **7/11**, fixed selection **11/11**. This distinguishes complete declaration boundaries from a one-field/one-duplicate special case.
- Non-map record construction from the later Seed field: **11/11**, confirming the record declaration boundary rather than a map-only workaround.
- A third mapped member has `pad=0`; `pad / pad * pad` would fail if selected. Both asymmetric selected instances pass and only their two record-field geometry occurrences are computed. Existing independently failing `1 / 0` is replayed as the legal `evaluation-divide-by-zero` control.

The ninth compiler assertion checks that each tested field construction follows the actual defining field binding event, in addition to existing nominal, producer/alias and occurrence-closure assertions. Expected values come from the normative `docs/nui1/spec.md` Records, Modules, dependency and lazy collection semantics, not evaluator agreement.

The exact production Base bytes were restored temporarily using `git show`, with an empty production diff, and the candidate was restored in `finally`. Verify-mode proof: **6 expected FAIL / 4 genuine PASS / 5 pre-existing deferred SKIP**, exit 1. Those six failing regressions are the two exact originals and four new boundary contrasts. Candidate ninth verification: **10 PASS / 6 explicit deferred SKIP**; the sixth skip is an additional existing residual7 map-free transfer discriminator. No unused scalar observation was added to the failing programs to make them pass. `residual9-dispositions.json` retains compact before/after decoded results and exact compiler field boundaries.

**276 cumulative unique accepted legal hashes = all 272 historical + 4 new.** No historical hash is removed or counted again. No new invalid/ambiguous prototype is accepted. The frozen corpus and normally eligible real persistent-Rust requests are the only execution path; raw compiler/wire/decoded and temporary runtime traces remain under `/tmp/issue1194-residual9/` with fingerprints retained in Git.

## Remaining observations and proposed #1260 transfer

The five other eighth-slice cases remain **UNRESOLVED**, not PASS. `residual9-transfers.json` records exact hashes, independent expected values by reference to the dispositions, actual TS/Rust outcomes, first incorrect products/owners and genuine controls. Transfer is proposed for independent adjudication; #1260 stays queued.

1. **G-map-free-dynamic / B-min-forward-dynamic:** generic collection visibility metadata places producer boundary `1.500002` / `1.500006` after consumer `1.5`. The first wrong metadata comes from `moduleScalarRuntime.ts`'s `executionPositionForValue` statement fraction versus `runtimeEventPositionForValue` half-step. Rust's existing `line_geometry_input.rs` visibility guard rejects this invalid relation. The map-free input reproduces it without record selection or maps.
2. **A-min-optional-forward:** its collection target/controller boundary `1.500009` likewise exceeds consumer `1.5`, before the selected geometry is reached. This is the same generic collection-clock boundary, not a missing record occurrence.
3. **A-map-free-optional-control:** generic optional collection if/match producer positions `2.500004` / `2.500005` exceed consumer `2.5` (second instance similarly shifted). This independently removes records/maps and remains a native production failure.
4. **A-optional-source-constructor:** scalar collection indexing inside the geometry program has no transitive dependency edge to the source scalar bindings. `typedDependencyGraph.ts`'s `referencesIn` visits the index expression but does not follow the referenced scalar collection producer in `addScalarProgramDependencies`. Existing residual7 **B-map-free-scalar-source** reproduces the absent source prerequisite without nominal records/maps; **G-map-free-construct** is the literal-source PASS discriminator. This is concrete shared-boundary evidence, but exclusive first-owner adjudication for A-optional-source-constructor is still pending; the proposal is not an established ownership transfer. No shared graph/scheduler fix is made here.

All six transfer/discriminator sources were explicitly evaluated in discovery mode; default verification skips them honestly. TS passes their independent numeric observations while Rust still reports unavailable geometry. The compiler's producer presence alone is not treated as proof of correct runtime scheduling. The two B-min-construct cases are explicitly excluded from this transfer proposal because their first owner is now repaired as F49.

#1439 owns the Human-approved future public imported nominal type capability. No `export record`, qualified type grammar, public API redesign or normative specification edit is included. That feature is no longer an ambiguous #1194 repair requirement.

## Verification and handoff

`residual9-verification.json` retains actual ordered commands/results. The block passed once: **565 focused PASS / 26 SKIP; 1,073 Stage-control PASS; build/lint PASS; parity 203 PASS; full npm 10,845 PASS / 183 SKIP (678 files PASS / 2 SKIP); DSL reference/diff checks PASS**. Rust-specific conditional gates were not run because no Rust source changed. The settled source runs residual1–9, record/Module/mapped geometry controls and the directly relevant Stage 1–7 suites, followed by build, lint, normal parity, full npm test, DSL reference check and diff check. Conditional Rust gates apply only if Rust source changes. Focused pre-gate verification: **253 PASS / 16 explicit SKIP**.

Only the existing Module lowering owner, ninth test and compact ninth evidence change. Parser/AST, typing, resolution, serialization, spans, editor/language services, UI/hosts, watchers, dependencies, packaging, CI and architecture boundaries are intentionally unchanged. Existing DSL documentation remains consistent. Manual E2E is Not Required. No scope deviation or new framework.

The supplied Human admission was consumed once; current GitHub authorization, material comments and routed Project Context were read. Fetch/prune and the bounded volatile main/topic/local/clean/ownership check passed before creating the exact new branch. No second full physical inventory, new checkout, metadata repair, reset/stash/rebase/force or main switch occurred. Normal commit/push and exact remote HEAD/clean status are reported in the final handoff. No PR, self-approval, merge, Issue closure or #1260 startup is performed.

The closed #1194 ninth repair matrix is complete. Unconditional Issue closure is reserved for independent acceptance of the transfer dispositions, exact-pushed-HEAD blocking review, protected CI/integration and Human guarded clean-main restoration. Untested DSL combinations are not claimed PASS. No quota readings or estimates were taken. All process/request bounds and owned-child cleanup remain in effect; raw logs stay outside Git.
