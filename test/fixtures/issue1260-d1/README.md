# Issue #1260 autonomous evaluator campaign

Current reviewable checkpoint: sequential slice 2, Base `d8e8ad20a325e2d190561940f6f15a39347d910e`, branch `sayosomi/issue-1260-r2-d1`. **#1260 remains OPEN.** All R2/R4/R5/R6/R7 primary cells are now dispositioned. R1-04 and `C-carry-if` remain UNRESOLVED under separate [#1442](https://github.com/sayosomi/nuinuiCAD/issues/1442); no whole-collection representation workaround is introduced.

The 32 primary cells comprise 24 PASS, 7 BUG→FIXED→REPASS, and 1 UNRESOLVED. R1 is unresolved; R2/R4/R6 are BUG→FIXED→REPASS; R3/R5/R7/R8 are PASS within their four-cell matrices. The two historical root-only coordinate controls also remain explicitly unresolved and skipped, without forced Rust eligibility.

| New family | First incorrect producer | Base FAIL and adjacent Base PASS |
| --- | --- | --- |
| F3 | Inline geometry collection carry lowering dropped the selected stage. | R2-02; existing root path/non-final alias stage controls PASS. |
| F4 | Module-local single-geometry carries also created unqualified root plans. | R2-03/04 payload exception; C-R2-selected and Stage 7 controls PASS. |
| F5 | Escaped scalar carry reads lacked a completed-loop prerequisite. | R4-02 fails Rust; C-R4-arithmetic PASS. |
| F6 | Module collection carry literal expressions skipped scalar semantic analysis and could lack runtime carry inputs without root scalars. | R4-03 and D-R4-literal fail both; C-R4-literal PASS. |
| F7 | Module snapshots waited for generated templates as ordinary completed elements. | R6-04 fails both; R6-02 PASS. |
| F8 | A failed Module truncated inside its body leaked its successful prefix. | R6-03 fails both; C-R6-complete-failed PASS. |

All six newly counted families have exact frozen sources/oracles, independent Base failures, genuine adjacent passing controls, and passing normal TypeScript/persistent-Rust results. F1/F2 from PR #1441 remain completed controls, not new findings. F4 additionally required preserving source path/line type versus projected point input type, and evaluating a lazy projected next alias in the incoming frame. Those masked corrections are **not separately counted** as independently confirmed Base families. New abstractions, shared model/schema changes, transport changes, and edits to excluded `src/scalars/` owners were unnecessary.

`cases.json` and `freeze.json` retain exact immutable source hashes and analytic numeric/geometry/diagnostic oracles. `dispositions.json`, `families.json`, `blocker.json`, and `input-registry.json` are cumulative current records. `r2-proofs.json` retains compact actual compiler/TS/Rust evidence; raw compiler products, wire requests, decoded payloads and logs stay outside the repository at `/tmp/issue1260-r2-evidence/`. Source fingerprints, invocation/lifecycle accounting and final verification are in the `r2-*` evidence files. `r2-prototypes.json` preserves rejected statement-spelling trials and provisional diagnostic-spelling corrections; these are not product defects. The remaining non-`r2-*` evidence files document the completed first slice and retain their original Base/provenance.

Exact accepted sources are charged once across both slices, including discarded accepted trials. The campaign started this slice at 24/96 and now retains 49/96 (25 newly accepted). No quota efficiency is asserted without attributable Human observations.

Normal verification exercises all repaired cases and skips only the four explicit unresolved cases. Discovery mode reports observed failures instead of converting discovery runs into a green acceptance gate:

```sh
ISSUE1260_MODE=discover ISSUE1260_EVIDENCE=/tmp/issue1260-replay VITEST_MAX_WORKERS=1 npx vitest run test/issue1260ResidualD1Rust.integration.test.ts
```

`ISSUE1260_IDS` selects an exact subset. The runner seeds cumulative accepted hashes, freezes source/oracle before compilation, checks actual Rust stdin against prepared input, and retains normal eligibility. Timeouts remain 10 seconds/request, 120 seconds/Cargo build, 60 seconds/case, 600 seconds/process and five seconds/cleanup. Test-local wrong coordinates, dropped Module snapshots and dropped diagnostic sets must fail the detectors; no production fault injection is used.

DSL impact stays within canonical lowering, dependencies and existing evaluator consumption/publication. Grammar, public semantics, source spans, identity, editor/host/persistence and architecture ownership remain unchanged, so the normative specification and implemented DSL Reference require no contract edits. Existing authored-stage, endpoint and carry-shadowing regressions remain intact. Human Manual E2E is Not Required.

Next action: independent blocking review of the exact normally pushed HEAD, then protected PR/CI/integration. This agent creates no PR, self-approval, merge or Issue closure. #1442 remains separately authorized work after this checkpoint.
