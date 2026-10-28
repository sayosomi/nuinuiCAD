# Stage 7 source-backed scheduled readiness controls

Base: `d69e1baf31bf48344f7da8df5118e5944f073e3e`.
The closed 8-root × 4-revision matrix is complete. All 32 sources compile and
use normal Rust eligibility. No reducers or other exploratory sources were used.
`matrix.json` records every source/input/oracle hash, graph V/E/bytes, candidate
projection, original/final disposition and independent output checks.

R4 reaches nonempty production readiness in every revision (maximum two
candidates). Base rebuilds full topology 45/45/173/557 times for S0/S1/S2/S3;
the repair builds a borrowed projection once per evaluation. It is discarded
when evaluation ends. Branch activation, availability and readiness results are
still queried from current state, without a persistent index or another graph.
Topology edge visits fall from 3555/9315/35811/329187 to 79/207/207/591.
Reusing the evaluator's existing current early-binding set also reduces its
projection edge visits from 8374/74934/74934/667830 to 316/828/828/2364.
Candidate identities, ready sets and dependency traversals remain unchanged.

R6 independently exposes a typed-text runtime defect in both evaluators:
`Note` fails despite its available clockwise arc. The text-hole environment now
delegates direct geometry-property reads to the existing document runtime.
The complete source-derived oracle requires `clockwise=true`, all three scalar
results, the arc's signed sweep and endpoints, both offsets, and all padding.
All 32 final cells pass these independent checks. Parity is a separate control.

`R4-S0-input.json` and `R6-S0-input.json` are exact compiler-produced production
requests, not hand-built geometry. Their hashes and preparation are recorded in
`provenance.json`. Rust regressions execute `evaluate_document` on these requests;
the TypeScript regression compiles the unchanged R6 source fixture. Existing
Stage 6 and #1474 controls are retained unchanged. Synthetic branch/availability
controls validate helper semantics and do not establish production reachability.

`original-oracles.json` and `generate.py` contain authored-source arithmetic and
normative expectations established before evaluator execution. S0 preserves
original bytes; S1 inserts exactly 64 specified points after `nui 1\n`; S2/S3
append exactly 64/256 points. `source-oracle-seal.json` preserves every complete
oracle hash, including padding. Clock-dependent compiler IDs were fixed for
input sealing, and each input hash was checked again before every execution.
V counts unique `kind:id` Rust endpoint keys, E counts edge records, and graph
bytes count the exact compact JSON payload. Endpoint-record V, which can count
different metadata for one endpoint, is separately labeled in `input-seal.json`.

`per-call-work.json.gz` preserves each call's candidate count/identity hash,
reconstruction visits, dependency visits and ready count on Base and final.
`causal-proof.json`, `verification.json` and the external evidence index record
frozen regression hashes, original failures, isolated repair removals/restorations,
commands and results. An initially malformed synthetic control and an initial
compiler-clock observer correction are disclosed in `provenance.json`.

Raw exact sources, all 32 full padded oracles/inputs, both evaluator payloads,
candidate identities, full traces and command logs are preserved outside the
checkout at `/Users/yosomi/Library/Logs/nuinuiCAD/issue-1476-stage7-20261028`.
The archived Python scripts and `observe.test.ts.txt` document the bounded
experiment; they are not production infrastructure or automatic test entrypoints.
Replaying instrumentation requires an admitted implementation checkout and a
fresh external evidence directory; never execute it in the Human-test checkout.
The `.txt` observer was temporarily placed under `test/` for Vitest imports and
was removed after measurements. Base and final instrumenters are distinct.

These are deterministic work-count and semantic results, not a timing claim or
whole-application speedup. There is no Human GUI E2E result. Independent review
of the pushed checkpoint and protected PR/CI/merge remain separate decisions.
