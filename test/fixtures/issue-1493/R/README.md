# Issue #1493 — statement reconciliation evidence / reusable fixtures

Base: `7d08c98aca4ae7982679a55f50358ec6f8eaa63b`.
Owner: `packages/nui-language/src/document/statementReconciler.ts`.
The Base owner's SHA-256 is `ad91510a0d1cabfc9ba7563dafdd948cce935bd545d9e6c1dac15dbfe2703cfe`;
final owner is `b5acb1cbc2fb263eb0dfe0fabbcd37acbd28c287b0e16dcb724b8c4ca011de69`.
Per the sequential mission, R Base observations were captured at the M commit,
with the reconciler byte-identical to admitted Base. All R sources are Module-free;
the compiler omits Module materialization, so M's repair does not enter these
isolated or canonical-edit paths. Exact owner hashes, not an uncommitted
candidate's `head` field alone, identify every measured implementation.

## Frozen oracle and closed ledger

`oracle.json.gz` freezes the original 17 old→new source pairs and their source
hashes, authored-location ID correspondence, stages, identity kinds, parent and
branch relationships, created and vanished identities. `oracle-extensions.json.gz`
adds only the independently authored R3-2 minimal two-sibling reproducer, frozen
before its product run. The original oracle was never regenerated to fit output.
`test/issue1493ReconcilerSupport.ts` derives expectations from authored topology
and intended edits, not from reconciler matching results.

Accepted: 12 primary + 4 motivated controls + 2 minimized reproducers = 18/20.
RC-1: nested attribute editing with stage-2 matching; RC-2: anonymous group and
reordered anonymous child (stage 4); RC-3: named child moves then→else (stage 5);
RC-4: rename/move/type replacement, preserved comments/blank lines, two created
IDs and one vanished ID (stage 6). R1-2 and R3-2 minimize the two repeat-work
producers. No further conditional units activated. Every row below is semantic
PASS on Base and final, including deterministic reruns and canonical source edits.

| Unit | IDs (inherit/create/vanish) | Stages 1/2/3/4/5/6 | Scope reads Base → final | Stage-3 Base global visits → final local range checks | Isolated CPU median (p95), ms: Base → final | Canonical edit median, ms: Base → final |
| --- | --- | --- | --- | --- | --- | --- |
| R1-8 | 10 (10/0/0) | 1/0/9/0/0/0 | 420 → 90 | 90 → 180 | 0.092 (0.432) → 0.147 (0.521) | 1.131 → 1.188 |
| R1-16 | 18 (18/0/0) | 1/0/17/0/0/0 | 2244 → 306 | 306 → 612 | 0.356 (0.585) → 0.211 (0.406) | 1.508 → 1.657 |
| R1-32 | 34 (34/0/0) | 1/0/33/0/0/0 | 14212 → 1122 | 1122 → 2244 | 2.038 (3.368) → 0.998 (2.022) | 4.897 → 4.201 |
| R1-64 | 66 (66/0/0) | 1/0/65/0/0/0 | 100100 → 4290 | 4290 → 8580 | 13.412 (13.474) → 4.904 (5.308) | 23.228 → 18.125 |
| R2-8 | 10 (10/0/0) | 9/0/1/0/0/0 | 4 → 2 | 2 → 4 | 0.016 (0.130) → 0.048 (0.094) | 0.579 → 0.648 |
| R2-16 | 18 (18/0/0) | 17/0/1/0/0/0 | 4 → 2 | 2 → 4 | 0.019 (0.245) → 0.020 (0.088) | 1.041 → 1.062 |
| R2-32 | 34 (34/0/0) | 33/0/1/0/0/0 | 4 → 2 | 2 → 4 | 0.034 (0.035) → 0.036 (0.039) | 2.563 → 2.717 |
| R2-64 | 66 (66/0/0) | 65/0/1/0/0/0 | 4 → 2 | 2 → 4 | 0.068 (0.070) → 0.073 (0.081) | 8.512 → 8.898 |
| R3-16 | 33 (33/0/0) | 1/0/32/0/0/0 | 224 → 156 | 1056 → 192 | 0.121 (0.626) → 0.110 (0.419) | 1.641 → 1.602 |
| R3-32 | 65 (65/0/0) | 1/0/64/0/0/0 | 448 → 316 | 4160 → 384 | 0.248 (0.413) → 0.325 (0.778) | 2.887 → 2.884 |
| R3-64 | 129 (129/0/0) | 1/0/128/0/0/0 | 896 → 636 | 16512 → 768 | 0.729 (0.769) → 0.546 (0.688) | 7.514 → 14.944 |
| R3-128 | 257 (257/0/0) | 1/0/256/0/0/0 | 1792 → 1276 | 65792 → 1536 | 2.266 (2.360) → 1.425 (1.668) | 17.022 → 26.985 |
| RC-1 | 4 (4/0/0) | 1/3/0/0/0/0 | 12 → 6 | 0 → 6 | 0.008 (0.008) → 0.011 (0.013) | 0.293 → 0.306 |
| RC-2 | 3 (3/0/0) | 2/0/0/1/0/0 | 2 → 2 | 0 → 0 | 0.006 (0.006) → 0.007 (0.012) | 0.234 → 0.246 |
| RC-3 | 4 (4/0/0) | 3/0/0/0/1/0 | 2 → 2 | 0 → 0 | 0.008 (0.070) → 0.010 (0.115) | 0.560 → 0.589 |
| RC-4 | 4 (2/2/1) | 2/0/0/0/0/2 | 4 → 3 | 0 → 0 | 0.007 (0.033) → 0.009 (0.037) | 0.332 → 0.370 |
| R1-2 | 4 (4/0/0) | 1/0/3/0/0/0 | 32 → 12 | 12 → 24 | 0.014 (0.014) → 0.016 (0.030) | 0.328 → 0.306 |
| R3-2 | 5 (5/0/0) | 1/0/4/0/0/0 | 28 → 16 | 20 → 24 | 0.052 (0.132) → 0.017 (0.020) | 1.023 → 0.341 |

## Two independently demonstrated avoidable producers

1. Recursive `scopeKey` repeatedly traversed already visited named ancestors.
   R1-64 used 100100 scope reads: stage 2 = 4290, stage 3 = 95810.
   Final uses 4290 total: stage 2 = 130, stage 3 = 4160. The repair memoizes
   per-side keys only while parent pairing state is stable. Both caches clear
   whenever `match` pairs blocks, covering changes to `matchedOldBlocks` and
   `oldBlockByNewBlock`, including later hunks in the same wave. Stage-1 direct
   block registration completes before any scope cache lookup. Keys, branch
   suffixes, ambiguity handling and stage precedence are unchanged.
2. Stage 3 sorted/iterated the complete remaining identity set for every hunk.
   R3-128 had 65792 global residue visits in stage 3. Diff hunks are already
   disjoint source-index intervals; direct ascending interval iteration plus
   current residue membership yields exactly the old filtered/sorted order.
   Final uses 1536 local range membership checks and no global stage-3 residue
   enumeration. No hunk, matching schedule, parent resolution or tie-break
   semantics were changed.

The two work metrics in the table deliberately distinguish old global
iterations from new range checks. Repeated matching waves remain necessary:
R1-64 still has 66 stage-3 waves. Range iteration checks already matched indices
in a hunk, so R1 has more cheap range checks than the old shrinking residue count;
its recursive work and repeated sorting/allocation are reduced. LCS DP, full
scope strings, output maps and legitimate matching costs remain. This is not a
claim of globally linear reconciliation.

## Causal removal and restoration

`counterfactual.json.gz` records hashes, commands and results for independent ablations.
All ablated variants retain exact semantic ID/stage/parent/source oracles.

- Remove only memoization, retain local ranges: four R1 work tests FAIL;
  R3 work controls PASS. R1-64 returns to 100100 scope reads / 14.077 ms.
  Restore: 18/18 work tests PASS; 4290 reads / 5.056 ms.
- Remove only local ranges, retain memoization: four R3 work tests FAIL;
  R1 controls PASS. R3-128 returns to 66304 total residue iterations / 3.281 ms.
  Restore: 18/18 work tests PASS; 512 remaining (stage-2) residue iterations /
  1.380 ms. Final also counts numeric Set membership checks in its deterministic
  bound, so moving the work from iteration to interval membership is visible.

`base*.json.gz`, `cache-only*.json.gz`, `fixed*.json.gz`, `removed-*.json.gz`,
`restored-after-*.json.gz` and `restored-full*.json.gz` retain intermediate and repeated
samples rather than selecting a single favorable timing. The final candidate's
whole matrix is `restored-full.json.gz`. Diagnostic trace bundles are temporary,
CLI-only copies of the exact owner with stage counters, independently checked
against the frozen oracle; their timings are never benchmark data. The trace
includes source/instrumentation hashes and all stage 1–6 work arrays.

## Verification and practical interpretation

- Base: 18 semantic/canonical oracles PASS. Eight deterministic complexity
  gates fail (four R1, four R3), ten controls/reducers PASS.
- Final: 18/18 work and semantic tests PASS, all 18 diagnostic oracle replays
  PASS, and 3 focused files / 47 tests PASS including existing reconciliation
  and source-preserving text-patch property regressions (`restored-focused.log.gz`).
- No production API, parser, document model, source-edit boundary, Rust code,
  language semantics, source identity rule, or architecture changed.
- Measurements: standalone Node 24, 20 warm-ups, 21 CPU samples, 10 isolated
  reconciliations/sample and one canonical edit/sample. Parsed input and old
  compilation are outside isolated timings; canonical timings include the
  real `compileCanonicalText` source-edit path.
- Small-input cache overhead is visible (e.g. depth-8 bulk edits), while R2
  localized leaf edits were already cheap. Whole canonical-edit timings are
  noisy and not uniformly improved. No arbitrary millisecond PASS threshold
  or practical user-facing lag claim is inferred from these synthetic results.
  Depth-64 bulk ancestor renaming is a stressor, not typical pattern editing.
- No GUI, headless VS Code/browser, frame measurement or Human Manual E2E ran.

Reproduce with `node --import tsx scripts/performance/issue1493Reconciler.ts <label>`
and `node --import tsx scripts/performance/issue1493ReconcilerTrace.ts <label>`;
optional `ISSUE1493_ONLY=R1-64,R3-128,R2-64` selects already frozen timing units.
Bound full timing runs to 300 seconds externally. Do not re-freeze an oracle
to accommodate changed identity behavior. Combined verification is recorded
in the parent directory.
