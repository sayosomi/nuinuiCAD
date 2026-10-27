# Higher-order endpoint regression fixtures

Run `npm test -- test/issue1410HighOrderLineAngleRust.integration.test.ts`.
The suite uses the canonical compiler, TypeScript reference and the production
Node `RustEvaluationProcess` → persistent `evaluation_stdio` boundary. Rust
eligibility, serialized endpoint targets and independent numeric oracles are
asserted separately. A TypeScript/Rust match alone is insufficient.

`cases.ts` retains the complete matrix declared before exploration: A72, B96,
C324, D96, E32 and F48. IDs, factors and original source texts remain stable.
`adjacent.json` retains the exact four #1408 anomaly sources, minimized
reproductions and passing controls. `invalidVariants` also retains the 108 intermediate split trial sources that
indexed Source but still used an ambiguous bare Cut. `legalVariants` preserves all 216 indexed
counterparts of the invalid original C sources, linked by `L-Cnnn` → `Cnnn`.

## Legality

The original C offset/split programs read `@Source.base` inside a two-iteration
statement-for (split also reads bare `@Cut`). The normative statement-for
contract in `docs/nui1/spec.md` says bare `@Name` requires exactly one available
occurrence and otherwise reports collection-index-unavailable. On iteration one
these names are ambiguous. Their final disposition is CONTRACT-INVALID, with
that diagnostic required in both evaluators. They are never counted as numeric
passes. Their original numeric hypothesis remains in `legalExpected`.

The indexed counterparts use `@Source[@i].base` / `@Source[@g].base` and an
explicit matching Cut occurrence. They retain every geometry, transformation,
endpoint, scheduling, collection carrier and member-index combination. No
current-row fallback is introduced for ambiguous authored geometry inputs.

Original matrix accounting: 420 numeric cases, 32 diagnostic-boundary cases and
216 CONTRACT-INVALID cases. The legal counterparts add 216 numeric cases.
Every E diagnostic has a retained adjacent passing source.

## Independent geometry

All measurements use a non-coincident axis at 7 degrees. Generated polar lines
have axes 23 + 11*occurrence degrees. The CCW arc runs from 287 to 38 degrees;
its endpoint tangent axes are 17 and 128 degrees plus the occurrence rotation.
The asymmetric cubic has endpoint derivative axes 34 and 137 degrees. Selected
and later rotations are 13 and 31 degrees, so base, selected and final snapshots
are distinguishable. Module Two adds 21 degrees and a distinct translation.

The directionless angle is `acos(abs(dot(unit tangent axes)))` in degrees.
Reverse swaps endpoint axes. The selected split is the far segment `[.37,1]`;
its start tangent comes from the analytic cubic derivative at .37 (de Casteljau
coordinates are calculated in the generator), not from the chord. Offset cases
read the evaluated parallel path. Translation, independent declaration reorder
and consistent renaming must preserve the oracle. `previousExpected` checks the
incoming immutable snapshot independently of the final carried result.

## Reduced boundaries

- X01: indexed geometry carry next; X02 and retained reversed-arc seeds: named
  stage must exist before next snapshot capture.
- X03: a geometry carry is a legal collection member with its exact binding.
- X04: Module parameter → carry → export retains the caller's carry identity.
- X05: the canonical dependency graph releases an independent generated owner
  before a forwarding carry, even if declarations are reordered.
- X06: bulk and indexed recipes preserve authored order and execute once per
  occurrence; an unavailable future index must not stall the scoped scheduler.
- X07–X09: geometry input indices retain typed iteration bindings and selected
  stages survive lowering and production wire decoding. Literal/no-stage
  controls distinguish numeric-index lowering from stage transport.
- X10 and its reductions: Module parameter property reads must keep the exact
  carry binding, wait for the carry owner's completion, and serialize a finite
  source position. Independent Module declarations cannot be consumed as loop
  body statements. Module geometry values wait for scalar inputs as well as
  selectors; the literal construction is a passing pre-fix control.

Complete per-run sources, compiler targets, serialized requests/responses,
TypeScript and Rust outcomes, revision hashes and final ledger are retained by
the implementation execution alongside its Issue checkpoint. The permanent
fixtures regenerate all sources and assertions without that local evidence.
