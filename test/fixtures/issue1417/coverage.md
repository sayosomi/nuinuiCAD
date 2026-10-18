# Stage 2 historical subtraction

Baseline: `ebb00adfb84cf6a38cba6401a23ad2a0be9daa0e`. This ledger and the
512-ID manifest were established before executing any novel Stage 2 program.
`coverage.tsv` is coverage classification, **not final result disposition**.
Every row is PARTIAL: related assertions exist, but none establishes the exact
seed × shape × transformation with a full independent oracle, compiler ownership
checks and production persistent Rust. No ALREADY-COVERED discovery is repeated.

Evidence keys (actual assertions inspected at the baseline):

| Key | Closest owner and actual assertions | Remaining gap |
| --- | --- | --- |
| C1 | `src/scalars/scalarProgram.integration.test.ts`, “compiles and evaluates scalar and choice value-if declarations”: amount=10, side=left, after=30; unselected 1/0. `src/scalars/expressionEvaluator.test.ts`, “does not observe an unselected branch runtime error”: exact number=10. | TS-only scalar controls; no prerequisite permutation/rename matrix, compiler conditional graph or persistent Rust/model comparison. |
| C2 | Same scalar-program file, “compiles and evaluates exhaustive choice matches”: amount=5 and side=left. Expression evaluator “does not observe an unselected arm runtime error”: exact number=10. | Exact choices tested, but no Stage 2 seed transformations, runtime-zero selected contrast or production compiler/Rust oracle. |
| V1 | `test/valueForNonProgramBindingRust.integration.test.ts`: reduced indexed map=1; constant-body=2; padding/unrelated=1; length=1. Asserts preResolvedOnly binder, no executable version/history, clean diagnostics and real Rust parity. | Only singleton observations; no full ordered maps at lengths 0/2/4 or all independent transformations. |
| V2 | V1 owner plus `test/rootCollectionCarryValueForRust.integration.test.ts`: incoming identity result=1, repeated map result=4, two mapped carry results 34/13, named-source result=5, two carry swap results 2/1, alias map result=4 and asymmetric Module observations 4/1/13/2, with TS and real Rust. `src/scalars/immutableCarry.integration.test.ts` separately asserts static map elements 3/5, length=2 and mapped carry results 37/13 in TS. | Existing carried maps are not two chained immutable root maps with distinct binders and all four transformations/full maps. |
| S1 | `src/scalars/immutableCarry.integration.test.ts`: multiline scalar carry result=3; initializer outside frame result=3 (TS). `test/moduleCollectionStatementForRust.integration.test.ts`: direct numeric collection count=1, asymmetric counts=2/3, empty initializer=7, alias/local sums=5, both evaluators. `test/rootScalarCarryCollectionIndexRust.integration.test.ts`: selected indexed next result=2, renamed/alias total=14, expected index diagnostics. | Root numeric snapshot matrix, every escaped value, 0/1/2/4 iterations, compiler owner and equivalent transformations not jointly asserted. |
| S2 | Immutable-carry integration “swaps multiple carries”: 0/1 swap three times, result a=1 (TS only). `test/geometryCarryIfMatchNextRust.integration.test.ts`, “lowers direct, if, and choice-match construction leaves”: one numeric swap first=4, second=3; direct point=(3,4) asserts incoming snapshot in both evaluators. | No two numeric cross-update matrix, reordered next declarations, both final values across lengths or numeric history/model checks. |
| X1 | Scalar-if control inside immutable-carry integration: scalarResult=6 (TS). Root scalar collection-index test asserts iteration-selected collection values; geometry conditional next tests assert point=(1,2), branch=(5,6). | Numeric conditional **next** over incoming scalar carry, per-iteration branches, transformations and lazy runtime-zero error attribution not covered by those geometry/collection controls. |
| X2 | `test/rootCollectionChoiceMatchCarryRust.integration.test.ts`: choice binder remains alive, full final [21,22,23], length=3; renamed/alias/reversed arms same; failing unselected collection arm yields 2. Geometry-if-match next: selected point=(7,8), match path length=5. | Numeric match-next carry with exact choice binder, per-iteration incoming scalar snapshots and four transformations remains untested. |

Historical issue subtraction:

- #1103: 86 valid variants, four geometry/dependency/Module families repaired;
  broad collection/loop/lazy cross-products explicitly unclosed. No retained
  complete Stage 2 numeric matrix oracle.
- #1106: 133 accepted inputs, six families (ordinal collection binder, Module
  carry execution owner, fractional next order, optional literals/types/binder).
  Broad source-order permutations and lazy cross-products explicitly residual.
- #1193: 111 accepted inputs / five families. SAY-468's repaired analysis-only
  map binder is V's compiler/runtime smoke, not a new finding. Geometry maps,
  record version order and Module geometry payloads do not close these slots.
- Open #1260: R1–R8 retains heterogeneous/geometry/collection carry swaps, deep
  control/gates, range boundaries, limits and diagnostic ordering/suppression.
  Scalar shallow controls are partial evidence only. Its last audit had R1/R2/R4
  partial results and unresolved residuals; this task does not take their repair
  ownership. Open #1194 owns structured/optional/Module/document transport.
- Repaired #1312: canonical geometry if/match-next plans (including compiler
  accepted pure leaves), laziness, snapshot and missing-plan regression. Actual
  assertions in the geometry test above protect that family; geometry is outside
  the Stage 2 numeric generator.
- #1415: 256 scalar root/Module pairs independently modeled and checked against
  compiler, TS and persistent Rust; no if/match/maps/statement-for/carry. Reuse
  its harness, exact integer approach and native fast-check replay/shrinking.

Normative legality: `docs/nui1/spec.md` typed value control flow (both arms
checked, selected-only runtime), collections/value-for (exact type, size/order,
lexical binder), statement-for (ascending positive-step inclusive ranges, empty
collections), immutable carry (shared incoming snapshot, simultaneous commits).
All generated arithmetic is bounded exact integer arithmetic. Choice scrutinees
are explicitly `choice(left, right)`; no numeric conversion is generated.
Zero-iteration loops use empty collections. Line breaks occur at statement or
already-open delimiter boundaries. Rejected attempts must be retained separately
and must never turn a compiler-invalid laziness case into PASS.

Second reconciliation: all 512 classifications remain PARTIAL. The V2 evidence
description above corrects the initial ledger's attribution of TS-only 3/5 and
37/13 assertions to the persistent-Rust test (whose actual snapshot result is
34/13). No row was subtracted as ALREADY-COVERED and no matrix ID changed.
