# Split / onLine conformance fixtures

Reusable legal nui1 sources for #1501. `oracle.py` reproduces the source hashes
and numerical expectations in `manifest.json` without product imports or
observations. Run the integration test from the repository root:

```sh
npx vitest run test/issue1501SplitOnLineConformance.integration.test.ts
```

`ISSUE1501_VALIDATE_ONLY=1` checks compilation and production Rust eligibility
without evaluating geometry. `ISSUE1501_RECORD=/absolute/path.json` retains
payloads, numerical comparisons, process/request counts and dispositions.
Evaluation uses the canonical compiler, ordinary production lowering, one real
persistent Rust stdio process and the TypeScript reference. Child completion
listeners are installed before requests/teardown; requests have 15s timeouts.

| Case | Discriminator |
| --- | --- |
| S1 | Asymmetric directed straight split, fraction .37, station 44.4 mm |
| S2 | Start/end ratio and distance agreement, endpoints 0/1 |
| S3 | Nonuniform three-segment polyline, middle-segment split and reversal |
| S4 | Off-line, exact endpoint, separated near-endpoint guard, valid recovery |
| A1 | CCW arc crossing zero, radius 43, sweep 128°, ratio .37 |
| A2 | Same locus reversed clockwise, complementary endpoint stationing |
| A3 | Line/arc/line joined path, stations inside arc and following straight |
| A4 | Selected base arc differs from translated owner-final snapshot |
| B1 | Asymmetric cubic, Bernstein parameter .371, de Casteljau controls |
| B2 | High-curvature cubic, parameter .437, physical stations from both ends |
| B3 | Two-segment Bezier, split in second segment, retained intermediate slot |
| B4 | Reversed cubic, complementary parameter .629 and directed controls |
| P1 | Open line/arc/Bezier offset, exact straight-tail split and fitted-array preservation |
| P2 | Pure/drawable station agreement and identity separation |
| P3 | Independent Module instances, downstream far consumer, dimension revision |
| P4 | Two-panel intersection → split → transform/offset chain and dimension revision |

P4 is a deliberately analytic neighborhood of
`docs/module/manual-fixtures/nui1-seam-allowance-copy.nui`: asymmetric straight
seams make the intersection and all downstream geometry independently exact.
It tests split/publication consumers without auditing the intersection solver,
offset fitter, copy solver, source edits, exports or GUI.

Coordinates use a 1e-6 mm tolerance. Directed arcs use analytic `r*abs(theta)`;
Bezier controls use independent Bernstein/de Casteljau calculations. Bezier
lengths use Simpson quadrature at 8192 and 16384 panels (agreement <1e-8 mm).
Each length assertion has its own independent bound: five binary subdivisions
produce 32 control polygons; the true length lies between their summed chords
and summed control-polygon lengths. The product's 32-chord length is compared
with the integral using that gap, plus 1e-7 mm rounding allowance. The B2 station
coordinate allowance is twice the maximum subcurve control-to-linear deviation
plus twice that length gap and rounding; it applies only to the approximate
distance station, never the exact authored split point or split controls.

P1 uses the established offset fitter as an input control. Its cubic is
geometrically straight, with analytic offset x=35 and station y=65. The fitter
may subdivide it: the split contract preserves all untouched input segments,
partitions one segment using independent Bernstein inversion/de Casteljau,
and preserves exact analytic physical lengths. Fitter subdivision count is
not a public split guarantee. Internal endpoint IDs can differ at coincident
arc/offset joins; coordinate continuity and distinct drawable ownership are
asserted separately. Selected transform inputs use the sealed directed geometry
rather than assuming the evaluator's pre-mutation cache is an owner-final cache.

Every case checks the unchanged 37 mm Control sibling, finite payloads,
diagnostics, near/far drawable identities, topology, endpoints and lengths.
Revisions preserve existing drawable IDs, including Module identities.
Pure values have occurrence identity only. No new production semantics,
architecture or parallel evaluator is introduced.

The initial harness overconstrained internal endpoint IDs and P1 fitter
subdivision count. Those assertions were corrected without changing any
numerical oracle or accepted source. A later generic cache assertion incorrectly
used pre-transform geometry for B4; its already sealed reversed controls remain
the oracle. Initial failed harness logs are retained as such, not product FAIL
evidence. All 16 cases passed on unchanged production Base
`0c82168872543bda24bbbf3faccd65f7619e67cc`.
X1–X6 and R1–R6 are NOT_TRIGGERED. With no confirmed defect or production repair,
repair-removal counterfactuals are not applicable. Verification records live in
`verification/`; CLI checks do not establish GUI behavior or garment sewability.
