# Issue #1718 public measurement fixture

`root.nui` is a deterministic 2,000-line nui 1 source that imports the saved
`library.nui` module. It contains dynamic nested guards, a static guard, 80
active/inactive geometry-dependent branches, and 1,200 unrelated scalar edges.
The integration test compiles the two documents through the production
multi-document compiler, prepares the normal Rust evaluator input, verifies
Rust eligibility, and compares Rust against the TypeScript reference and the
independent geometry/scalar oracle.

Run the source-backed production-path check from the repository root with:

```sh
npx vitest run test/issue1718ControllerCandidates.integration.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism --disableConsoleIntercept
```

The captured `prepared-rust-input.json` is the exact compiler-prepared input
used by the Rust measurement. `oracle.json` records its SHA-256, the normalized
output SHA-256, compiler/import authority, graph counts, and expected computed
values. To intentionally recapture those fixed artifacts after changing the
fixture, run the same command with `ISSUE1718_CAPTURE_FIXTURE=1`.

The Rust work-count and timing measurement uses the normal `evaluate_document`
path with that prepared input. It reports invocation count, nonempty controller
candidate results, nonempty scheduled-binding calls, graph size, outer
guarded-edge visits, inner prerequisite-edge visits, thread CPU time and wall
time for three independent evaluations. Reproduce the optimized run with:

```sh
cargo test --manifest-path rust-evaluator/Cargo.toml --lib issue_1718_source_backed_controller_candidates_measurement -- --nocapture --test-threads=1
```

`base-work-count-regression.log` is the pre-optimization result. It fails only
the structural work-count assertion after recording all three measurements.
For the reversal proof, the inner traversal was temporarily changed back to
iterating `self.edges` and comparing `endpoint_key(&prerequisite.from)` with
the guarded source. `reversal-work-count-regression.log` records the expected
failure; the source-backed Rust/TypeScript output comparison passed during the
reversal. The indexed implementation was then restored, and
`restoration-work-count-measurements.log` records the passing measurements.
No reset, stash, or destructive cleanup was used. The summarized raw samples,
medians, spreads, graph counts, and output hashes are in
`measurement-summary.json`.

The measurements are evidence about removed redundant work and observed
runtime on one development host. They do not impose an elapsed-time threshold
on CI.
