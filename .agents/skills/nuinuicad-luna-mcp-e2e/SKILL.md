---
name: nuinuicad-luna-mcp-e2e
description: Run predeclared objective nuinuiCAD Manual E2E units in an isolated VS Code Extension Development Host as the Luna test operator. Use Playwright/CDP for deterministic UI operation, nuinuiCAD MCP for exact-current structured evidence, and Computer Use only for required GUI/pixel-only gaps. Do not use this skill for implementation, root-cause investigation, test-plan design, product judgment, or Human-assigned units.
---

# nuinuiCAD Luna MCP-backed Manual E2E

Use this skill only for a current Manual E2E plan that already declares objective `Executor: Luna` units, exact initial state/actions, predeclared oracles, and required evidence.

Luna is the test operator, not the test designer:

```text
prepare exact state
-> operate
-> observe
-> compare with predeclared oracle
-> record evidence
-> PASS | FAIL | BLOCKED
```

Do not modify implementation files, fix failures, investigate implementation root causes, redesign or weaken the test plan, invent missing semantics, or perform Human-assigned judgment.

## Authority routing

This skill is the reusable execution procedure, not a competing policy owner. Sol High applies the current authorities before creating the execution prompt:

- classification / executor / PASS-FAIL-BLOCKED: `sayosomi/dev-context/projects/nuinuiCAD/MANUAL-E2E.md`
- isolated VS Code host baseline: `sayosomi/dev-context/projects/nuinuiCAD/VS-CODE-E2E.md`
- tested state / prompt / evidence / retry / pitfalls / result handling: `sayosomi/dev-context/projects/nuinuiCAD/LUNA-E2E-PLAYBOOK.md`
- skill selection: `sayosomi/dev-context/projects/nuinuiCAD/AGENT-SKILLS.md`
- fixture / action / oracle / acceptance: the current Manual E2E plan supplied by Sol High

If execution instructions are ambiguous or conflict in a way that changes the oracle or allowed operations, return `BLOCKED`; do not choose a new contract.

## Human transport is not Human execution

Normal handoff is manual transport between separate product sessions:

```text
Sol High prompt
-> user copy-pastes to Luna/Codex
-> Luna executes and returns evidence
-> user copy-pastes result to Sol High
```

Treat the user action above as transport only. It is not `Judgment: Human` or `Executor: Human`. Do not introduce, require, scrape, or simulate automatic ChatGPT-to-Luna conversation relay.

## 1. Freeze and verify the tested state

Follow the tested commit/stable-ref contract from the prompt. At minimum verify:

```bash
git fetch origin --prune
git status --short
git branch --show-current
git rev-parse HEAD
```

Use only a clean checkout permitted by the prompt. Never reset, stash, discard, overwrite, force-switch, or force-update unrelated user work.

When a stable E2E ref is supplied, verify that it points to the exact expected commit. Record the execution-time `origin/main` separately. A newer `origin/main` alone is not product failure and does not authorize changing the tested state.

If an expected repository file, Agent Skill, or build input appears to be missing from the local checkout, verify the exact tested commit on GitHub before classifying it as product absence. An incompletely materialized checkout or dependency tree is an environment/setup problem. When the prompt permits a bounded recovery, use a clean full detached checkout/worktree at the exact tested commit, run the repository's normal dependency install such as `npm ci`, and rebuild. Do not repair or overwrite unrelated user work merely to make the checkout usable.

Return `BLOCKED` for a rewritten/missing tested ref or for a checkout that cannot be made safe without touching unrelated work.

## 2. Launch the isolated VS Code host and preflight it

Use the current canonical launch procedure from `VS-CODE-E2E.md`; do not rebuild a parallel launcher in this skill. Preserve its fresh profile, empty extension directory, run-unique fixture outside the checkout, current extension build, matching Rust evaluator binary, explicit extension development path, trust isolation, dedicated-machine process cleanup, and dedicated CDP port.

When any unit uses `vscode_observe`, start the tested Extension Development Host with the current read-only observation bridge explicitly enabled. The current implementation uses:

```text
NUINUICAD_MCP_OBSERVATION=1
```

Keep the MCP observation path read-only. Do not expose bridge credentials or add command/mutation/shell/keyboard/pointer/screenshot surfaces to MCP.

Before product units, objectively verify:

- the run-unique `.nui` fixture is active;
- its language mode is nuinuiCAD/`nui`, not Plain Text;
- required nuinuiCAD commands are registered **from a surface where their declared Palette scope is supposed to be visible**;
- Playwright/CDP is attached to the workbench containing that exact fixture;
- when `vscode_observe` is required, the expected live observation instance/document resolves.

Do not require a Canvas-only command while Source is active merely because the test will use it later. For example, verify Source-scope commands while Source is active and verify Canvas-only commands such as Fit Drawing after Canvas is active. A missing command in an out-of-scope Palette state is not evidence of extension-registration failure.

Registration/launch/observation-bridge setup failure is environment `BLOCKED`, not product `FAIL`.

Use the bounded launch retry from `VS-CODE-E2E.md`: wait through the canonical CDP readiness window, preserve diagnostics on failure, cleanup, then retry once with a new fresh profile. A second failure is environment `BLOCKED`. Do not convert this into repeated product-behavior retries.

A bounded prompt/operation mistake may be corrected only while the predeclared action and oracle remain unchanged. Do not loop on instructions that require redesign.

## 3. Choose operation and evidence surfaces deliberately

Use this model:

```text
Playwright/CDP = preferred deterministic VS Code UI operation and DOM/accessibility evidence
nuinuiCAD MCP = exact-current structured product state and evidence
Computer Use = bounded fallback only for genuinely required GUI/pixel-only gaps
```

Do not visually infer a fact through Computer Use when Playwright/CDP or MCP can establish it objectively. If a required GUI/pixel-only operation cannot be performed reliably with available capability, return capability `BLOCKED`.

### Headless MCP vs `vscode_observe`

Use file-backed headless MCP tools when the oracle concerns the exact on-disk `.nui` snapshot and does not require live editor/session state:

- `document_inspect`
- `document_definition`
- `document_references`
- `document_evaluate`

Do not use those file-backed tools as proof of dirty unsaved Source state.

Use `vscode_observe` for live VS Code production-host facts such as document identity/version/dirty state, Source selection and diagnostics, active surface, Canvas/Output Preview session presence, or current Canvas runtime state. Request `includeSourceText: true` only when exact live Source text is required; the compact default intentionally omits it.

`vscode_observe` is observation only. Never treat it as an automation or mutation API.

### Deterministic Canvas operation inside the webview

When a Canvas unit requires a geometry click, first resolve the correct `vscode-webview://...` frame for the run-unique document, then derive the operation point from the actual rendered geometry/overlay in that frame. Nested-frame coordinates must be resolved against the frame/element that owns the geometry; do not mix workbench coordinates, webview-frame coordinates, and geometry-local coordinates.

Do not use an offset geometry-name label or other `pointer-events: none` identity text as the click target. A label may be positioned near the geometry rather than on its hit-test point. Geometry-name identity DOM may also be intentionally absent before hover/selection or while name display is disabled, so do not make optional pre-selection identity text a prerequisite unless the tested product contract guarantees it.

For a fixture with one objectively unique rendered geometry, it is valid to click that geometry's deterministic midpoint/bounds-derived point, then require the post-click selection marker/selected identity DOM before taking the fresh structured observation. If multiple geometries are plausible and the intended target cannot be distinguished objectively, return `BLOCKED` instead of guessing.

## 4. Resolve the live instance/document without guessing

Use explicit `instanceId` when the prompt has established it. Otherwise prefer the exact run-unique `documentPath`.

Respect the current deterministic resolution behavior:

1. explicit instance ID;
2. exactly one live instance matching the requested document path;
3. sole remaining live instance;
4. otherwise explicit `ambiguous` / `unavailable` instead of guessing.

Never choose by PID, timestamp, window order, title similarity, or visual proximity. Unresolved ambiguity/unavailability is `BLOCKED` unless the prompt provides a bounded way to re-establish one intended instance.

## 5. Observe each production surface with current evidence

### Source

Use `vscode_observe` for document identity, `documentVersion`, dirty state, active surface, Source selection, diagnostics, and opt-in live `sourceText`. Source selection line/character coordinates are zero-based UTF-16 code-unit coordinates.

Use Playwright/CDP only for editor-visible facts/actions not represented by the structured observation.

### Canvas

Prefer `vscode_observe` for the structured Canvas facts it publishes: selected IDs/subject, document/compiled/evaluation revisions, preview/evaluation state, evaluation source/Rust eligibility, current/stale state, and error/warning summaries. Use Playwright/CDP for webview DOM identity, controls, overlays, deterministic UI operation, bounding boxes, and screenshots when those are part of the oracle.

For the current MCP projection, `canvas.selectedElementIds` is the agent-facing stable snapshot identity namespace and is the field to compare with stable IDs returned by headless tools such as `document_inspect`. When `runtimeSelectedElementIds` is present, it intentionally exposes the separate Canvas runtime/session IDs; do not compare those raw runtime IDs to headless stable IDs or treat their difference as failure.

Do not replace published structured Canvas facts with screenshot interpretation.

### Output Preview

Use `vscode_observe` for document identity/version, active surface, and Output Preview session presence where published. Use Playwright/CDP for Output Preview webview/DOM operation and facts outside the current structured MCP projection. Do not invent Output Preview runtime fields.

## 6. Enforce freshness and source-edit atomicity

Exact-current evidence is mandatory.

- prove the observation belongs to the intended run-unique document/instance;
- reject a stale/non-current Canvas observation;
- obtain a fresh observation after any state-changing action;
- do not use a pre-action snapshot as post-action evidence;
- after Source changes that trigger compilation/evaluation, wait for the predeclared stable post-action state before comparing revisions or output.

One user-level Source action can expose intermediate document/compile/evaluation revisions before the authoritative state settles. When revision semantics matter:

1. capture the required pre-action identity/version evidence;
2. execute the predeclared action once;
3. wait for the defined stable post-action condition;
4. re-observe Source/document and dependent Canvas/evaluation revisions;
5. compare only the stable states named by the oracle.

Do not count transient intermediate revisions as extra edits, extra Undo steps, or product failures unless the oracle explicitly tests those intermediate states.

If exact-current state cannot be observed reliably, return `BLOCKED` instead of substituting stale screenshots or inference.

## 7. Record objective evidence and classify the result

A `PASS` requires evidence directly supporting the oracle. `looks correct` is not evidence.

Prefer structured MCP fields, DOM/accessibility state, exact strings/source text, active identity, selector values, before/after versions/state, counts/IDs, and screenshots only as supporting evidence when useful. A screenshot does not authorize aesthetic judgment.

Return product `FAIL` only when environment preflight passed, the specified action executed, the required state was objectively observable, and the observation contradicted the predeclared oracle.

Return `BLOCKED` and identify the class for:

- tested-state / checkout failure;
- environment / extension-registration failure;
- Luna operation capability failure;
- observation/evidence capability failure;
- unresolved MCP ambiguity/unavailability/staleness;
- missing or ambiguous oracle/instruction.

Do not convert ambiguous product semantics into Human judgment. Do not weaken an oracle to make it Luna-executable.

A missing structured MCP fact is an observation deficiency, not automatically a product failure. Report the exact deficiency instead of using brittle visual inference merely to force PASS/FAIL.

Never execute a `Judgment: Human` / `Executor: Human` unit unless a later valid Sol High prompt explicitly reclassifies an objective capability-only assignment. User copy-paste transport never changes this boundary.

## 8. Preserve independent evidence across units

Follow the prompt's dependency/stop rules and put destructive actions last when possible.

If one failed unit contaminates a later independent unit, use only the preauthorized fresh fixture/host reset needed to recreate that unit's exact initial state. Do not reset a dependent unit when state continuation is part of its oracle. Continue independent units after failure when the plan allows it.

## 9. Return the standard result plus reusable-operation facts

Record the tested commit/ref, checkout, execution-time `origin/main`, clean-status evidence, VS Code/Playwright versions when used, isolated run root, extension-registration/observation preflight, and whether repository implementation files were modified.

Per unit:

```text
Unit <id>: PASS | FAIL | BLOCKED
Expected:
Observed:
Evidence:
Reproduction steps if FAIL:
Blocker if BLOCKED:
```

End with:

```text
Reusable-operation observation: none | <concise factual observation>
```

Use the final field only for a potentially reusable execution/evidence fact encountered during the run: repeatable environment pitfall, proven capability, capability boundary, stable evidence technique, or structured MCP observation gap. Do not propose policy or an implementation fix.

Sol High owns the reusable-lesson check after every run and routes a real lesson to the authoritative skill/playbook/rule owner. Generally reusable MCP observation deficiencies should become focused MCP follow-up work rather than permanent brittle visual inference. If the run taught nothing reusable, report `none`.
