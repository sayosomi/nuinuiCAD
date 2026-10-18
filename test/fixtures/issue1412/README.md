# Finite lineAngle interaction closure

Issue: [#1412](https://github.com/sayosomi/nuinuiCAD/issues/1412).
Base: `8094ca8ef9ef18a77bd22e5829feaf62fa0c003b`.

Run `npm test -- test/issue1412LineAngleInteractionRust.integration.test.ts`.
The suite compiles canonical nui1, checks independent analytic oracles against
TypeScript and the production persistent `evaluation_stdio` process, and observes
the actual production stdin envelope. Compiler endpoints must survive serialization;
carry IDs must identify real plans and geometry-value occurrences must identify real
program entries. Positive cases also require zero stray geometry-value errors.

## Coverage union

`coverage-union.json` retains all 768 original slots, their initial classifications,
exact historical evidence/control references, original source attempts, normative
legality proofs, current source hashes, duplicate representatives, final dispositions,
endpoint targets, measured results and serialized production-input hashes.
`cases.ts` generates the eight closed Cartesian products without probing a compiler.
`adjacent.json` retains reductions, passing contrasts, original direct-branch
counterparts and selected-invalid-branch counterparts.

Before the first novel compiler request, the persisted union classified 24 exact
historical interactions, 732 partial interactions and 12 invalid-stage slots. The
24 exact interactions retain #1410 B source bytes for selected-stage aliases and
Module parameter exports, both endpoints, all shapes and both frames. Historical
controls are not added as disjoint coverage: the #1404/#1406 matrices, #1408 B/K/R
fixtures (including two-level occurrence 0/3), #1410 original/adjacent cases and the
named carry/Module/collection repository tests remain explicitly linked controls.
A fixed typed `pick=1` is not changing-selector coverage. Updating Module carry
cases change their initializer, unlike a stationary forwarding control.

Final original-slot dispositions: **756 ALREADY-COVERED, 12 CONTRACT-INVALID**.
The covered slots contain 708 numeric and 48 runtime-diagnostic cases. All 154
adjacent cells are covered: 106 numeric and 48 runtime diagnostics. There are 51
explicit duplicate-source cells across the union. The 12 nonexistent-stage slots
retain compiler diagnostics and physical spans, never numeric passes. Illegal
implicit Module-capture drafts remain recorded alongside legal same-factor sources;
the original legal root branch sources remain as `O-Bnnn` counterparts.

**835 distinct new compiler-accepted exploratory sources** were used. Identical
reruns and the 24 exact historical sources are excluded. The 2,400 ceiling applies
to distinct accepted source bytes, not verification requests. All 922 cells have
final dispositions: **no unexplored or unresolved cells within this scoped model**.
This says nothing about arbitrary nui1 programs outside these products and admitted
same-factor adjacent cases.

## Analytic oracle and discriminators

The independent directionless axis angle is `acos(abs(dot(unit(u),unit(v))))`.
Line axes start at 23 degrees. The CCW arc radius angles 287/38 give endpoint
axes 17/128 degrees. Asymmetric cubic endpoint derivatives have axes 34/137.
Generated occurrence turns, asymmetric sibling turns, named rotations and the later
rotation are separate terms. Reverse swaps endpoint derivatives. Split returns the
far segment `[.37,1]`; its start uses the analytic cubic derivative at `.37`,
calculated from de Casteljau control points, rather than a chord. Offset uses the
parallel evaluated path. The two P operands have independently selected owners,
turns, occurrences and endpoints, with an operand-swap control in the same source.
D checks both selected members and the changing index snapshot. N uses two or three
values per loop at depth two or three, first/interior/last selection, and propagated
inner/outer immutable carries. B retains unused disabled leaves and genuinely
selected disabled counterparts; X09/X10 independently check simultaneous snapshots.

## Repaired boundaries

| Family | Reduced evidence / passing contrast | Owner-correct repair |
| --- | --- | --- |
| Exported indexed alias loses its target | X01 / C-X01 | Retain the declaration's lazy geometry-value program and caller-bound index. |
| Deferred child export drops a Module carry plan | X02 / C-X02 | Preserve semantically deferred references through materialization. |
| Cross-Module carry readiness omits the owner | X02, M / C-X02, N/R controls | Use the canonical carry-owner graph; lexical incoming and body-final views do not wait on their enclosing loop. |
| Conditional geometry leaves reject stages/indexing | X04, X11 / X03, C-X11 | Pass existing geometry-property/index AST leaves to the canonical geometry resolver. |
| Module conditional next lacks a runtime plan | B Module cells, X09/X10 / C-X09/C-X10 | Reuse geometry value control-flow semantics and the existing immutable next construction plan. |
| Frame-local aliases run without their snapshot | X04, X08 / X03, C-X08 | Share root/Module capture of already-resolved programs; keep frame templates lazy. |
| Indexed nested forwarding qualifies a carry twice | X05 / C-X05 | Preserve the already-qualified runtime binding ID. |
| Rust geometry-value references bypass generated occurrences | X04 / X03 | Reuse the canonical generated-occurrence/stage resolver for value references. |
| Line carry snapshots omit required value fields | X06 / C-X04 | Serialize complete line values using the existing segment kernel, preserving valid/degenerate tangent information. |
| A dependent value releases before a source-fenced predecessor | X07 / C-X07 | Consult current canonical dependency completion during both TS and Rust release passes. |

The new internal capture helper shares one projection between root and Module
lowering. It consumes resolved programs and lexical ownership; it introduces no
parser, resolver, scheduler, public syntax, dependency, or normative semantics.
Subsystem ownership and production entry points remain those in `ARCHITECTURE.md`.
The implemented builtin reference is clarified consistently with the existing spec.

## Verification and external gates

Required regression suites include #1404, #1406, #1408, #1410 and the named
carry/Module/collection tests, together with affected compiler, scalar and runtime
coverage. Required gates are build, lint, DSL reference check, TS/Rust parity, full
npm tests, Rust fmt/check/tests and Clippy with warnings denied. The final exact
runtime verification revision is recorded in the union and PR; later evidence-only
commits preserve those runtime source bytes.

Manual E2E is **Not Required for #1412** under the current `MANUAL-E2E.md` rule:
these acceptance conditions are deterministic compiler/evaluator checks. #1373's
Human GUI E2E remains separate. Independent exact-pushed-HEAD blocking review,
required GitHub Actions CI, protected merge and merged-main readback remain external
gates; implementation verification does not claim those outcomes.
