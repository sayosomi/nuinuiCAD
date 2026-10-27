# Issue #1470 Bezier conformance result

Base: `b1f9a32c1b18890729895c1157884e3a72f70cb3`.
Branch: `sayosomi/issue-1470-bezier-derived-geometry`.
Tested implementation/test commit: `a2ebc6682e1a3d78173970121cf01acc08786baa`.
The final pushed commit and clean checkout proof are recorded in the canonical
[Issue checkpoint](https://github.com/sayosomi/nuinuiCAD/issues/1470).

## Scope and dispositions

20 distinct accepted ordered exploration units / 34 ceiling: 18 primary plus
X1/X2; 56 source revisions. Original unsupported C6 sources are retained and
excluded from accepted-input counting. Reruns, controls, existing tests and
full gates are verification, not additional exploration units.

| Unit | Disposition and evidence |
| --- | --- |
| E1 | BASE_PASS: asymmetric interior maximum, handle-length source change |
| E2 | BASE_PASS: both stationary roots and endpoints compared; direction change |
| E3 | BASE_PASS: 90 → -270 → 450 preserves the point with current revisions |
| E4 | BASE_PASS: separate t=.01/.02 maxima remain interior |
| E5 | BASE_PASS: flat projection returns B(.5), not the endpoint midpoint |
| E6 | BASE_PASS: split tail segment 0 → 1 → trimmed 1 → extended 1, translated named stage |
| B1 | BASE_PASS: asymmetric unsigned bulge and translated source |
| B2 | BASE_PASS: unequal S-curve absolute bulges and reversal |
| B3 | BASE_PASS: equal opposite-side bulges, center/smaller-t tie and reversal |
| B4 | BASE_PASS: nonlinear chord-collinear B(.5), with changed end coordinate |
| B5 | BASE_PASS: segment 1 → out-of-range 2 → fractional .5 → recovered 1; no stale point |
| B6 | BASE_PASS: pure Module local/exported values, drawable materialization and sibling isolation |
| C1 | BASE_PASS: asymmetric convex → concave, opposite physical normal |
| C2 | BASE_PASS: reversed evaluated curve preserves physical sides |
| C3 | BASE_PASS: independently frozen extreme/bulge bases feed projection and normal |
| C4 | BASE_PASS: on-curve → off-curve .1 mm in Y → recovery; current owner error |
| C5 | BASE_PASS: adjacent finite-curvature control, true inflection, zero tangent, ambiguous join, negative/zero distance and recovery |
| C6 | Original CONTRACT_INVALID; supported equivalent BASE_PASS: Module transform/split/reverse named-stage pure value and isolated argument change |
| X1 | BASE_PASS: Module pure bulge segment failure/recovery; value occurrence error, no synthetic point, sibling preserved |
| X2 | BASE_PASS: pure offset on-curve/off-curve/negative-distance/zero-distance/recovery |
| X3–X8 | NOT_TRIGGERED |
| R1–R8 | NOT_TRIGGERED |

X1 was triggered because B5 exercised drawable errors while B6 exercised pure
success, leaving the occurrence-owned pure Module failure channel unmeasured.
X2 covered the analogous pure curvature-side invalidation/recovery boundary
left by C4/C5 drawable errors. Neither counterfactual revealed a product defect.

**Distinct new defect families: 0. First incorrect owners: none established.**
There are no product repairs, Base FAILs or repair-removal results to claim.
All legal neighbors and sealed expected successes/errors passed against the
unchanged Base implementation. This result is limited to the closed campaign.

## Frozen independent evidence

Original sources/oracles were sealed in `251574a7311c998c55f18cd123f9b87c063ea119`
before exploratory compilation/evaluation. The original `manifest.json` is
unchanged. It contains exact source SHA-256, revision transitions, selected
segments/stages, control points, candidate scores, derivatives, tangent/normal,
expected diagnostics and 1e-7 mm tolerances. `freeze.py` uses only Python's
standard library: direct Bernstein coefficients, a stable analytic quadratic
formula, de Casteljau subdivision and signed derivative frames. It does not
call the product compiler, TypeScript evaluator or Rust evaluator.
An isolated reproduction regenerated all 49 original source/manifest artifacts
byte-for-byte. All 58 frozen source checkpoints (including rejected originals
and supported equivalents) retain their sealed hashes.

Examples from the sealed oracles:

- E1 initial control points (0,0), (3,36), (31,12), (40,0): projection derivative
  216t²−360t+108, interior maximum t=.3923747814892349, point
  (12.420214841414154, 19.01350611830142); both endpoint scores are zero.
- E2 stationary scores −2.517755255658134 and 9.284576188374404, with endpoint
  scores 0 and 2, independently distinguish the global maximum from first root.
- E5/B4 final B(.5).x=9 while the geometric chord midpoint x=24.
- B3 candidates t=.2113248654051871/.7886751345948129 have unsigned distance
  6.92820323027551 mm. Reversal reselects smaller local t; an equal-distance
  physical point may switch sides as required by the normative parameter tie.
- C1 at t=.37: B'=(46.4292,4.3704), B''=(52.32,−200.16), signed curvature
  −.093886811643274, convex unit normal (−.09371614594799851,.9955989574063713).
  A 3 mm convex offset is (11.087619562156004,21.951812872219115).

Production evidence follows exact source → canonical compiler →
`buildEvaluationOptions` → normally eligible `prepareRustEvaluation` →
`evaluatePreparedRust` → one persistent production `evaluation_stdio` child.
The permanent integration test checks source hash/revision, typed geometry,
error owner, withheld invalid geometry/value, selected control points, pure
occurrence identity and sibling isolation. TS reference results are a separate
control against the same independent expectations, never the truth oracle.
The final gate campaign recorded one spawn and 56 persistent requests, all PASS.

26 checkpoints reject deliberately incorrect endpoint/midpoint/normal oracles
using the same numeric assertion as the positive checks; the exact intentional
assertion failures are retained for both persistent Rust and TS reference.
There are no hidden test skips or relaxed numeric assertions. The focused
checked drawable/control coordinates differed by at most 2.132e-14 mm.

## Unsupported input and harness corrections

C6's original Module `split(at: (coordinate expression))` is rejected with
`module-geometry-type-mismatch`. It is CONTRACT_INVALID, not a numerical bug.
Supported `C6-supported-*.nui` replaces that argument with a Module-local
coordinate point reference. Geometry and mathematical expectations are
unchanged; both equivalent sources were committed before their execution in
`6e14022b`. The integration test preserves and asserts the original rejection.
No syntax or public semantic change was made.

All failed preliminary harness runs are retained, with explicit causes:
fixture URL resolved against the jsdom origin (zero Rust requests); wrong
initial revision setup (zero Rust requests); original unsupported C6; and X1
lookup confusing a runtime instance ElementId with its canonical statement ID.
The final harness uses canonical statement/occurrence identity. These are not
product defect families. The first Rust tangent test filter matched zero tests;
the corrected existing test-module filter executed and passed all 11 tests.
No failed gate or detector result is silently converted to PASS.

## Verification and resources

Focused verification: 7 TS/source-backed test files, 141 tests PASS; Rust Bezier
feature-point 12 tests PASS; Rust tangent-offset 11 tests PASS. The campaign
integration file contains 21 tests (20 accepted traces and preservation of the
unsupported original C6 source). Exact commands/logs/results are in evidence.

The required final serial gate and its exact results are recorded below.
All commands run in the declared implementation checkout. The gate has a 3600s
wall limit, 12 GiB aggregate descendant RSS watchdog, 128 MiB log limit,
Node heap limit 4096 MiB and two Cargo build jobs. Focused runs have finite
300s subprocess limits, 120s stdio build and 15s request/close bounds. Error and
close listeners precede lifecycle transitions; owned Rust children close after
each run. No Human E2E helper, extra worktree or production host was used.

## Changed owners and remaining limits

Only `test/issue1470BezierConformance.integration.test.ts` and
`test/fixtures/issue-1470/**` changed: permanent source-backed regressions,
independent source/oracle seals and compact evidence. Production source and
build-input Git objects exactly match Base (see `base-source-proof.json`).
No new abstraction or production parser/resolver/evaluator was introduced.
Architecture and the normative/public DSL contract are unchanged; the DSL
Reference check is therefore not applicable.

No unresolved mathematical ambiguity was encountered on the discriminating
inputs. Unspecified near-degenerate numerical thresholds, broad fuzzing,
performance, UI interaction and general output/printer behavior remain outside
this campaign. No claim is made about those domains.
Manual E2E: **Not Required** for this host-neutral mission; no Human GUI PASS
was executed or inferred. Human-supplied weekly and five-hour Codex quota
readings: **UNAVAILABLE**.

## Final required serial gate

Executed once in this exact order; every command exited 0.

| Command | Exit |
| --- | --- |
| `npm run build` | 0 |
| `npm run lint` | 0 |
| `npm test -- --maxWorkers=2 --no-file-parallelism` | 0 |
| `npm run test:parity` | 0 |
| `cargo fmt --manifest-path rust-evaluator/Cargo.toml -- --check` | 0 |
| `cargo check --manifest-path rust-evaluator/Cargo.toml` | 0 |
| `cargo test --manifest-path rust-evaluator/Cargo.toml` | 0 |
| `cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings` | 0 |
| `cargo build --manifest-path rust-evaluator/Cargo.toml --bin evaluation_stdio` | 0 |
| `git diff --check` | 0 |

Full npm suite: **695 files / 11,204 tests PASS**; baseline configuration reports
2 files / 187 tests skipped. Our 21 tests all execute and pass. Parity:
**207 tests PASS**. Rust: **618 library + 6 stdio + 1 integration tests PASS**,
9 existing ignored library tests; zero failing tests. The DSL Reference check
was not run because source language/public semantics did not change.

Gate duration: 669.693 seconds. Peak monitored aggregate RSS: 2,528,944 KiB
(about 2.412 GiB), below the 12 GiB ceiling. No timeout/resource/log limit was
triggered. The exact serial command, stdout/stderr, gate results, final campaign
observations, independent reproduction and Base source proof are retained in
[evidence/](evidence/); `index.json` hashes compressed and uncompressed bytes.
No `evaluation_stdio` process remained at post-gate inspection.

No required gate was omitted, renamed, reordered or retried. Only documentation
and captured evidence were added after this gate; a final `git diff --check`
and diff review cover that addition. The reviewed implementation/test commit
and all production source remain unchanged by the evidence commit.
