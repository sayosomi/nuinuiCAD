# Stage 5 campaign result

All **42 primary cells / 84 primary programs**, plus **three G zero-iteration
controls**, are resolved semantic PASS in TypeScript reference and normal
eligible production persistent Rust. **Novel independently confirmed-and-fixed
families: 0.** No product source, dependency, configuration, architecture or
normative/user-facing DSL change was needed. No minimized novel-bug regression
or first-defective-producer repair is claimed. Human Manual E2E is Not Required.

Base: `938b30ff9319106badef883a09f7292c707d821f`.
Branch: `sayosomi/issue-1423-evaluator-strategy-stage5`.
W1 and W2 ran before any product repair on that same production-owner tree,
SHA-256 `b6e97ff9fb2b69f61df367741c579bacf90302525df1b6b44ddc436788b97d50`.
The production tree remained unchanged throughout final focused verification.
Freeze SHA-256:
`6c9e23bfe1d3769490b6d433a9aa62917f166a8ff0347c86d66ea070fe7e4161`.
The complete freeze and original W1 result were pushed at
`1ccd0818fe1a514a526233f069bea9a9a8789d6e` before the
[W1 prediction checkpoint](https://github.com/sayosomi/nuinuiCAD/issues/1423#issuecomment-6266621585)
was published at 2026-10-19 20:55:55 JST. W2 evaluation followed that read-back.

| Phase | Cells | Programs | Compiler / TS / persistent Rust requests | Result |
| --- | ---: | ---: | ---: | --- |
| W1 baseline | 18 | 36 | 36 / 72 / 72 | All PASS; zero novel families |
| W2 held-out baseline | 18 | 36 | 36 / 72 / 72 | All PASS; zero novel families |
| G final sensitivity batch | 6 | 12 + 3 controls | 15 / 30 / 30 | All clean semantics PASS; injected output detected in 12 positives |
| Final focused campaign replay | 42 | 84 + 3 controls | 87 / 174 / 174 | All PASS, including exact dependency/private-value checks |

Counts above describe individual successful batches, not total agent effort.
`telemetry.json` includes prevalidation and repeated instrumentation attempts;
replays do not consume additional distinct-source capacity. **87/240** new
accepted source texts were used, with no Stage 3/4 exact-source duplicates.
The 33 rejected pre-freeze candidates remain CONTRACT-INVALID attempts.
No current frozen cell is CONTRACT-INVALID, BLOCKED or UNRESOLVED. No cell is
repaired-then-PASS because no product repair occurred.

Semantic PASS and activation are separate. All six G cells actually execute
Module-in-loop private conditional ownership and exported/consumer output.
F04 first-loss injection changes only the conditional value's test-local lazy
flag; **all 12 active programs detect exported/consumer output loss in both
runtimes**, with independent controls surviving. All three zero-loop drawable
negative controls pass and have NOT_COVERED activation. Their injected TS-only
private diagnostic side channel is retained and excluded from output/activation
scoring. Seeded F04 contributes zero novel families.

W2 C cell 00 intentionally has zero iterations in each method: its final
initializer observer passes while inner-control activation is NOT_COVERED.
W1 E cell 00 is the two-success adjacent contrast, NOT_COVERED for failed-instance
atomicity. Other cells activate first/second failure and two-iteration incoming
snapshot discrimination. `outcomes.json` retains these per-mechanism limitations;
no blanket claim of every fault mechanism in every cell is made.

The W1-derived E=B/C=B/D=C defaults remained provisional. Its narrow all-method
W2 semantic PASS/zero-yield prediction was replicated. G=A is an operational
starting choice; G activation/output sensitivity passed for A/B/C. Stage 4's six
families/88 accepted texts and unmeasured quota do not establish a comparable
efficiency denominator. Overall efficiency classification: **INCONCLUSIVE**.

Human quota observations: before weekly **28%**, reset **in 5 days 13 hours**,
five-hour **97%**, reset **in 4 hours 58 minutes**, date **2026-10-19 JST**;
after weekly **27%**, five-hour **87%**, with **no overlapping Codex/Work usage**.
Displayed movement is **1 weekly point / 10 five-hour points**. Exact observation
times and after reset displays are missing; the strict same-window attributable
denominator is UNAVAILABLE. These snapshots bracket experimental work, omit
parts of initial setup and final mandatory verification, and do not separate
methods. `quota.json` preserves the raw observations and rounding limitations.
No token estimate, time-based ranking or quota-efficiency superiority is claimed.

Focused verification passed **6 files / 223 tests**, covering Stage 5, directly
related Stage 3/4 controls, F04 sensitivity, Module failure atomicity and numeric
runtime behavior. Targeted ESLint, the evidence reducer and diff whitespace
review also passed. The exact mandatory final gate block is run **after the
final intended commit**, with its results and exact pushed HEAD recorded in the
PR/checkpoint and implementation response; this file does not pre-certify it.
Rust source is unchanged, so the conditional standalone Rust fmt/check/test/clippy
block is inapplicable. Required persistent Rust semantic comparisons above did run.

Artifacts:

- `freeze.json`: immutable source/model/oracle/seed/method/order registration.
- `W1-baseline.json`, `baseline.json`: original pre-repair dispositions/hashes.
- `source-ledger.json`: accepted sources and budget attribution.
- `outcomes.json`: final independently checked numeric geometry, diagnostics,
  instance snapshots, selected dependency edges and activation classifications.
- `sensitivity.json`: original/injected F04 construction and compact output proof.
- `telemetry.json`: requests, rejected attempts and observable agent corrections.
- `prediction.json`: pre-W2 Issue comment, choice and falsifiable prediction.
- `quota.json`: exact Human observations and unavailable/confounded dimensions.
- `strategy.md`: runnable tested commands, controls, switching/stopping rules,
  first-producer triage and quota/context policy.

Large attempt envelopes and instrumentation failure traces remain in
`/tmp/nuinui-stage5-1423/` for this local run; compact historical instrumentation
dispositions are retained in telemetry. The G diagnostic/cache and D scrutinee-edge
assertion corrections never changed primary sources, frozen semantic expectations
or product code. The W2 setup read-back failure made zero compiler/evaluator
requests and revealed no held-out results. None is counted as a product family.

No scope deviation or unresolved primary cell remains. Excluded Stage 4
forward-dependent numeric-site suspect provenance is preserved unchanged in
`../issue-stage4/out-of-scope-suspect.json`. Records/optional transport, imports,
#1260's separate matrix and broader scheduler changes remain outside this work.
Clean PASS cannot exclude defects in other legal shapes, larger iteration counts
or unseeded historical families. Independent exact pushed-HEAD blocking review,
protected CI and the authorized merge/read-back workflow remain outstanding;
the implementation agent does not merge or self-certify that review.
