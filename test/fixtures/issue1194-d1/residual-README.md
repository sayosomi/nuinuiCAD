# Issue 1194: second residual slice

Base: `1e4984b47b7e879731e3b7cbd46dd50007875f6b` (PR #1431 merge).
Branch: `sayosomi/issue-1194-residual-d1`. Issue remains OPEN.
The initial slice's source, frozen oracle, registry and before/after records are unchanged.

Run `npx vitest run test/issue1194ResidualD1Rust.integration.test.ts`.
The runner reuses the initial runner's canonical compile, normal persistent Rust
process, bounded lifecycle, wire observation, payload decode and parity checks.
Its saved-fixture adapter resolves full importer-relative normalized paths;
it never falls back to basenames. Production import resolution is unchanged.

`residual-model.ts` supplies the exact source/bundle bytes; historical controls
and retained prototype sources are imported rather than regenerated.
`residual-freeze.json` freezes each ordered bundle hash, authored numeric/error/
none expectations and saved paths. The test checks that freeze before compiling.
Hashing is the initial slice's SHA-256 of JSON `[["root.nui", source],
...savedEntriesSortedByPath]`; saved paths include directory components.
Actual graph document IDs are `/issue1194/` plus those complete paths.
The initial independent numeric oracles are reused for exact B/C prototype replays.
Neither evaluator supplies expected values.

## Named domains and five new families

| Domain | Final evidence |
| --- | --- |
| I01–I04: saved nominal collisions, extra explicit re-export, asymmetric forwarding and invalid substitution | I01/I02 pass at Base; I03 exposes F12's incorrect exported document identity despite correct numeric values; I04 rejects the cross-document nominal substitution. Check defining Module documents, argument producer identities, nominal parameter identity, catalog separation and complete saved graph paths. |
| O01–O04: general optional record match | F13 repairs compiler rejection of a nested whole-record binder leaf, another exact-identity leaf, absent reference fallback, Module export laziness and selected divide-by-zero. Existing whole-binder/none/lazy-constructor/error controls still pass. Missing-arm, wrong-nominal and escaped-binder controls reject. |
| G01–G04: geometry-valued record paths/stages | Root pure polyline, record parameter/local/export forwarding, asymmetric Module-owned paths, and an explicit translated stage versus its base control. F14 repairs the omitted immutable-geometry-property reanalysis trigger; the runtime target was already correct. Lengths 17/13 and endpoints/stage coordinates are authored independently. |
| Compiler admission | F15 repairs direct record-field collection sources for value-for. F16 repairs arithmetic scalar literal members with lazy indexed demand, Module caller/parameter isolation, record constructor fields and geometry-property operands. All fourteen retained B00–B07/C02–C07 prototypes now replay exactly; C04–C07 were already repaired controls at Base. |

The new family count is **five**, grouped by first incorrect producer, excluding
F01–F11, #1376 and historical Stage 1–7 repairs. See `residual-families.json` for
minimal boundary-preserving failing cases, genuine Base PASS controls, owners
and exact observations. The document reducer preserves both independent saved
definitions required by the collision hypothesis.
F15 also uses the unchanged initial C02 named-collection mapping as its adjacent
control (the initial suite is part of the required verification block).

F12 preserves the imported record export's defining document before the existing
document-qualification decorator can stamp it with the importer. F13 resolves
whole-record binder aliases within the selected arm and reuses singleton record
collection descriptors plus the existing optional-length presence projection.
Its exhaustiveness diagnostics stay active when scalar field projection is skipped.
F14 adds the existing geometry-value target kind to the existing full-analysis
activation condition. F15 shares the canonical collection-reference resolver
between aliases and value-for sources. F16 typechecks scalar members through the
existing scalar semantic owner and emits ordinary lazy ordinal-seeded map
descriptors; runtime geometry and caller binding adapters remain authoritative.
There is no new payload schema, evaluator, name resolver or Rust implementation.

## Independent before/after proof

`independent-base-replay-1792518814670` replays the then-complete 44 cases with
all nine changed tracked production owners read from the exact Base. The two
later expression-owner neighbors have a separate exact Base replay recorded in
`residual-telemetry.json`. Candidate bytes were saved externally and restored
exactly in `finally`; no branch switch, reset, stash or history rewrite occurred.
The new scalar lowering helper exists during these experiments but is unreferenced
by Base imports. Its bytes are included in the monitored source digest, so that
digest is distinguished from the actual Base Git tree and loaded tracked owners.

`residual-dispositions.json` records actual Base compiler failures/product identity
mismatches and final runtime outcomes. Compiler-rejected legal sources are
FAIL-before compiler evidence, not invented runtime failures. In F12, both
runtimes already returned the expected numbers; the independently checked
compiler document identity was wrong. Every accepted legal final case verifies
compiler producer/alias existence, normal Rust eligibility, exact authored scalar
results/none/errors, normal payload decoding and TS/Rust agreement. Parity is
an additional check. Raw compiler products and wire output remain external.

The 46 residual tests contain 16 Base PASS controls/cases, 26 repaired cases and
four deliberately invalid controls. These counts describe representative inputs,
not the number of novel defects or domain-wide correctness.

## Cumulative input and telemetry accounting

`residual-input-registry.json` retains the historical 74 accepted hashes and
adds **36** observed accepted identities: **110/112**, leaving two unused slots.
Exact historical replays do not consume slots. Fourteen historical rejected
prototypes became accepted for the first time in this slice and are charged.
The registry conservatively also charges O-invalid-arm, which a provisional
candidate wrongly accepted before its exhaustiveness diagnostic was restored;
the final compiler correctly rejects it. It is never labeled a legal PASS.

There are 18 newly observed compiler-rejected hashes beyond the historical
registries, including legal FAIL-before reducers that later pass. Final newly
rejected controls are four. Rejection observations and cumulative accepted
identities can overlap; they are not mutually exclusive input populations.
`residual-admission-triage.json` gives all 24 historical prototypes a disposition.
The original nominal mismatch and empty-Module typo remain invalid controls.

`residual-telemetry.json` reports instrumented authored compiler attempts, blank
setup compiles, TS calls and actual production persistent Rust request calls.
These are measured runner scopes, not estimates of compiler recursion or all
other test-suite internals. The required block's initial-slice runner is measured
separately. Earlier initial-suite reruns without external telemetry are excluded
from those measured totals. Counts are not Codex quota measurements; no quota
reading or quota-efficiency claim is made.

Raw evidence is local at `/tmp/nuinuicad-1194-residual-20261021/`; instrumented
initial-slice controls from final gates are at
`/tmp/nuinuicad-1194-residual-controls-20261021/`.
The manifest records file digests/sizes. These temporary locations are not durable
cross-machine storage; committed models, hashes, observations and regressions
support exact independent reproduction.

## Remaining original rows and decisions

The initial A/C record-field/collection rows and initial point/line controls remain
regression-covered. This slice adds substantive general-match representative
coverage to B, pure-path/asymmetric/selected-stage coverage to D, and same-named
saved-document collision/re-export/record-argument identity coverage to E.

High-value cases still unproven include arbitrary deep source/dependency
permutations, record-binder field reconstruction inside constructors, other
optional-record parameter/export scrutinee routes, and heavier path/geometry
collection compositions. These are NOT_COVERED, not latent-defect claims.
There are only two accepted-input slots left under the current global ceiling.

File-public record definitions and qualified imported record type spelling remain
CONTRACT_AMBIGUOUS/NOT_REPLAYED. The normative specification does not uniquely
establish those spellings' public-family/type grammar; the retained eight E
prototype entries also lack complete saved dependency bytes. No exact-bundle
PASS or compiler defect is claimed. ChatGPT must settle the product contract
before promoting these forms. No specification is changed to fit the compiler.

Live editor/watch/saved-dirty lifecycle and language-service/UI work remain
outside scope. Carry/control/gate/diagnostic campaign rows remain delegated to
#1260. Architecture ownership is unchanged. Two implemented English DSL reference
paragraphs describe repaired array-member and record-field source behavior;
there is no normative language redesign.

`residual-verification.json` owns required gate results, including the corrected
unused test-runner variable found by the first lint run and the obsolete
Stage 2 generator-rejection assertion found by full regression. The latter
now asserts current legal admission while retaining its original rejection
fixture unchanged. No carry/control behavior is changed. No PR, merge or Issue
close is performed. Independent exact-pushed-HEAD review, protected PR/CI
integration and Human clean-main return remain outstanding.
