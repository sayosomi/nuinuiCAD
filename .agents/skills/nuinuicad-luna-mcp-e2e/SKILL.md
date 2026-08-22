---
name: nuinuicad-luna-mcp-e2e
description: Run predeclared objective nuinuiCAD Manual E2E units in an isolated VS Code Extension Development Host as the Luna test operator. Use Playwright/CDP for deterministic UI operation, nuinuiCAD MCP for exact-current structured evidence, and Computer Use only for required GUI/pixel-only gaps. Do not use this skill for implementation, root-cause investigation, test-plan design, product judgment, or Human-assigned units.
---

# nuinuiCAD Luna MCP-backed Manual E2E

Use this skill only when the task prompt already contains a current Manual E2E plan with `Executor: Luna` objective units and predeclared oracles.

Luna is the test operator, not the test designer.

Operate in this loop:

```text
prepare exact tested state
-> operate
-> observe
-> compare with the predeclared oracle
-> record evidence
-> report PASS | FAIL | BLOCKED
```

Do not modify implementation files. Do not fix failures. Do not inspect implementation code for root-cause investigation. Do not redesign, weaken, or expand the test plan. Do not invent missing product semantics. Do not perform Human-assigned units or aesthetic/experiential judgment.

## Authority routing

The Sol High prompt is responsible for applying the current project authorities before execution. Keep these ownership boundaries intact:

- Manual E2E classification, executor selection, and PASS/FAIL/BLOCKED semantics: `projects/nuinuiCAD/MANUAL-E2E.md` in `sayosomi/dev-context`.
- isolated VS Code Extension Development Host setup: `projects/nuinuiCAD/VS-CODE-E2E.md` in `sayosomi/dev-context`.
- Luna prompt, stable tested state, evidence, retry, and known-pitfall guidance: `projects/nuinuiCAD/LUNA-E2E-PLAYBOOK.md` in `sayosomi/dev-context`.
- skill selection: `projects/nuinuiCAD/AGENT-SKILLS.md` in `sayosomi/dev-context`.
- current task fixture, action, oracle, and acceptance: the current Manual E2E plan supplied by Sol High.

Do not reconstruct a competing policy from this skill. If the task prompt and a current authority conflict in a way that changes the oracle or allowed operations, return `BLOCKED` with the conflict instead of choosing a new contract.

## Human transport boundary

Normal Sol High/web ChatGPT and Luna/Codex communication uses manual user copy-paste transport:

```text
Sol High creates the Luna prompt
-> user copies it into the Luna/Codex session
-> Luna executes and returns the result/evidence
-> user copies the result back to Sol High
```

Treat that user action as transport only. It does not make an objective unit `Judgment: Human` or `Executor: Human`. Do not require, implement, or simulate automatic ChatGPT-to-Luna conversation relay, UI scraping, or programmatic session transport.

## 1. Verify the tested state before launching

Follow the exact tested commit/stable-ref instructions in the task prompt.

At minimum:

```bash
git fetch origin --prune
git status --short
git branch --show-current
git rev-parse HEAD
```

Use only a clean, safe checkout permitted by the prompt. Never reset, stash, discard, force-switch, or overwrite unrelated user work.

When a stable E2E ref is supplied, verify that it points to the exact expected commit. Record the execution-time `origin/main` SHA separately. A newer `origin/main` alone is not a product failure and does not authorize changing the tested commit.

If the expected commit/ref was rewritten, cannot be obtained safely, or the checkout cannot be made clean without touching unrelated work, return `BLOCKED`.

## 2. Start the isolated VS Code host exactly as specified

Use the current canonical isolated-host baseline supplied by Sol High from `VS-CODE-E2E.md`. Preserve these invariants unless the task contract explicitly changes them:

- fresh `--user-data-dir`;
- empty `--extensions-dir`;
- built-in completion interference disabled;
- task fixture outside the checkout with a run-unique identity;
- extension built from the tested checkout;
- production Rust evaluator binary built from the same tested checkout and selected explicitly;
- `--extensionDevelopmentPath` points to that checkout;
- workspace trust disabled;
- stale VS Code processes cleaned up on the dedicated Luna machine before launch;
- a dedicated CDP port for objective VS Code UI operation.

Do not reuse an old Extension Development Host after a rebuild, commit/ref change, failed setup, or uncertain initial state.

### Bounded environment retry

For CDP startup, allow the canonical readiness window from `VS-CODE-E2E.md` (currently about 60 seconds). If the first fresh launch fails to expose CDP:

1. save launch/process/port/profile diagnostics;
2. terminate the test VS Code processes;
3. create a new fresh profile and retry the launch once;
4. if the second fresh launch also fails, return environment `BLOCKED`.

Do not turn this into repeated product-behavior retries.

A clearly bounded prompt/operation mistake may be corrected once when the predeclared action and oracle remain unchanged. If correction would require changing the plan or deciding new semantics, return `BLOCKED`.

## 3. Run extension-registration preflight before product units

Before evaluating any product oracle, establish objectively that the current host is the intended run:

- the run-unique `.nui` fixture is active;
- its language mode is nuinuiCAD/`nui`, not Plain Text;
- required contributed nuinuiCAD commands are registered;
- the Playwright/CDP workbench contains the current run-unique fixture;
- inspect Running Extensions or fresh-profile logs when needed to resolve registration uncertainty.

Preflight failure is environment `BLOCKED`, not product `FAIL`.

## 4. Choose the operation and observation surface deliberately

Use this priority order:

```text
Playwright/CDP = deterministic VS Code UI operation/DOM/accessibility observation
nuinuiCAD MCP = exact-current structured nuinuiCAD state/evidence
Computer Use = bounded fallback only for required GUI/pixel-only operations
```

Do not use Computer Use to visually infer a fact that Playwright/CDP or MCP can establish objectively.

### Playwright/CDP

Prefer Playwright/CDP for workbench/tab identity, Command Palette operation, Monaco keyboard interaction, visible text, webview/frame discovery, DOM/accessibility state, DOM counts/identity/bounding boxes, coordinate actions derived from DOM geometry, and screenshots.

### Headless nuinuiCAD MCP tools

Use the file-backed headless tools when the oracle concerns an exact on-disk `.nui` snapshot and does not require live editor/session state:

- `document_inspect` — inspect one exact-current file-backed document snapshot;
- `document_definition` — resolve a same-document declaration at a source position;
- `document_references` — enumerate same-document references at a source position;
- `document_evaluate` — evaluate the exact-current file-backed document with the production Rust evaluator.

Do not use a file-backed headless tool as evidence for dirty unsaved Source state.

### `vscode_observe`

Use `vscode_observe` when the oracle depends on the live VS Code production host, including dirty Source text, Source selection, diagnostics, active surface, Canvas/Output Preview session presence, or current Canvas runtime facts.

The tool is read-only. Never treat it as a mutation, command, keyboard, pointer, screenshot, shell, or arbitrary automation API.

Request `includeSourceText: true` only when exact live Source text is required. The default compact response intentionally omits source text.

## 5. Resolve the live VS Code instance/document without guessing

Prefer an explicit `instanceId` when the prompt has already established it. Otherwise use an exact `documentPath` for the run-unique fixture when possible.

Respect `vscode_observe` deterministic resolution outcomes:

- explicit instance ID has priority;
- an exact document-path match may resolve only when exactly one live instance reports that document;
- a sole remaining live instance may resolve without guessing;
- multiple unresolved candidates are `ambiguous` and must not be chosen by PID, timestamp, window order, title similarity, or visual proximity.

`unavailable` or unresolved `ambiguous` is `BLOCKED` unless the task prompt provides a bounded way to re-establish the intended single instance. Never guess which host is current.

## 6. Observe Source, Canvas, and Output Preview with the right evidence

### Source

Use `vscode_observe` for:

- active document identity;
- `documentVersion` and dirty state;
- active surface;
- Source selection;
- diagnostics;
- exact dirty Source text when explicitly requested.

Source selection line/character coordinates are zero-based UTF-16 code-unit coordinates. Do not reinterpret them as Unicode code-point or byte indexes.

Use Playwright/CDP when the oracle is specifically about editor-visible UI that is not represented in the structured observation.

### Canvas

Use `vscode_observe` as the primary structured evidence for current Canvas facts that it publishes, including:

- selected element IDs and selection subject;
- document/compiled/evaluation revision facts;
- preview/evaluation state;
- Rust eligibility/evaluation source;
- current/stale flags;
- error/warning counts and summaries.

Use Playwright/CDP for Canvas/webview DOM identity, controls, overlays, bounding boxes, deterministic UI operation, and screenshots when those are part of the oracle.

Do not replace exact structured Canvas facts with screenshot interpretation when MCP publishes them.

### Output Preview

Use `vscode_observe` to establish document identity, active surface, document version, and Output Preview session presence where available. Use Playwright/CDP for Output Preview webview/DOM facts and deterministic operations that are not part of the current structured MCP projection.

Do not invent Output Preview runtime fields that `vscode_observe` does not publish.

## 7. Enforce freshness before accepting evidence

Treat exact-current evidence as a requirement, not a best effort.

For live VS Code evidence:

- verify the observation belongs to the intended run-unique document/instance;
- verify document versions are consistent with the state being tested;
- for Canvas evidence, reject a stale/non-current runtime snapshot;
- after an action that changes Source or triggers recompilation/evaluation, wait for the specified stable observable state rather than accepting an intermediate revision;
- when a live action changes document state, obtain fresh observation after the action; do not carry a pre-action snapshot forward as proof of post-action state.

If the required exact-current state cannot be observed reliably, return `BLOCKED` rather than using a stale screenshot or inferred state.

### Source-edit atomicity and intermediate states

One user-level action may pass through intermediate Source/document revisions before the authoritative edit, compilation, Canvas publication, or evaluation settles.

When revision semantics matter:

1. capture the required pre-action identity/version evidence;
2. perform exactly the predeclared action once;
3. wait for the task's stable post-action condition;
4. re-observe the Source/document version and any dependent Canvas/evaluation revisions;
5. compare only the stable before/after states required by the oracle.

Do not count transient intermediate revisions as extra user edits, extra Undo steps, or product failures unless the Manual E2E oracle explicitly defines those intermediate observations as the behavior under test.

## 8. Keep evidence objective

A `PASS` requires evidence that directly supports the predeclared oracle. Narration such as `looks correct` is insufficient.

Prefer:

- structured MCP fields;
- DOM/accessibility state;
- exact visible strings;
- exact Source text;
- active tab/document identity;
- selector values;
- before/after versions and state;
- counts/IDs;
- screenshots as supporting evidence when useful.

A screenshot does not authorize aesthetic or experiential judgment.

For every unit, record:

```text
Unit <id>: PASS | FAIL | BLOCKED
Expected:
Observed:
Evidence:
Reproduction steps if FAIL:
Blocker if BLOCKED:
```

Also record the tested commit/ref, checkout, execution-time `origin/main`, clean-status evidence, VS Code/Playwright versions when used, isolated run root, extension-registration preflight, and whether repository implementation files were modified.

## 9. Classify execution outcomes without crossing roles

Return `PASS` only when the expected observable condition is verified with sufficient exact-current evidence.

Return product `FAIL` only when all of these are true:

- environment/registration preflight passed;
- the specified action was executed;
- the required state was objectively observable;
- the observed result contradicted the predeclared oracle.

Return `BLOCKED` when reliable execution or judgment is prevented by any of these classes:

- tested-state/checkout problem;
- environment or extension-registration problem;
- Luna operation capability limitation;
- observation/evidence capability limitation;
- unresolved MCP instance/document ambiguity;
- stale/unavailable required MCP state;
- ambiguous or missing oracle/instruction.

When reporting `BLOCKED`, identify the class. Do not convert an ambiguous oracle into Human judgment and do not downgrade the oracle to make it executable.

An MCP observation deficiency is not automatically a product failure. Report the exact missing/insufficient structured fact as an observation deficiency; do not replace it with brittle visual inference merely to produce PASS/FAIL.

## 10. Respect Human judgment boundaries

Never execute a unit assigned `Judgment: Human` or `Executor: Human` unless a later Sol High prompt explicitly and validly reclassifies it.

Do not turn subjective checks such as visual discomfort, naturalness, polish, spacing quality, or interaction feel into binary substitutes merely because a DOM/MCP fact is available.

The user's copy-paste transport between Sol High and Luna remains transport only and does not change this classification.

## 11. Order units safely

Follow dependency/stop conditions in the task prompt. Put destructive actions last when the plan permits.

If one failed unit contaminates state for a later independent unit, use only the preauthorized fresh fixture/host reset needed to recreate that independent unit's exact initial state. Do not reset a dependent unit when state continuation itself is part of its oracle.

Continue independent units after a failure when the plan allows it so one failure does not hide unrelated evidence.

## 12. Return execution facts for the reusable-lesson check

Sol High owns the post-run decision about whether a run taught a reusable lesson. Do not edit the skill/playbook during Manual E2E and do not turn execution into policy work.

In the result, add this final field:

```text
Reusable-operation observation: none | <concise factual observation>
```

Use a factual observation only when the run exposed a potentially reusable operation/evidence fact, for example a repeatable environment pitfall, proven positive capability, capability boundary, stable evidence technique, or structured MCP observation gap. Do not propose policy or a fix.

Sol High will route any reusable lesson to the authoritative skill/playbook/rule owner. A generally reusable MCP observation deficiency should become focused follow-up MCP work instead of permanent brittle visual inference. If the run taught nothing reusable, report `none`.
