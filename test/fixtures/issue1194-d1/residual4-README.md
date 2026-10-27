# #1194 fourth D1 slice checkpoint

Base `28a6161a0460c284921cc7920b8a7463f0504663`; topic `sayosomi/issue-1194-residual4-d1`. Refs #1194.

Six newly repaired first-loss families, **18 REPAIRED_THEN_PASS**, **12 genuine Base PASS**, **3 UNRESOLVED** rows. F01–F24, #1376 and Stage 1–7 remain merged regression controls. This bounded checkpoint does not close #1194 or assert overall DSL conformance.

## Frozen oracles and accounting

`residual4-cases.json` and `residual4-freeze.json` retain 33 exact source/bundle cases and independent expected results. The normative oracle is `docs/nui1/spec.md`: Records, value-control-flow/optionality, Modules, Multi-document imports, and Choice literals and arrays. No file-public or qualified imported record-type grammar is assumed. Sources, expected values and bundle hashes were written before evaluator execution. New cases were immutable once evaluated; later reducers/controls have separate IDs/hashes.

The full historical 140 accepted SHA-256 entries are preserved verbatim through `residual3-input-registry.json`. **31 newly accepted hashes; cumulative 171; no numerical ceiling.** Historical 112/144 ceilings remain historical observations, not active restrictions. P2/P4 are separately retained spec-valid compiler-rejected hypotheses, not accepted hashes or CONTRACT_INVALID declarations. M1 was accepted and remains charged despite its failing runtime result.

| Cluster | Frozen cases | Newly accepted | REPAIRED_THEN_PASS | Base PASS | UNRESOLVED |
|---|---:|---:|---:|---:|---:|
| map | 12 | 12 | 8 | 3 | 1 |
| optional-members | 11 | 9 | 6 | 3 | 2 |
| document | 4 | 4 | 0 | 4 | 0 |
| nested-record | 6 | 6 | 4 | 2 | 0 |

Chronological discovery/reduction/repair replay ledger (accepted counts are cumulative, deduplicated; replays add nothing):

| Phase | Compiler calls | Accepted cumulative |
|---|---:|---:|
| base-initial | 8 | 146 |
| base-reduce1 | 6 | 149 |
| base-controls | 3 | 152 |
| fix-optional-fields | 5 | 155 |
| fix-map-chain | 1 | 155 |
| fix-map-fields | 4 | 155 |
| adjacent-module-document | 5 | 159 |
| fix-module-omission | 2 | 160 |
| nested-map | 2 | 161 |
| fix-nested-alias | 1 | 162 |
| fix-nested-contents | 6 | 162 |
| fix-identity-map | 2 | 162 |
| nested-document-depth | 4 | 165 |
| fix-nested-module | 5 | 166 |
| affected-parameter-geometry | 2 | 168 |
| candidate-all | 30 | 168 |
| base-exact | 30 | 168 |
| final-adjacent-control | 3 | 171 |
| base-exact-extra | 3 | 171 |
| focused-final | 30 | 171 |

## Independent FAIL-before / PASS-after

| Family | First-loss mechanism | Exact Base FAIL reducers | Genuine Base PASS controls |
|---|---|---|---|
| F25 | Omitted optional scalar record fields are reparsed as field names | P3, P10 | P5, P11 |
| F26 | Optional scalar record fields are discarded at the root semantic adapter | P0 | P6, P5 |
| F27 | Collection-literal fields of a mapped record lose their source binder occurrence | M4 | M8, M3 |
| F28 | Chained and aliased record maps lose collection-field producers | M5, M7 | M8, M3 |
| F29 | A nested whole-record constructor field loses scalar and collection paths | N0, N1, N4, N5 | N2, N3 |
| F30 | Whole-binder record maps drop the original record occurrences | M6, M10 | M0 |

`residual4-families.json` names the exact first owners and repairs. `residual4-first-loss.json` retains compact compiler diagnostics, missing producer IDs/field aliases, typed nominal identities, independent scalar observations, normal eligibility and canonical prepared-input hashes. F25 and F26 have independent counterfactuals: explicit `none` still fails at the optional root adapter in P0, while standalone explicit `none` passes P5. F27 reconstructs a field literal from binder members; F28 loses a preceding map/alias producer even with no reconstructed literal. F29 groups the root compiler exception, Module missing declaration, and nested collection reference as one nested-whole-record projection family, rather than counting assertions separately. F30 is only a whole-binder identity map, not constructor-map geometry. F07's original single-map field forwarding remains a passing historical control, not new novelty.

Authoritative Base replay phases `base-exact` and `base-exact-extra` restored **all four changed production files** to exact `git show Base:path` bytes. The source fingerprint equals the unchanged initial Base fingerprint. Candidate bytes were saved externally and restored exactly in `finally`; no reset, stash, checkout recovery or extra worktree was used. `residual4-evidence-manifest.json` records the four Base/candidate file hashes. Standard compiler exceptions were preserved as failures, not runtime PASS or resource hangs.

The runner is `test/issue1194Residual4D1Rust.integration.test.ts`, reusing the established canonical document compiler, graph-backed saved bundle, reference evaluator, production eligibility preparation, persistent `RustEvaluationProcess`, independent payload decode assertions and parity normalization. One real Rust stdio child per invocation; every stdin request's input object is checked against canonical prepared input. Compiler checks include nominal definition identities, every collection index/length producer edge, source member identity for F30, and distinct two-level imported geometry instance paths in D4. M11 checks that an unrequested failing collection member is not evaluated. N4/N5 and M10 check asymmetric Module occurrences.

## Residual dispositions and stopping boundary

- **M1 — UNRESOLVED:** a record-map constructor containing a geometry field still loses its selected geometry producer. TS and normally eligible production Rust both fail the independent path-length oracle. The direct collection control M0 and repaired whole-binder map M6 distinguish this from a general root scheduling defect. This needs the existing constructor-map geometry owner to carry the field occurrence; it is not reported repaired by F30.
- **P2/P4 — UNRESOLVED:** `Box?[]` inline record constructors and optional-indexed record match binders remain compiler-rejected. P4 replaces constructors with references to isolate the binder loss. The spec establishes optional element types and indexing; these are not invalid syntax claims, runtime passes, or guessed public record type spelling. No partial optional-record runtime representation was added.
- **Original third-slice G9–G12 — UNRESOLVED, #1260 coordination:** generic root geometry selector/dependency scheduling remains outside this patch; no duplicate repair or novelty claimed.
- **File-public record definitions / qualified imported record type spelling — CONTRACT_AMBIGUOUS/BLOCKED:** separate pending product contract decision; no syntax/spec changes.
- Other deeper structured-value/Module/document permutations are **NOT_COVERED**. The four document bundles cover two same-name nominal definitions, explicit re-export, optional parameter reconstruction, a foreign nested Module call, caller type shadowing and asymmetric geometry producers; their Base PASS results did not justify generating more equivalent green bundles.

The probe clusters have been reduced and separated into six repaired mechanisms and the explicit frontiers above. Work stops at this reviewable intermediate checkpoint, not an input/family/request cap or overall Issue completion. No numerical stop was imposed. No unrelated root scheduler, host/UI/lifecycle, normative syntax, dependency, CI, packaging or architecture owner changed.

## Verification and process evidence

Final focused semantic owners plus fourth-slice runner: **242 PASS, 3 explicit unresolved skips**. Required seven-file historical/Stage regression command: **320 PASS, 4 historical unresolved skips**. Required block ran unchanged and in order: build, lint, parity (**203 PASS**), full npm (**10,734 PASS / 164 skip**), DSL reference check, Rust fmt/check/test (**621 PASS / 9 ignored**)/clippy and diff check all PASS. The original Rust conditional uses the original third-slice Base, so Rust gates ran even though this fourth slice has no Rust production changes. Full suite ran once on the settled implementation. After resume, the completed log and unchanged production hashes were checked; only the final silent diff check was repeated.

Instrumented fourth-slice runner counts only: compiler **152**, blank setup compiler **20**, TS reference **132**, real Rust requests **132**. These are not complete repository-suite invocation counts or a quota estimate. `residual4-telemetry.json` retains each run and cumulative input count. No recorded request/resource timeout; every owned child was disposed and its close awaited. No owned evaluator/test child remained at resume.

Compact evidence lives beside this README. Bulky compiler/transport logs stay outside Git in `/tmp/issue1194-residual4/`; required-gate log `/tmp/issue1194-r4-gates.log`, focused log `/tmp/issue1194-r4-focused-final.log`. `residual4-verification.json` records command/result/log hashes and the resume verification limitation honestly.

Human original weekly baseline **74%**. The Issue reports **63% after the third slice**. Fourth-slice ending quota and attributable consumption are **UNAVAILABLE**; five-hour remaining is UNAVAILABLE. No request/token-based quota inference.

Next safe action: independently perform blocking review of the exact pushed topic HEAD against Base, inspect F25–F30 first-owner proof and genuine Base controls, replay the focused runner and assess all explicit unresolved dispositions. PR creation, protected CI/integration, merge and Human clean-main return belong to the independent ChatGPT/Human workflow. Keep #1194 OPEN; do not switch to #1260 or resolve the ambiguous grammar by assumption.
