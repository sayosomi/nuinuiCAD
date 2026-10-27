# Stage 3 detector calibration and repair evidence

Contract: [#1419](https://github.com/sayosomi/nuinuiCAD/issues/1419).
Base: `0e37653056be4389e806122b2f152c989d378622`.
Branch: `sayosomi/issue-1419-detector-calibration-stage3`.

The immutable 64-ID manifest, semantic contracts and successful calibration were
committed and pushed in `77d536ec` before any novel exploratory compilation.
`manifest.json` remains unchanged. The harness reuses fast-check shrink/replay,
the canonical compiler, reference evaluator and existing persistent Rust client.
It checks the actual Node-to-Rust stdin envelope; TypeScript parity is not its
expected-value oracle.

## Calibration contrasts

Each historical reduced source is retained in `../issue1412/adjacent.json`.
Both uncorrupted evaluators return independently expected **16 degrees**:
`acos(abs(cos((23 - 7) degrees)))`, with the difference strictly inside 0–90.
Each test first checks that value and then mutates only its test-owned input.

| Control | First incorrect boundary asserted | Negative semantic result in both evaluators |
| --- | --- | --- |
| X02 | A deferred child carry reference loses its owning immutable-for plan while its parent still forwards that identity | Expected 16 fails; result is `evaluation-geometry-builtin-unavailable` |
| X05 | An already qualified indexed forwarding carry binding/statement identity receives another Module qualification | Expected 16 fails; result is `evaluation-geometry-builtin-unavailable` |
| X07 | The dependency edge to the later-source-fenced predecessor is removed despite its earlier dependency rank | Expected 16 fails; result is `evaluation-geometry-builtin-unavailable` |

All three additionally assert the exact immutable-value error
`Geometry value reference is unavailable at runtime.` and their distinct
boundary assertion text. These are real plan/identity/readiness corruptions,
not injected exceptions. No vulnerable revision or production corruption is
used. [calibration-proof.json](calibration-proof.json) records the contrasts;
the executable assertions are in the integration test. Calibration contributes
zero novel discoveries.

## Confirmed repairs

Five baseline producer families were found and repaired. Seven reduced
reproducer/control pairs remain in [regressions.json](regressions.json).
[repair-proof.json](repair-proof.json) records independently expected values,
the accepted failing source, actual pre-fix results, first incorrect boundary,
and passing controls and repaired results.

| Family | Independent contrast and first loss | Narrow repair |
| --- | --- | --- |
| F01 | Nested source `[2]` selects correctly, but a conditional source or literal member depending on the outer frame returns an unavailable scalar instead of **3** in Rust | Preserve the existing frame's visible bindings for collection length/index reads |
| F02 | Direct `@Points[0]` works; an immutable conditional point forwarding that carried member loses its compiler program and then its consuming frame, instead of point **(3,4)** | Preserve the canonical carry collection target; materialize existing lazy programs with the consuming frame in TS/Rust |
| F03 | A map-based replacement reaches **5**; a literal replacement naming the local immutable member loses that value when the frame retires | Freeze literal binding members in the existing collection snapshot in TS/Rust |
| F04 | An empty statement-for must execute no Module value program and emit no value error | Mark Module descendants of lexical loop call sites as frame-owned lazy values |
| F05 | A direct point consumer works; a generated Module export consumer cannot find its invocation and omits independently expected **(1,17)** | Apply the existing current/ancestor invocation map to drawable input targets in TS/Rust |

F06 is a repair follow-on grouped with F04: after frame-owned execution, Rust's
later document cursor could append a second `skipped-control` history record for
an already executed Module parameter. Preserve that first completion, as the
existing reference evaluator does. The reduced source and exact duplicate IDs
are retained. It is **not** counted as another independently demonstrated
baseline family. F02 likewise retains the compiler and consuming-frame losses
as one producer family, rather than inflating the count by symptom.

Production changes stay within lexical/Module compilation, typed carry lowering,
reference geometry/scalars and Rust evaluation. Rust state-literal fixture edits
only initialize the derived lazy-program index. There is no new scheduler,
resolver, payload contract or runner, and no parser, specification, dependency,
CI or architecture change.

## Closed exploration and oracle

[contracts.md](contracts.md) defines both shapes for R/N/G/D and both transforms.
The first 32 cells (00/01) completed before any 02/03 novel compilation.
[first-probe.json](first-probe.json) records activation, sensitivity, yield and
the frozen-contract refinement: later G cases distinguish analytic lengths
25 and 65, while retaining asymmetric coordinates, stages and owners.

[dispositions.tsv](dispositions.tsv) lists all 64 final outcomes and both source
hashes. [case-evidence.json](case-evidence.json) retains, per A/B and selected
contrast, the independent scalar/collection/geometry expectations, immutable
incoming/next/final traces, activated paths, exact diagnostic owners, production
mode and serialized input hash. `repaired-then-PASS` identifies cells actually
observed failing at a repaired semantic boundary; other passing cells do not
claim an observed pre-fix failure. All final A/B sources are distinct and
separately compiler-accepted, with both evaluators checked against the model.
Final dispositions are **58 PASS and 6 repaired-then-PASS**; BLOCKED,
CONTRACT-INVALID and UNRESOLVED are all zero.

Numeric collection/carry arithmetic uses BigInt; geometry uses analytic endpoint
and Pythagorean expectations. Every collection length/member and every generated
snapshot coordinate is checked, including complete row cardinality. Selected
errors propagate into subsequent incoming snapshots; those generated failed
occurrences have exact dependency/owner assertions and no valid geometry.
Disabled Module errors, dependent suppression and independent scalar errors
have separate exact expectations. Runtime output never computes expected values.

G's path endpoints are rejected by the current *eligibility predicate* when
used as point inputs. This remains honestly recorded as `rustEligible: false`.
Those cases still pass through real persistent Rust using the supported
canonical direct input builder, including carry plans; no fallback or eligibility
repair is claimed.

Rejected exploratory drafts and shrinks are recorded in
[rejected-probes.json](rejected-probes.json), excluded from PASS, discoveries and
accepted-source capacity. Legal typed intermediates/forwarding were used within
the same frozen shapes. The selected-error model initially assumed no later
generated rows; it was corrected to model poisoned incoming values and exact
failed occurrences. That oracle correction is not a product defect.

## Replay, effort and verification

Run `npm test -- test/issue1419EvaluatorBoundaryCalibrationRust.integration.test.ts`.
The default executes calibration, reduced contrasts and all 64 cells, with
00/01 ordered first. Optional `ISSUE1419_IDS`, `ISSUE1419_WAVE=first|later` and
`ISSUE1419_PATH` select an existing cell/wave or fast-check replay path. Seeds
and deterministic configurations are owned by `model.ts`; replay does not
change manifest meanings. `ISSUE1419_EVIDENCE=/absolute/outside/path` appends raw
attempts, request counts and accepted hashes across runs. Its accepted set
enforces the 400 distinct compiler-accepted-content ceiling; exact-content
reruns consume no new capacity.

The existing Rust client has a 10-second request timeout, a bounded build,
10-minute process watchdog, bounded fast-check checks and 5-second teardown.
Close/error listeners precede lifecycle transitions, teardown errors are
consumed, and the process is disposed after every run.

[metrics.json](metrics.json) records exact accepted capacity, compiler/reference/
production request totals, accumulated harness time, verification effort and
defect yield. Counts cover the instrumented #1419 harness, including its final
verification replays, rather than claiming counts inside unrelated old suites.
Large raw logs remain outside the checkout at `/tmp/nuinuicad-issue1419`; their
sizes and hashes are retained. [verification.json](verification.json) records
the mandatory gates, including the initial lint failure and corrected rerun.
There are **198 / 400** distinct accepted exploratory contents and **57**
distinct rejected drafts. Across 39 bounded harness runs, the exact request
totals are **1,711 compiler / 1,722 TS / 1,712 production Rust**. Five confirmed
families per 198 accepted sources is **0.025253 families/source**. Accumulated
measured harness time is **68.073 seconds**. The final gate attempts took
**710.230 seconds** in total; harness time includes verification replays and
overlaps that gate time. These are local execution measurements, not estimates
of engineering time or general performance.

All required gates passed: the specified 12 files / 1,810 tests, parity 203,
build, corrected lint, DSL reference consistency, serial full suite
**663 files passed / 2 skipped; 10,304 tests passed / 157 skipped**, and Rust
fmt/check/test/clippy. Rust tests passed 612 library tests (9 existing ignored),
6 stdio tests and 1 integration test. Strict TypeScript checking also passed for
the new harness/fixtures. The original block stopped on its lint diagnostic;
lint and every remaining gate were then executed successfully in order.

[changed-files.txt](changed-files.txt) lists the complete authorized file set
relative to the exact base. The pushed HEAD is reported in the task handoff;
an exact commit cannot contain its own SHA.

No residual hypothesis is declared complete beyond these 64 cells. Arbitrary
nesting, broader geometry constructions, other guard combinations and host
eligibility remain gaps. #1260 stays open with its other residual scope.
#1194 structured records, optionals and cross-document transport were excluded.
Independent review of the exact pushed HEAD, protected PR/CI and merge remain
separate gates; these implementation results do not certify them.
