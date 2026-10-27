# Stage 7 — local acceptance passed, independent review pending

[Issue #1428](https://github.com/sayosomi/nuinuiCAD/issues/1428) has **20/20 frozen
sources PASS**, **seven independently confirmed and fixed novel families**, and
no remaining confirmed implementation blocker. This is a local implementation
checkpoint; independent blocking review, protected PR/CI and integration remain
external gates. Do not self-merge or close #1428/#1260 here.

Base: `e08ff62174bc461661693173a27108f71c14de35`. Branch:
`sayosomi/issue-1428-targeted-stage7`. The initial BLOCKED checkpoint was
`0a6b47bef3c5c79395b199ddd74f83fdbe70ab60`; the four-repair checkpoint was
`0f0cc141bbcb189bbf9ca176f80412298ab58991`. Human authorized continuation and
expanded F5 ownership to the two canonical parameters files on 2026-10-20.
Only the bounded volatile recheck preceded mutation; Human admission was not
repeated. No other checkout, force/reset/stash, dependency, CI, UI, architecture
or normative specification change occurred.

## Frozen campaign and evidence

`freeze.json` and `checkpoint.json` remain unchanged. The 20 initial texts were
compiler-prevalidated and frozen with independent expectations, hashes, seeds,
execution order and product fingerprint before any primary evaluation.
`outcomes.json` owns current per-source results. Original failures are retained
separately in the unchanged checkpoint and hash-indexed external logs.

First scheduled texts: H1-03, H1-07, H2-00, H2-07, then the remaining 16. Seed =
`9000 + hypothesisOffset + cellIndex`, H1/H2 offsets 0/100, indexes 00..07.
H1 bits: 4=path, 2=Module, 1=two inner iterations rather than zero; outer length
is two. H2 bits: 4=line rather than point, 2=exhaustive match rather than if,
1=ancestor rather than direct dormant gate. Two distinct-hash controls per
hypothesis share its cell-00 numeric model.

The normative oracle is `docs/nui1/spec.md`. H1 independently unrolls nested
simultaneous next: active final member ends are `(u+27,22)` and `(u+30,27)`;
zero-inner variants preserve initialization. Assertions check whole geometry,
endpoints, lengths, stages, member order, generated occurrences and qualified
exports. H2 independently applies one swap, emits only the successful Module's
children/consumer plus Survivor, and checks selected failure, exact owners,
Module atomic suppression, unselected laziness and dormant nonactivation.
Compiler bindings/collection identities and dependency edges are checked before
using TS/Rust agreement as corroboration.

The initial harness lost rows on observer exceptions; its unchanged-product
retry hit a real H2-00 native stack overflow at 23:28 JST on 2026-10-19. The exact
original native wire was not saved; frozen source, product fingerprint and stderr
survive. No missing native result is invented. Continuation used preserved
compiler evidence and bounded TS reductions, then small Rust regressions after
the snapshot repair. The original native crash was never repeated.

## Independently confirmed repairs

`families.json` records minimum legal reproductions, adjacent genuine PASS,
first incorrect producers and repairs. `repair-proof.json` retains compact
FAIL-before/PASS-after evidence; larger products/wires remain externally indexed.

1. **F1: incoming collection snapshot loss.** Local indexed aliases copied into
   next subsequently read the new carry and recurse. Root/Module one-swap TS
   reductions fail; zero-iteration neighbors pass. TS/Rust now capture canonical
   member identity against the incoming snapshot and retain generated provenance.
   A regression in the first repair eagerly captured both if/match arms. Two
   independent unselected out-of-range alias reductions exposed it; selected-arm
   capture fixes it. These are repair-regression evidence, not another novel
   family. Then/else, exhaustive match and two-successive-swap controls pass.
2. **F2: line/path indexed carry aliases omitted by lowering.** Reuse the point
   path's canonical deferred collectionIndex fallback. The identical minimum
   Module source and root/Module drawable-seed controls pass in both engines.
3. **F3: path endpoints retain whole-path metadata.** Selected endpoints lower
   as point inputs. Path/line controls are normally Rust eligible and yield
   `(8,11)`; whole-path identity is preserved.
4. **F4: missing immutable point diagnostic leaks Module output.** Rust now
   emits the existing consuming drawable dependency diagnostic, allowing existing
   atomicity/suppression to operate. Invalid/valid Module controls and all H2
   geometry and exact diagnostic checks pass.
5. **F5: inline polyline coordinates lack numeric projection.** Approved
   `parameterDefinitions.ts` and `parameterAccess.ts` expose per-vertex numeric
   slots. Existing DSL span and Module scalar-site owners preserve `points:index`
   keys and exact expression spans; Rust materializes the same coordinates.
   Inline/named controls and frozen H1-05/06/07 now pass without source rewrites.
6. **F6: root collection-alias dependency ordering.** The retained pure-seed
   root reducer independently fails in both engines while Module/drawable-seed
   neighbors pass. Its graph lacks root loop-to-eager-seed and escaped-alias-to-
   loop edges, releasing Seed after Pick. The canonical graph now supplies those
   root joins, excludes frame-local owner cycles, and preserves existing Module
   execution events and conditional/lazy activation. Graph assertions plus the
   identical minimum pass; no authored statement was reordered.
7. **F7: polyline deferred point targets lose vertex identity.** The independent
   Module path-endpoint minimum is normally Rust-ineligible; frozen Module
   inspection separately records its input under an empty key. `dslApplyArgs`
   now transports `points:index` through existing eligibility and TS/Rust anchor
   materialization. The normal production minimum yields `(8,11) -> (10,13)`.
   The minimum's before run stops at eligibility: no TS-before result or forced
   native request is claimed for that source.

No new resolver, scheduler, evaluator, transport or alternate parameter accessor
was introduced. Rust remains the production semantics owner; TS is the reference.
Historical Stage 3–6 fixtures and #1358/#1359/#1360 controls are unchanged.

## Sensitivity and limits

Test-local cloned next plans establish **14 actual output detections per engine**:
four active H1 sources substitute inner initialization for inner-final outer
consumption; all eight H2 primaries and both controls lose their swap. Each
changes Result0 or Two::Mark geometry. The six zero-inner/control H1 sources
remain NOT_COVERED for inner-body loss. No production historical fault injection,
noise-only detection, or universal gate/atomicity sensitivity claim is made.

The strongest separate future hypothesis is a deferred immutable point/path
endpoint in a Bezier intermediate anchor inside a Module path collection:
`dslApplyArgs` still calls `anchor(point)` without the intermediate slot key.
This is a source-level hypothesis outside the closed matrix, not a reproduced
eighth family or a claim of global evaluator conformance.

## Replay and verification

Compiler-only replay starts no evaluator:

```sh
ISSUE1428_MODE=prevalidate ISSUE1428_EVIDENCE=/tmp/nuinui-stage7-prevalidate \
  npx vitest run test/issue1428TargetedStage7Rust.integration.test.ts
```

Default strict verification runs 20 frozen sources and 19 necessary reductions/
controls. `ISSUE1428_IDS` selects exact IDs; `inspect` persists compiler products
and bounded TS evidence without Rust. `baseline` rejects repaired products and
existing evidence files. Normal eligibility is never overridden. Primary and
reducer wires are persisted before native dispatch. Native failure stops later
cells. Build/request/process/teardown bounds remain 120s/20s/10m/5s; lifecycle
listeners precede transitions and expected teardown errors are consumed.

Run the Issue's required build/lint/parity/full-suite/DSL and conditional Rust
checks on the settled implementation, plus `test/issue1428PolylineParameters.test.ts`.
`verification.json` gives exact results and prior checkpoint failures. Full-suite
verification includes directly affected Stage 3–6 and historical #1358/#1359/#1360
regressions. Human Manual E2E is Not Required. Ordinary implementation changes
stay within existing ownership; durable architecture and language docs need no
incidental rewrite.

`telemetry.json`/`summarize.mjs` retain global accepted/rejected hashes and
instrumented campaign compiler/TS/production request counts. **39/56 accepted
texts** = 20 frozen + 19 reducers/controls, including the reactivated original
root minimum; no optional primary counterfactual or filler sources. Original
rejected prototypes remain separately classified. Historical/parity/Rust unit
requests are outside campaign totals. Counts are not quota measurements; Human
before/after quota/reset/concurrent-use observations are UNAVAILABLE.

Large traces stay under `/tmp/nuinui-stage7-1428*` and `/tmp/nuinui-stage7-*`;
committed sources and compact observations are reproducible, but temporary raw
retention is not an archival guarantee. Added parameter owner hashes supplement
the original campaign product fingerprint without altering freeze.json.
Next action: independently review the exact normally pushed HEAD, then proceed
through the existing protected PR/CI integration workflow. Keep both Issues open
until their own required gates are satisfied.
