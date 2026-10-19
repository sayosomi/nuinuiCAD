# Issue #1421 — harness repair checkpoint

This checkpoint repairs and validates the saved Stage 4 harness only. It does
not complete Issue #1421, confirm new defect families, choose an adaptive method,
or authorize a product repair.

## Baseline and preserved history

- Unmodified product baseline: `bab8313ae08f5e354a6cfd9d7b2ffb8177a15bc2`.
- Preserved pushed checkpoint: `dc5c276c1c7ac0dc5755cc6b5313719eab7cdba2`.
- Branch: `sayosomi/issue-1421-evaluator-strategy-stage4`.
- The original three files remain available at the preserved commit. Human's
  original `/tmp/issue1421-freeze.log` and `/tmp/issue1421-pilot.log` were not
  changed. Their failed pilot is not comparison evidence.
- No production source, specification, dependency, CI, or Stage 3 test changed.
  All three methods ran against the same original product implementation.

## Harness corrections and authority

The old E source `point Fault(enabled: @Fail) = ...` compiled as a point named
`Fault(enabled: @Fail)`, with no computation gate. Every instance therefore
failed, including both supposed successful controls. The replacement is a legal
statement conditional `if (@Fail) { point Fault = ... }`. This preserves the two
asymmetric healthy instances, failed-instance contrast, consumer, and four limit
placements. Prevalidation now checks the exact Fault declarations and their
canonical conditional parents as well as compiler validity.

Stage 3's compiler helper assumes every omitted geometry-value program has a
specific Stage 3 path tag and a directly disabled Module. Stage 4 D also has a
disabled ancestor. Its check now verifies the exact canonical occurrence,
Module owner, and disabled owner/ancestor chain without that unrelated path tag.
C continues to use the full Stage 3 carry/identity checks. D additionally checks
the complete surviving geometry set and absence of the disabled export.

The normative specification's “Immutable single-geometry reference values”
section distinguishes source-only immutable values from drawable elements. The
old assertion applied a drawable limit to all private immutable cache entries;
the specification does not establish that cache population rule. The corrected
checks retain exact drawable/export/consumer sets and coordinates, exact error
owners, complete instance snapshot contents, and rejection of Module-owned
value errors. A root source-only alias of an excluded export may report the
existing unavailable-reference class, with its exact authored owner checked.
The cache and alias observations remain in the raw evidence; they are not
counted as product defects merely because they differ from drawable limits.

Compiler, preparation, reference execution, and Rust execution failures are
recorded separately. The source, expectation, prepared input, and completed
observations survive a later exception. A Rust rejection no longer erases the
passing TypeScript result or prevents the remaining pilot cases from running.
The checked-in accepted-source ledger also survives a new raw-evidence directory.

## Independent expectations and freeze

All 36 final pilot sources are distinct, compiler-valid, and shape-validated.
`pilot.json` freezes the exact sources, hashes, seeds, activation claims,
execution order, generator expectations, and independent calculation.
`oracles.ts` consumes only authored model inputs; it imports no compiler or
evaluator. It agrees with the generator's iterative calculation for every
pilot member before any evaluation starts.

- E calculates each exported point directly from its asymmetric origin and
  declares the exact 0/1/2 successful-instance output sets. The final boundary
  excludes the failed export, consumer, and snapshot, retains its Fault error,
  and retains the independent point.
- C-B uses `t(n) = n(n+1)/2`. Final values are `u+t(n)`, `u+d+t(n)`, and
  `d+n(u+d)+(n-1)n(n+1)/6`; the same closed forms at each earlier index establish
  incoming observation rows independently of the generator's state updates.
- C-A uses the affine odd-iteration update `a -> 4a+2(tick+f)+d` in a weighted
  sum, rather than replaying the generator's two inner updates. C-C uses the sum
  of the first `m` odd integers: final members `u+m²+m(f+d)` and `d+2m²`.
- D separately calculates selected divide-by-zero versus unselected success,
  the independent scalar/geometry failures, surviving point, diagnostic binding
  owners, and disabled-export absence.

Two independent freeze processes produced the same complete file hash:

`008a55cfd0732f03ce8d891623b1421a80ca8554bff3b58bdc220073611db7b1`.

Only a fully successful legality/shape/oracle check can replace `pilot.json`.
An intermediate shape check used an incorrect host type spelling; that freeze
failed without replacing the artifact, and the corrected canonical-parent check
then passed. No rejected run is an evaluator PASS.

## Corrected pilot

| Method | Accepted sources | Compiler / TS / Rust requests | PASS sources | Unresolved sources |
| --- | ---: | --- | ---: | ---: |
| A | 12 | 12 / 32 / 32 | 7 | 5 |
| B | 12 | 12 / 32 / 32 | 7 | 5 |
| C | 12 | 12 / 32 / 32 | 11 | 1 |

There are **11 PASS cells / 7 UNRESOLVED cells**, or **25 PASS sources / 11
UNRESOLVED sources**. The verification file therefore reports **12 passing tests
/ 7 failing tests**, including the passing freeze-consistency test. Every source
is normally Rust-eligible. All 96 reference requests returned; 93 of 96 real
persistent Rust requests returned payloads and three returned the retained wire
validation error. No normal-host eligibility bypass was used.

An independent process repeated all 36 exact sources. Statuses, geometry,
diagnostics, scalar observations, and snapshot contents matched after generated
identity normalization. Each E source also exercises full → zero → full replay
inside the persistent process. Expected results were not changed to make a
product discrepancy pass.

| Observation, not a confirmed family | Exact affected members | First incorrect observed boundary | Passing contrast |
| --- | --- | --- | --- |
| P1: conditional owner | E-A-00 S/T; E-A-01 S/T | TS and Rust mark Failed::Fault inactive despite the correctly wired true Fail parameter. Failed::Mark, UseFailed, and its snapshot survive; its expected Fault diagnostic is absent. Producer ownership is not isolated. | Healthy E-A placements; E-C-00/01 preserve the failed-instance contrast correctly. |
| P2: collection readiness | E-B-00 S/T; E-B-01 S/T | TS fails to materialize the Module's Chosen geometry value and then reports unavailable Mark consumers. Rust produces the independently expected successful exports from the same input. The alias member's Module-owned value errors are retained as related symptoms. | Rust evaluation of the same sources; E-C's direct point values. |
| P3: wire order | D-A-01 T; D-B-01 T; D-C-01 T | Prepared binding versions have adjacent equal sourceOrder values, including an append-catalog Module parameter. Rust rejects the wire with scalar-payload-invalid-source-order before evaluation. Whether the producer or append validation is defective is not yet isolated. | Each corresponding S member; TypeScript matches each T oracle. |

`pilot-results.json` retains each exact source/hash/expectation reference into
`pilot.json`, both runtimes' relevant actual results, replay results, and boundary
evidence. A `sameSemanticResultAs` or `sameAsObservation` entry explicitly reuses
an identical result, rather than omitting an observation. Raw payload hashes and
generated identity slices preserve the link to the larger raw logs.

All three observations remain **suspected product defects**. There is no
independent minimized reproduction, producer fix, or FAIL-before/PASS-after
repair proof in this continuation. Confirmed new families: **0**; fixed new
families: **0**. No method yield or winner follows from the different numbers of
passing inputs. F01/F04 sensitivity holdouts and adaptive selection remain
outside this checkpoint.

## Verification and measurement limits

- Latest required freeze: PASS, 36/36 final sources accepted; no rejections.
- Latest required pilot: FAIL with the seven classified cells above; all 18
  pilot cells executed against the unchanged baseline.
- Freeze reproducibility and a separate-process pilot replay: matched.
- Existing Stage 3 X02/X05/X07 calibration and regression file: 75/75 PASS.
  The initial test-name filter also matched the enclosing suite, so the entire
  existing Stage 3 file ran. Those are mandatory-existing inputs, not novel
  Stage 4 exploration or new families.
- `npm run lint`: PASS. `git diff --check`: PASS.
- Production build, full-suite, parity-suite, Rust source gates, DSL-reference
  gates, and Human E2E were not required for this test-only repair checkpoint.
  They remain applicable to a later product repair/full Stage 4 completion.
- `accepted.sha256` contains 48 globally distinct accepted exploratory texts:
  the original 36 and the 12 corrected E sources. Exact reruns consume no novel
  capacity. The 200-source ceiling has not been approached.
- `manifest.json` records the latest run counts and durations;
  `pilot-results.json` records the initial corrected comparison and independent
  repeat. Probe timings exclude import/generation and share startup overhead;
  they are not end-to-end method-efficiency measurements. Agent token usage and
  complete phase-effort accounting are unavailable.
- No platform operation was blocked. Larger raw evidence remains under the
  `/tmp/issue1421-harness-*` directories listed in the manifest. The original
  failed checkpoint and diagnostic runs are excluded from method comparison.

## Next safe step

Stop here. Keep the Issue open and retain the pushed repair checkpoint. A
separately authorized product-triage continuation can independently reproduce
and minimize P1/P2/P3, establish the defective producer boundary, and obtain
repair authorization under its contract. Do not adapt the matrix, count new
families, or start the full autonomous Stage 4 campaign from this checkpoint.
