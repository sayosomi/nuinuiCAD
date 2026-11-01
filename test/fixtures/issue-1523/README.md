# Issue #1523 diagnostic-to-Quick-Fix conformance evidence

Repository: `sayosomi/nuinuiCAD` · fixed Base: `9273e8dfb7e0f2134b515b726c9cdddc91c11f49`

Branch: `sayosomi/issue-1523-diagnostic-quickfix-conformance-hunt`.

Outcome: **zero confirmed product defects, zero product fixes**. This area contains the frozen investigation and an executable deterministic regression matrix. No production source, configuration, dependency, normative specification, DSL reference, or architecture changed. Independent pushed-HEAD review, protected PR/CI, merge, and Human GUI E2E are separate downstream gates.

## Authority and admission

The live GitHub Issue body and comments were read at startup. The current GitHub Project Context matched the local `dev-context` checkout at `3208462494b04d4328e571a03280cfb3b052cfad`; the routed D1, checkout, Coding Agent, Git, and skill policies were read. Current product `AGENTS.md`, `ARCHITECTURE.md`, `docs/dsl.md`, relevant normative `docs/nui1/spec.md` sections, and the existing query/provider/diagnostic/lexical/Module owners supplied the oracle.

The supplied Human `LOCAL CHECK PASS` was consumed without rerunning the Human checker. Immediately before the branch mutation, `git fetch origin --prune` exited 0 and the bounded volatile recheck verified exact clean local `main`/HEAD and remote `main` at Base, unused local/remote topic, registered implementation checkout and origin, and no live implementation/audit/native-E2E ownership marker. The visible unrelated `run_web_e2e_329.py` process had cwd `/Users/yosomi/Code/voiceger-editor`. No worktree, legacy claim, reservation, GUI, browser, Human-test operation, or subagent was created. The remote main stayed at Base through the final push check.

## Frozen fixtures and initial harness errors

`oracle.json` and `initial-harness.ts.txt` preserve the first freeze and exact initial harness. `base-results.json` and `base-matrix.log` preserve its 12 PASS / 4 FAIL result. These failures are **fixture/harness authoring failures, not product Base FAIL evidence**:

- T1 incorrectly enumerated only `point` and `number`. The canonical keyword table plus documented edit-distance thresholds also admit `print` and `const`; the canonical type list also admits `number?`. Every candidate still edits exactly the diagnosed token. An eligible keyword correction need not make an unrelated statement suffix valid.
- T3's geometry diagnostic oracle incorrectly included `@`. `dslReferences.ts` passes `reference.pathRange` to its geometry diagnostic, so the diagnostic covers the name. The scalar binding diagnostic legitimately includes `@`; both edit plans preserve it.
- R4's negative source changed only the last typo but the harness incorrectly rejected actions for the still-eligible first typo. The negative must target the changed diagnostic while retaining the other real diagnostic as a positive discriminator.
- A2 used unsupported `if true then ... else ...` syntax. The normative conditional syntax is `if (condition) { value } else { value }`.

The Human explicitly authorized **a separate pre-execution fixture freeze and rerun**, retaining the original oracle and failure evidence. `oracle-v2.json` is that separate freeze; the changed sources are marked X1–X4 in comments. It derives expectations from the normative grammar and canonical keyword/type/diagnostic producers, never from the candidate plans. The initial oracle was not overwritten. `v2-matrix.log` records 16/16 PASS before the additional T4 controls.

A later strengthened A1 harness assertion incorrectly compared a pre-error-recovery statement ID with a freshly compiled ID across revisions. `identity-harness-failure.log` / `.json` preserve that failure (185 PASS / 1 FAIL). The canonical document owner deliberately retains the last **error-free** reconciliation base; an errorful snapshot is not that base. The corrected assertion checks the candidate against the canonical definition in its **own current revision**, and checks the repaired call against the canonical definition in the repaired revision. The frozen semantic expectation—resolve the source-owned `Pocket(width: number)` definition—did not change. This was no new source input or exploration unit.

## Complete primary matrix

All rows run real `NuiLanguageSession.diagnostics()` and `quickFixes()`, the composed production native provider and apply handler under deterministic host mocks, exact raw source edits, and recompile. Each row has frozen positive and negative controls. Multi-option plans are each applied independently. Returned native WorkspaceEdits are physically applied by the host mock; assertions do not stop at inspecting descriptors.

| Row | Final | Evidence / discriminating condition |
| --- | --- | --- |
| T1 | PASS | Keyword/type tokens; complete eligible sets; exact token edit; independent registry-distance derivation; X1 |
| T2 | PASS | Nested `max`/`abs` around `roumd`; named `spreadAngle(lenght: ...)`; no positional display-name argument repair |
| T3 | PASS | Typed scalar and point references; wrong-type and hidden-scope near spellings forbidden; `@` preserved; X2 |
| T4 | PASS | Local Module callee and argument label; wrong Module parameter excluded; nearer scalar shadows Module; direct/facade imported unsupported evidence retained |
| Q1 | PASS | Three choice options in declaration order, no preferred ambiguous action; all alternatives physically applied |
| Q2 | PASS | One choice option, preferred native action, exact replacement and valid type |
| Q3 | PASS | Only `: ` inserted at name boundary; missing-annotation diagnostic removed; empty type is not claimed valid; independent `number` completion verifies valid source |
| Q4 | PASS | `point ... = segment(...)` offers only `line`; category token alone changes; original argument/comment bytes preserved |
| R1 | PASS | CRLF and supplementary `🧵` before a Japanese binding typo on the same line; UTF-16 diagnostic and raw edit agree |
| R2 | PASS | A→B→A source revisions 1→2→3 and host versions 1→2→3; first-A action rejected, including after updating only its host version; fresh final-A action applies |
| R3 | PASS | Valid→incomplete→current typo→valid, revisions 1→2→3→4; incomplete source offers no last-good typo action |
| R4 | PASS | Two file URIs and two same-code/different-range diagnostics; wrong diagnostic, other URI and closed URI rejected; other document unchanged; X3 |
| A1 | PASS | Real Module typo offer/apply; same-revision candidate identity matches canonical definition; repaired `Use` callee resolves the source-owned `Pocket` and width binding |
| A2 | PASS | Choice and missing-type edits independently applied; other same-line choice diagnostic shifts only by edit delta; missing-initializer diagnostic unchanged; spacing/comments preserved; X4 |
| A3 | PASS | Actual applied category edit recompiles; production Rust returns A=(0,0), B=(3,4), Hypotenuse endpoints matching A/B and length=5 mm; no evaluation errors |
| A4 | PASS | 10 payload alterations, 5 malformed payloads, 3 wrong offer fingerprints, mutation during session lookup, and duplicate after actual edit all reject without additional edit |

`module-controls.json` was frozen before its candidate execution. Direct and facade imported Module typo inputs make the graph semantic context invalid. The existing `moduleRuntimeContext` / imported completion contract requires `runtime.valid`, so these are **NOT_SUPPORTED**, not defects. Supported local Module callee/label cases remain the neighboring T4 acceptance. Positive saved-library/facade sources compile with original defining-document identity, public `Pocket`, no private `Secret`, and no dirty-buffer-only `DirtyOnly`. The in-memory saved loader never substitutes unsaved contents. The existing full host suite separately exercises production saved/current graph behavior.

## Exploration accounting

Conservatively count the original 16 primary units plus the four separately frozen replacements: **20 / 28** distinct accepted exploration units. Related controls and declared revision sequences belong to their primary row. Existing-suite runs, compiler calls, Rust requests, baseline comparisons and verification replays are not new units.

| Slots | Disposition |
| --- | --- |
| X1 | TRIGGERED / PASS — T1 complete canonical spelling sets |
| X2 | TRIGGERED / PASS — T3 geometry diagnostic path range |
| X3 | TRIGGERED / PASS — R4 target-specific negative control |
| X4 | TRIGGERED / PASS — A2 supported conditional syntax |
| X5–X6 | NOT_TRIGGERED |
| D1–D6 | NOT_TRIGGERED — no confirmed product defect to minimize |

No confirmed causal defect family or incorrect producing owner was found. Product regression, causal correction, fix-removal FAIL, and restored-product-fix PASS are **not applicable**. Do not misrepresent the retained harness failures as causal product evidence.

## Verification records

- `base-matrix.log`: exact focused matrix command, exit 1; 12 PASS / 4 FAIL / 0 skipped, initial harness.
- `related-command.json` / `related-base.log`: exact 16 related-suite paths and command, exit 0; 170 PASS / 0 FAIL / 0 skipped.
- `v2-matrix.log`: same focused command with separately frozen authorized sources, exit 0; 16 PASS / 0 FAIL / 0 skipped.
- `completed-matrix.log`: focused matrix including imported/saved/shadow controls, exit 0; 16 PASS / 0 FAIL / 0 skipped.
- `identity-harness-failure.log`: strengthened focused run, exit 1; 185 PASS / 1 harness FAIL / 0 skipped.
- `focused-command.json` / `focused-final.log`: exact combined matrix plus related-suite command, exit 0; 186 PASS / 0 FAIL / 0 skipped, 17 files.
- `completed-results.json`: final source/oracle hash, actual diagnostics, returned plans and source-edit spans, applied raw source and native edit ranges, recompiled diagnostics, imported identity evidence, revision/rejection assertions, and A3 actual Rust payload.

A3 uses `cargo build --quiet --manifest-path rust-evaluator/Cargo.toml --bin evaluation_stdio` (exit 0) with a 120-second bound, then the ordinary `evaluation_stdio` protocol (`{ id: 1, input: prepared.input }`, exit 0) with a 15-second bound. No evaluator or lowering semantics changed, so `npm run test:parity`, `cargo fmt --check`, `cargo check`, Rust source tests and clippy were **not run / not required**. Cargo binary compilation for A3 is not a claim that those source gates ran.

The required final command block is retained exactly in `final-command.json` and its complete output in `final-gates.log`. It runs build → lint → DSL reference check → full tests with two workers → diff check, without substitutions. Each focused process tree has a 240-second bound; the final block and all its descendants have a 1,200-second wall-clock bound. Only a process group created by this run would be terminated on timeout. There were no hangs, OOM, timeouts, or owned lingering processes.

## Scope and residuals

All changed paths are under `test/fixtures/issue-1523/`; no additional product owner was touched and no upper-tier exception was inferred. The Human-approved separate fixture freeze is the sole execution deviation and is explicitly retained above. These files are reusable test fixtures and review evidence, not an obsolete implementation plan. No architecture or DSL documentation update is needed because product behavior did not change.

The 16-row matrix is bounded evidence, not proof of every possible Quick Fix or GUI interaction. Unsupported imported typo repairs remain unsupported; this task adds no capability. Native provider mocks validate offer/apply/routing behavior, not an actual VS Code GUI. No independent review, protected PR/CI, merge or GUI E2E PASS is claimed.

## Final required gate result

The following exact block exited **0**; every command in the `&&` chain exited **0** in the required order:

```sh
(
  cd /Users/yosomi/Code/nuinuiCAD || exit 1
  npm run build &&
  npm run lint &&
  npm run docs:dsl:check &&
  npm test -- --maxWorkers=2 &&
  git diff --check
)
```

Full suite: **11,719 passed / 0 failed / 188 skipped**, 11,907 total tests; **725 passed / 0 failed / 3 skipped** files, 728 total files. Vitest duration: 389.83 seconds. No required check is incomplete. Ordinary configured skips are reported as skips, never as PASS. The post-edit evidence review found no unexpected compile errors across all 27 actual applications; intentionally incomplete skeletons, the other same-line diagnostic and generic keyword alternatives remain explicitly distinguished.

The exact final local/pushed commit and clean-checkout read-back are reported in the execution handoff; Git is their authority. No blocker remains for independent review. Status: **READY FOR INDEPENDENT REVIEW**.

Additional staged whitespace check: the initial `git diff --cached --check` exited 2 for terminal blank lines at EOF in captured CLI logs. Exact raw stdout is preserved in `raw-command-logs.json`; readable `.log` views omit only those terminal blank lines. After this evidence-only normalization, `git diff --cached --check` exited 0. No executable input or product source changed after the required final block.
