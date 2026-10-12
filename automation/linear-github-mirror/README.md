# Linear → GitHub public mirror

Cloudflare Worker for the nuinuiCAD one-way public mirror.

nuinuiCAD GitHub Issues became the current Work and contract authority through the completed C1 cutover on 2026-10-12. GitHub Issue bodies and comments are the current Work, contract, and evidence records. Linear is historical and retained for provenance and minimal checkpoints on compatible SAY work admitted before cutover.

The Linear mirror is a historical integration; checked-in `wrangler.jsonc` sets `MIRROR_MODE` to `disabled`. In historical `active` mode, the Worker validates Linear webhooks, enqueues them through Cloudflare Queues, refetches canonical Linear data, and reconciles GitHub through the REST API.

## Scope

Webhook resource types:

- `Issue`
- `Comment`
- `Document`

Issue mirror:

- title and description
- Linear status → GitHub open/closed + close reason
- Linear labels
- priority, project, parent, blocks / blocked-by / related metadata
- existing Linear → GitHub mapping
- new Linear issues create a GitHub issue and attach its URL back to Linear

Comment mirror:

- all Linear comments on mirrored Issues
- all Linear comments on mirrored Documents
- create, edit, and remove are reconciled one-way to GitHub
- `linear-comment-id` hidden markers provide stable mapping and deduplication
- GitHub-only comments remain GitHub-only

Document mirror:

- one Linear Document maps to one GitHub Issue
- only Documents under the nuinuiCAD Initiative subtree are public
- title and Markdown content are mirrored
- the GitHub issue gets the `Linear Document` label
- archived, trashed, or removed Documents close as `not planned`
- `linear-document-id` hidden markers provide stable mapping

Not mirrored:

- GitHub → Linear changes
- assignees
- Project / Initiative / milestone / status-update comments
- project-level objects as standalone mirrors
- Linear-hosted authenticated media re-hosting

Migration-only/shadow Linear issues `SAY-39`, `SAY-75`, `SAY-84`, and `SAY-85` are explicitly excluded.

## Issue mapping

Mapping resolution is deterministic and idempotent:

1. Reuse a GitHub issue attachment already present on the Linear issue.
2. For legacy backfill ranges, use the historical mapping:
   - SAY-9…SAY-38 → GitHub #186…#215
   - SAY-40…SAY-74 → GitHub #216…#250
   - SAY-39 is excluded.
3. Recover a previously created mirror by the hidden `linear-issue-id` marker in the GitHub body.
4. Otherwise create a new GitHub issue and attach it to Linear.

## Reliability

The HTTP handler only authenticates, validates freshness, and enqueues. The Queue consumer performs Linear/GitHub API calls with retries, a dead-letter queue, batch size 1, and max concurrency 1.

GitHub issue discovery for hidden mirror markers uses repository issue listing rather than Search API indexing. After creating a Document mirror, the consumer waits until that marker is visible before completing the Queue message. This prevents a second queued webhook for the same new Document from creating a duplicate mirror during GitHub read-after-write propagation.

The Cloudflare Cron Trigger remains scheduled every 12 hours (`0 */12 * * *`, UTC). In active mode, it reconciles all Sayosomi Issues and accessible Linear Documents in the nuinuiCAD Initiative subtree, including managed comments and orphaned Document mirrors, to catch webhook gaps. In disabled mode, the scheduled handler returns without enqueueing or reconciling.

## Required secrets and variables

Secrets:

- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN` — fine-grained PAT for `sayosomi/nuinuiCAD` with **Issues: Read and write**

Non-secret vars in `wrangler.jsonc`:

- `MIRROR_MODE` — `active` enables mirroring; `disabled` blocks webhook enqueueing, acknowledges pending Queue messages without reconciliation, and skips scheduled sweeps. Missing or unsupported values fail closed as disabled.
- `LINEAR_TEAM_ID`
- `LINEAR_INITIATIVE_ID`
- `GITHUB_OWNER`
- `GITHUB_REPO`

## Deploy

From this directory:

```bash
npx wrangler deploy
```

The queues and secrets are already provisioned in production. For a fresh environment, create both configured queues and set the three secrets before deployment.

Linear webhook configuration for the Sayosomi team:

- URL: `https://<worker>/webhooks/linear`
- data change events: `Issues`, `Comments`, `Documents`

Health check:

```bash
curl https://<worker>/health
```

Expected:

```json
{"ok":true,"mirrorMode":"disabled"}
```

`mirrorMode` reports the effective mode. A missing or unsupported `MIRROR_MODE` is reported as `disabled`.

## Production shutdown cutover

The checked-in configuration sets `MIRROR_MODE: "disabled"` after reviewed [PR #1370](https://github.com/sayosomi/nuinuiCAD/pull/1370). The separately authorized 2026-10-12 production deploy reported version `41736512-dc33-440b-b292-e470e2541519` at 100% and `/health` reported `mirrorMode: "disabled"`. These are deployment-time results; current live Cloudflare state was not independently checked for this README update. Do not reactivate the Worker during test/documentation maintenance.

The approved shutdown procedure was (do not reactivate a disabled Worker just to repeat active-mode reconciliation steps):

1. Reconcile pending Linear updates while mirroring is active and verify the GitHub mirror is current.
2. Inspect the Cloudflare Queue backlog and in-flight work. Let all intended work finish before shutdown; messages delivered while disabled are acknowledged and will not be reconciled later.
3. In a reviewed, tracked configuration change, explicitly set `MIRROR_MODE` to `disabled`.
4. Deploy that reviewed configuration to the intended Cloudflare Worker.
5. Read back the deployed configuration/revision and confirm `/health` reports `mirrorMode: "disabled"`. Verify that valid signed webhooks are acknowledged without Queue dispatch, Queue messages are acknowledged without reconciliation, and no GitHub writes occur after cutover.

Do not treat PR merge or the health response alone as proof of completed shutdown. Completion requires deployed-state read-back and verification that production GitHub writes have stopped.

## Verification

Automated checks:

```bash
npm test
node --check src/index.js
node --check src/worker.js
node --check src/mirrorApi.js
node --check src/comments.js
node --check src/documents.js
node --check src/extensions.js
```

Production verification completed on 2026-08-21:

- Issue create/update/state/close-reason reconciliation passed.
- Linear Issue comment create/edit/remove passed.
- Document mirror create/update passed.
- Existing Document comments were reconciled to the Document mirror Issue.
- A fresh Document mirror creation produced exactly one canonical GitHub Issue after the duplicate-create guard was added.
- GitHub-side title edits did not flow back to Linear.
- Cloudflare deployment listed schedule `0 */12 * * *`, Queue producer, and Queue consumer.
- The old ChatGPT `Legacy Issue Mirror` automation is disabled.

Archive/trashed/remove handling remains implemented in the same Document reconciliation path. The current ChatGPT Linear connector does not expose a Document archive/remove mutation, so that specific production mutation was not exercised by the smoke test.
