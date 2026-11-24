# nuinuiCAD Codex-only development workflow

This is the repository-owned execution policy for the **post-Chat/Work-unification** development system. Its introduction in a draft PR is preparation, not activation. Until the migration PR is deliberately merged **after the actual Chat/Work unification**, continue following the current policy on `main`. Chat conversations must not be moved to Work as a migration shortcut.

## Authority and roles

- **Product/engineering authority:** current `AGENTS.md`, `ARCHITECTURE.md`, `docs/nui1/spec.md`, `docs/dsl.md`, current source, and explicit Human decisions.
- **Work contract:** GitHub Issue body; material decisions and evidence in Issue comments. The exact remote commit, PR and required checks establish implementation facts.
- **Issue Authoring** (`nuinuicad-issue-authoring`): discuss, reproduce/triage, search open/closed Issues and PRs, identify first owner, obtain product decisions, author a bounded contract and correct labels. Discussion does not authorize creation; Issue creation does not authorize implementation.
- **Implementation** (`nuinuicad-implementation`): implement the authorized contract and focused local verification; commit, non-force push, and PR. For deterministic narrow changes or simple gates recommend Luna; for ambiguous/cross-owner work the Human may choose Sol/Astra. Do not infer a model choice or expand a lower-tier allowlist.
- **Independent Review** (`nuinuicad-independent-review`): a different reviewer/session reads the *exact pushed remote HEAD* against Issue/spec and actual CI coverage, returns PASS/FAIL/BLOCKED, with no implementation writes. Every changed HEAD requires applicable re-review.
- **Human E2E session** (`nuinuicad-e2e-session`): prepare/launch an isolated native VS Code development host, provide the checklist, and record the Human's result. It is an environment-preparation skill, **not an E2E executor**. Only the Human operates the product GUI and judges E2E. Do not use MCP, Playwright, CDP, computer use, or agent-driven product E2E.

There is no independent Coordinator skill. The Codex conversation orchestrates the above four responsibilities; decisions that alter product behavior belong to the Human.

## Before any implementation

1. Re-fetch authoritative remote `main`, Issue body/comments, relevant specs and existing PRs. Do not use old chat snapshots as current state.
2. Verify the *authorized* implementation checkout, clean working tree, origin, branch, intended base/head, and absence of conflicting owners. Do not create extra worktrees, interfere with a Human E2E checkout, or silently reset/stash/rebase/force-push.
3. Reconcile any contract/owner drift before mutation. Scope includes only acceptance-linked implementation, tests and necessary docs.
4. Commit/push only intended paths. PR uses `Refs #N` while Human E2E or other acceptance remains pending; only use a closing keyword when full acceptance is already verified.

## Test and quality gates

- **Local:** run changed/impacted focused tests first; use `git diff --check`, code/diff review, and only relevant `npm run build`, `npm run lint`, `npm run build:vscode`, `npm run docs:dsl:check`, focused Rust tests/fmt/check, and TypeScript/Rust parity. Broad/racy changes may demand additional focused coverage. Do not make full `npm test` or full Rust suites a blanket precommit requirement.
- **CI:** the required protected PR check owns broad Node regression (`npm test` for code changes) and the change-aware Rust/parity/stress/VS Code checks that apply. Verify actual jobs and artifacts; a green status is not proof that a skipped job ran.
- **Independent review:** compare the exact pushed HEAD and acceptance to implementation, including regression oracles and CI breadth. FAIL/BLOCKED returns to Implementation, then a new push/review cycle.

## Default merge route

```text
Issue contract ready
  -> scoped Implementation + focused local checks
  -> pushed PR
  -> independent exact-HEAD review PASS + required CI PASS
  -> Human E2E PASS (if required)
  -> protected merge + authoritative main read-back
  -> Issue completion/close
```

If the Issue explicitly states Human E2E **Not Required**, review and CI can precede normal merge directly. Never treat build/launch success or agent observations as Human E2E PASS. Review and Human E2E may take place in parallel with CI, but all gates must be proven before a normal merge; if HEAD or the tested artifact changes materially, refresh the affected evidence.

## Human E2E environment preparation

Use the **dedicated, clean, Human-authorized test checkout**, never the live implementation checkout. Independently verify the target against the reviewed PR's exact remote pushed HEAD (premerge), or the merged authoritative `main` SHA (deferred batch). The exact SHA must be recorded with Human test evidence.

Current dogfood tooling supports these two modes after this change:

```bash
# Premerge: the Human-approved test checkout is clean at the exact reviewed PR HEAD.
npm ci
npm run dogfood:build -- --tested-head <40-character-reviewed-PR-SHA>
npm run dogfood:launch -- --isolated /absolute/path/to/test-fixture.nui

# Postmerge batch: the clean main checkout equals freshly fetched origin/main.
npm run dogfood:build
npm run dogfood:launch -- --isolated /absolute/path/to/test-fixture.nui
```

`--tested-head` is a deliberate override of the default main-only build guard, **not** proof by itself that a local commit is a reviewed remote PR HEAD. The preparing agent must verify that separately against the current GitHub PR; mismatched or dirty checkout blocks setup. The immutable snapshot binds the extension and release Rust evaluator to the exact SHA/platform/architecture. The `--isolated` launch option creates a distinct VS Code user-data and extensions directory for that session. Do not reuse or delete other profiles, sessions, snapshots or private fixtures. Build/launch success is only `SETUP READY`. Human GUI operation and PASS/FAIL judgment occur afterwards.

## Away-only deferred Human E2E exception

The Human must explicitly declare that they are away and cannot conduct physical E2E. Location, calendar, or remote access never implies permission. During that period:

1. After exact-head review PASS and required CI PASS, a PR requiring Human E2E **may** merge while its E2E status is `PENDING`; record the explicit exception and exact merge/commit on each affected Issue.
2. Keep every such Issue **OPEN**; use `Refs #N`, not an auto-close keyword. Do not mark the Issue accepted or PASS.
3. Subsequent Issues may be implemented in sequence from freshly verified current `main`, respecting checkout/owner safety.
4. On return, use a dedicated human-test session to test the integrated `main` at an explicit SHA, one or more Issues in a single physical session. Record per-Issue scenarios, result, Human identity/date, SHA, and any integration dependencies. A single successful launch is not a blanket PASS.
5. Close each Issue only when its Human E2E acceptance is PASS and all other gates hold. If a test FAILs, keep the Issue open and create/authorize a bounded fix-forward path; do not rewrite the failed historical result.
6. Restore the normal **pre-merge** Human E2E requirement when the Human ends the away period.

## Policy ownership and retired components

This document owns the development lifecycle; `docs/development/github-issues.md` owns Issue types, readiness and contract structure. `AGENTS.md` owns durable product/engineering principles. Existing `scripts/dogfood/` infrastructure owns SHA-frozen native VS Code snapshot/launcher behavior.

The `dev-context` repository is retained as an unrelated historical repository but is **not a nuinuiCAD authority, dependency, router or synchronization destination** after activation. Do not resurrect its rules, the legacy `nuinuicad-luna-mcp-e2e` skill, agent-operated GUI E2E, or automatic Chat-to-Work migration.
