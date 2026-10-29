# Issue #1493 — CLI performance implementation and verification evidence

Recorded: 2026-10-29 22:55:51 JST.

Implementation and required local CLI verification complete. Awaiting independent
blocking review of the final exact pushed HEAD, then protected PR/CI. This is
not independent review PASS, merge, Issue closure, GUI evidence or dogfood readiness.

Base/main: `7d08c98aca4ae7982679a55f50358ec6f8eaa63b`.
Branch: `sayosomi/issue-1493-module-materialization-scaling`.
Exact code/test source under the final gates: `a073ab37f88b129030d33f6988616ded30c757b1`.
The last evidence commit adds only these reports/logs/manifests. All changed
executable source bytes are checked against the tested commit in
[`verification/source-hashes.json`](verification/source-hashes.json). The final
pushed HEAD and PR are read back in the Issue checkpoint; no self-referential
commit hash is fabricated inside this commit.

## Closed exploration dispositions

| Family / units | Primary | Controls | Reducers | Accepted / ceiling | Final disposition |
| --- | --- | --- | --- | --- | --- |
| M1/M2/M3 × 64/128/256/512 instances | 12 | M-control-128 | M1-2 | 14/24 | all independent runtime/origin/snapshot/geometry oracles PASS; global scan repaired |
| R1/R2 × depths 8/16/32/64; R3 × breadth 16/32/64/128 | 12 | RC-1/2/3/4 | R1-2, R3-2 | 18/20 | all ID/stage/parent/source oracles PASS; recursive scopes and per-hunk global scans repaired; R2 retained as localized-edit control |
| Combined | 24 | 5 | 3 | 32/44 | all primary and activated conditional units disposed; no unresolved/contract-invalid primary |

No unused units were transferred between families. Same-unit reruns, warm-ups,
ablations and required regression/parity invocations were not new units.

- [M ledger, all source hashes/oracles, measurements and causal removal](M/README.md)
- [R ledger, all stages/scopes, measurements and independent ablations](R/README.md)
- [Complete changed-file inventory](changed-files.txt)

## Confirmed defects and causal repairs

- Module snapshots mapped/filtered all runtime entries for every instance.
  Reserve snapshots in emission preorder and derive each from its completed
  contiguous subtree. Descendants, container exclusions, origins, ordered IDs,
  source units, instance ancestry and Base boundaries retain their prior values.
- Reconciliation recursively rebuilt shared named-ancestor scope keys. Memoize
  only while matched-parent state is unchanged; invalidate both sides on every
  paired block, including between hunks within a stage.
- Reconciliation repeatedly sorted/enumerated global residues for each hunk.
  Iterate the existing disjoint diff hunk intervals with live residue
  membership in the exact same ascending order. Stage precedence and matching
  waves remain unchanged.

Only two production owners changed: the existing materializer and reconciler.
No new abstraction, parser, resolver, scheduler, production semantics owner,
dependency, API, language rule, host surface, spec or architecture was added.
Test/benchmark consumers use existing supported package exports.

| Isolated CPU median, ms | Base | Fixed / restored final |
| --- | --- | --- |
| M1, 512 instances | 16.815 | 0.798 |
| M2, 512 instances | 39.292 | 3.163 |
| M3, 512 total instances | 15.588 | 0.990 |
| R1, depth 64 bulk rename | 13.412 | 4.904 |
| R3, 128 sibling groups | 2.266 | 1.425 |

Separate M and R ledgers retain p95, every sample, whole compile/canonical-edit
CPU, exact owner hashes, stage work counts, frozen oracles and neighboring
controls. M repair removal restores all 12 primary work failures; the R cache
and range repairs each independently restore only their corresponding four
primary work failures. Restoring each returns its full family to PASS.

## Required verification

| Check | Result |
| --- | --- |
| M focused, including TS/reference and actual persistent production Rust | 6 files / 106 tests PASS |
| R focused and source-patch properties | 3 files / 47 tests PASS |
| Corrected public import boundary and both work suites | 3 files / 38 tests PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test -- --maxWorkers=2` | 710 files PASS, 2 skipped; 11464 tests PASS, 187 skipped |
| `npm run test:parity -- --maxWorkers=1 --no-file-parallelism` | 207/207 PASS |
| `npm run docs:dsl:check` | PASS |
| `git diff --check` | PASS |

[`verification/results.json`](verification/results.json) records commands,
process timeouts, exit codes, exact tested code HEAD and log hashes. Compressed
raw logs are adjacent. No Rust source changed, so Rust fmt/check/clippy/full-core
suites were not separately required; actual production Rust requests and the
full parity gate ran. No native host configuration or interactive surface changed.

Initial harness issues are retained transparently: ordinary non-Module compile
omits materialization; M2-512 reference evaluation finishes in ~38 seconds and
needed a bounded 120-second test allowance. The unchanged Base case passed after
those harness corrections. The initial full run caught newly added internal
imports and was intentionally stopped after that known failure. Existing public
exports replaced the imports without weakening the boundary test; the complete
final full-suite run passed. Initial evidence is under `verification/initial-boundary/`.
A trace-script lint spelling issue was corrected before the final passing run.

## Remaining limits / next owner

Small-input cache overhead remains visible. Whole compilation/canonical-edit
CPU is noisy and not uniformly improved; legitimate LCS/matching/output costs
remain. A depth-64 ancestor bulk rename is synthetic and does not establish
practical GUI latency. The pre-existing empty-Module instance-ordinal fallback
was preserved deliberately. No long-session memory, Canvas frame, Human Manual
E2E, global performance or dogfood readiness is claimed. Issue #1492 and unrelated
Rust/dependency-graph work were not modified.

Next: independent blocking review of exact final pushed HEAD and ordinary
protected CI/PR gating. The implementation executor must not merge or close
#1493 and must not self-certify independent review PASS.

## Tested implementation history

```
6965bb5f7cbc5a9edcf695ce0213746eed1cc7da perf(language): bound module snapshots to emitted instance subtrees
8c0e1fa18b3091ff1b0ae156da373f77cbf5d34b perf(language): reuse stable scope keys and visit only changed hunks
19a75d5abc30b2e71f854a6ee14a762256e2d0b7 test(language): compress retained reconciliation evidence losslessly
2be6e26113ff1b92bfba69b7b2ab986680c5b40c test(language): use the supported module materialization export
a073ab37f88b129030d33f6988616ded30c757b1 test(language): use the supported reconciler type export
```

The final evidence-only commit follows these entries in Git history.
