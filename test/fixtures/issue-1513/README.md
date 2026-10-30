# Corner-radius transaction conformance (#1513)

Reusable CLI-only fixtures and evidence for Base
`ebdcdce00727d291067ac6f20b295466caf04843`. Run
`python3 test/fixtures/issue-1513/oracle.py` to reproduce the sealed sources
and numerical expectations, then
`npx vitest run test/issue1513CornerRadiusConformance.integration.test.ts --maxWorkers=1`.
The runner uses canonical compilation, normal production lowering, one real
persistent Rust process, and the TypeScript reference secondarily. It checks
compiler acceptance, Rust eligibility, owner identities, diagnostic ownership,
finite payloads, original source publications, downstream consumers and recovery.
It waits for child completion before recording results.

## Findings and causal repairs

1. **Dual-trim atomicity:** both corner evaluators published the first trim
   before discovering that the second trim would collapse its owner. F1's
   original A length 100 became 90 while B stayed 10 and R failed. Reducer1
   independently reduces this to lengths 20/3 and radius 3 (A incorrectly 17).
   X4/X5 reach the same producer with a sampled Bezier as either source.
   Prepare both candidate trims using the existing pure trim helpers, then
   publish only after both are valid. No compiler/transport/trim algorithm
   change is necessary.
2. **Final invalid-arc guard:** a positive radius `5e-8` reaches the existing
   coincident-endpoint diagnostic after publishing both source trims and R.
   The outer evaluator already removes R on error, but leaves the trims.
   Reducer2 independently uses radius `2e-8`, lengths 14/7. Keep the established
   diagnostic and radius policy; run the existing guard before any publication.

Only `src/geometry/cornerRadiusArcEvaluator.ts` and
`rust-evaluator/src/evaluation/corner_radius_evaluator.rs` change production
behavior. Both are the original incorrect producers. The Rust unit test,
canonical integration test, fixtures and implemented DSL reference verify and
describe the repair. No new architecture, API, dependency, host or language
syntax is introduced; `ARCHITECTURE.md` and the normative spec stay current.

## Matrix and budget

There are **16 primary slots, 5 adjacent slots, 2 reducer slots**. R1 has three
sealed revisions, R2 two, R3 two, and C4 two: **28 distinct accepted source hashes** out
of the 28 ceiling. Re-execution and counterfactuals do not consume new units.
X6 and Reducer3–6 are NOT_TRIGGERED. All sources compile without diagnostics
and are normally Rust eligible. Final execution: 28 persistent requests,
56 independent Rust/TS oracle comparisons, one process, all PASS.

| Slots | Disposition | Discriminator |
| --- | --- | --- |
| S1–S4 | PASS | asymmetric right angle, acute, reversed obtuse, downstream properties |
| F1 | REPAIRED | second collapse: both complete source objects unchanged; R and dependent Consumer absent |
| F2–F4 | PASS | first collapse, overlarge radius, noninteger index; no source mutation |
| C1 | PASS (approximate) | genuinely curved cubic, interior trim, Bernstein locus, integrated retained length and tangent residual |
| C2 | PASS (approximate) | source arc, exact circle tangency oracle, retained locus and directed sweep |
| C3–C4 | PASS | segmented offset, then two Bezier owners, including a genuinely curved pair; ordered retained primitives |
| R1 | REPAIRED | valid → collapse → valid, stable reconciled identity, no stale trim/arc |
| R2 | PASS | endpoint/dimension revision, changed tangencies and both retained lengths |
| R3 | PASS | immutable base/named/final; strengthened revision distinguishes lengths 100/120/110 |
| R4 | REPAIRED | two independent groups: one fails while the other succeeds, distinct owner IDs |
| X1 | REPAIRED | final coincident-endpoint guard, exact unchanged geometry |
| X2–X3 | PASS | disabled corner and unavailable source controls |
| X4–X5 | REPAIRED | first / second source sampled-Bezier trim failure |
| Reducer1–2 | REPAIRED | independent minimal three-declaration failure cores, plus unchanged sibling control |

C1 checks the *continuous input cubic* tangent residual within 0.04 radians,
endpoint projection within 0.25 mm, and converged independent length within
0.3 mm. Its materialized sampled path is a sequence of straight segments;
these checks do not assert exact smooth-curve preservation or exact tangency
of the final short chord. C2 uses radius 1,000,000 mm and sweep 0.01°: its
chord sagitta is bounded by 0.00381 mm. The exact internal circle-tangency
oracle is checked within 0.002 mm / 0.02°; all retained vertices are within
0.004 mm of the source circle. These are explicit approximation controls,
not a new fillet policy. Straight constructions use 1e-7 mm / 1e-6° checks;
failed source objects are additionally compared exactly with their original
pre-mutation publication, including metadata.

## Evidence and counterfactuals

`verification/pre-execution-seal.json` predates first product evaluation.
The adjacent, stage and curved seals separately precede newly admitted inputs.
The original primary oracle, manifest and runner are also retained compressed,
reconstructed and verified byte-for-byte against the initial seal hashes.
`oracle.py` imports no product code. `manifest.json` holds source SHA-256,
expected outputs/errors and tolerances. Full canonical payloads, owner IDs,
source revisions, results, binary identity and production diffs are retained
in the compressed run records.

- `base.json.gz`: initial full matrix. X3 initially exposed an overly generic
  diagnostic-text assertion, corrected to the established disabled-source
  wording. X1 initially fell inside the general numeric tolerance; exact
  source-object equality and stricter tolerances expose that mutation on the
  same input. Neither harness calibration is reported as a product defect.
- `base-strengthened.json.gz`: independent Base repeat, five failing slots
  (F1, R1, R4, X1, Reducer1); nearby controls pass.
- `base-complete.json.gz`: original production bytes replayed with the added
  curve discriminators/reducer. Eight failing slots: F1, R1, R4, X1, X4, X5,
  Reducer1, Reducer2. Other executed slots pass.
- `remove-atomicity.json.gz`: final invalid-arc guard remains fixed; removing
  only dual-trim atomicity restores F1/R1/R4/X4/X5/Reducer1 failures in both
  engines, while X1/Reducer2 pass.
- `remove-final-guard.json.gz`: atomic trim preparation remains fixed;
  restoring the late guard restores only X1/Reducer2 failures in both engines.
- `matrix-final.json.gz`: both fixes restored; all 27 revisions pass both
  engines, including the stronger stage discriminator added afterward.
- `matrix-28.json.gz`: final 28-source matrix, including two genuinely curved
  cubic owners in C4. Their unique intersection uses independent Newton
  iteration, two-ray normal offsets, converged 20000/40000 integration and
  continuous-curve tangent residual below 0.001 radians; retained-length
  comparison permits 0.02 mm for the sampled paths. All 56 engine checks pass.

`counterfactuals.py` restores the fixed production bytes in `finally` and
records source hashes and expected failing exits. It is a deliberate mutation
experiment; run it only in an owned implementation checkout. Each controlled
removal returned exit 1 as expected; restored focused execution returned 0.
The initial new Rust test needed `cargo fmt`; the final formatting gate passes.

`verification/verify.py` contains bounded final gate commands; compressed logs
and JSON exit records retain their actual execution. `tested-source-sha256.json`
binds the final production/test/fixture bytes. `environment.json` records tool
versions and DSL impact classification. Existing parser, compiler, source
identity, serialization, language queries and native-host behavior are
intentionally unchanged. No GUI or Human E2E result is claimed.

## Final verification

All required commands returned exit 0: build, lint, DSL reference check;
`cargo fmt --check`, `cargo check`, full `cargo test`, and clippy with warnings
denied; full JavaScript regression and TS/Rust parity; final diff checks.
The final fixed-state JavaScript regression has **11,661 PASS / 187 skipped**
(720 passed files, 2 skipped). Rust has **649 PASS / 9 ignored** across library,
stdio and integration targets. Parity has **207 PASS**. Focused corner/source/
eligibility/edge controls have 233 PASS, native corner tests 5 PASS, and the
final 28-source corner run has 56 PASS engine comparisons. The final full JS
regression was repeated after adding C4-curved; final production/test/fixture
hashes remain unchanged. Source/current identity was also independently audited
across revision gaps (`revision-identity-audit.json`).

These are local CLI outcomes. Independent exact-pushed-HEAD review and GitHub
protected CI remain separate gates. No merge or Issue closure is performed.
