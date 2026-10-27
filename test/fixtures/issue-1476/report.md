# Issue #1476 Stage 1 checkpoint

## Causal result

The first incorrect owner was `ConditionalDependencyGraph::unavailable_module_instance_prerequisite` in the Rust conditional dependency runtime. Before the repair, every element query filtered the complete graph edge vector, formatted each source endpoint key, and only then checked whether the target was a module occurrence.

The exact-Base discriminator decoded a structurally valid graph with 64 unrelated edges and queried 8 element endpoints. The graph itself independently established that no target was a `module-occurrence`, so each expected answer was `None`. Base inspected 512 edges / formatted 512 endpoint keys; the assertion requiring zero unrelated visits failed (exit 101). The adjacent decoded empty-graph control passed (exit 0).

The compiler-backed B2/B3 check compiled the frozen source files and inspected the actual canonical graph lowered into the production Rust payload. Both were Rust-eligible and had zero `module-occurrence` target edges:

| Source | SHA-256 | Bytes | Outputs | Graph V/E | Edge records | Module-occurrence targets |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| B2-r1 | `74b80541663319067de0f8d10fd495ccfe7fd5335b1144e2468476233878c9ca` | 14,513 | 258 | 775/773 | 773 | 0 |
| B3-r1 | `9fbc4372bdffc1cbb4949f8f1423351ce2e87ddcedc04824e25eeab836b408f1` | 56,991 | 1,002 | 3007/3005 | 3005 | 0 |

## Repair and semantic controls

Graph decoding now builds one owner-local `HashMap<source endpoint, ordered edge indices>` containing only compiler-provided `module-occurrence` target edges. The lookup visits only those indexed edges and reevaluates activation and current failed/included instance sets on every query. Appending edge indices during the original edge-order traversal preserves edge order. Graphs without module-occurrence targets get an empty index, so these lookups do no full-edge query traversal or endpoint-key formatting. No scheduler or caller change was introduced.

Decoded-graph Rust controls cover no module edges, an empty graph, included prerequisites, failed prerequisites, excluded prerequisites, first-failed and last-excluded priority, unrelated source endpoints, non-module target kinds, active/inactive conditional branches, static selected/unselected guards, repeated queries over one graph with changing selections and instance sets, and invalid payload rejection. Existing #1474 empty-readiness and empty-error tests remain in place.

Base positive controls passed. The fixed discriminator passed. A bounded removal of the indexed lookup restored the original full-edge scan and failed the unchanged discriminator with the same 512 visits (exit 101). Restoring the fix returned all four focused module prerequisite tests to PASS (exit 0).

## Performance

The unchanged `test/issue1474DependencyTopologyTiming.performance.test.ts` harness ran three independent processes on exact Base before editing and three independent processes on the fixed candidate. Every block used five warmups, 21 alternating B2:B3 trials, one persistent Rust child, and 53 requests. All six blocks exited 0. Full raw records and per-block resource measurements are in this directory's `performance/` files; the summary contains per-block values and pooled 63-trial p50/p95/max.

Times below are milliseconds. Each cell is `p50 / p95 / max`. `worker CPU` is the harness process's `process.cpuUsage()` around that stage; Rust child CPU is recorded separately below. The encoding probe is additional. Rust transport includes actual encoding, Rust evaluation, and JSON decoding as defined by the existing harness.

| Case | Stage | Base wall | Fixed wall | Base worker CPU | Fixed worker CPU |
| --- | --- | ---: | ---: | ---: | ---: |
| B2 | Compile/graph | 35.197 / 45.195 / 47.724 | 34.186 / 40.553 / 45.083 | 43.491 / 81.481 / 102.339 | 42.450 / 79.875 / 93.228 |
| B2 | Lowering | 0.305 / 0.411 / 0.442 | 0.297 / 0.397 / 0.671 | 0.307 / 0.575 / 0.648 | 0.299 / 0.580 / 5.030 |
| B2 | Encoding probe | 0.542 / 0.638 / 0.696 | 0.534 / 0.586 / 1.766 | 0.553 / 2.083 / 6.615 | 0.536 / 1.872 / 5.595 |
| B2 | Rust transport | 102.355 / 114.546 / 124.233 | 72.923 / 76.874 / 78.357 | 2.647 / 18.976 / 66.799 | 2.483 / 18.976 / 63.400 |
| B2 | Result decode | 0.232 / 0.265 / 0.352 | 0.219 / 0.261 / 0.263 | 0.231 / 0.264 / 0.298 | 0.219 / 0.261 / 0.264 |
| B3 | Compile/graph | 220.409 / 243.497 / 491.638 | 215.210 / 232.037 / 240.998 | 251.693 / 300.584 / 343.310 | 240.661 / 296.923 / 307.449 |
| B3 | Lowering | 1.006 / 1.301 / 1.911 | 1.003 / 1.404 / 2.023 | 1.021 / 2.582 / 3.998 | 1.049 / 4.120 / 5.844 |
| B3 | Encoding probe | 2.002 / 2.330 / 2.752 | 2.012 / 2.212 / 2.339 | 2.092 / 4.477 / 8.473 | 2.046 / 4.866 / 8.450 |
| B3 | Rust transport | 757.224 / 838.816 / 1035.815 | 321.145 / 340.051 / 362.017 | 7.666 / 18.544 / 85.308 | 8.004 / 18.758 / 73.753 |
| B3 | Result decode | 0.766 / 0.946 / 1.378 | 0.760 / 0.932 / 0.957 | 0.774 / 1.657 / 1.952 | 0.764 / 1.237 / 1.687 |

Frozen input and graph sizes were unchanged before and after: B2 source/payload 14,513/348,087 bytes, V/E=775/773; B3 56,991/1,352,833 bytes, V/E=3007/3005. Each block started one owned Rust child and issued 53 requests. Rust child peak RSS was 74,096–74,336 KiB on Base and 74,144–74,512 KiB fixed. Rust child batch CPU across paired warmups/trials was 17.59–18.28 seconds on Base and 8.08–8.12 seconds fixed (the harness's `ps` CPU resolution is 0.01 seconds). The test process max RSS recorded by `process.resourceUsage()` was 712,096–712,912 KiB on Base and 711,936–712,736 KiB fixed. Every child was awaited through close by the existing harness.

## Verification

Focused source-backed B2/B3 correctness used the unchanged independent complete scalar/geometry oracles, positive wrong-value sensitivity, Rust production evaluation, and TypeScript reference evaluation: 2 passed, 18 filtered, exit 0. The compiler graph-fact test passed (1 test). The bounded performance blocks each passed (8 tests per block).

`npm run lint` exited 0. The final required block, rerun after formatting the new Rust tests, completed in the specified order with exit 0 for every command:

| Command | Exit / result |
| --- | --- |
| `cargo fmt --manifest-path rust-evaluator/Cargo.toml --check` | 0 |
| `cargo check --manifest-path rust-evaluator/Cargo.toml` | 0 |
| `cargo test --manifest-path rust-evaluator/Cargo.toml` | 0; 628 passed, 9 ignored; stdio 6 passed; hover metadata 1 passed |
| `cargo clippy --manifest-path rust-evaluator/Cargo.toml --all-targets -- -D warnings` | 0 |
| `npm run test:parity` | 0; 207 passed |
| `npm test` | 0; 11,236 passed, 187 skipped; 699 files passed, 2 skipped |
| `git diff --check` | 0 |

The first required-block attempt stopped at `cargo fmt --check` (exit 1) on formatting in the newly added tests. `cargo fmt` corrected it and the entire block was rerun from its first command. An initial timing-harness invocation also exited 1 because the repository excludes performance suites by default; it ran no tests. All actual timing blocks were rerun with the repository's `VITE_RUN_PERFORMANCE_GATES=1` switch and passed. No production build was needed because no production TypeScript, type, or build inputs changed.

## Scope and remaining work

Only the authorized Rust owner, the additive `test/issue1476ModulePrerequisiteScaling.test.ts`, and `test/fixtures/issue-1476/**` evidence changed. The caller in `mod.rs`, #1474 fixtures, compiler residuals, geometry diamond, for-group scaling, H-B1 readiness, specifications, dependencies, and CI were not changed. Stage 1 does not close Issue #1476. The separate B compiler, D geometry, and historical for-group hypotheses remain deferred. No PR, merge, or Human Manual E2E was performed; the independent exact-pushed-HEAD review can start after the checkpoint is pushed.
