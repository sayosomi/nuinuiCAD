# #1194 fifth D1 slice checkpoint

Base `9a19e02d5f916074368395f87b659931c99d9336`; topic `sayosomi/issue-1194-residual5-d1`. Refs #1194.

Four newly confirmed and repaired first-loss families F31–F34: **15 REPAIRED_THEN_PASS**, **9 genuine Base PASS**, **2 CONTRACT_INVALID** rows. The requested fourth-slice M1/P2/P4 are repaired. F01–F30, #1376 and Stage 1–7 remain merged controls. This intermediate checkpoint does not establish overall DSL conformance or close #1194.

## Independent oracle and accounting

The normative oracle is `docs/nui1/spec.md`, especially Records, optional/value control flow, Modules, Multi-document imports, and Choice literals and arrays. In particular, T is assignable to T?, T?[] preserves optional members, and an optional match's some binder has the exact underlying nominal type. These establish P2/P4 legality without guessing a new binder-constructor form. Indexing must preserve member order and reject an invalid index; only a selected match arm is evaluated. Imported fixtures declare private local record types inside each defining document and export Modules using the established `export module` form; no public/qualified imported record-type syntax is assumed.

`residual5-cases.json` and `residual5-freeze.json` contain 26 frozen source/bundle inputs and independently authored expectations. Every bundle and oracle was persisted before compilation/evaluation. Accepted source text never changed after evaluation; adaptive cases have separate IDs/hashes. The two rejected authored `public module` prototypes are retained separately as CONTRACT_INVALID and were replaced with separate, spec-legal `export module` bundles. They are not compiler defects or accepted inputs. The invalid implicit-unwrapping control requires compiler rejection; its initial guessed diagnostic code was not normative, and the final wildcard asserts rejection while retaining actual diagnostic evidence. No legality or value oracle changed.

All **171 historical accepted SHA-256 entries remain unchanged**. **17 newly accepted hashes; cumulative 188; no numerical ceiling.** P2/P4 were spec-valid but compiler-rejected in slice four; their first accepted fifth-slice hashes are newly charged. M1 and six other exact historical inputs are free replays. Both invalid source controls and the two rejected prototypes consume no accepted hash. The registry uses the established SHA-256 of compact ordered JSON `[[root.nui,source],...saved path/source sorted lexically]`.

| Cluster | Cases | New accepted | REPAIRED_THEN_PASS | Base PASS | CONTRACT_INVALID |
|---|---:|---:|---:|---:|---:|
| map | 5 | 0 | 1 | 4 | 0 |
| geometry-map | 2 | 2 | 2 | 0 | 0 |
| optional-members | 4 | 2 | 2 | 2 | 0 |
| optional-record-index | 9 | 9 | 7 | 2 | 0 |
| singleton | 2 | 2 | 1 | 1 | 0 |
| document | 2 | 2 | 2 | 0 | 0 |
| invalid-control | 2 | 0 | 0 | 0 | 2 |

Chronological replay ledger; counts are cumulative and deduplicated. Replays do not add accepted hashes:

| Phase | Compiler calls | Accepted cumulative |
|---|---:|---:|
| base-initial | 11 | 173 |
| fix-map-geometry | 3 | 173 |
| fix-optional-admission | 4 | 174 |
| fix-indexed-record-match | 5 | 176 |
| fix-indexed-producers | 6 | 176 |
| module-adjacent | 7 | 180 |
| fix-occurrence-selection | 7 | 180 |
| fix-optional-forwarding | 6 | 180 |
| selected-member-controls | 7 | 184 |
| fix-selected-member | 6 | 184 |
| fix-selected-member2 | 6 | 184 |
| document-adjacent | 3 | 184 |
| document-valid | 3 | 186 |
| candidate-all | 24 | 186 |
| base-exact | 24 | 186 |
| singleton-reduce | 2 | 188 |
| base-exact-singleton | 2 | 188 |
| focused-final | 26 | 188 |
| focused-producers | 26 | 188 |
| settled-focused | 26 | 188 |

## First incorrect owners and counterfactuals

| Family | First loss | Exact Base FAIL reducer | Genuine Base PASS controls |
|---|---|---|---|
| F31 | Constructor record-map geometry fields lose the selected source producer | M1 | M0, M6, M3 |
| F32 | Optional-record collection elements skip inline constructor analysis and nominal enrichment | P-length-constructor | P-length-reference |
| F33 | Indexed optional-record match loses its nominal selected binder and presence producer | P4 | P-scalar-control, P5 |
| F34 | Indexed whole-record exports omit the singleton producer required by their field projections | S-index | S-reference-control, M10 |

F31 is the geometry alias lowering owner: the canonical record-map constructor already contains the exact nominal binder field, but lowering previously stopped before following its selected source occurrence. F32 is constructor admission/identity analysis beneath an optional element wrapper. F33 is indexed optional-record match binding/presence, including its Module argument forwarding and conditional member consequences. Those downstream symptoms were initially blocked behind the same Base compiler rejection and are grouped as one family. F34 independently removes geometry and optionality: Base returns X=19/Y=43 through the direct scalar-field route, yet its recordField descriptors reference missing exported singleton producers. This is a compiler product/producer conformance failure, not a claim that the Base scalar values failed. Its whole-record-reference counterfactual passes every compiler and runtime check.

`residual5-families.json` names exact canonical owners. `residual5-first-loss.json` records Base and settled compiler producers/nominal identities, missing source edges, actual TS/Rust decoded scalar values or errors, normal eligibility and exact wire hashes. M1 changes from `evaluation-geometry-property-unavailable` to L=5/N=21; P2/P4 change from compiler rejection to X=19/Y=31. The parameter cases distinguish named versus inline arrays, present versus explicit none, two asymmetric instances, and an invalid index. P-conditional-member checks both selected binder reconstruction and an unselected division-by-zero arm. Geometry cases verify chained constructors, two asymmetric Module instances, two same-text but document-distinct local nominal types, physical lengths and endpoint coordinates.

Authoritative Base replay phases `base-exact` and `base-exact-singleton` restored all **seven changed production files** to exact `git show Base:path` bytes. Both fingerprints equal the initial unchanged Base fingerprint. Candidate bytes were saved externally and restored byte-for-byte in `finally`; no reset, stash, extra worktree or integration recovery was used. The manifest retains Base/intermediate candidate/final owner hashes. A focused regression exposed three existing descriptor-count assertions; the repair was narrowed to reuse original aliases and field declarations, so all original assertions pass unchanged.

The focused runner is `test/issue1194Residual5D1Rust.integration.test.ts`. It reuses canonical compilation, graph-backed saved sources, the TypeScript reference, normal `prepareRustEvaluation` eligibility and persistent production `RustEvaluationProcess`. It checks exact stdin JSON, independently decodes values/errors, verifies nominal definition and producer closure, checks defining document identities and geometry instance paths, then compares normalized parity. No parallel evaluator, semantic framework, runtime absence model or new Rust transport was introduced.

## Residual scope and stopping boundary

- Fourth-slice M1/P2/P4: **REPAIRED_THEN_PASS** in the fifth runner. Historical fourth-slice observations/skips remain immutable evidence.
- File-public record definition / qualified imported record-type spelling: **CONTRACT_AMBIGUOUS/BLOCKED**, awaiting an authoritative grammar/visibility decision.
- Third-slice G9–G12: **UNRESOLVED**, general root scheduling belongs to #1260 and remains excluded.
- Dynamic optional-record indices, nonliteral collection control-flow routes, new geometry constructions inside mapped record fields, and geometry-collection Module parameter combinations: **NOT_COVERED** by this slice. See `residual5-residuals.json` for precise boundaries.

The priority reducers and adjacent high-value mechanisms reached a reviewable checkpoint. No input, family or evaluator request cap was imposed. No new broad green matrix was generated after counterfactuals separated the first losses. No host/UI/lifecycle, generic root scheduler, normative syntax/specification, dependency, packaging, CI or architecture boundary changed. Existing DSL documentation already describes these semantics; the DSL reference gate verifies consistency.

## Verification and process evidence

Final focused owner regressions plus fourth/fifth runners: **268 PASS / 3 historical SKIP**. Settled fifth runner: **26 PASS**, comprising 24 legal eligible TS/Rust comparisons and 2 rejection controls. Required unchanged ordered block: historical/Stage runner **320 PASS / 4 SKIP**; build/lint/DSL reference **PASS**; parity **203 PASS**; full npm **10,760 PASS / 164 SKIP**; Rust fmt/check/test (**621 PASS / 9 ignored**)/clippy and diff check **PASS**, exit 0. Full verification ran once on settled production bytes. The original Rust conditional compares 4a43b27f, so Rust gates ran although this slice has no Rust production delta. `residual5-verification.json` retains exact commands, results and log hashes. Final remote main, Issue contract/comments and ownership recheck remained unchanged. No owned evaluator/test child remained.

Instrumented fifth runner counts only: compiler **204**, blank setup compiler **20**, TS reference **176**, production Rust stdio requests **176**. These are not full-suite counts or quota estimates. Every owned persistent child was disposed and close awaited; no recorded request/resource timeout or process hang. Bulky raw compiler/transport evidence stays outside Git in `/tmp/issue1194-residual5/`; gate log `/tmp/issue1194-r5-gates.log`, focused log `/tmp/issue1194-r5-focused2.log` and settled log `/tmp/issue1194-r5-settled.log`. Compact frozen sources, first-loss observations, dispositions, cumulative registry and manifests live beside this README.

Human original weekly baseline **74%**. The latest Human-reported observation in #1194 is **57% after slice four**; that comment also states seven points consumed, inconsistent with the preceding 63% reading, so no attributable consumption is inferred. Fifth-slice ending quota, attributable weekly percentage-point cost and five-hour remaining are **UNAVAILABLE**. Evaluator requests and token counts are not quota measurements.

Next safe action: independent blocking review of the exact pushed topic HEAD against Base, F31–F34 first-owner proof and genuine Base controls; replay the fifth runner and inspect residual dispositions. PR creation, integration/CI approval, merge and Human clean-main return remain with the independent ChatGPT/Human workflow. Keep #1194 open.
