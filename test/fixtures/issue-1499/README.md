# Intersection conformance fixtures

These reusable, compiler-validated nui1 fixtures cover Issue #1499's complete
16-primary matrix. `manifest.json` seals source SHA-256 hashes, independent
geometry, exact roots, traversal distances, diagnostics and identities before
product evaluation. `freeze.py` reproduces them using standard-library algebra
and numerical quadrature, without product imports or evaluator results.

The test uses canonical compilation, production payload lowering, one actual
persistent Rust stdio evaluator, and the TypeScript reference. It checks all
selected points and missing indices, invokes the existing intersection API on
both payloads' actual input geometry, and independently checks roots against
both primitives (including finite membership, directed sweeps and sealed cubic
parameters). Cubic controls are checked against the independent polynomial.
Pure occurrence ownership, Module instance isolation and invalid-to-valid
source revision recovery are covered. Every fixture retains the independent
Control segment from (201,-103) to (238,-103), including its identity on edit.

The coordinate tolerance is 0.000001 mm for well-conditioned simple roots;
no tangencies, epsilon ties or overlapping-root selection are assigned invented
semantics. Cubic distances use independent Simpson quadrature, converged between
2048 and 4096 panels within 1e-8 mm. The 0.15 mm distance allowance covers the
existing sampled traversal metric: independent control-polygon bounds plus
speed-interpolation bounds are below 0.067 mm for these cubics. For arcs,
R*theta^3/(24*n^2) bounds chord-length deficit; the largest fixture bound is
below 0.054 mm. Root distances are widely separated, preserving exact index
order despite those metric approximations. `distanceErrorUpperBounds` retains
the independent computations. Coordinate assertions do not use this allowance.

The prescribed cubic is x=120t, y=400(t-.2)(t-.5)(t-.8), with controls
(0,-32), (40,56), (80,-56), (120,32). B3 uses x=120t-60,
y=x²/120 and x²+y²=956.25, so candidate parameters are .25/.75;
the partial arc excludes the negative-x root. The other algebra and directed
parameters are recorded per unit in the manifest.

All 16 primaries passed on Base 0fd989e683104944d45bed6830bdac148d9bbc94.
No novel defect was confirmed. X1-X6 and R1-R6 are NOT_TRIGGERED; no
repair-removal counterfactual is applicable. A pre-evaluation N3 grammar draft
needed spaces around scalar additions; it was rejected and corrected before
acceptance, without changing its mathematical expectations.

Saved verification evidence includes compiler validation, Base results,
focused regressions, and the complete required final gate. These CLI results
do not establish physical sewability or Human Manual GUI E2E. No production
owner, language behavior, architecture or user documentation changed.
