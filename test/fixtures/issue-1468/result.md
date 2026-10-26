# Issue #1468 investigation and reusable regression ledger

Base: `c7ae3500f16d6e17dfb7bffd57365c967e1c4e5c`.
Branch: `sayosomi/issue-1468-pattern-workflow-hunt`.

## Seals and oracle provenance

The original manifest and F1/F2/F3 files were committed at `6743b3b5`, before
exploratory compilation/evaluation. Concrete `from` geometry kind was corrected
by source inspection at `7664cd39`, still before first execution. Neither the
compiler nor either evaluator supplies the analytic expected numbers.

`visible-manifest.json` is the executable 12-trace seal. Original sources,
`manifest.json`, and `legal-manifest.json` remain immutable evidence. Two F2
admission corrections are explicit in `support-disposition.json`: bare instance
`move Right` is not a supported geometry target, so the equivalent targets its
two exported members; generated geometry is hidden by default, so the final
fixture explicitly requests `showGenerated: true`. Numeric oracles did not
change. Source-order errata were fixed from authored declarations before any
encoded output was observed. These are fixture/control dispositions, not bugs.

R1's initially predicted root-scalar PASS was disproved: root and group scalar
variants both fail on Base. That prediction remains in the original seal;
`r1-neighbor.json` separately seals the successful literal neighbor. No oracle
was changed to accept a defective result.

Store source revisions and canonical compile revisions are distinct. B4's fatal
source edit advances the store from 5 to 6 while retaining last-good compile 5;
its corrected source is store revision 7 / compile revision 6. The test checks
both, exact text and source-map ownership, then actual compiled-document request
identity. Native VS Code Undo/Redo is not claimed by host-neutral A3 history.
Module Preview evaluates a dependency-bearing root; only its target runtime IDs
form the displayed Preview domain. Authored siblings/ordinary source may remain
in the dependency-bearing evaluation and are not mistaken for preview targets.

## Closed matrix

| Unit | Final disposition | Discriminating evidence |
| --- | --- | --- |
| A1 | BASE_PASS | Bodice, asymmetric neckline controls/bounds, labels, 100 mm line, actual SVG/PDF |
| A2 | BASE_PASS | width80→83; independent height and control geometry retained |
| A3 | BASE_PASS | width83→87; height140→144; two actual source-history reversals; revisions3–6 |
| A4 | BASE_PASS | actual Rename width→bustWidth, Source Value Step83→84, stable statement identities |
| B1 | BUG→FIXED→REPASS | instance60→63; sibling85 unaffected; Preview context/recipes F1/F2 |
| B2 | BUG→FIXED→REPASS | repaired Preview boundary retained; range2→3 yields4 occurrences; index1→2 picks22,-32 |
| B3 | BUG→FIXED→REPASS | Module mirror/rotate/reverse plus caller translation; F3 noncommuting order |
| B4 | BUG→FIXED→REPASS | bad dependency explicitly rejected; newer lift44, exact-current MCP, delayed real Rust prior result rejected |
| C1 | BASE_PASS | actual Bake plan/application, inserted independent100 mm line; canonical recompile/export |
| C2 | BASE_PASS | actual coordinate conversion to dx100,dy0; Step100→101; baked/sibling geometry retained |
| C3 | BASE_PASS | asymmetric placements, explicit scale2 and inherited1.5, mirror/rotations90/180, A4 landscape overlap12, four encoded tiles |
| C4 | BASE_PASS | exact file save/reopen; fresh canonical store; dx101→102; current saved-source MCP hash and exports |
| X1 | BASE_PASS | profile2px→common1px changes physical stroke bounds, not geometry or placement scale |
| R1 | BUG→FIXED→REPASS | group/root scalar FAIL; literal neighbor PASS; actual Rust P13,4 and Q17,-2 |
| R2 | BUG→FIXED→REPASS | Preview recipe FAIL; literal neighbor PASS; reversed transformed line4,-15→4,-5 |
| R3 | BUG→FIXED→REPASS | caller translation FAIL; identity neighbor PASS; line124,-25→124,-15 |

All 12 primary units completed on the corrected candidate. The whole Base replay
passes all A/C units and X1; its B series stops at B1's context exception, so no
unexecuted later Base B unit is mislabeled a Base PASS. R2 and R3 independently
establish the masked mechanisms. B2/B4 inherit repaired boundaries; they are not
additional findings. Accepted units: 12 primary + 1 triggered X + 3 independent
R = 16/28. X2–X8 and R4–R8 are NOT_TRIGGERED (7 X and 5 R slots unused).

## Three novel independent first-owner families

1. **Preview drops valid document binding context.** First incorrect producer:
   `src/vscode/modulePreviewEvaluation.ts`. It supplied only Module call controls
   and empty source numeric/property/template maps, despite retaining document
   bindings and ordinary dependency geometry. R1 has no authored Module instance,
   distinguishing it from #1460's pruned authored-instance binding leak. Existing
   lowering/control helpers now receive both valid source and fresh Module facts.
   Removal of this owner's correction restores the Base exception; literal
   neighbor still passes.
2. **Preview bypasses transformation compilation.** First incorrect producer:
   `src/dsl/modulePreviewRoot.ts`. Direct low-level materialization omitted the
   canonical element compiler's resolved root/Module recipes. R2 needs no external
   scalar or generated geometry, so F1 cannot explain it. Preview now calls the
   existing canonical compiler over the ephemeral AST, preserves ordinary source
   element identities/resolved targets, and lowers the canonical dependency plans.
   Existing source occurrence clock lowering is shared with the document compiler
   so selected generated dependencies use execution clocks. Removing only the
   root correction restores wrong base coordinates while R2's literal neighbor
   passes.
3. **Caller recipes precede Module-local recipes on the same owner.** First
   incorrect producer: `packages/nui-language/src/dsl/dslCompiler.ts`. Concatenated
   root/Module buckets reached the canonical graph in the wrong order. Runtime
   recipes now sort by their existing compiler-owned runtime source order. R3's
   Base start is approximately14,-135, versus124,-25 analytically; its identity
   caller neighbor passes. Removing only this correction restores the failure.

These are not historical #1194/#1260/#1450–#1466 repairs. No fourth family is
claimed for follow-up context/clock wiring within these repaired paths.

## Changed owners and causal scope

- `src/dsl/modulePreviewRoot.ts`: reuse canonical element/recipe compilation;
  retain ordinary source IDs and resolved source-consumer targets; preserve
  synthetic call isolation.
- `src/vscode/modulePreviewEvaluation.ts`: complete compiler-fact lowering for
  this dependency-bearing projection; reuse the canonical graph builder and
  production runtime entry builders, not another scheduler or evaluator.
- `packages/nui-language/src/dsl/dslCompiler.ts`: same-owner recipe ordering at
  the first combined producer.
- `packages/nui-language/src/scalars/scalarProgram.ts`: extract the existing
  occurrence clock conversion as a shared pure lowering helper.
- `packages/nui-language/src/dsl/dslDocument.ts`: reuse that exact helper; the
  ordinary document path's behavior is unchanged by this extraction.
- `test/issue1468PatternWorkflow.integration.test.ts` and this fixture directory:
  persistent ordered production Rust workflows, sealed sources/oracles, controls,
  physical encoder checks, Base/removal evidence, and disposition ledger.

Ownership, primary entrypoints and documented architecture boundaries remain
unchanged. No new public syntax/semantics or DSL documentation change; therefore
no DSL reference regeneration/check is required. No new dependency or framework.

## Verification and limits

See `evidence/verification.json` and command logs for the final full gate.
`evidence/base-proof.json` records the exact production Base restoration, while
`base` and `mutation-F1/F2/F3` records retain FAIL/control facts. The fixed focused
record includes source hashes, revisions, actual geometry and encoded artifact
hashes. Each harness owns one persistent Rust process, finite15s requests and
finite process completion, and cleans only its own temporary files/process.

Actual SVG XML paths/cubics, mm dimensions, viewBox, labels and drawing/text order
are parsed. Actual PDF xref/page tree, stream lengths, MediaBox points, m/l/c
geometry, encoded text/order, guides and every tile origin are parsed. Wrong
physical-unit/coordinate copies are rejected. TS reference output is never the
numeric oracle or a substitute production path.

Manual E2E: **Not Required**. No native host adapter, command registration,
focus/history/file-dialog interaction changed. No native GUI PASS is claimed.
No paper/printer calibration, sewability, arbitrary garment correctness, extreme
geometry, performance/race stress, imports/#1439, or exhaustive DSL coverage is
claimed. Broader unknown combinations remain outside this bounded campaign.
Human-observed weekly and five-hour quota readings: **UNAVAILABLE**.

The first full-suite attempt was stopped after its B-series failure and is
retained as `first-full-test.log` / `first-verification.json` (exit130, incomplete;
not PASS). Its final detailed assertion was not emitted on interruption. A
separate deterministic harness negative control proves that rebuilding options
on every React render sends8 gated requests rather than the intended2
(`harness-unstable-options.log`). Options are now stable per document and the
assertion requires exactly2 requests. Three predeclared complete focused runs
must all pass before the final full-gate rerun. This is a test-input lifecycle
correction, not a product defect/fourth finding, and no assertion was weakened.
