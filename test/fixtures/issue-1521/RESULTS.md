# Issue 1521 conformance evidence

Base: `4303eddadbf36def7b89c6d937cbe0f1d995af7c`.
Branch: `sayosomi/issue-1521-authoring-assistance-conformance-hunt`.
Sources and independent assertions: `src/dsl/dslAuthoringConformance.test.ts`.
Producer span regression: `packages/nui-language/src/dsl/dslCallAuthoringContext.test.ts`
(replays the identical D1 source inside the package boundary).
Exploration oracle and rejected unsupported attempts: `ORACLE.md`.

## Confirmed defect families and first incorrect producing owners

| Family | First producer | Base observation | Repair |
| --- | --- | --- | --- |
| F1 | `dslCallAuthoringContext.ts:currentArgumentFrom` | `spread :` label slice was `pread `; active named parameter absent despite a valid scalar builtin call | Find the captured key's start independently of whitespace preceding the colon |
| F2 | `dslSignatureHelpQuery.ts:activeParameterFor` | Invalid `abs(arg1: 1)` activated synthetic positional display parameter 0 | Positional signatures never activate a named label |
| F3 | `dslCompletionQuery.ts:scalarCandidatesAt/queryCandidates` | Closed Module numeric fields exposed outer `forbidden`; point input exposed outer External and omitted Module parameter base | Suppress root binding candidates inside Module bodies; reuse existing overlay-aware Module reference owner for geometry inputs |
| F4 | `dslCompletionQuery.ts:queryDslCompletion` additive Module candidates | Boolean initializer's inner numeric isClose input offered flag/result instead of width/local; explicit @ and operator slots received operand literals/functions | Use the existing classifier's nearest operand type and operand/reference/literal shape; avoid operand augmentation in operator/name slots |

No new production owner or API was introduced. Existing Module completion
and lexical resolution owners are reused. No evaluator, lowering, parser,
language syntax, native host, dependency, or architecture contract changed.
Changed production files are exactly the three producers above. New tests and
this fixture directory are task-owned evidence.

## Base and causal replay

`causal-results.json` records actual commands, exits, counts and failing case
names. Each mutation run changed only task-owned repair hunks, restored bytes in
`finally`, and used a 120-second process timeout. Exact Base files were read
with `git show <Base>:<path>` without a checkout transition or another worktree.

| Candidate | Exit | Passed / failed |
| --- | --- | --- |
| All three production owners at Base | 1 | 14 / 10 |
| Remove F1 only | 1 | 20 / 4 (B2, X1, D1, producer span) |
| Remove F2 only | 1 | 23 / 1 (X2) |
| Remove F3 only | 1 | 20 / 4 (C4, X3, X4, D2) |
| Remove F4 only | 1 | 21 / 3 (C4, X3, X5) |
| Restore every repair | 0 | 24 / 0 |

Nearby Base PASS controls include B2's no-space spelling, X2's legal positional
abs, D2's ordinary root numeric field, B1's numeric positional builtin, C1/C2's
ordinary typed/reference fields, and all saved/current/revision cases.
Canonical rejection controls independently demonstrate capture/type errors;
no expectation was derived from evaluator parity or changed to bless a defect.

## Complete exploration disposition

| Primary | Base | Repaired disposition |
| --- | --- | --- |
| B1 | PASS | PASS: overloads, arity rejection, numeric eligibility, exact empty range |
| B2 | FAIL F1 | PASS: reordered named args, whitespace, negative calling styles |
| B3 | PASS | PASS: nearest nested call, punctuation/string distractor |
| B4 | PASS | PASS: partial name insertion, opening/trailing-comma recovery |
| C1 | PASS | PASS: numeric eligibility and lexical rejection |
| C2 | PASS | PASS: point/path kinds and literal reference insertion |
| C3 | PASS | PASS: side/closed/default metadata and typed eligibility |
| C4 | FAIL F3/F4 | PASS: closed scope, parameter shadow, nearest call |
| M1 | PASS | PASS: typed required/optional/default parameters; insertion produces (14,3) |
| M2 | PASS | PASS: inner/outer signatures, docs and scoped identity |
| M3 | PASS | PASS: public alias/facade, saved identity, docs and callee/label candidates |
| M4 | PASS | PASS: changed saved signature, current root and dirty/stale rejection |
| R1 | PASS | PASS: CRLF, supplementary UTF-16, Unicode identifier and physical range |
| R2 | PASS | PASS: current invalid source and last-good/recovery separation |
| R3 | PASS | PASS: A-B-A monotonic revisions and stale equal-text rejection |
| R4 | PASS | PASS: exact returned insertion changes wide=100 to width=12; point (12,-4), untouched surrounding bytes |

X1 PASS after F1 (unsupported construction/Module spellings remain rejected).
X2 PASS after F2. X3 PASS after F3/F4. X4 PASS after F3. X5 PASS after F4;
existing absence of Module-only operator suggestions is not expanded.
X6 NOT_TRIGGERED. Reducers D1/D2 PASS after F1/F3; D3-D6 NOT_TRIGGERED.
23 units total (16 primary + 5 adjacent + 2 reducers), below the 28-unit ceiling.
24 regression tests include the package-local replay of D1.
Verification replays do not add exploration units.

M1 and R4 evaluate the physically applied insertion through the ordinary
production persistent Rust stdio boundary with independent point expectations.
Additional frozen-source replay (`insertion-results.json`) verifies C1 point
(12,-4), C2 selected B endpoint binding (8,0)->(8,0), R1 point (1.3,12),
and B4 inserted round(1.5)=2 through the same persistent Rust boundary.
No new accepted sources were introduced. Rust client disposal is owned by test
teardown/finally. The extra replay initially failed under plain tsx because
the existing helper imports Vitest; the project Vitest runner passed (1 test,
4 existing cases, exit 0). Parity and Rust source-change
gates are not applicable: production evaluation/lowering semantics are unchanged.

## Verification and delivery

All required checks passed; command/count/exit records are in `verification.json`.

| Check | Actual result | Exit |
| --- | --- | --- |
| Focused matrix + related regressions + import boundary | 211 tests, 13 files passed; 0 skips | 0 |
| Final complete `npm test -- --maxWorkers=2` | 11,703 passed, 188 skipped; 724 files passed, 3 skipped | 0 |
| `npm run build` | TypeScript, Language Core and MCP bundle passed | 0 |
| `npm run lint` | Passed | 0 |
| `npm run docs:dsl:check` | DSL reference check passed | 0 |
| `git diff --check` | Passed | 0 |
| Frozen insertion replay through production Rust | 1 test, 4 existing cases passed; 0 skips | 0 |

No unresolved failures or blockers. Existing full-suite skips were not changed.
Parity/Rust source-change gates are not applicable to these query-only changes.
No GUI/headless GUI run, native VS Code
change, Human-test checkout mutation, PR creation, merge, Issue close or
independent review is claimed. Human-only Manual E2E has not been performed;
no native-host change introduces a mandatory host-specific E2E gate here.

Initial verification issues were confined to new test wiring: build exit 2
for a missing required evaluationLimitIndex input; first full suite exit 1
for an internal package import (11,701 passed, 188 skipped, 1 failed;
722 files passed, 3 skipped, 1 failed). The input was supplied and the
producer-only test moved behind its package boundary. No existing assertion
was changed or waived. Focused recheck: 211 tests / 13 files passed, exit 0.
Build and lint then both passed, exit 0. The final full suite then passed as recorded above. No further production or
test source changes followed that verification.

Documentation lifecycle review: retained only reusable regression fixtures, the
frozen oracle and compact task evidence; no temporary task plan was introduced.
Architecture ownership remains unchanged; no ARCHITECTURE.md update is required.

READY FOR INDEPENDENT REVIEW. Exact delivery commit/push and clean-state
read-back are reported with the final response to avoid a self-referential SHA
in this committed artifact.
