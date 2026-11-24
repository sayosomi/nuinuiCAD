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

## Contract readiness

`contract:pending` — necessary product decision, reproduction/evidence, acceptance, or dependency remains unknown.

`contract:ready` — meaning, scope, expected acceptance, dependencies and verification are concrete enough to implement after fresh admission.

`contract:blocked` — an actual required prerequisite or capability is unavailable; ordinary waiting for implementation is not blocked.

These are contract states, not proof that tests passed. Use a single matching `contract:` **label only if the repository actually has and governs it**; otherwise put readiness in the Issue body. Do not infer readiness from an Issue simply being open.

## Recommended Issue body

```markdown
## Status
Contract: pending | ready | blocked

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

A branch, PR, CI success or successful E2E **setup** does not mean completion. Normal acceptance requires independent review, required protected CI, and any required Human native E2E PASS, plus verified merge/read-back. Close only after all acceptance is proven. The explicitly Human-authorized **away-only** deferred E2E route may merge first, but **must keep the Issue open** until per-Issue Human E2E PASS. See [workflow.md](./workflow.md).
