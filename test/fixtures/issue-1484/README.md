# Issue #1484 — retained metamorphic regression evidence

Base: `0b1181a410cd573392b685c0544654abac397232`.
Branch: `sayosomi/issue-1484-record-metamorphic-hunt`.
The containing commit is the exact candidate. Independent pushed-HEAD review belongs to ChatGPT.

## Frozen inputs and oracle

`matrix.json` contains all 48 accepted multi-document bundles, SHA-256 fingerprints and independent expectations. `generate.mjs` uses only an explicit integer model and source templates; it imports no product parser, compiler, type checker or evaluator. It ran before implementation observations. Geometry is mm, Y-up. E0 has gain 5; E1 saves gain 11 in `lib.nui` while leaving record R(x:number,y:number) intact. E0/E1 share one artifact cache and one production stdio process per test session; every E0 starts with a cold cache. E1 proves changed saved fingerprints, fresh output, unchanged old snapshots, and parsed-artifact reuse for unchanged facade/other dependencies. The dirty current-buffer control reuses the pre-existing #1439 dirty source and cannot replace the saved loader snapshot. No cross-epoch raw statement-ID equality is assumed.

Expected original nominal identities come from the frozen defining document role plus its exact within-epoch reconciled definition. The checker independently encodes that pair, verifies public/facade identities, record field ownership, nested optional/array identities, and each named record value. It compares runtime numeric/point observations by authored semantic roles. Raw TS/Rust payload equality is an additional parity check, never the semantic oracle.

The 12 initial R3 candidates in `rejected-candidates.json` use `@wrapped.rows[1]` as a whole-record conditional leaf. The current supported leaf forms do not include that property-based extraction (spec record-value section: whole-record reference or supported collection-index leaf; record analyzer rejects property-bearing whole-record references). Each was rejected with `record-reference-invalid`; none counts as an accepted primary cell. Same-cell replacements use the unambiguous `if (true) { @first } else { ... }` form. They retain optional/array fields, scalar selected-member access and the independent root observation. All sources/hashes remain frozen, including rejected candidates. Conservative exploration total: **48 accepted + 12 rejected = 60**. No additional source bundles or source reducers were generated. Causal reducers operate on one existing compiled expression/producer and exact per-fix ablation of the frozen bundles.

## Historical overlap and novelty

- #1439 direct/facade import acceptance, private/missing/wrong-family/no-import/unrelated-import/nontransitive rejection, cross-origin mismatch and dirty saved-source authority are retained controls. Existing fixtures/tests are rerun; they are not claimed as newly discovered behavior.
- #1376 root record forwarding, #1452 query freshness, and #1476 graph/Module prerequisites and typed geometry remain regression controls. Previous scalar/control-flow, nested scalar-to-geometry, GUI publication, whole-pattern/export, and performance campaigns are not reopened.
- New observations combine legal source transformations, saved revisions, imported nominal record forwarding through a nested local Module, and a record-array field with original inline constructor/reference identities followed by scalar projection into geometry.

## Proven producer families

**F1 — nested imported Module record backing context.** R2-T0-E0 freezes `first=(7,19)`, `second=(13,29)`, Read gain 5. Independent outputs: scores 54/94, root scalar 36, Result=(25,43). Base TS and production Rust both compute the scalars but omit Result and report `@left::out.x` / `.y` type failures. The minimal failing compiled observation is Result.dx=`@left::out.x`; the graph and record origin have already passed. `recordFieldBindingIdForSemanticTarget` searched imported child definitions using only a file-local analysis and dropped the parent context while following a local record alias. It now consumes the existing graph-backed ModuleRuntimeContext, original defining analysis/namespace, runtime instance path and parent context. No new resolver was added.

**F2 — record-array field member ownership.** R3 freezes Wrapped(maybe:first, rows:[f::R(37,41), first]). Original record semantics omitted inline constructors inside collection fields; Module semantics replaced both constructor and reference targets with `record-field:<offset>`. With F1/F3 intact and only F2 removed, TS/Rust fail on the missing binding for that synthetic target. The causal reduced producer is the first member of Wrapped.rows (expected original imported R, x=37); the second member must reference the actual first declaration. The record analyzer reuses its existing inline-array member registrar with owner-derived field/member identities, original spans and nominal types. Module field analysis retains those real constructor/reference targets (including its existing parameter target form). Files: `recordSemanticAnalysis.ts`, `moduleSemanticAnalysis.ts`.

**F3 — indexed collection-field scalar projection.** With F1/F2 intact and only F3 removed, R3 still fails at Result.dx=`@wrapped.rows[0].x`. The resolved member is valid and numeric, but lowering treats a field path crossing an array as an ordinary scalar binding. The record-member owner now carries the already resolved path through the indexed collection field in the existing semantic payload; runtime lowering projects the member field from that field's canonical contents collection and uses the existing collection-index transport. Root geometry numeric sites now request the same record-field projection producer as root scalar sites. At gain 5, R3 scalars are optionalX=23, observed=169, unaffected=186, and Result=(65,49); after save they are 23/307/186 and (71,43). No Rust protocol, parser grammar or user-facing syntax was added. Files: `recordSemanticAnalysis.ts`, `moduleSemanticAnalysis.ts`, `moduleSemanticTypes.ts`, `moduleScalarRuntime.ts`.

Each family has exact Base FAIL, independent oracle, normally eligible persistent Rust and TS observations, adjacent PASS roots R1/R4, fix PASS, removal-only FAIL and restored PASS. `ablation-runs.json` names the bounded selections and exit statuses. Base had 24 PASS cells and 24 FAIL cells; restored candidate has all 48 PASS. Each removal run has two failing original cells and four passing adjacent controls. Sources and expected values were unchanged throughout. Each family is reduced to its first incorrect producer without introducing a new exploratory bundle.

## Sensitivity and rejection controls

The semantic checker first accepts the unmodified observations, then detects three test-only faults: R4 first's observed nominal identity changed to the independent other-document origin; E1 numeric observed changed from 67 back to E0's 49; and E1 Result changed from (17,23) back to E0's (11,29). The numeric and geometry corruptions are checked separately. No production code or historical evidence is fault-seeded.

All required adjacent negative controls run in `issue1439RecordImports.test.ts`: ghost without import, unrelated import, private/nontransitive and wrong-family access, same-shape distinct-origin assignment, invalid saved dependency fail-closed, and legal direct/facade success. All 12 rejected candidates are also rerun and required to reject.

## 48-cell disposition ledger

Every final cell passes canonical graph/Module compilation, original nominal/field origin, independent scalar/geometry checks in both consumers, ordinary Rust eligibility, parity and epoch/cache assertions. Fingerprints, expected values and exact Base/fixed observations are in `ledger.json` and the observation artifacts.

| Cell | Base | Restored candidate |
| --- | --- | --- |
| R1-T0-E0 | PASS control | PASS |
| R1-T0-E1 | PASS control | PASS |
| R1-T1-E0 | PASS control | PASS |
| R1-T1-E1 | PASS control | PASS |
| R1-T2-E0 | PASS control | PASS |
| R1-T2-E1 | PASS control | PASS |
| R1-T3-E0 | PASS control | PASS |
| R1-T3-E1 | PASS control | PASS |
| R1-T4-E0 | PASS control | PASS |
| R1-T4-E1 | PASS control | PASS |
| R1-T5-E0 | PASS control | PASS |
| R1-T5-E1 | PASS control | PASS |
| R2-T0-E0 | FAIL F1 | PASS |
| R2-T0-E1 | FAIL F1 | PASS |
| R2-T1-E0 | FAIL F1 | PASS |
| R2-T1-E1 | FAIL F1 | PASS |
| R2-T2-E0 | FAIL F1 | PASS |
| R2-T2-E1 | FAIL F1 | PASS |
| R2-T3-E0 | FAIL F1 | PASS |
| R2-T3-E1 | FAIL F1 | PASS |
| R2-T4-E0 | FAIL F1 | PASS |
| R2-T4-E1 | FAIL F1 | PASS |
| R2-T5-E0 | FAIL F1 | PASS |
| R2-T5-E1 | FAIL F1 | PASS |
| R3-T0-E0 | FAIL F2/F3 | PASS |
| R3-T0-E1 | FAIL F2/F3 | PASS |
| R3-T1-E0 | FAIL F2/F3 | PASS |
| R3-T1-E1 | FAIL F2/F3 | PASS |
| R3-T2-E0 | FAIL F2/F3 | PASS |
| R3-T2-E1 | FAIL F2/F3 | PASS |
| R3-T3-E0 | FAIL F2/F3 | PASS |
| R3-T3-E1 | FAIL F2/F3 | PASS |
| R3-T4-E0 | FAIL F2/F3 | PASS |
| R3-T4-E1 | FAIL F2/F3 | PASS |
| R3-T5-E0 | FAIL F2/F3 | PASS |
| R3-T5-E1 | FAIL F2/F3 | PASS |
| R4-T0-E0 | PASS control | PASS |
| R4-T0-E1 | PASS control | PASS |
| R4-T1-E0 | PASS control | PASS |
| R4-T1-E1 | PASS control | PASS |
| R4-T2-E0 | PASS control | PASS |
| R4-T2-E1 | PASS control | PASS |
| R4-T3-E0 | PASS control | PASS |
| R4-T3-E1 | PASS control | PASS |
| R4-T4-E0 | PASS control | PASS |
| R4-T4-E1 | PASS control | PASS |
| R4-T5-E0 | PASS control | PASS |
| R4-T5-E1 | PASS control | PASS |

## Architecture and documentation impact

Existing compiler record/Module owners and the production evaluation payload boundary are reused. The optional internal indexed-field-path metadata makes the existing resolver's result available to lowering; it does not establish a new semantic owner or public API. Runtime uses the existing Rust record/collection descriptors. Source text, comments, layout, definition origin and canonical statement/member identity remain owned by their existing boundaries. No architecture ownership or primary entry point changed, so ARCHITECTURE.md remains current. The existing DSL Reference already documents optional/array nominal fields and scalar field observations; normative syntax/semantics are unchanged. The required DSL Reference check is run. No working plan documents were introduced or superseded.

## Limits

This is the closed 48-cell mission, not exhaustive proof of all record/control-flow combinations. All 12 additional inputs were consumed by retained rejected candidates; there is no exploratory capacity left. Host/GUI behavior was outside this host-neutral Issue; no Human GUI result is claimed. No Rust source changed, so conditional Rust source gates are not applicable. Required gate results are recorded in `gates.json` and the Issue checkpoint.
