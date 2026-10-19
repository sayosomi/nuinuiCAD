# Issue #1421 — final exploration and method comparison

This checkpoint completes the bounded implementation/exploration phase. Issue #1421 remains OPEN. Independent exact-HEAD review, protected PR/CI and merge remain subsequent work; no PR was created here. Human Manual E2E is Not Required for this compiler/evaluator-only change.

The original comparable pilot remains on product baseline `bab8313ae08f5e354a6cfd9d7b2ffb8177a15bc2`. This continuation began at independently reviewed `357bd93c26e5a424d5679668bec4f0d75874f498`. See `preserved-evidence.json` for byte-identical hashes of the original model, independent oracles, pilot, results and preceding repair evidence. The older manifest/report fields are historical, not a second current outcome.

## Selection, chronology and outcomes

The [published selection](https://github.com/sayosomi/nuinuiCAD/issues/1421#issuecomment-6261130615) precedes compiler prevalidation and every adaptive evaluation. `selection.json` retains its timestamp/body hash; `selection-comment.md` retains its exact rationale. Exactly E=B, C=B, D=C were selected. Only their 02/03 pairs were frozen in `adaptive.json`, after the existing generator calculation agreed with the separately authored closed-form oracle for every expected field. Prevalidation compiled all twelve sources without diagnostics and ran neither evaluator.

| Selected pair | Initial S/T | Final S/T | Disposition |
|---|---|---|---|
| E-B-02 | PASS / PASS | PASS / PASS | PASS |
| E-B-03 | PASS / PASS | PASS / PASS | PASS |
| C-B-02 | FAIL / FAIL in Rust final scalar | PASS / PASS | repaired-then-PASS |
| C-B-03 | FAIL / FAIL in Rust final scalar | PASS / PASS | repaired-then-PASS |
| D-C-02 | PASS / PASS | PASS / PASS | PASS |
| D-C-03 | PASS / PASS | PASS / PASS | PASS |

The first adaptive batch continued through all six pairs despite the C failures. Original S/T sources and expected results were never edited to get PASS. All 36 repaired pilot sources, all twelve selected adaptive sources, seven preceding reduced regressions and twelve new runtime reductions/controls passed the final Stage 4 verification (45 tests including two freeze/oracle checks). Normal Rust eligibility was true for every executed valid program; no direct-input eligibility bypass was used.

`final-results.json` gives all 36 matrix IDs: **15 PASS, 9 repaired-then-PASS, 12 NOT_SELECTED**. Twenty-four cells / 48 primary programs were executed. The twelve unselected adaptive cells were never run and imply no correctness claim.

## Independently confirmed production defects

The preceding checkpoint fixed three pilot families (F1 canonical condition-owner prerequisites; F2 TS geometry-value collection environment; F3 Module scalar event ordering) and non-counted repair follow-on R1. This phase confirms **three additional producer families**, all fixed, with one observed directly in adaptive cells and two discovered during their reduction. Initial triage grouped the two numeric-field symptoms together; the partial-repair evidence separates their independent first producers. This is producer-based classification, not three findings inferred from three failing tests.

| Family | Independent minimal evidence / passing contrast | First defective producer and repair |
|---|---|---|
| Stage4-F4 | Map `[1]` through ticks 1/2, carrying both Values and Total. Independent incoming snapshots are `([1],0) → ([2],1) → ([4],3)`; Rust produced Total=4. A literal-member contrast produced 5 instead of 3. Constant +1 mapping and one iteration passed before repair. | Rust `collection_carry_context` let the consuming frame override the saved scalar closure on the first read. Captured bindings now take precedence on that read too. No new resolver or scheduler. Direct Rust regression fails before with 9 instead of 2, passes after with 2; an uncarried body collection still reads current 9. |
| Stage4-F5 | One statement-for, Values=`[7]`, point x=`@Values[0]`, `next Values=@Values`. Valid nui1 was compiler-fatal; forwarding through a typed scalar alias passed. | Canonical Module/source `resolveCollectionIndex` excluded root carry declarations with an `ownerIndex !== null` gate. Reuse its existing carry-index branch for root lexical carries; retain Module capture validation and canonical identities. |
| Stage4-F6 | The proposed root-only control (historical test ID `F5-root-control`) was compiler-accepted yet omitted the expected point `(7,0)` in both runtimes. No carry is present. Its semantic collectionIndex was already correct. | Root numeric-site projection selected optional members only, and numeric-site lowering dropped a collection-only typed program. Reuse existing source semantic lowering and suppress legacy compilation only for the exact already typed numeric occurrence. Completing that repair also forwards the existing collection lookup callbacks to the TS numeric materializer; this downstream completion counts as zero extra families. |

F5 and F6 are independently isolated: after the numeric projection change the Rust root-only F6 example passed while F5 still failed in the compiler; removing the root-carry gate then resolved F5. F4 is isolated by a scalar-only reproducer, so neither numeric-field repair can explain it. The original rejected incoming-observer reduction is retained by exact hash and now passes as `F5-original-reduction`. The alias, invalid-index diagnostic ownership and Module counterpart cases verify adjacent behavior. Final negative validation also exposed dropped type diagnostics at root numeric sites; preserving the canonical typing result rejects boolean members and boolean indexes. These are F6 error-transport completion, not additional discovery families. Root materialized numeric programs are also projected into the existing canonical dependency graph; an ordered index-input control asserts its exact binding edge. `graph-wiring-proof.json` records the missing-before/present-after edge without changing scheduling. Both incorrectly accepted texts remain charged to the budget, even though the repaired compiler now rejects them; an always-rejected missing-name control is retained too. The initially proposed root control is explicitly a failing contrast, never credited as a passing control.

`error-control-proof.json` retains the type-error FAIL-before/PASS-after checks. `final-proof.json` retains exact reduction sources, independent expectations, original/final normalized TS/Rust observations, compiler diagnostics, intermediate failures, input/payload hashes, run/request counters and a complete attempt index. Large raw envelopes/logs remain outside the checkout. The same test harness replays the committed sources; historical pre-repair evidence is not overwritten.

These are repairs of the existing normative contract: shared typed numeric construction fields, scalar collection indexing, incoming carry snapshots and simultaneous `next` in `docs/nui1/spec.md`. No syntax, normative semantics, E/C/D matrix shape or authorized production ownership was expanded. No architecture boundary changed and no DSL-reference content change was needed; the reference check passes.

## Comparable method evidence

A is repaired-defect neighborhood probing, B targets compiler/payload/runtime implementation risks, and C generates deterministic programs against an independent model. The table uses **original pre-repair observations**, subsequently independently confirmed, rather than repaired PASS counts.

| Stratum | Method A families; probe ms | Method B families; probe ms | Method C families; probe ms | Selection |
|---|---:|---:|---:|---|
| E | 1 F1; 1024 | 1 F2; 330 | 0; 300 | B: tied yield with A, lower recorded cost |
| C | 0; 38 | 0; 30 | 0; 41 | B: zero-yield tie, lower recorded cost |
| D | 1 F3; 31 | 1 F3; 34 | 1 F3; 30 | C: tied yield, lower recorded cost |

Every table entry has four sources. E has 4 compiler / 24 TS / 24 persistent Rust requests per method; C and D each have 4 / 4 / 4. Each method totals twelve sources and 12 / 32 / 32 requests. The three D observations are corroboration of **one** family globally. Across the comparable pilot A observed two families, B two, C one, but the global union is three, not five.

Pilot families/accepted-source: A=2/12, B=2/12, C=1/12; global union=3/36. Recorded probe-only families/minute are A≈109.79, B≈304.57, C≈161.73, global≈96.88. These tiny-denominator descriptive rates include compilation, assertions and process overhead, omit unmeasured authoring/diagnosis/repair, and are **not** productivity forecasts. Per-stratum rates and request/phase totals are in `effort.json`.

Per-method diagnosis allocation and historical end-to-end wall effort were not instrumented. Consequently end-to-end confirmed-and-fixed families per total effort is **unavailable**, not zero and not the probe-only rate. Agent tokens and active human/model labor are unavailable. Current harness phases have measured start/end/request counts; first-failure to first-all-reduced-PASS is an observation window containing editing, analysis and process waits, not exclusive repair labor. Current full-suite wall duration is measured separately. `verification-history.json` distinguishes superseded passes, a scoped-edit regression and interrupted superseded checks from final gates; none is hidden as a successful final run. No historical time is invented or retroactively assigned to arms.

A's first E input includes cold startup overhead. D-C's lead over D-A is just 1ms. No exact measured-cost tie occurred, so later activation/lexical tie breaks were not invoked. Unmeasured diagnosis cost could change the ranking. Sensitivity does not override the higher-ranked available cost observations. The adaptive result is not a controlled A/B/C comparison: only B was run for C, so its three new producer families (including two reduction findings) do not show that A or C would have missed them.

## Calibration, activation and sensitivity limits

Existing X02/X05/X07 positive/negative calibration passes with exact production persistent Rust and TS requests (3 compiler / 6 TS / 6 Rust). Known seeded faults count as zero discoveries.

F01 is confined to a Rust `cfg(test)` test. Real nested for-group frames hold outer locals; the actual collection selector/member reader receives either the frame resolver or the legacy document-only delegation. The independent length/member oracle rejects the loss; the intact frame and literal control pass. C-A-01 and C-C-01 S/T actually activate nested collection-source reads, corroborated by the original pilot's two inner rows. Other pilot cells are NOT_COVERED for that boundary. This is a boundary-level semantic sensitivity test; an arm-wide mutated-evaluator detection fraction was not measured or claimed.

F04 changes test input only: a Module call's lexical for-group ancestry establishes that its immutable value needs frame-owned lazy scheduling, then the negative input clears only that flag. The independent ownership oracle detects the first loss and the intact counterpart passes. Remaining dependency/owner gates on the repaired engine mask an output difference in both runtimes, so output sensitivity is **NOT_DETECTED**. None of the pilot arms calls a Module inside a statement-for: every arm is **NOT_COVERED** for F04. That is a real coverage gap, not a PASS. `sensitivity.json` retains these distinctions and the test-development failures that revealed masking. No deliberately defective production code, generic injected throw or vulnerable production checkout was used.

## Exploration and effort accounting

The global exact-content ledger grows **61 → 88 / 200**: twelve selected primary adaptive sources plus fifteen additional accepted texts (twelve runtime reductions/controls, two incorrectly accepted type-error controls, and one out-of-scope investigation text). There are 112 unused slots; the ceiling is not a target. Compiler-rejected initial attempts were never evaluator PASS and only consumed capacity when their identical content became accepted after repair. Exact reruns, existing X calibration/holdouts and mandatory regression runs add zero sources. Every accepted exact hash maps to method, stratum, first phase and purpose in `source-ledger.json` (A=27, B=41, C=20); current reductions and controls also retain their exact sources in the proof. Shared texts count once globally.

The adaptive freeze used twelve compiler requests, no evaluator requests. Its first evaluation used 12 compiler / 32 TS / 32 Rust requests. Subsequent diagnosis and verification counts are retained separately in `effort.json`; they are costs rather than discovery yield. No further adaptive cells were added after either finding. See `final-summary.json` for final verification results and file hashes.

## Specific policy for the next authorized discovery run

1. Start E with **B**, retaining asymmetric successful/failed Module instances and all four limit placements. Switch to A if a fully prevalidated pilot produces no independent new producer, or if compiler graph activation fails to reach conditional descendants. Do not repeat repaired F1/F2/R1 exact inputs as exploratory discoveries; keep them as mandatory regressions. An unexamined hypothesis is interaction between failed-instance completion and a distinct private scalar/geometry dependency at a limit boundary.
2. Start C with **B**, but require at least two discriminating iterations and an observer of both incoming and escaped views. Zero/one iterations masked F4 in the pilot. Switch to A when map/simultaneous-carry probes add no new producer or when the new hypothesis specifically depends on nested frame collection selection; A/C had that activation while B did not. Keep scalar-alias and direct numeric-field contrasts, since their different first producers separated F5/F6. Do not merely increase iteration counts or rerun the fixed snapshots to manufacture volume.
3. Start D provisionally with **C**; its cost lead is weak. Switch to B if selected/unselected condition and disabled-ancestor paths are not actually distinguished, or if one complete calibrated pilot adds no independent family. Retain an independent surviving geometry and independent scalar/geometry errors so absence of output cannot masquerade as successful suppression. Do not credit three arm observations of F3 as three families.
4. Before any next selection, measure warm and cold probe costs separately and instrument diagnosis/repair time prospectively. Freeze hypotheses and independent oracles before evaluation. If known-fault boundary activation is absent, record NOT_COVERED and switch hypotheses rather than count PASSs. Add a Module-loop lazy-ownership hypothesis only in a separately authorized scope; this run's matrix was not expanded to hide its F04 gap.
5. Stop a bounded wave after its selected cells and confirmed repairs are resolved. Switch after a complete zero-yield activated pilot, not after an arbitrary request/family quota. Stop safely on the Issue's admission/resource/contract/budget blockers; push evidence rather than manufacture completion. Require independent replication before promoting these provisional starting choices into a lasting policy.

One additional compiler-accepted investigation moved a consumer before its own inputs. Its ordered counterpart passed; the forward variant still fails in both runtimes after its canonical index edge is present. This changes dependency order rather than merely reordering unrelated declarations, exceeding the frozen Issue matrix. `out-of-scope-suspect.json` retains the source, independent expectation, failing payloads and scope boundary. It consumes one budget slot and is neither PASS nor a confirmed/fixed family; broader scheduler work requires a separate contract. The ordered control and canonical edge assertion remain in the regression suite.

No observed in-scope product failure remains unresolved. Coverage gaps, missing cost measurements, independent final-HEAD review and later integration are explicit limits; this small sample proves neither a universal method optimum nor overall DSL correctness.
