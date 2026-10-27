# Stage 5 evaluator discovery procedure (scoped v1)

This runnable procedure implements [Issue #1423](https://github.com/sayosomi/nuinuiCAD/issues/1423).
Its efficiency classification is **INCONCLUSIVE**. W1's semantic prediction was
replicated by held-out W2, but zero novel families and absent method-isolated
quota observations cannot validate a discovery-efficiency ranking. It is not a
universal optimum or a new project policy.

## Initial choices and experiment

Start provisionally with **E=B, C=B, D=C, G=A**. These are operating choices,
not measured efficiency winners. Always finish all frozen A/B/C cells, including
controls; a provisional preference never removes an arm.

| Method | Mechanism used here |
| --- | --- |
| A | Stage 3/4 repaired-owner neighborhoods: Module private geometry/atomicity, nearest-loop nested `next`, conditional/disabled diagnostic ownership, Module-loop private `if` |
| B | Inspect canonical compiler → runtime payload → TS/reference and production persistent Rust risks: private selected collection feeding Module geometry; indexed incoming carry plus simultaneous scalar `next`; exhaustive match scrutinee/branch dependencies; Module-loop private match lazy ownership |
| C | Independently seeded authored models: asymmetric points and failures, affine array/scalar carry updates, independently surviving errors/geometry, and Module-loop values; values and oracles do not come from historical or current evaluator output |

The closed matrix is W1 `E/C/D × A/B/C × 00/01 × S/T` (36 programs),
W2 with the same shape (36), and G `A/B/C × 00/01 × S/T` (12), plus one
zero-iteration G control per method (3). S/T applies legal alpha-renaming,
typed-alias forwarding and/or unrelated prerequisite padding/reorder.

Seeds are exactly `5000` (W1), `6000` (W2), or `7000` (G), plus
E/C/D offset `0/100/200`, method A/B/C offset `0/10/20`, and cell `0/1`.
G has no E/C/D offset. Both pair members share their cell seed. The G
zero control shares cell 00's model values but has its own source hash.
`model.ts` specifies the deterministic draw and source construction.

Before any primary evaluation, compiler-prevalidate and freeze **all** W1/W2/G
sources, hashes, authored expectations, independently recalculated expectations,
seeds, assignments and array evaluation order. `freeze.json` is immutable;
`source-ledger.json` indexes its 87 distinct texts. None matches a Stage 3/4
accepted-source hash. Prevalidation rejected 33 initial generator candidates;
they are CONTRACT-INVALID attempts, not evaluator PASS or new defect families.
They were corrected before freezing, without evaluator feedback.

## Independent oracles and controls

Use `docs/nui1/spec.md` for lexical dependencies, lazy selected branches,
enabled gates, simultaneous immutable carries, indexing, Module ownership and
limit atomicity. `model.ts` computes expected geometry/errors from authored
inputs. `oracles.ts` independently checks those expectations; its carry result
uses closed-form prefix sums rather than the generator's iterative updates.
Compiler/TS/Rust output is never an oracle input.

E uses exactly two asymmetric Module instances, a private conditional geometry
or selected collection dependency, exported points, consumers and an independent
consumer. Each source has before-first, first-only, both and independent-success
limit placements. Failure contrasts occur in W1 cell 01 and both W2 cells;
W1 cell 00 is the adjacent two-success contrast, **NOT_COVERED for failure**.
Check exact geometry/owners, atomic snapshots, failed-owner diagnostics and
unaffected independent output, rather than point counts alone. W2 activates
the opposite private branch and first-instance failure/second-instance survival.
Source-only private cache population outside a drawable limit is not itself
drawable leakage or a normative failure.

C uses scalar **and** `number[]` carries, an inner value-collection for (A also
has an inner statement-for), lazy if or exhaustive choice match, indexed incoming
and final observers. W1 uses 1/2 iterations; W2 uses 0/2 and starts at 3 rather
than 1. The two-iteration case distinguishes incoming snapshots from stale
initializer/frame reuse. Check exact generated occurrence paths, final scalars, compiler/wire
carry identity and exact scalar observer dependency edges. Zero iterations prove
initializer preservation, **NOT_COVERED for body/inner-control activation**.
Collection references remain in the existing collection/carry plans; do not
invent scalar binding edges for a collection that is not a scalar graph node.

D checks both selected/unselected division-by-zero branches, independent scalar
and geometry failures, disabled Module/ancestor, diagnostic codes/binding owners,
dependent suppression and an independent survivor. Preserve the match
scrutinee's required edge as well as its lazy conditional branch edges. T changes
only unrelated declaration order and legal forwarding. W2 swaps selected failure
assignment and uses disabled ancestors throughout.

G requires an actual lexical Module-in-statement-for call, its exact Module
private conditional value and lazy scheduling owner, 1/2 executed occurrences,
export and downstream consumer rows, and an independent external point.
Static lazy flags alone do not establish activation. Check private conditional
value identity/value and real output occurrences. A forwarded alias need not
duplicate the canonical conditional value's cache entry.

For authentic F04 sensitivity, clone the test payload and change **only** the
Module-private conditional construction's `lazy: true` to `false`. Do not alter
production code, eligibility, dependencies, gates or other aliases. In the clean
payload all expected outputs must exist. In the injected active payload detect
lost exports/consumers while the external control survives. The zero-loop
negative must retain identical drawable geometry/errors and no Module execution.
The injected zero-loop TS cache may emit a private diagnostic; record this
diagnostic side channel separately, not as activation/output detection.

Score semantic PASS independently from activation/sensitivity PASS. Use
NOT_COVERED for absent activation. If only the lazy-owner boundary changes and
outputs remain protected, record **BOUNDARY_DETECTED / OUTPUT_NOT_DETECTED**.
Never count seeded F04 as a novel family. This run detected real downstream
output loss in all 12 active G programs in both runtimes, with three passing
zero-loop drawable negatives. That improves on Stage 4's uncovered/masked F04.

## Runnable batch replay

From the repository root with its installed dependencies and Rust toolchain:

```sh
ISSUE1423_MODE=prevalidate ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-replay \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
ISSUE1423_MODE=W1 ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-replay \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
ISSUE1423_MODE=W2 ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-replay \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
ISSUE1423_MODE=G ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-replay \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
ISSUE1423_MODE=verify ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-replay \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
node test/fixtures/issue-stage5/summarize.mjs /tmp/nuinui-stage5-replay
```

These commands were replayed as batches in this campaign; all five phases and
the reducer were tested. The reducer writes compact evidence in this fixture
directory: use a task-owned checkout and review the generated diff. Raw envelopes
and per-attempt records remain under the chosen `/tmp` directory. A fresh replay
has its own prevalidation/attempt telemetry and does not replace historical
campaign evidence. The historical 33 rejected attempts are retained in
`telemetry.json`; a fresh prevalidation has no rejected final sources.

W1/W2/G modes enforce the frozen initial production-owner fingerprint, so a
future repaired tree must use `verify`, not masquerade as an initial baseline.
In a new campaign, run `freeze` only after compiler-only legality succeeds and
only when that campaign has no existing freeze; this runner refuses to overwrite
the Stage 5 freeze. Freeze W2 before W1 outcomes and publish W1's choice/prediction
in the Issue **before evaluating W2**. `prediction.json` links the actual
[pre-W2 checkpoint](https://github.com/sayosomi/nuinuiCAD/issues/1423#issuecomment-6266621585).
The committed freeze and W1 evidence were pushed at
`1ccd0818fe1a514a526233f069bea9a9a8789d6e` before that checkpoint.

For a focused replay of an already frozen source:

```sh
ISSUE1423_MODE=verify ISSUE1423_IDS=W1-C-B-01-S,W1-D-A-00-S \
  ISSUE1423_EVIDENCE=/tmp/nuinui-stage5-focused \
  npx vitest run test/issue1423EvaluatorStrategyRust.integration.test.ts
```

The production `RustEvaluationProcess` runs the real persistent stdio binary.
Each build is bounded to 120 seconds, each request to 20 seconds, the process
to ten minutes, and teardown to five seconds. Close/error listeners precede
transitions and expected teardown errors are consumed. Actual resource failure
stops the campaign; a watchdog is not a reason to retry until green.

## Continue, switch, triage and stop

Continue through the closed matrix while processes progress and ownership,
baseline identity and independent oracles remain valid. No filler is needed
after a resolved zero-family matrix. The ceiling is 240 distinct **new accepted
source texts**, not requests; reruns and old regressions do not spend capacity.
Count accepted reductions/controls by exact hash, and retain rejected attempts.

Switch a provisional first method after independently confirmed novel-family
evidence or demonstrated activation/sensitivity failure. Prefer a different
already-frozen arm before generating another input. With equal zero-family
yield and unavailable quota attribution, retain a provisional choice without
claiming it is better. Do not tune held-out W2 from W1 failures.

For each novel suspicious mismatch: reproduce at the current revision; calculate
expected behavior independently; establish an adjacent true PASS; minimize the
legal source; locate the first incorrect compiler → payload → TS → Rust
producer; preserve FAIL-before; repair only that authorized producer; add a
focused regression; prove PASS-after in TS and normal eligible persistent Rust;
recheck every potentially contaminated cell. A shared first producer is one
family, including downstream repair completion. Do not repair TS/Rust consumers
to compensate for a compiler loss or bypass host eligibility to claim parity.

Stop with a safe pushed checkpoint on unknown/ambiguous oracle or first owner,
uninstantiable required legal shape, conflicting checkout/audit/E2E ownership,
actual hang/resource exhaustion/nonprogress, exhausted accepted-source budget
before required completion, outside-owner/semantic change, or invalidated
W1/W2 comparability. Preserve BLOCKED/UNRESOLVED/CONTRACT-INVALID outcomes. Do not
reset/stash/rebase/force, change the normative oracle to pass, or widen the matrix.

## Quota, overhead and confidence

`quota.json` preserves Human text verbatim: before **28% weekly / 97% five-hour**,
relative resets **in 5 days 13 hours / in 4 hours 58 minutes**, observation date
**2026-10-19 JST**; after **27% weekly / 87% five-hour**, and explicit confirmation
that no other Codex/Work usage overlapped. Displayed net movement is **1 weekly
point and 10 five-hour points**. It is not a token percentage.

Exact observation times and after reset displays were not supplied. The short
same-session interval and before relative resets are consistent with unchanged
windows, but cannot independently establish reset identities. Accordingly the
strict attributable denominator is **UNAVAILABLE**. The first snapshot occurred
during setup and the second before final gates, so these are not complete
Stage 5 costs. Integer rounding also leaves roughly 0–2 weekly and 9–11 five-hour
points uncertainty around the displayed deltas. There are no method-isolated
snapshots and common setup/oracle/correction effort is unallocated.

When a future run has valid isolated observations in the same reset windows,
calculate before remaining minus after remaining in percentage points; report
absolute novel fixed families and cost alongside their rate. Weekly is primary,
five-hour secondary. Never divide by a displayed zero delta or substitute
milliseconds, source counts, test counts, elapsed time or estimated tokens.
Actual tokens here are UNAVAILABLE. Collect only one Human before/after pair
unless method snapshots are naturally available without interrupting a batch.

`telemetry.json` records accepted/rejected texts, compiler/TS/Rust requests by
method/phase and observable instrumentation retries. G diagnostic/cache and D
match-edge assertion corrections are explicit agent overhead, not product
discoveries. No new token-accounting infrastructure is introduced. Load task
authority once, reuse context, run deterministic batches and inspect long traces
only for a real discrepancy; retain large raw evidence outside Git.

## Prediction audit, false negatives and limitations

W1 and W2 each produced zero novel families in every method. W1 predicted
all-method W2 semantic PASS/zero yield; all 18 W2 cells passed with changed E/C/D
activation. This **replicates the narrow semantic prediction**, not a discovery
ranking. Overall method-efficiency classification is **INCONCLUSIVE**:
REPLICATED would require isolated quota support and held-out effectiveness for
the predicted choice; PARTIALLY_REPLICATED would require only some supported
strata; NOT_REPLICATED would require a valid contradicted comparison. Missing
cost attribution and zero comparative yield do not establish any of those.

Stage 4 found six families using 88 accepted exploratory texts but did not measure
Codex quota. Stage 5 used 87, found zero, retained its provisional E=B/C=B/D=C,
and closed the G activation/sensitivity gap. Neither source-normalized yield nor
milliseconds can establish an efficiency change between those stages.

This matrix cannot exclude faults in other semantic shapes or more iterations.
E W1 success contrasts do not activate failure; C zero-loop cells do not activate
inner control. F04 is the only seeded sensitivity family here; clean E/C/D PASS
does not prove sensitivity to every historical defect. G private cache occurrence
identity is reused across iterations; exact generated output rows establish each
iteration rather than claiming a separate cache record per iteration. Diagnostic-
only mutation effects may be false positives for activation. All tested sources
were normally Rust-eligible; no unsupported source was forced through the host.
The carry probes read an incoming array into scalar `next`, but a hypothetical
sequential implementation that updates the scalar before the array could still
pass these particular inputs; no mutation-sensitivity claim for that ordering is
made. F04 output sensitivity does not establish carry-fault sensitivity.

No nominal records, optionals/structured transport, imports, #1260 residual
matrix, new syntax/spec changes or Stage 4 forward-dependent numeric-site repair
is included. The existing suspect remains unchanged at
`../issue-stage4/out-of-scope-suspect.json`, source SHA-256
`bc42f7b2175d40a1668140778932c0aa9dbc3d1c03f06f4510795b76ffa4f6dd`.
Stage 3/4 fixtures remain intact. No new product defect was confirmed, so no
producer repair or minimized novel-bug regression is claimed.
