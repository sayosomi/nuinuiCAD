# Issue #1515 — completed bounded CLI investigation and causal repair

All **12 primary sequences plus R1/X1 PASS** after the repair. Required local
verification and controlled repair-removal/restoration are complete. Awaiting
**independent exact-pushed-HEAD blocking review** and subsequent protected CI/merge.
This executor has not merged, closed the Issue, or self-approved that review.
No GUI/Canvas performance or dogfood-readiness validation is claimed.

- Production Base: `7fe9b0d3a39131c5bf39ea0e13e87d26caf52e28`.
- Branch: `sayosomi/issue-1515-incremental-pattern-evaluation-perf`.
- Initial failed-oracle checkpoint: `3eff02ab819065fba914c2cea07d42263278ba37`.
- Complete Base matrix/evidence checkpoint: `1b1a2ffbfd54667d500cd221f925f9ba456648b6`.
- Draft PR: https://github.com/sayosomi/nuinuiCAD/pull/1516.
- Exact final pushed HEAD is recorded in the executor handoff/PR; this file does
  not fabricate its own containing commit hash.

Continuation consumed the supplied Human PASS and passed the fresh fetch,
main/topic/clean/ownership check at **2026-10-31 08:44:59 JST**. The independently
reproduced first owner was outside the original strict writable list. The Human
subsequently explicitly approved **only** `moduleExecutionCompiler.ts` and the
counter-oracle correction in this session; a fresh fetch/exact-clean-checkpoint
check preceded those mutations. `verification-v3/human-authorization.json`
retains that decision. No upper-tier identity/authority was inferred.

## Preserved oracle history and frozen units

The [Bezier adjudication](https://github.com/sayosomi/nuinuiCAD/issues/1515#issuecomment-6535672873)
authorizes acceptance v2: compute the analytically specified cubic at i/32 and
sum its 32 Euclidean chords independently of the compiler/evaluators. Both
actual control coordinates and discrete drawable/scalar lengths use **1e-6 mm**
comparison tolerance. Continuous integration/bounds remain separate non-gating
accuracy observations. No production Bezier algorithm or user-facing accuracy
policy changed. Exact straight/seam geometry, origins, identities, diagnostics
and revision oracles remain unchanged.

`acceptance-v2.json.gz` decoded SHA-256:
`fdf511c4489d2f8768a3b1423706f932158e14a991b1e1743f12f329829bcd1e`.
It was sealed before execution. Original sources, hashes, the original 0.02 mm
assertion/manifest, all 12 original FAIL results and blocker evidence are
unaltered. Exact original test/helper/report bytes are archived and hash-indexed
under `original-v1/`; original failures are never represented as PASS.

| Units | Source/edit sequence | Final semantic and work disposition |
| --- | --- | --- |
| S-P, M-P, L-P | shared width 48 → 60; fixed independent sibling | PASS |
| S-M, M-M, L-M | only I0's argument 48 → 56 | PASS |
| S-C, M-C, L-C | authored comment/blank-line change | PASS |
| S-R, M-R, L-R | malformed numeric source → valid width 60 | PASS; intentional fatal revision distinct from last-good |
| R1 | one Module/body point + independent root point; comment edit | PASS; minimal legal discriminator with unaffected control |
| X1 | original root panel and legal Module definition, no instances | PASS; nearby one-scope control |

**14/20 units consumed**; X2–X4 and R2–R4 unused. Repeats/probes/verification are
not new units. All 31 literal revision hashes and the independent arithmetic,
scalar, ownership and revision expectations are sealed in the primary,
conditional and adjacent manifests. No source or semantic oracle was changed
for the repair.

Each primary authors 16 drawable declarations (eight root and eight in the
Module definition), plus 3/15/63 authored instance calls. Compilation verifies
32/128/512 runtime drawables and 3/15/63 separate containers: 35/143/575 runtime
entries. Runtime counts do not imply editability or Canvas visibility.

Incremental compilation is compared with independent fresh compilation by
qualified semantics/owners rather than opaque-ID equality across allocations.
All geometry/control points, seam/notch lengths, every Module-local measured
scalar, unchanged siblings, runtime/source identities and ordered instance
snapshots are checked against elementary-math oracles. Both ordinary persistent
production Rust and the secondary TS reference are checked. R's invalid source
has current diagnostics/source revision 2, retains last-good revision 1, makes
no Rust request, then recovers revision 3 with current changed geometry and
stable identities. No fatal last-good result is presented as valid current output.

## One confirmed producer and smallest first-owner repair

Only production owner changed:
`packages/nui-language/src/dsl/moduleExecutionCompiler.ts`.
Before the repair its preliminary and final scope maps each filtered **all**
runtime elements for **every** scope, and constructed now-unneeded entry-array
prefixes. Existing `entryScopeKeys` already determine membership. The repair
partitions each placeholder state once in execution-statement order using those
keys, preserving scope insertion order, within-scope element order, object
references, root namespace handling and parent-resolution state boundaries.
The obsolete entry collector and ID-set/full-filter passes disappear. No new
parser/resolver/cache/scheduler/API or cross-revision state was introduced.

| Unit | Entries / scopes | Base scope-filter visits | Fixed ordered-partition visits | Whole-owner callbacks Base → fixed |
| --- | --- | ---: | ---: | ---: |
| S (all edit classes) | 35 / 4 | 280 | 70 | 385 → 175 |
| M (all edit classes) | 143 / 16 | 4576 | 286 | 5005 → 715 |
| L (all edit classes) | 575 / 64 | 73600 | 1150 | 75325 → 2875 |
| R1 | 3 / 2 | 12 | 6 | 21 → 15 |
| X1 | 8 / 1 | 16 | 16 | 40 → 40 |

The exact `2 * scopes * entries` producer is replaced with `2 * entries`
partition visits on **every valid edited/recovered matrix phase**; fatal phases
do not reach this owner. The whole-owner gate counts map/filter/forEach callback
visits, including three legitimate output maps, so changing array methods
cannot hide the same repeated work.

The first four-pass whole-owner gate omitted the existing selected-ID projection.
Its failed assertion/evidence remain unchanged. The Human explicitly authorized
the independently justified **five-pass** v3 gate, sealed before execution in
`work-acceptance-v3.json` / `work-seal-v3.json`. This did not change the original
correct two-partition baseline, or any semantic/source expectation.

`verification-v3/causal-proof.json` verifies the same test/oracle throughout:

1. Exact Base: four work FAIL, X1 PASS; all semantic source/geometry controls PASS.
2. Fix only: five work PASS at exactly 5E callbacks.
3. Remove only this repair, restoring exact Base owner bytes: the same four FAIL
   and original visit counts recur; X1 still PASS.
4. Restore exact fixed bytes: all five PASS again.

The full 14-unit semantic and work matrices were rerun on the restored candidate.
Exact Base/fixed owner files, source hashes, raw traces and every ablation log
are retained. No completed #1493/#1474/#1476/#1503 repair was altered.

## Comparable measurements and honest limits

All comparable blocks use the same machine, five warm-ups and 21 measured
trials. Fixture generation/reads, binary build, baseline compilation, fresh
controls and oracle assertions are outside edit timers. An edit timer includes
canonical compile, context/request lowering, real serialization/IPC/response
parse and conversion to a ready evaluation result. Node process CPU and Rust
wall duration are distinct measurements; nested stages are **inclusive, not
additive**. Work-probe timings are diagnostic, not benchmark samples.

A strict summary check caught different SHA-256 values for the early ordinary
Rust binary and its later normal rebuild, despite unchanged Rust source. The
failed check and all original samples are retained. The binary-equality condition
was **not** weakened: all twelve Base normal blocks and three representative
Base stage blocks were repeated using frozen exact-Base JS bundles against the
same ordinary Rust executable already used by fixed blocks. Every central
before/after comparison now verifies SHA-256
`26de8a1bd3acbe3bd619d3026eaa4446bb331f0a51e9a0f280580dcd2edbd92d`.
That exact executable is losslessly retained; bundle source maps prove the Base
owner hash. See `verification-v3/rust-binary-alignment.json` and
`aligned-base-builds.json`. Build reproducibility is not claimed as a new defect.

The table uses these **binary-aligned** normal blocks: p50 / p95 / max in ms.
R rows show recovery; diagnostic-only invalid phases remain separately recorded.

| Case | Base p50 / p95 / max | Fixed p50 / p95 / max |
| --- | ---: | ---: |
| S-P | 26.125 / 27.224 / 30.715 | 26.253 / 27.805 / 30.072 |
| S-M | 26.208 / 27.264 / 30.505 | 26.131 / 27.226 / 30.859 |
| S-C | 26.194 / 27.377 / 30.096 | 26.069 / 28.657 / 29.960 |
| S-R | 26.452 / 27.973 / 28.016 | 26.532 / 27.486 / 27.763 |
| M-P | 154.580 / 157.198 / 161.567 | 155.684 / 157.898 / 160.135 |
| M-M | 155.130 / 158.858 / 161.174 | 155.767 / 157.928 / 157.979 |
| M-C | 154.880 / 161.156 / 168.741 | 156.122 / 158.650 / 159.434 |
| M-R | 155.006 / 158.139 / 163.622 | 155.647 / 156.836 / 157.730 |
| L-P | 1555.611 / 1563.512 / 1563.772 | 1565.157 / 1573.927 / 1585.691 |
| L-M | 1566.675 / 1575.138 / 1578.063 | 1553.112 / 1572.893 / 1573.059 |
| L-C | 1558.877 / 1569.904 / 1576.337 | 1552.856 / 1562.991 / 1569.752 |
| L-R | 1567.747 / 1601.871 / 1933.191 | 1561.699 / 1571.637 / 1572.876 |
| R1 | 1.534 / 2.104 / 2.163 | 1.550 / 2.123 / 2.246 |
| X1 | 6.097 / 6.630 / 7.577 | 6.095 / 6.655 / 6.859 |

Representative materialized-execution-compiler stage p50, from matching
separately instrumented blocks (ms):

| Unit | Base | Fixed |
| --- | ---: | ---: |
| S-P | 0.448 | 0.422 |
| M-P | 1.986 | 1.790 |
| L-P | 14.814 | 11.534 |
| R1 | 0.040 | 0.037 |
| X1 | 0.124 | 0.126 |

Full before/after wall/Node CPU p50/p95/max, all 5+21 samples, warm/cold distinction,
serialization, payload bytes, graph/entry sizes and source hashes are retained
in `measurements-v2/`, `measurements-v3/`, `summary-v2.json.gz` and
`summary-v3.json.gz`. The initial 36 primary normal/stage/Rust-timer blocks remain
historical observations. Direct matched comparisons comprise 19 Base and 19
fixed blocks: all twelve normal cases, three P stage scale points and normal/
staged R1/X1 controls. All 14 post-repair work cases are separately recorded.
Rust timer blocks were not unnecessarily repeated after a JS-only repair:
Rust source/algorithm is unchanged; every fixed normal case and parity/focused
verification still execute actual persistent Rust. That conditional decision
was recorded before the post-repair campaign.

Work reduction is deterministic. Whole CLI latency is **not uniformly improved**;
M and L-P medians are slightly higher while other L medians are lower. No
arbitrary millisecond PASS threshold, subtraction of independent medians,
dedicated-CPU isolation, overall responsiveness or global linearity claim is
made. Rust evaluation remains the dominant observed cost; no additional causal
Rust/scalar-lowering defect was established and no speculative repair was made.

The JS probes wrap real compiler/client calls only in memory; exact original
bundles/source maps are archived. One passive Rust `Instant` probe was built to
an external Task target, then its source restored byte-for-byte. All production
Rust source remains exact Base. The cold-setup field includes initial baseline
compile and is excluded from warm statistics. Input JSON byte counts exclude
the small request envelope and may vary with independently allocated opaque IDs.

## Verification, retained failures and review boundary

| Check on restored source | Result |
| --- | --- |
| Focused source/identity/revision/performance/persistent-Rust/Module ownership | 13 files / 130 tests PASS |
| #1474 C3 safety, then B2/B3 topology controls | 3 PASS |
| All 14 semantic units and post-repair work cases | PASS |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm test -- --maxWorkers=2` | 721 files PASS, 2 skipped; 11675 tests PASS, 187 skipped |
| `npm run test:parity -- --maxWorkers=1 --no-file-parallelism` | 207/207 PASS |
| `npm run docs:dsl:check` | PASS |
| Source/oracle/archive hashes and final whitespace/change review | recorded in final executor checks |

The skipped files/tests are the unchanged repository defaults, not new waivers.
All commands, timeouts, exit codes and raw logs are retained. Applicable broad
shared-compiler gates ran after focused tests. No lasting Rust change exists,
so unrelated Rust full-core/clippy gates were not added; the ordinary binary
build and actual Rust focused/parity paths ran. No host configuration/native
command changed, so native packaging and Human GUI E2E are not Task gates.

Earlier scalar-adapter and redundant-initialization lint failures are retained
and corrected without changing expected source/geometry values. The original
four-pass gate, the original continuous-accuracy gate, their failures, and the
binary-alignment summary failure remain auditable. A cold-start promise metadata
mistake affected only the first invalid warm-up annotation, not any measured
trial; original data and supplementary corrected replays remain. The initial
S-P pilot retains measured samples in its log; its warm-up records were
superseded by the complete campaign. All comparable blocks retain all 26 records.

Subprocess groups, requests and teardown are bounded; stream/error/close
listeners precede transitions, and only Task-owned children are cleaned up.
There is no GUI/headless GUI, Human-test checkout, second worktree, legacy SAY,
dependency, architecture or unrelated feature change. Source comments/layout,
compiler dependency ownership, millimetres/Y-up and Rust production semantics
are preserved. The helper stays inside its existing compiler owner; no new shared infrastructure
or parallel semantic owner was added.

Stop here for independent review of the exact pushed HEAD. Protected CI/merge,
reset-free checkout return and Issue closure remain separate later operations.
