# Linear → GitHub public issue mirror

Cloudflare Worker for the nuinuiCAD one-way public issue mirror.

Linear is authoritative. GitHub Issues are a public mirror. The Worker receives Linear webhooks, validates the Linear HMAC signature, queues the event through Cloudflare Queues, refetches the canonical Linear issue, and reconciles the matching GitHub issue.

## Scope

Mirrored automatically:

- issue title and description
- Linear status → GitHub open/closed + close reason
- Linear labels
- priority, project, parent, blocks / blocked-by / related metadata in the GitHub body
- existing Linear → GitHub mapping
- new Linear issues: create a GitHub issue and attach its URL back to the Linear issue

Not mirrored in v1:

- GitHub → Linear changes
- Linear comments
- assignees
- project-level objects

Comments are intentionally excluded because existing Linear top-level discussions can contain internal/non-public notes. A later comment bridge needs an explicit public-comment marker or equivalent privacy-safe contract.

Migration-only/shadow Linear issues `SAY-39`, `SAY-75`, `SAY-84`, and `SAY-85` are explicitly excluded so they can never create a second public GitHub issue.

## Mapping

Mapping resolution is deterministic and idempotent:

1. Reuse a GitHub issue attachment already present on the Linear issue.
2. For legacy backfill ranges, use the historical mapping:
   - SAY-9…SAY-38 → GitHub #186…#215
   - SAY-40…SAY-74 → GitHub #216…#250
   - SAY-39 is excluded.
3. Recover a previously created mirror by the hidden `linear-issue-id` marker in the GitHub body.
4. Otherwise create a new GitHub issue and attach it to Linear.

The attachment URL is the durable mapping for newly created mirrors. Linear attachment creation is idempotent by issue + URL.

## Reliability

The HTTP webhook handler only validates and enqueues. A Cloudflare Queue consumer performs Linear/GitHub API calls with retries, a dead-letter queue, batch size 1, and max concurrency 1. This prevents concurrent create races for the same Linear issue and keeps webhook acknowledgement fast.

A Cloudflare Cron Trigger runs every 12 hours (`0 */12 * * *`, UTC) as a safety sweep. It paginates every issue in the Sayosomi team, including archived issues, and enqueues each issue through the same Queue reconciliation path. This catches relation-only changes or any webhook delivery gap without introducing a second mirror implementation.

Cloudflare Queues are available on the Workers Free plan. This project is far below the free daily operation allowance under normal nuinuiCAD use.

## Required secrets

Set these as Cloudflare Worker secrets; never commit them:

- `LINEAR_WEBHOOK_SECRET` — signing secret from the Linear webhook
- `LINEAR_API_KEY` — Linear personal API key with read access to the Sayosomi team and permission to create attachments
- `GITHUB_TOKEN` — fine-grained GitHub PAT scoped to `sayosomi/nuinuiCAD` with **Issues: Read and write**

Non-secret deployment vars are already in `wrangler.jsonc`:

- `LINEAR_TEAM_ID`
- `GITHUB_OWNER`
- `GITHUB_REPO`

## Deploy

From this directory:

```bash
npx wrangler login
npx wrangler queues create nuinuicad-linear-events
npx wrangler queues create nuinuicad-linear-events-dlq
npx wrangler deploy
```

Set the API credentials:

```bash
npx wrangler secret put LINEAR_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

The deploy output gives the Worker URL, for example:

```text
https://nuinuicad-linear-github-mirror.<account>.workers.dev
```

In Linear workspace settings, create a team webhook for the Sayosomi team:

- URL: `https://<worker>/webhooks/linear`
- resource type: `Issue`

Copy the webhook signing secret, then set it:

```bash
npx wrangler secret put LINEAR_WEBHOOK_SECRET
```

Health check:

```bash
curl https://<worker>/health
```

Expected:

```json
{"ok":true}
```

## Verification

Automated tests and syntax check:

```bash
npm test
node --check src/index.js
```

The tests cover both webhook routing and the 12-hour safety sweep pagination / queue payload path.

Manual production smoke test after deploy:

1. Create a temporary Linear issue in Sayosomi.
2. Confirm a GitHub issue is created within a few seconds.
3. Confirm the GitHub URL appears as an attachment on the Linear issue.
4. Change title, description, priority, labels, and status in Linear; confirm GitHub follows one-way.
5. Mark the Linear issue Canceled; confirm GitHub closes as `not planned`.
6. Edit the GitHub issue directly and confirm nothing flows back to Linear.
7. Confirm the Worker deploy output lists the `0 */12 * * *` scheduled trigger.
8. Remove/archive the temporary Linear test issue as appropriate after verification.

Production cutover was verified on 2026-08-21. The webhook smoke test passed, the scheduled `0 */12 * * *` trigger was deployed, and the old ChatGPT `Legacy Issue Mirror` automation was disabled. This Worker is now the only automatic reconciliation owner.
