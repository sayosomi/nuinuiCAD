# Issue #1260 D1 residual checkpoint

**BLOCKED; not ready for closure.** Fixed Base `c595241dd5974aa643cae707eb7ac849beefb344`, branch `sayosomi/issue-1260-residual-d1`. Two independently confirmed generic families repair all five accepted #1194 transfers. The R1–R8 campaign stopped at the shared whole-carry reference representation boundary; this checkpoint does not claim full Issue completion.

| Family | First incorrect owner | Exact Base discriminator and result |
| --- | --- | --- |
| 1260-D1-F1 | `moduleScalarRuntime.ts`: Module collection event positions | `G-map-free-dynamic`: producer `1.500002`, consumer `1.5`; native geometry unavailable. `B-min-forward-fixed` genuinely passes on Base. Reuse the instance event clock; corrected dynamic and optional-forward cases pass TS and normal persistent Rust. |
| 1260-D1-F2 | `typedDependencyGraph.ts`: scalar collection source closure | `B-map-free-scalar-source`: geometry→`n` prerequisite missing. Literal-source `G-map-free-construct` passes on Base. Follow existing descriptors with member/field selection, conditional guards and map binder identity. Keep forwarded Module activations owned by their original controller in TS and Rust. |

The mirrored controller fix maintains existing Stage 4/5 atomicity regressions after adding the missing dependencies. It is not separately counted as a new family without an independent Base DSL failure. Historical #1194 F01–F49 remain subtracted.

The exact Base regression invocation recorded six failures and three successes. A second unchanged-Base replay confirmed the closer fixed-selector control. The before/after payload projections, source identities, source orders, dependency edges and independent numeric oracles are in `base-proofs.json`. Full raw compiler, request, stdout and decoded payload records remain under `/tmp/issue1260-d1/`, with SHA-256 fingerprints in the evidence manifest. Base replays saved only task-owned candidate bytes externally and restored them byte-for-byte in `finally`; no branch/checkout/reset/stash/rebase operation was used.

All five transferred bundle hashes exactly match `residual9-freeze.json`:

| Frozen source | Final disposition |
| --- | --- |
| G-map-free-dynamic | BUG→FIXED→REPASS (F1) |
| B-min-forward-dynamic | BUG→FIXED→REPASS (F1) |
| A-map-free-optional-control | BUG→FIXED→REPASS (F1/F2) |
| A-min-optional-forward | BUG→FIXED→REPASS (F1) |
| A-optional-source-constructor | BUG→FIXED→REPASS (F1/F2); no separate nominal-record first loss remained |

| Domain | 01 | 02 | 03 | 04 | Aggregate |
| --- | --- | --- | --- | --- | --- |
| R1 | PASS | PASS | PASS | UNRESOLVED | UNRESOLVED |
| R2 | PASS | UNRESOLVED | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| R3 | PASS | PASS | PASS | PASS | PASS, bounded four cells |
| R4 | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED |
| R5 | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED |
| R6 | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED |
| R7 | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED | NOT_COVERED |
| R8 | PASS | PASS | PASS | PASS | PASS, bounded four cells |

R1-04 / `C-carry-if` is normatively legal. The geometry collection reference checker rejects the carry inside the selected `if`. A local type-lookup-only trial admitted it, but the subsequent alias lowering had no whole dynamic carry reference node: the selected collection was absent and carry-next failed in both runtimes. That incomplete trial was removed. `GeometryInputCollectionNode` lives in `packages/nui-language/src/model/cadDocumentTypes.ts` and has no identity-preserving whole-reference variant in its branch union. Authorizing the shared model and serialized reference representation requires a scope decision; this task excludes that model expansion and transport protocol changes. Synthesizing a map occurrence for a whole alias was not adopted as an identity workaround. See `blocker.json` for exact owners and the next safe action.

Other retained observations are not numbered repaired families:

- R2-02: inline path collection `next` loses `Seed.base`; both evaluators select the final stage, giving `(108,211)` instead of `(3,4)`.
- R2-03/R2-04: an unqualified definition-local single-geometry carry owner reaches payload setup and throws before Rust eligibility/request. A root-plan guard trial was removed after the earlier scope stop.
- A retired coordinate-member carry variant returns unavailable geometry in TS and a raw coordinate model in Rust. The named-point contrast passes; first-owner repair is unfinished.
- Root-only `C-coordinate` and its named variant are Rust-ineligible and unavailable in TS. They are not counted as passing controls or new independently repaired families.

There are **24/96 distinct newly compiler-accepted exact UTF-8 source hashes**, including two retired accepted variants and sources admitted only under the non-adopted local trial. All are charged conservatively even if the settled compiler rejects them. Historical transfers, ten reused controls, audit/suite fixtures and exact replays are excluded. `input-registry.json` records each witness. The **276 historical #1194 hashes are unchanged**. Rejected prototypes and retired variants retain exact text/hash in `prototypes.json`; none is used to manufacture a PASS.

Final required verification passed: build, lint, parity (203 tests), full npm test (10,871 passed / 190 skipped), Rust fmt/check/test/clippy, and diff check. The docs gate was not applicable because `docs/` is unchanged. The full block ran twice: inherited historical defer flags were corrected after the first run; the final run executes all repaired transfers. Exact commands, summaries, intermediate failures and log fingerprints are retained in `verification.json`.

Normal verification of `test/issue1260ResidualD1Rust.integration.test.ts` runs 25 passing cases and explicitly skips seven unresolved cases. Discovery mode reruns all frozen sources and records honest failure dispositions:

```sh
ISSUE1260_MODE=discover ISSUE1260_EVIDENCE=/tmp/issue1260-replay VITEST_MAX_WORKERS=1 npx vitest run test/issue1260ResidualD1Rust.integration.test.ts
```

Use a fresh evidence directory. `ISSUE1260_IDS` accepts an exact comma-separated subset. No eligibility override is provided. The runner reuses residual9 lifecycle/stdio handling and residual8/Stage 3/Stage 7 assertions; the canonical compiler and evaluator remain the only execution path. Each source and oracle is frozen before compilation/evaluation. Normal requests retain the actual stdin→decoded-result assertion. Requests are bounded at 10 seconds, Cargo build at 120 seconds, individual tests at 60 seconds, process lifetime at 600 seconds and cleanup at five seconds.

Changed production files are only `moduleScalarRuntime.ts`, `typedDependencyGraph.ts`, and Rust `conditional_dependency_runtime.rs`. New tests are `test/issue1260ControllerOwnership.test.ts` and `test/issue1260ResidualD1Rust.integration.test.ts`; remaining additions are this fixture directory. No normative specification, documentation reference, UI, host, dependency, CI, stdio lifecycle, #1439 feature or #1194 Issue was changed. Human Manual E2E is Not Required.

Evidence index: `cases.json` / `freeze.json`, `assertions.ts`, `families.json`, `base-proofs.json`, `dispositions.json`, `blocker.json`, `input-registry.json`, `prototypes.json`, `sensitivity.json`, `source-fingerprints.json`, `verification.json`, `telemetry.json`, `git-evidence.json`, `evidence-manifest.json`.

Next action: independent blocking review of the exact normally pushed checkpoint, then a scoped decision on whole-carry reference representation and new admission for remaining work. No PR, self-approval, merge or Issue closure is performed here.
