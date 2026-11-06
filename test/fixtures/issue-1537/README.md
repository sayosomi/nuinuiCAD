# Bezier knot regression oracle

`base-oracle.json` freezes the old grammar's three-segment controls and measured
length at `df566c918198598dc2f6145d6ad1b1caa79581f4`. Its source is historical
oracle provenance, not a current-language fixture to compile. Runtime IDs were
removed; anchors, control coordinates and length are unchanged.

The capture bundled `compileFreshCanonicalText`, `buildEvaluationOptions`,
`evaluateElementsReferencePayload` and `evaluationPayloadToResult` with esbuild.
Every repository module was loaded from `git show <Base>:<path>` in an onLoad
hook, bypassing the modified working tree. The old source was compiled and
its Curve geometry captured outside the checkout. No second checkout or
worktree was created. The test also asserts analytic control coordinates.

The existing evaluator uses a sampled length approximation. This task preserves
its Base result; exact quadrature is not the length oracle for this cutover.
