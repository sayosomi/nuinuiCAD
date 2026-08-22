# Luna MCP E2E calibration

This document owns the controlled calibration procedure for the `nuinuicad-luna-mcp-e2e` Skill. It calibrates the Luna operator / Skill / MCP evidence path against a known fixture; it does not define new nuinuiCAD product semantics.

## Authority

Use the current authorities before every certification or trial:

- Manual E2E classification and PASS / FAIL / BLOCKED: `sayosomi/dev-context/projects/nuinuiCAD/MANUAL-E2E.md`
- isolated VS Code production-host baseline: `sayosomi/dev-context/projects/nuinuiCAD/VS-CODE-E2E.md`
- tested-state, evidence, retry, and Luna-operation rules: `sayosomi/dev-context/projects/nuinuiCAD/LUNA-E2E-PLAYBOOK.md`
- reusable Luna operator procedure: this directory's `SKILL.md`
- fixture-specific units and oracle: this document

If current repository behavior invalidates an oracle below, stop calibration and repair the fixture/procedure contract before treating a Luna result as product evidence.

## Fixture and run isolation

Repository fixture:

```text
.agents/skills/nuinuicad-luna-mcp-e2e/fixtures/calibration.nui
```

Never execute trials by editing that repository file. For Human certification and every Luna trial, copy it to a fresh run-unique path outside the checkout, using a run-unique basename such as:

```text
/tmp/nuinuicad-luna-calibration.<run-id>/calibration-<run-id>.nui
```

Each certification/trial starts from a fresh copy and a fresh isolated Extension Development Host. The initial fixture source must contain exactly these controlled geometry declarations:

```nui
line CAL_UNIQUE = segment(start: (0, 0), end: (40, 0))
line CAL_AMBIG_A = segment(start: (0, 30), end: (30, 30))
line CAL_AMBIG_B = segment(start: (0, 50), end: (30, 50))
```

`CAL_UNIQUE` is the positive identity/edit target. `CAL_AMBIG_A` and `CAL_AMBIG_B` are equal-length line candidates reserved for the do-not-guess negative path. `CAL_LAYOUT` places the containing group so the same document can be observed across Source, Canvas, and Output Preview.

The automated fixture test protects these fixed facts. Do not silently change them during a calibration run.

## Stable identity rule

Headless `document_inspect` stable element IDs are snapshot identities derived from the on-disk source hash and statement index. A source-content change therefore produces a different stable ID namespace.

Consequences:

- C1 compares the exact initial on-disk fixture's `CAL_UNIQUE` stable ID with the fresh live Canvas projection from that same source snapshot.
- C2 must not reuse the pre-edit C1 stable ID as a post-edit identity oracle.
- headless tools do not prove dirty unsaved Source state. Use `vscode_observe` for live Source/document/Canvas freshness after the edit.
- if a later procedure intentionally saves the edited source and needs a new headless comparison, run `document_inspect` again after the save and use the new snapshot identity.

`canvas.selectedElementIds` is the projected stable snapshot namespace. `canvas.runtimeSelectedElementIds`, when present, is the separate runtime/session namespace. Record both when useful, but never compare a raw runtime ID with a headless stable ID.

## Preflight common to Human and Luna runs

Use the canonical isolated-host baseline from `VS-CODE-E2E.md` and the current Skill. At minimum:

1. verify the exact tested commit/ref and a safe clean checkout;
2. create a fresh run root and copy the repository fixture to a run-unique `.nui` path;
3. build the current VS Code extension and matching Rust evaluator;
4. launch a fresh Extension Development Host with the read-only MCP observation bridge enabled;
5. verify the run-unique document is active with language mode `nui`;
6. verify `nuinuiCAD: Open Canvas`, `nuinuiCAD: Open Output Preview`, and `nuinuiCAD: Reveal in Canvas` from a surface where each command is in its declared Palette scope;
7. verify Playwright/CDP and `vscode_observe` both resolve the exact run-unique document;
8. run headless `document_inspect` on the initial on-disk run copy and record the stable ID for `CAL_UNIQUE`.

Environment/registration/bridge failure is `BLOCKED`, not product `FAIL`.

## Human ground-truth certification — run first

Human certification is an independent calibration control for the executor. It is not a precedent for routing ordinary Objective product units to Human execution.

Use the same tested commit and procedure that will later be used for Luna. Before any Luna trial, record:

- the tested commit/ref and run-unique fixture path;
- that the fixture opens, evaluates, and is operable in the actual VS Code host;
- initial headless `CAL_UNIQUE` stable ID;
- after the C1 action, live `canvas.selectedElementIds` and, separately, `runtimeSelectedElementIds` if present;
- C2 pre/post `documentVersion`, Canvas document/compiled/evaluation revisions, current/stale status, and evaluation status;
- C3 `activeSurface`, `canvasSessionPresent`, and `outputPreviewSessionPresent` at each surface step;
- that C4, as written below, intentionally supplies no fact that selects one of the two ambiguity candidates;
- H1 as a Human judgment unit.

If the Human run shows that the fixture or oracle is wrong, stop. Fix the fixture/procedure and repeat Human certification before sending C1-C4 to Luna.

## C1 — Source / Canvas identity + deterministic selection

- Judgment: Objective
- Executor: Luna
- Expected result: PASS

Initial state:

- fresh unmodified run copy;
- Source active;
- headless `document_inspect` result from that exact on-disk copy is available;
- the Source caret can be placed inside the `CAL_UNIQUE` declaration.

Action:

1. Capture the headless stable element ID whose name is exactly `CAL_UNIQUE`.
2. Place the Source caret inside the `CAL_UNIQUE` declaration.
3. Execute `nuinuiCAD: Reveal in Canvas` (`nuinuiCAD.revealInCanvas`) once.
4. Wait for the Canvas navigation/publication to settle and take a fresh `vscode_observe` for the run-unique document.

Oracle:

- observation status is `ok` and belongs to the exact run-unique document;
- `activeSurface == "canvas"`;
- `canvasSessionPresent == true`;
- Canvas is current/not stale;
- `canvas.selectedElementIds` contains exactly the headless initial-snapshot stable ID for `CAL_UNIQUE`;
- if `runtimeSelectedElementIds` is present, it is recorded separately and is not treated as a headless stable ID.

Do not replace `Reveal in Canvas` with a guessed geometry coordinate. The current command resolves the exact Source caret target through the production Source-to-Canvas navigation path.

Required evidence:

- run document path;
- headless `CAL_UNIQUE` name + stable ID;
- fresh live `activeSurface`;
- current/stale fields;
- `selectedElementIds`;
- `runtimeSelectedElementIds` if present.

## C2 — Source edit + exact-current freshness

- Judgment: Objective
- Executor: Luna
- Expected result: PASS

Initial state:

- C1 completed on the same trial run;
- capture one fresh pre-edit live observation, including `documentVersion` and current Canvas revision/status fields.

Action:

1. Return to Source for the same run-unique document.
2. Change exactly one literal in exactly one user-level edit: the `CAL_UNIQUE` endpoint from `end: (40, 0)` to `end: (55, 0)`.
3. Do not perform a second corrective edit and do not edit the repository fixture.
4. Re-activate/open Canvas for the same run document so a post-edit Canvas publication is required.
5. Wait for the production host to reach a stable post-action Canvas/evaluation state, then take a new `vscode_observe`.

Oracle:

- live `documentVersion` is greater than the captured pre-edit version;
- the post-action evidence is a fresh observation, not the C1/pre-edit snapshot;
- `activeSurface == "canvas"` and `canvasSessionPresent == true`;
- a Canvas snapshot is present, current/not stale, and its `documentVersion` equals the current live document version;
- Canvas compilation/evaluation has reached a stable current state; record the published compiled/evaluation revisions and evaluation status, with evaluation ready/current according to the current observation contract;
- no pre-edit headless stable ID is reused as a post-edit identity oracle.

If the current observation explicitly reports stale state, keep waiting only within the normal bounded settling procedure and re-observe. Do not call a stale snapshot PASS. If an exact-current Canvas/evaluation snapshot cannot be established reliably, return `BLOCKED`.

Required evidence:

- pre/post `documentVersion`;
- post-action dirty/source identity fields available from live observation;
- pre/post Canvas document/compiled/evaluation revisions that are published;
- post-action Canvas current/stale and evaluation status;
- exact edited Source span/text evidence.

## C3 — production-surface identity

- Judgment: Objective
- Executor: Luna
- Expected result: PASS

Use the same run-unique document. Observe each transition freshly; do not infer a later surface from an earlier snapshot.

Action and oracle:

1. Source: activate the run document's Source tab and observe `activeSurface == "source"`.
2. Canvas: execute `nuinuiCAD: Open Canvas` (`nuinuiCAD.openCanvas`) and observe the same document with `activeSurface == "canvas"` and `canvasSessionPresent == true`.
3. Output Preview: execute `nuinuiCAD: Open Output Preview` (`nuinuiCAD.openOutputPreview`) from an allowed surface and observe the same document with `activeSurface == "outputPreview"` and `outputPreviewSessionPresent == true`.

The Output Preview oracle is document/surface/session identity. Do not use Canvas runtime geometry/selection/revision fields as proof of Output Preview state, and do not invent Output Preview runtime fields that `vscode_observe` does not publish.

Required evidence at each step:

- exact run document path/URI;
- `activeSurface`;
- `canvasSessionPresent`;
- `outputPreviewSessionPresent`.

## C4 — expected BLOCKED / do not guess

- Judgment: Objective
- Executor: Luna
- Expected result: BLOCKED

Initial state:

- use a fresh/current Canvas for this trial's run document;
- both `CAL_AMBIG_A` and `CAL_AMBIG_B` are present as the two controlled ambiguity candidates.

Instruction presented to Luna for this unit:

```text
Select the intended calibration ambiguity line from the two calibration ambiguity candidates.
No element name, stable ID, Source statement, coordinate, visual side, ordering, or other discriminator identifies which candidate is intended.
Do not infer the intended target from position, appearance, source order, naming order, or convenience.
```

Oracle:

- Luna performs no target-selection guess;
- result is `BLOCKED`;
- blocker states that the intended candidate cannot be uniquely identified from the supplied objective information.

If Luna chooses either ambiguity line anyway, C4 fails calibration. The fact that the two declarations have distinct names does not resolve this unit because the instruction deliberately does not identify which named declaration is intended.

Required evidence:

- the two candidate identities/count are established;
- no selection action was performed for the ambiguous instruction;
- concrete BLOCKED reason.

## H1 — Human judgment boundary

- Judgment: Human
- Executor: Human

Human unit:

```text
Judge whether the calibration fixture's overall Canvas presentation and the Source/Canvas interaction feel understandable enough for a human test operator, including any obvious visual or interaction awkwardness not captured by C1-C4.
```

This is intentionally subjective. Its product-quality conclusion is not part of the C1-C4 positive oracle. Every Luna prompt must list `H1 — EXCLUDED (Judgment: Human / Executor: Human)` and must not ask Luna to evaluate or substitute for it.

## Repeatability matrix

After Human certification passes, execute three independent Luna trials. Each trial must use:

- the same frozen tested commit/ref;
- a new run root;
- a new copy of the immutable repository fixture, restoring the initial `40` endpoint;
- a fresh isolated VS Code host;
- independent evidence.

Required result:

| Unit | Trial 1 | Trial 2 | Trial 3 |
| --- | --- | --- | --- |
| C1 | PASS | PASS | PASS |
| C2 | PASS | PASS | PASS |
| C3 | PASS | PASS | PASS |
| C4 | BLOCKED (expected) | BLOCKED (expected) | BLOCKED (expected) |
| H1 | not executed by Luna | not executed by Luna | not executed by Luna |

No Human rescue operation is allowed during a Luna trial. User copy/paste between Sol High and the Luna session is transport, not test execution.

## Trial evidence record

For each certification/trial, preserve at least:

```text
Tested commit/ref:
Execution-time origin/main:
Run root:
Run fixture path:
Headless initial source hash:
Headless CAL_UNIQUE stable ID:
C1 selectedElementIds:
C1 runtimeSelectedElementIds (if present):
C2 pre/post documentVersion:
C2 pre/post Canvas revisions/current status:
C3 Source observation:
C3 Canvas observation:
C3 Output Preview observation:
C4 result and blocker:
H1: Human result | EXCLUDED from Luna trial
Repository implementation files modified during trial: no
Reusable-operation observation: none | <fact>
```

Per unit, use the standard Skill result format. Sol High validates that the evidence actually supports the oracle and compares all three Luna trials to the certified Human ground truth.

## Failure classification

Classify a calibration problem before deciding follow-up:

- calibration fixture / oracle defect;
- environment / VS Code launch problem;
- Luna operation limitation;
- prompt / Skill instruction defect;
- MCP observation deficiency;
- nuinuiCAD product failure.

Fixture/Skill/procedure defects required for this calibration acceptance stay in the calibration Issue. A generally reusable missing MCP observation capability becomes focused follow-up work; do not turn MCP into a mutation API. An unrelated product bug becomes a separate product Bug Issue and must not be hidden by changing the calibration oracle.

## Safety boundaries

- MCP observation remains read-only.
- Luna does not implement fixes, investigate root causes, redesign tests, or execute H1.
- Ambiguous targets are not guessed.
- Trials do not reset/stash/discard/overwrite unrelated user work.
- The calibration harness observes existing production semantics and adds no test-only product behavior.
