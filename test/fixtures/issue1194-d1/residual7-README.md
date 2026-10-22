# #1194 seventh D1 conformance slice

Base `0aa5ffee5d7f283633c622741e843c4a784fa305`; branch `sayosomi/issue-1194-residual7-d1`. Refs #1194. Three novel confirmed families F42–F44 are repaired. F01–F41 are historical controls. This is a bounded checkpoint, not completion of #1194 or the DSL.

| Family | First loss | Exact Base FAIL / adjacent Base PASS |
|---|---|---|
| F42 | Geometry collection runtime accepts only a single record field segment | A-min-alias / A-min-direct |
| F43 | Selected constructor-map program emission does not follow collection aliases | B-min-alias / B-min-direct |
| F44 | A second map cannot bind its source to a selected constructor-map occurrence | B-min-source / B-min-direct |

`residual7-families.json` retains the independent-family rationale and compact before/after compiler and decoded TS/persistent-Rust observations. F42 reuses the existing typed record-field traversal from `moduleGeometryRuntimeLowering.ts` for collection transport; no second accessor is introduced. F43 canonicalizes the collection identity before emitting its selected geometry occurrence. F44 retains an indexed source occurrence instead of requiring a concrete named record, emits its geometry producer, and reuses the existing scalar field projection owner. The alias-only intermediate still fails the source-chain probes. These are distinct from F40/F41 flat field admission/alias controls and F31/F39 direct map forwarding/construction.

## Frozen sources and sensitivity

24 exact legal source/bundles and independent expectations are in `residual7-cases.json` and `residual7-freeze.json`. Inputs are hand-authored, deterministic and use no random generator (seed: not applicable). Each source/bundle, expected values and SHA-256 was persisted before compilation/evaluation. Two rejected outer-geometry-capture reducer prototypes are separately retained as CONTRACT_INVALID in `residual7-rejected.json`; no rejected hash is added to legal acceptance.

The canonical compiler, TS reference, normal Rust eligibility, real Node-to-persistent-Rust stdio request and normal payload decoding are the only execution path. The runner derives from the sixth runner and reuses its assertion infrastructure. All Rust requests have the existing 10-second bound; Cargo build, tests, process lifetime and owned-child cleanup are bounded. No security settings or binary signatures were altered.

On the exact Base, all four changed production owners were temporarily replaced with `git show` Base bytes, with no production diff remaining. Candidate bytes were restored in `finally`, without Git reset/switch/stash. The final executable regression proof runs the six frozen reducer/control IDs in verify mode: **3 expected failures and 3 passes**, exit 1. The candidate passes all three regressions. Complete Base snapshots and the later saved-source replay are retained outside Git; their fingerprints are in `residual7-evidence-manifest.json`.

Checks cover nested nominal identities; scalar fields; point/line/path collection aliases; exact source-member order including duplicate `[Q,P,Q]` versus `[P,Q]`; cardinality and selected index; whole records, record arguments, private values and qualified exports; two asymmetric instances; canonical producer/alias closure; map occurrence closure; selected if/choice-match laziness; and a separately evaluated `1 / 0` negative control. A selected-index-1 two-map case distinguishes the second source record from the first. Saved dependency bundles use private local record types and explicit public Module re-exports, with two identically named but document-distinct definitions. No ambiguous imported record-type spelling is used.

## Results and residuals

**239 unique accepted legal hashes = 215 unchanged historical + 24 new.** No numeric ceiling is imposed. Final legal dispositions: **15 REPAIRED_THEN_PASS, 6 PASS, 3 UNRESOLVED**. The two separate rejected prototypes are CONTRACT_INVALID. `residual7-dispositions.json` contains every exact hash and outcome.

The 3 UNRESOLVED rows are B-construct-chain, B-construct-noalias and B-map-free-scalar-source. Constructor-source identity/program/projection loss is corrected and TS passes, but production Rust still lacks scalar-collection dependency release before geometry. The map-free Module control reproduces the same loss without records or record maps. `typedDependencyGraph.ts`'s geometry scalar dependency walk visits collection indices without following their scalar collection producers; the emitted construction consequently has no edge to the source bindings. This is the shared general scheduler residual owned by #1260, not another repaired family. No scheduler or Rust source was changed. Historical G9–G12 and G-construct/G-scalar-source/G-direct-control remain #1260-owned and were not re-explored.

File-public/qualified imported nominal record-type grammar remains CONTRACT_AMBIGUOUS/BLOCKED pending Human contract. Optional selected whole-collection source chains, arbitrary deep combinations, dynamic mapped-record selectors and unobserved geometry fields remain NOT_COVERED by this sample. No exhaustive correctness claim is made. Further exploration stopped after sensitive variants established these mechanisms and the remaining constructor-source failures reduced to the excluded scheduler.

## Verification and handoff

The required block passed once, in order: 529 focused PASS / 13 SKIP; 320 historical Stage PASS / 4 SKIP; build and lint PASS; parity 203 PASS; full npm 10,809 PASS / 170 SKIP; DSL reference and diff checks PASS. The Rust conditional is correctly not run because no Rust source changed. See `residual7-verification.json` for the verbatim required ordered block, actual results, bounds and log fingerprints. Settled pre-gate focused verification: **243 PASS / 6 SKIP**, including sixth-slice/Module/mapped occurrence controls. The seventh runner verifies **21 PASS / 3 explicitly deferred SKIP**. Language Core focused typecheck passes.

Only four canonical DSL/scalar production files, the seventh runner and compact task-owned fixture evidence changed. Syntax, normative specification, current DSL reference, architecture boundaries, UI, language services, dependencies, CI and Rust source are unchanged. Existing documentation remains authoritative; no obsolete task plan was introduced. Human Manual E2E is Not Required under this compiler/evaluator contract.

The supplied Human new-admission PASS was consumed once; current Issue authorization/comments and Project Context were read, fetch and the bounded main/topic/HEAD/clean/ownership recheck passed before creating the exact authorized topic. A later fetch still matched Base. No new checkout, metadata repair, main integration, force push, PR, merge or Issue closure. All owned evaluator children were closed. Exact pushed HEAD is supplied by Git/final handoff rather than a self-referential file hash. Keep #1194 OPEN for independent exact-HEAD blocking review and separate protected PR/CI integration.

Quota attribution: **CONFOUNDED** by concurrent independent Human use; measurement intentionally waived. No quota readings, estimates or attribution from counts/tokens/time.
