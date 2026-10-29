# Imported nominal records to physical pattern artifacts (#1488)

Fixed Base: `07723e51f16dce664bc95971c3fed89ec3f5f7ee`.

`freeze.mjs` imports no product code. It seals the twelve source bundles and
independent Y-up millimetre arithmetic in `matrix.json` before observation.
R1 is direct import, R2 is the equivalent facade route, R3 has two asymmetric
typed Module instances, and R4 selects a literal member of a nested record
wrapper. Each root has an independent selected control and an unselected
alternative output. The saved `Data` Module supplies numeric library data
because standalone file-level scalar/record values are not public declarations.

S0 uses saved `(17,-23)` data, S1 genuinely saves `(31,-37)` in the same cache,
and S2 opens dirty `(71,-83)` data while changing only the current root's
`rootEdit` from 0 to 5. S2 then restores the exact S1 root, rejects an invalid
saved dependency, and recovers. These retained variants/reruns consume no extra
exploration units. #1486's existing independent root (`n = 41`) must retain its
graph and evaluated value across invalidation; untouched facade artifacts must
retain their parsed object. Old valid snapshots are re-evaluated against their
own old oracle.

`rejected-missing-at.json` retains twelve initially drafted bundles with a
missing required `place.at`; `rejected-outer-capture.json` retains three drafts
that illegally capture an outer Module instance. They are negative controls,
never positive passes. Legal replacements keep the same numeric expectations.

The actual-file test uses the canonical graph/coordinator/cache and compiler,
normal `prepareRustEvaluation`, the production persistent `evaluation_stdio`,
the TypeScript reference, Canvas runtime projection/fallback, Module Preview,
`evaluateOutputPlan`, and actual Rust `exportOutput` files. No manually built
encoder payload supplies acceptance evidence. Root source is current; dependency
snapshots are read from real saved temporary files with content fingerprints.

The independent placement formula is `(7 - 2*y, -11 + 2*x)` for the rotated
pattern and translation for the independent control. The physical stroke is
`25.4/96` mm. Bounds include half the physical stroke, SVG adds 3 mm on every
side, A4 uses 210 by 297 mm, and overlap 10 gives strides 190 by 277 mm. This
produces both one-page and two-page outputs as saved dimensions change.

The detector parses SVG XML/mm dimensions/viewBox and every ordered path. It
follows PDF byte-offset xref, Catalog/Pages/Kids/Parent/Contents, MediaBox and
stream byte lengths, and checks every drawing path and all four physical guides
on every page using `72/25.4` pt/mm. Tolerance is 0.00051 in each encoded unit.
Independent test-only oracle faults exercise wrong nominal origin, stale S0
geometry after S1, wrong SVG units/PDF page dimensions, wrong selected output
order, and wrong Module instance geometry. All must be rejected.

Two first-owner families were found:

* F1: `moduleSemanticAnalysis.ts` recognized only the leading namespace segment
  as an instance, losing a grouped instance's exported record field. M1 reduces
  this to `@Left::p::out.x = 3`; X1's top-level instance and the private-export
  rejection are controls. The fix delegates the group prefix to the existing
  lexical path resolver and preserves the instance/member spans.
* F2: `modulePreviewRoot.ts` rebuilt a graph-backed root as file-local semantics,
  losing imported and document-qualified nominal identities. M2 reduces this
  to a single imported record parameter and P=(7,19). X2 also exposes the same
  loss for a local record compiled through a graph; that exact local source
  through the ordinary non-graph compiler is the neighboring PASS. The feature
  adapter projects only the ephemeral root AST, reuses the saved graph and
  canonical graph analyzer/runtime context, and retains target-only rendering.

No new parser, resolver, evaluator, public syntax, dependency, or native host
behavior is introduced. The architecture's ownership and data-flow contracts
remain unchanged. The implemented Module reference documents grouped instance
qualification; no normative specification was changed.

Run `npx vitest run test/issue1488PatternArtifacts.integration.test.ts
--maxWorkers=1 --no-file-parallelism`. `ISSUE1488_RECORD` selects an owned JSON
observation path; `ISSUE1488_KEEP_ARTIFACTS=1` retains its temporary files. One
test-owned Rust process serves the complete matrix with 15-second request and
120-second per-root deadlines. Close/error listeners precede requests/disposal;
the process is awaited and ordinary test runs remove their temporary directory.
Retained run files are archived with hashes before their temporary roots are
removed.

Accepted new exploration: 12 primary + X1/X2 + M1/M2 = 16 of the 28 ceiling.
X3–X8 and M3–M8 are NOT_TRIGGERED. Rejected source bundles: 20 (15 rejected
drafts, four required saved-invalid-dependency controls, and one private-export
control). Historical fixtures,
negative controls, restoration/recovery, ablations, and reruns add no slots.
See `evidence/summary.json` and retained run records for final dispositions,
exact hashes, causal proofs, verification outcomes and limitations.

No Human GUI E2E PASS is claimed. Independent exact-pushed-HEAD review,
protected PR/CI, merge and final acceptance remain external to implementation.
Human weekly/five-hour quota readings: UNAVAILABLE.
