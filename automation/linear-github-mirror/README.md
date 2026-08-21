# Linear → GitHub public mirror

Cloudflare Worker for the nuinuiCAD one-way public mirror.

Linear is authoritative. GitHub is the public mirror. The Worker validates Linear webhooks, enqueues them through Cloudflare Queues, refetches canonical Linear data, and reconciles GitHub through the REST API.

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

A Cloudflare Cron Trigger runs every 12 hours (`0 */12 * * *`, UTC). It reconciles all Sayosomi Issues and all accessible Linear Documents, filters Documents to the nuinuiCAD Initiative subtree, reconciles managed comments, and closes orphaned managed Document mirrors. This catches webhook gaps and relation/comment-only changes.

## Required secrets and variables

Secrets:

- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN` — fine-grained PAT for `sayosomi/nuinuiCAD` with **Issues: Read and write**

Non-secret vars in `wrangler.jsonc`:

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
{"ok":true}
```

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

Manual production checks after deploying the Comment / Document extension:

1. Add a Linear Issue comment and confirm the corresponding GitHub Issue gets it.
2. Edit that Linear comment and confirm the same GitHub comment is updated.
3. Remove that Linear comment and confirm the managed GitHub comment is removed.
4. Create a temporary Document under the nuinuiCAD Initiative and confirm a `Linear Document` GitHub Issue is created.
5. Edit the Document title/body and confirm the GitHub mirror follows.
6. Add a Document comment and confirm it appears on the Document mirror Issue.
7. Archive or trash the Document and confirm the mirror closes as `not planned`.
8. Confirm GitHub-only comments/edits do not flow back to Linear.
9. Confirm the deploy still lists schedule `0 */12 * * *`, Queue producer, and Queue consumer.

The Issue-only production cutover was verified on 2026-08-21, and the old ChatGPT `Legacy Issue Mirror` automation is disabled. Comment / Document mirroring is not production-complete until its redeploy and manual checks pass.
