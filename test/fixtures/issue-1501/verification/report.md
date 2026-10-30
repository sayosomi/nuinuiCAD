# #1501 completed CLI verification

Source-tested commit: `e933d168b6b3dc95ac063c6728bfc6b5a518047e`. Base: `0c82168872543bda24bbbf3faccd65f7619e67cc`.
Final evidence-only commits preserve all 3126 source-tested files byte-identically.
`tested-source-sha256.json.gz` and `source-identity.json` retain that proof.

All S1, S2, S3, S4, A1, A2, A3, A4, B1, B2, B3, B4, P1, P2, P3, P4
are PASS in TS and actual persistent Rust. R1 is PASS. There are 17/28 accepted
units: 16 primary, 0 X, 1 R. X1-X6 and R2-R6 are NOT_TRIGGERED. Each final
matrix invocation uses one Rust process, 22 Rust requests and 22 TS evaluations
(including three S4 recovery revisions and P3/P4 dimension revisions).

One novel family: split Bezier endpoint metadata was copied from the source
while its segment controls were correctly subdivided. Both original near and
new far publications therefore had stale tangent/handle measurements. Earliest
incorrect owners are the existing TS/Rust split evaluators. Recompute the six
endpoint fields from each result's first/last controls. No additional owner,
architecture, API, dependency, DSL feature or historical assertion was changed.
The DSL reference already states resulting endpoint/control geometry and remains
consistent; its required check passes.

Base proof: strengthened matrix has 12 primary PASS; B1-B4 and R1 FAIL in both
hosts. R1 controls are (0,0),(0,40),(80,40),(80,0), split at t=.5 / (40,30).
Independent de Casteljau gives near controls (0,20),(20,30) and far controls
(60,30),(80,20). Correct near-end/far-start tangents are 180/0 degrees and all
result endpoint handles are 20 mm. Base retains 90-degree tangent values and
40-mm handles. B1 near-end tangent is 236.309932474 degrees on Base versus the
independently expected 155.520652181 degrees.

`counterfactual.json` and the removal/restoration payloads/logs preserve a real
controlled experiment. Only the two production repairs were replaced by exact
Base bytes, with the new tests retained: matrix exit 1 (the same five units fail
in both hosts), native Rust exit 101 (new R1 fails). The other 12 primary controls
remain PASS. Restored production bytes match their saved SHA-256: matrix exit 0
(17/17), native Rust exit 0 (11/11). Every affected case was then rerun in the
final matrix and complete gates. Initial shape-only PASS is superseded; initial
harness endpoint-ID/subdivision/cache assertion errors are separately preserved
under `harness-drafts/` and are not product-defect evidence.

Independent geometry: Euclidean subdivision; analytic directed arcs (A1 radius
43, sweep 128 degrees, length 96.0629220297679 mm; A3 mixed length
132.1238898038469 mm); Bernstein/de Casteljau cubic points/controls/derivatives;
Simpson 8192/16384 with <1e-8 mm convergence and independent chord/control-polygon
bounds. Exact coordinates/controls use 1e-6 mm. Largest observed split-piece
length deficit is 0.0359158003361 mm within its 0.0718423819035 mm bound.
B2's existing approximate physical station errors are +0.117404310744 mm and
-0.113299174450 mm (start/end); the saved points are on the exact cubic within
3.91e-14 mm y residual. No exact arc-length inversion or arbitrary numerical
correctness is claimed. `audit-stations.py` reproduces this from saved outputs
without a solver/evaluator invocation. Oracle regeneration in an external
temporary directory reproduces every sealed source/manifest byte.

P1 treats established fitter subdivision as an input detail: analytic offset
locus/length and independent Bernstein inversion/de Casteljau verify the split
and exact untouched segment arrays. P4 uses the predeclared analytic two-panel
neighborhood of the seam-allowance-copy fixture. These are legal discriminators,
not offset/intersection/copy redesigns. No scope expansion or extra exploration
variant was needed. No new independent defect family remained after checking
all supported primitive/publication/identity/recovery cases in the matrix.

All required commands, timeouts, actual exit codes and durations are in
`verification-results.json`; complete logs are compressed beside it. The final
counts are listed below.

- compiler-validation: Test Files  1 passed (1); Tests  17 passed (17)
- focused-ts: Test Files  5 passed (5); Tests  132 passed (132)
- rust-line-path: test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 645 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
- rust-split: test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 638 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
- build: exit 0
- lint: exit 0
- full-test: Test Files  714 passed | 2 skipped (716); Tests  11535 passed | 187 skipped (11722)
- parity: Test Files  1 passed (1); Tests  207 passed (207)
- dsl-reference: exit 0
- rust-fmt: exit 0
- rust-check: exit 0
- rust-full: test result: ok. 640 passed; 0 failed; 9 ignored; 0 measured; 0 filtered out; finished in 5.58s; test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s; test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
- rust-clippy: exit 0
- base-diff: exit 0
- worktree-diff: exit 0

All 15 required commands exited 0, including build, lint, DSL reference, both
diff checks and the full Rust gate. No required check was waived. All task-owned
processes terminate through their normal cleanup. GUI/native Human E2E and
physical garment sewability were not tested. Independent exact pushed-HEAD
blocking review and protected CI/merge remain outside this implementation role.
