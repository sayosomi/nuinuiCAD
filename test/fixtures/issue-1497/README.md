# Affine seam-copy conformance fixtures (#1497)

Base: `b29186a6a8f48d35f60ab6adb334a3defe7d4a6a`.
Run `npx vitest run test/issue1497AffineConformance.integration.test.ts --maxWorkers=1`.
`freeze.py` uses only standalone Python mathematics and reproduces the exact
`.nui` sources and `manifest.json`. No product transform/evaluator imports or
candidate results supply the oracle. Geometry is Y-up in mm. Matrices,
determinants, ordered primitives, coordinates, controls, inward endpoint
tangents/right normals, lengths, diagnostics, topology and SHA-256 hashes are
retained in the manifest. Each source includes an unchanged 37 mm sibling.
The harness verifies normal Rust eligibility and uses the real persistent
`RustEvaluationProcess` plus the TS reference; both are checked against the
oracle. A complete run has one process spawn and 23 requests (21 units plus
P4/V4 recovery checkpoints), followed by owned process closure.

## Confirmed first-owner defects

1. **F1: short valid reflection axes disappear in Rust.** `LineTransform::reflect`
   admits an axis with length greater than 1e-9 mm, but `apply` compared its
   squared length to 1e-9. An oblique 1e-5 mm axis therefore lost all copied
   segments in drawable and pure paths. X1 and minimal R1 demonstrate this;
   M1/M2 and the unchanged sibling are neighboring passing controls. For R1,
   the unit axis is (3/5,4/5), so the independent reflection matrix is
   `[-7,24;24,7]/25`: (1,2) becomes (1.64,1.52), length 5 stays 5.
   The correction compares squared length to squared epsilon. Constructor
   admission and TS semantics stay intact. A direct Rust regression checks the
   short axis and an equivalent unit axis.
2. **F2: canonical endpoint reads from root pure copied paths fall through.**
   `dslDocument.ts`'s root geometry-value property resolver accepted length,
   angles and `start/end.x/y`, but omitted public `startPoint/endPoint.x/y`.
   Without a typed numeric declaration that activates the other semantic
   route, the compiler silently omitted the occurrence-aware numeric binding
   and both evaluators failed on `@Pure.endPoint.x`. V3 and minimal R2 show
   this; the same program's length/angle consumers and drawable readers pass.
   `first-owner-compiler-base.json` retains the absent Read.x binding and the
   correctly compiled neighboring occurrence bindings. Reuse the existing
   canonical numeric-property vocabulary instead of another property list.
   X2 covers all four coordinates for both copy forms and typed scalar readers;
   it already passes on Base because its typed scalar declarations activate
   that existing route. It is a sensitivity control, not a new defect.

The compiler is a causally required owner outside the initially writable copy
files, authorized by the Issue's upper-tier first-owner rule. Runtime geometry,
Module resolution and public language semantics were not redesigned. The DSL
Reference now explicitly lists the already normative endpoint properties.
Architecture ownership/data flow is unchanged; no ARCHITECTURE update is needed.

## Primary dispositions

| Unit | Disposition and independent discriminator |
| --- | --- |
| T1 | PASS — distinct source/reference anchor, directed two-line translation |
| T2 | PASS — four cubic points, non-cardinal rotation/scale, tangents/length |
| T3 | PASS — partial wraparound arc, reflection/rotation/scale, negative sweep |
| T4 | PASS — independently frozen noncommuting affine parameter arrangements |
| M1 | PASS — off-origin vertical cubic reflection, handles/length/tangents |
| M2 | PASS — clockwise oblique arc reflection, sweep and wraparound |
| M3 | PASS — immutable first mirror and drawable second mirror return identity |
| M4 | PASS — nonparallel axes compose analytic rotation; X3 adds mixed cubic handles |
| P1 | PASS — ordered connected line/arc/cubic triple and total length |
| P2 | PASS — exact straight-cubic right offset as known #1495 control, then copy/mirror |
| P3 | PASS — nested immutable polyline/join preserves ordered surviving segments |
| P4 | PASS — disconnected error, no copied geometry, legal recovery, sibling identity |
| V1 | PASS — drawable/pure transform and mirror agree, pure values recursively identity-free |
| V2 | PASS — two Module instances with distinct parameters and drawable/pure exports |
| V3 | REPAIRED PASS (F2) — downstream onLine, length, angles and canonical endpoint reads |
| V4 | PASS — zero/negative scale, coincident axes, disconnected source, both error channels and recovery |

X1 = REPAIRED PASS (F1); X2 = PASS (F2 sensitivity/neighbor control);
X3 = PASS (M4 cubic/mixed-path composition coverage gap).
R1 = REPAIRED PASS (F1); R2 = REPAIRED PASS (F2).
X4–X6 and R3–R6 = NOT_TRIGGERED. **21/28 distinct accepted units**:
16 primary + 3 justified X + 2 minimized reducers. Recovery/retest checkpoints
and pre-evaluation compiler-invalid drafts are not hidden extra inputs.

## Independent lengths and oracle corrections

Line/arc lengths are analytic. Cubic lengths use independent Simpson integration
of the quadratic derivative at 8192 panels, checked against 4096 (<1e-9 mm).
The contract uses a 32-edge cubic length approximation. Each path's frozen
length tolerance is its independent integral-minus-de Casteljau 32-edge mesh
chord gap plus 1e-7 mm per cubic (and a 1e-7 base allowance). Coordinates and
angles use 1e-7 mm/degrees; angles compare modulo 360. No exact analytic cubic
length is falsely demanded from the product approximation.

`base-initial.json.gz` and `manifest-initial.json` preserve the first run's
rejected oracle/harness assumptions. Continuity initially compared point ID/name
metadata as well as coordinates; adjacent directed segments correctly own
separate identities. The coordinate-only check fixes the harness without
changing geometry expectations. P2's original one-cubic segmentation prediction
was also wrong: its collinear source has nonuniform parameterization
`x(t)=3+34t+12t²-6t³`, `y=5`. The existing 0.1 mm fitter tolerance subdivides it.
The corrected independent oracle solves the scalar polynomial's linear-chord
sample deviations, then uses the mathematically forced chord/3 controls for
parallel endpoint tangents on each accepted interval. This is a source/oracle
correction with unchanged source bytes, not an offset defect or a new fitting
campaign. All five final primitives and their copied/reflected controls are
verified. V4's pure-error substrings were corrected to their owner-specific
English diagnostic contract; the drawable channel retains its Japanese errors.

`V2-compiler-invalid.nui` used literal coordinate anchors in an exported drawable
Module construction; local point references replaced them before evaluation.
`R1-compiler-invalid.nui` used Python exponent spelling in pure-coordinate input;
explicit decimal spelling replaced it before evaluation. Their original
compile diagnostics remain in `validation-*-initial.json`; neither draft was
accepted by both compiler and runtime. No language change was made for them.

## Causal evidence and verification

`base-complete.json.gz` retains all 21 units on Base production semantics:
V3/R2 fail in TS and Rust; X1/R1 fail only in Rust; all other observations pass.
`remove-rust.json.gz` removes only the new Rust repair: X1/R1 fail only in Rust,
all other units pass. Its focused Rust unit fails with exit 101.
`remove-compiler.json.gz` removes only the compiler repair: V3/R2 fail in both
hosts, all others pass. `restored.json.gz` records all 46 host/checkpoint
observations PASS. Exact source hashes, commands, expected/actual exit statuses
and elapsed times are in `counterfactual-results.json`. No regression was
weakened and no unrelated source was reverted. The old #1495 correction remains
present throughout all counterfactuals.

Focused verification (`focused-results.json` and logs) passed: 7 copy Rust tests,
1 new transform Rust test, 37 geometry-value Rust tests; 96 TS/integration tests
across 7 files, including the historical #1495 matrix, pure values, Module paths
and qualified properties. Rust format/check passed. Final required verification
is recorded under `verification/`, with tested commit and exact executable
source digests. Evidence-only commits after that tested commit do not change
executable source; the final pushed SHA remains the independent review target.

No GUI/headless GUI, host interaction, physical printing/sewability or Human
Manual E2E was performed or inferred. These fixes remain host-neutral; native
Human-only E2E is not newly required by a changed host path. Existing numerical
approximation/epsilon boundaries remain; the finite matrix is not a proof for
all magnitudes or all CAD geometry. Independent pushed-HEAD blocking review and
protected PR/CI/merge acceptance remain outstanding.
