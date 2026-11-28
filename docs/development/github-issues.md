# nuinuiCAD GitHub Issue authoring and labeling

GitHub Issues are the canonical Work/implementation contract for the Codex-only workflow after its approved migration is merged. Until then, the current rules on `main` remain active. The `nuinuicad-issue-authoring` skill follows this repository policy; the skill must not invent or silently change it.

## Informal report to contract

1. Accept a rough bug report, usability complaint, performance observation, or feature idea as discussion. Extract actual versus expected behavior and identify the Human's intended outcome.
2. Inspect the latest remote repository/specs, not a cached conversation. For bugs, investigate reproducibility using permitted read-only code analysis and bounded non-GUI checks; distinguish Human-native observations from automated evidence. For features, clarify interaction, keyboard access, non-goals, and acceptance.
3. **Search both open and closed Issues and open/merged PRs** before writing. Use behavior, subsystem, failure text, synonyms, and plausible root owners. Mark duplicates/overlaps and propose extending an existing Issue when equivalent acceptance already exists.
4. Produce an independently implementable minimal contract. Ask for a Human decision when semantics, expected UI behavior, business priority, or destructive side effects are still ambiguous; do not manufacture agreement.
5. A discussion or draft is not permission to create an Issue. Publish or edit only after the Human explicitly requests it. Publishing does not authorize starting code changes.

## Issue type labels

An **open Work Issue has exactly one appropriate type label** when the corresponding repository label exists. Re-read the actual GitHub label list before mutation; do not invent labels.

| Label | Main purpose |
| --- | --- |
| `type:bug` | Existing behavior contradicts its specification or accepted behavior |
| `type:feature` | New user-facing language, Canvas, editor, output, or other capability |
| `type:improvement` | Improve existing UX, accessibility, performance or responsiveness |
| `type:maintenance` | Tests, CI, builds, internal code quality, developer tooling, routine upkeep |
| `type:docs` | Documentation, reference, examples, usage guidance |
| `type:research` | Investigation, exploratory audit, or feasibility study is the intended output |

Classify by the primary deliverable, not by urgency, implementation phase, difficulty, required E2E, or assigned model. Do not bulk-relabel PRs or historical closed/mirrored Issues. Preserve legitimate existing area/priority labels if their live repository definition applies. Introduce/rename labels only through an explicit separate policy decision.

## Issue state labels

Every open Work Issue has exactly one applicable state label, consistent with its current Issue body and evidence. Permanent Inbox Issues without a concrete Work contract are exempt. State is independent of `type:` classification; do not use `active` for workflow state. These labels do not authorize implementation, merge, E2E execution or closure.

| Label | Meaning | Color |
| --- | --- | --- |
| `contract:pending` | Necessary product decision, investigation, reproduction/evidence, acceptance or dependency remains unknown. | `FED7AA` |
| `contract:ready` | Meaning, scope, acceptance, dependencies and verification are concrete enough to implement after fresh admission. Retain during implementation, review, CI and normal premerge E2E while the contract remains valid. | `99F6E4` |
| `contract:blocked` | An actual prerequisite or capability required for an executable contract is unavailable; ordinary implementation waiting is not blocked. | `FBCFE8` |
| `e2e:deferred` | Implementation, independent review, required CI and merge are complete; only required Human E2E or its required closure checkpoint remains. Includes waiting, execution, resumption, interruption and environment/execution BLOCKED. | `CBD5E1` |

Do not change existing `type:` colors. Re-read live labels before a state write. Missing required labels or an unavailable/ambiguous write or read-back blocks the state checkpoint; report it, do not invent labels or substitute body-only status.

Check state at authoring, contract confirmation, re-audit, implementation/review/CI checkpoints, merge, E2E start/resume/interruption/result and completion. Apply Pending, Ready or Blocked from current contract evidence. Normal premerge E2E does not qualify for Deferred. Only the explicitly Human-authorized [away exception](./workflow.md#away-only-deferred-human-e2e-exception) can enter Deferred after verified merge with E2E-only remaining acceptance. Retain Deferred through the remaining E2E lifecycle, even if the Human returns or execution is interrupted or blocked. Judge each Issue independently in a batch. If confirmed product FAIL or changed evidence requires additional implementation or contract investigation, return to the applicable contract state. Close only after existing completion requirements hold; preserve historical closed-Issue labels.

At each authorized state mutation, re-read current Issue body, comments, labels, and relevant PR/check/E2E evidence. Reconcile concurrent changes without overwriting unrelated work. Update current Issue meaning and the state label at the same checkpoint, removing obsolete state labels and preserving unrelated labels. Read back from GitHub and verify the intended state and exactly-one invariant (subject to the Inbox exemption and closed history). Do not complete a checkpoint with inconsistent or unverified state. Independent Review checks and reports discrepancies without performing mutations.

## Recommended Issue body

```markdown
## Status
State: contract:pending | contract:ready | contract:blocked | e2e:deferred

## Problem / goal
Actual, expected, effect on the user, version/environment.

## Evidence and reproduction
Human observations; minimal case and controls; current relevant SHA;
confirmed facts versus hypotheses; private data redactions.

## Contract and scope
Approved behavior/semantics, responsible subsystem/owner,
in-scope and explicit exclusions, relevant Issues/PRs.

## Acceptance
- [ ] Observable independent acceptance 1
- [ ] Negative/regression control 2

## Verification
Focused automated tests; build/lint/parity/Rust as affected;
independent pushed-HEAD review; required protected CI;
Human E2E Required / Not Required with concrete native scenarios.

## Dependencies and unresolved decisions
Explicit prerequisites, blockers and Human choices.
```

Keep the body focused on current meaning. Put material investigation, decision history, implementation checkpoints, and exact test/merge evidence in Issue comments. Never post private `.nui` patterns, personal paths or sensitive logs without Human approval.

## Issue closure

A branch, PR, CI success or successful E2E **setup** does not mean completion. Normal acceptance requires independent review, required protected CI, and any required Human native E2E PASS, plus verified merge/read-back. Close only after all acceptance is proven. The explicitly Human-authorized **away-only** deferred E2E route may merge first, but **must keep the Issue open** under the state-label rule until per-Issue Human E2E PASS and all required closure checkpoints are complete. See [workflow.md](./workflow.md).
