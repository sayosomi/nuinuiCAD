# Issue #1493 — Module materialization evidence / reusable fixtures

Base: `7d08c98aca4ae7982679a55f50358ec6f8eaa63b`.
Owner: `packages/nui-language/src/dsl/moduleMaterialization.ts`.
The JSON evidence records the exact production owner SHA-256; `head` alone
is not the candidate identity when measuring an uncommitted authorized repair.

## Frozen oracle and closed ledger

`oracle.json.gz` retains all sources, SHA-256 hashes, ordered runtime entries,
source indices, runtime IDs, parent/instance ancestry, authored geometry,
source-unit ranges and preorder snapshot boundaries. The generator is
`test/issue1493ModuleSupport.ts`; it derives the expected topology independently
of materialization. The oracle was frozen before calling the measured owner.
The M2 draft initially used invalid construction spellings; parser rejection
occurred before freezing or accepting any unit. Corrected source uses the
existing `line segment(start:, end:)` construction.

Accepted: 12 primary + 1 adjacent fixed-count ordinary-point control + 1 minimal
multiple-instance reproducer = 14/24. No other conditional units activated.
M3 uses N/2 outer + N/2 inner instances, N total, 2N runtime entries;
M1 has N root instances and 2N runtime entries. M2 has N instances, each with
a group, two points and a line (5N runtime entries, 3N drawable memberships).

| Unit | Runtime / instances / drawable memberships | Base → fixed map/filter visits | Isolated CPU median (p95), ms: Base → fixed | Whole compile median, ms: Base → fixed | Disposition |
| --- | --- | --- | --- | --- | --- |
| M1-64 | 128 / 64 / 64 | 8384 → 128 | 0.460 (1.125) → 0.209 (0.531) | 15.353 → 15.089 | semantic PASS; avoidable global scan confirmed/repaired |
| M1-128 | 256 / 128 / 128 | 33152 → 256 | 1.163 (1.635) → 0.360 (1.341) | 39.952 → 38.766 | semantic PASS; avoidable global scan confirmed/repaired |
| M1-256 | 512 / 256 / 256 | 131840 → 512 | 4.471 (4.582) → 0.407 (1.758) | 128.335 → 124.957 | semantic PASS; avoidable global scan confirmed/repaired |
| M1-512 | 1024 / 512 / 512 | 525824 → 1024 | 16.815 (17.208) → 0.798 (2.461) | 471.965 → 447.063 | semantic PASS; avoidable global scan confirmed/repaired |
| M2-64 | 320 / 64 / 192 | 20864 → 448 | 1.008 (1.894) → 0.474 (1.544) | 39.078 → 37.532 | semantic PASS; avoidable global scan confirmed/repaired |
| M2-128 | 640 / 128 / 384 | 82688 → 896 | 3.264 (4.338) → 0.818 (2.486) | 104.966 → 103.801 | semantic PASS; avoidable global scan confirmed/repaired |
| M2-256 | 1280 / 256 / 768 | 329216 → 1792 | 10.986 (11.285) → 0.986 (2.612) | 347.244 → 340.343 | semantic PASS; avoidable global scan confirmed/repaired |
| M2-512 | 2560 / 512 / 1536 | 1313792 → 3584 | 39.292 (40.057) → 3.163 (3.337) | 1318.731 → 1265.639 | semantic PASS; avoidable global scan confirmed/repaired |
| M3-64 | 128 / 64 / 96 | 8384 → 224 | 0.382 (1.428) → 0.168 (0.640) | 14.127 → 12.838 | semantic PASS; avoidable global scan confirmed/repaired |
| M3-128 | 256 / 128 / 192 | 33152 → 448 | 1.326 (1.775) → 0.249 (0.535) | 37.687 → 36.573 | semantic PASS; avoidable global scan confirmed/repaired |
| M3-256 | 512 / 256 / 384 | 131840 → 896 | 4.324 (4.559) → 0.499 (2.839) | 120.988 → 115.667 | semantic PASS; avoidable global scan confirmed/repaired |
| M3-512 | 1024 / 512 / 768 | 525824 → 1792 | 15.588 (16.591) → 0.990 (2.354) | 423.692 → 406.854 | semantic PASS; avoidable global scan confirmed/repaired |
| M-control-128 | 128 / 0 / 0 | 128 → 0 | 0.058 (0.170) → 0.058 (0.141) | 7.781 → 7.525 | semantic PASS; neighbor control |
| M1-2 | 4 / 2 / 2 | 14 → 4 | 0.007 (0.008) → 0.007 (0.012) | 0.368 → 0.382 | semantic PASS; reduced repeat-scan witness |

## Causal finding and repair

The first avoidably expensive producer was the snapshot derivation in
`materializeModuleExecution`: every instance mapped the entire runtime plan
into candidate/index objects and filtered it by runtime-path prefix. The
recorded visits are specifically callbacks on arrays of runtime entries, not
all operations: Base has R + I + I*R visits. Candidate-wrapper filtering adds
further uncounted work. The deterministic regression bounds these callbacks by
necessary output size, without a wall-clock PASS threshold.

The repair reserves a snapshot in preorder during recursive emission and uses
its completed contiguous runtime subtree. Only that range is filtered for
own drawable geometry. Nested points remain in both their inner and outer
snapshots. Cost is now proportional to emission plus subtree memberships;
materialized descendant lists themselves still require their output space.
No parser, resolver, runtime API, language, Rust payload or architecture changed.
The pre-existing instance-ordinal fallback for an empty Module is deliberately
preserved; this task does not redefine empty-body boundary semantics.

`counterfactual.json` records exact Base/fixed/restored owner hashes and commands.
Removing only the repair restored all 12 primary deterministic work failures;
the ordinary-point neighbor and two-call reducer retained their semantic PASS.
Removed M1-512 CPU was 17.248 ms (525824 visits); restoration returned the
output-sized work bound and the recorded CPU improvement. `removed.json` and
`restored.json` retain all samples for that case and the fixed-count neighbor.
The original Base evidence and removed owner bytes have the same hash.

## Verification and interpretation

- Base matrix: all 14 independently generated runtime/snapshot/origin oracles PASS.
- Base TS/reference + actual persistent Rust: all 14 geometry and instance-Base
  oracles PASS. The first harness used a 30-second test timeout: M2-512 completed
  in ~38 seconds but was marked timed out; the unchanged Base case passed with
  a bounded 120-second test allowance (`base-largest.log.gz`). This is reference
  evaluator CPU outside this repair, not a hung child or claimed GUI latency.
- The initial ordinary-point test incorrectly assumed compiler materialization
  was present; ordinary sources intentionally omit that product. The corrected
  harness checks the direct owner and permits omission only for this control.
  `base-tests.log.gz` retains the original harness failures transparently.
- Fixed focused verification: 6 files / 106 tests PASS, including all 14 TS/Rust
  cases and existing materialization, multi-document import, nested geometry,
  scalar/export, visibility and manual-fixture regressions (`fixed-tests.log.gz`).
- Restored deterministic work/semantic suite: 14/14 PASS.
- Benchmark: standalone Node 24, same machine, 12 warm-ups, 21 samples,
  five isolated calls per sample / one whole compile. Raw median/p95 samples
  are retained. GC/allocation and JIT noise remain visible. Timing is CPU, not
  production GUI frame or source-to-frame latency.
- Whole compilation still has substantial unrelated cost. The results support
  the local causal improvement, not global compiler or dogfood readiness.

Reproduce fixed measurements with
`node --import tsx scripts/performance/issue1493Modules.ts <new-label>`;
optional `ISSUE1493_ONLY=M1-512,M-control-128` selects already frozen units.
Use an outer bounded process timeout (300 seconds for the full matrix).
Do not re-freeze the oracle merely to make an implementation pass.
Final combined build/lint/full-suite/parity evidence is in the parent directory.
