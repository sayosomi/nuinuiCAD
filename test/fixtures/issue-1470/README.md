# Issue #1470 frozen Bezier conformance fixtures

`freeze.py` uses only Python standard-library Bernstein arithmetic, analytic
quadratic roots, derivative frames and de Casteljau subdivision. It does not
import or execute product code. `manifest.json` and the exact `.nui` sources
are committed before the first exploratory compiler/evaluator execution.

Each primary is an ordered trace starting from canonical empty-document source
revision 1. Every checkpoint changes source and advances revision by one. SHA-256,
selected/stage cubic control points, stationary candidates, frame calculations,
numeric tolerances, geometry error expectations and neighboring controls are
sealed together. Wrong-oracle entries deliberately confuse endpoints, midpoint
or physical normal sides; sensitivity is required where distinct.

E6 follows split tail segment 0 → segment 1 → trimmed segment 1 → extended
segment 1, each at the translated named stage. B6 and C6 isolate two Module
instances while changing only Left. C5 includes an adjacent inflection control,
exact inflection, zero tangent, opposite-curvature internal join, negative
distance and zero-distance recovery. Threshold edge cases are intentionally
excluded. Unsupported source must be preserved and classified CONTRACT_INVALID
before sealing a separately identified supported equivalent.

X/R slots are conditional, never filler. Execution evidence and dispositions
are recorded separately without rewriting this original seal.

Completed results, unsupported-source classification, conditional X triggers,
negative sensitivity and full serial gate results are in [result.md](result.md).
`evidence/index.json` authenticates retained original failure/PASS logs and
observations. The test uses `supported-equivalents.json` for C6 and adds only
the two pre-execution-sealed `counterfactuals.json` units.
