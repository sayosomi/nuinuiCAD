# Issue #1446: point[] indexed `from(source:)`

## Frozen cases

The source and oracle hashes remain unchanged:

| Case | SHA-256 | Before | After |
| --- | --- | --- | --- |
| `C-coordinate` | `306311f4de9be9a6331a39e6dc2ff03c946e411a7f282df6436eda157a0ee504` | Compiler valid; no source input target; TypeScript emitted no geometry and reported unavailable source geometry; Rust eligibility false, so no Rust request was made. | Compiler valid; TypeScript and persistent Rust emit `Observed = (3,4)` with no errors; normal Rust eligibility true. |
| `C-coordinate-control` | `e77f13db40523a7dc7f91c0a6c6dada8697d746d776e63f96c260db8dd1766aa` | Compiler valid; no source input target; TypeScript reported unavailable source geometry; Rust eligibility false, so no Rust request was made. | Compiler valid; TypeScript and persistent Rust emit `Observed = (3,4)` with no errors; normal Rust eligibility true. |

The original limited discovery replay (`discover-1792745497326`) confirmed empty compiler diagnostics for both. The discovery process completed, but both product results remained UNRESOLVED; that process status was not counted as a case pass. The compiler had resolved each `@Points[0]` site as a `collectionIndex`, while `geometryInputTargetsByElementId` was absent. The literal case’s collection member was a coordinate point; the control member retained the `geometryValue` occurrence for `P`.

## Adjudication and repair

Both cases share one first-loss family: canonical lowering in `packages/nui-language/src/dsl/dslDocument.ts` dropped ordinary root authored `collectionIndex` targets. Once exposed, the literal-coordinate member also needed to be lowered into the collection node, and point materialization needed to consume a coordinate as an identity-free point value. The named-point collection target exposed a source-order mismatch: the immutable root collection declaration index was not in the Rust geometry execution-order domain.

The repair is limited to those owners:

- `packages/nui-language/src/dsl/dslDocument.ts` lowers root authored collection indexes and coordinate members. Root immutable collection order is marked non-runtime; selected member availability is still checked when materialized.
- `src/geometry/materializedEvaluator.ts` evaluates coordinate anchors only at the `materializedPoint` source boundary and materializes the result with the destination element identity.
- `rust-evaluator/src/evaluation/mod.rs` applies the same point-only coordinate conversion using the ordinary numeric evaluator, preserving expression errors.

The source point remains identity-free. The new drawable owns the `Observed` element ID and name. `C-coordinate-control` and the direct `from(source: @P)` control preserve the immutable point value separately from the output drawable.

## Regression evidence

`test/issue1446PointIndexedMaterialization.integration.test.ts` replays both frozen sources through the canonical compiler, TypeScript reference evaluator, normal Rust eligibility/preparation, and one persistent Rust process. It checks the collection member and prepared input target identity, verifies the separate output identity and `(3,4)` coordinates, compares TypeScript and Rust outputs, includes direct materialization from a named immutable point, and rejects an intentionally changed coordinate.

Focused result after the repair: **PASS**, 1 test / 1 passed (2026-10-23 18:08 JST). The complete required verification block is recorded in the task completion report.
