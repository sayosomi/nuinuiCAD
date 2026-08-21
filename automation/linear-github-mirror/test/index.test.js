import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, {
  enqueueSafetySweep,
  extractIssueId,
  githubIssueNumberFromAttachments,
  githubStateFromLinearState,
  isFreshWebhook,
  legacyGithubIssueNumber,
  priorityName,
  renderGithubBody,
  safetySweepMessage,
  shouldMirrorIssue,
  shouldQueuePayload,
  summarizeRelations,
  verifyLinearSignature,
} from "../src/index.js";

test("legacy GitHub mapping matches the migrated ranges", () => {
  assert.equal(legacyGithubIssueNumber("SAY-9"), 186);
  assert.equal(legacyGithubIssueNumber("SAY-38"), 215);
  assert.equal(legacyGithubIssueNumber("SAY-40"), 216);
  assert.equal(legacyGithubIssueNumber("SAY-74"), 250);
  assert.equal(legacyGithubIssueNumber("SAY-39"), null);
  assert.equal(legacyGithubIssueNumber("SAY-76"), null);
});

test("migration test and accidental shadow issues are excluded", () => {
  assert.equal(shouldMirrorIssue({ identifier: "SAY-39" }), false);
  assert.equal(shouldMirrorIssue({ identifier: "SAY-75" }), false);
  assert.equal(shouldMirrorIssue({ identifier: "SAY-84" }), false);
  assert.equal(shouldMirrorIssue({ identifier: "SAY-85" }), false);
  assert.equal(shouldMirrorIssue({ identifier: "SAY-25" }), true);
  assert.equal(shouldMirrorIssue({ identifier: "SAY-86" }), true);
});

test("GitHub issue attachment lookup is repository-specific", () => {
  const env = { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" };
  assert.equal(
    githubIssueNumberFromAttachments([
      { url: "https://github.com/sayosomi/other/issues/4" },
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/260" },
    ], env),
    260,
  );
});

test("Linear states map to GitHub state and close reason", () => {
  assert.deepEqual(githubStateFromLinearState("Done", "completed"), { state: "closed", reason: "completed" });
  assert.deepEqual(githubStateFromLinearState("Canceled", "canceled"), { state: "closed", reason: "not_planned" });
  assert.deepEqual(githubStateFromLinearState("Duplicate", "canceled"), { state: "closed", reason: "not_planned" });
  assert.deepEqual(githubStateFromLinearState("In Progress", "started"), { state: "open", reason: null });
});

test("priority names preserve Linear priority semantics", () => {
  assert.equal(priorityName(0), "No priority");
  assert.equal(priorityName(1), "Urgent");
  assert.equal(priorityName(2), "High");
  assert.equal(priorityName(3), "Medium");
  assert.equal(priorityName(4), "Low");
});

test("relation summary preserves blocks direction", () => {
  const summary = summarizeRelations({
    relations: { nodes: [
      { type: "blocks", relatedIssue: { identifier: "SAY-20" } },
      { type: "related", relatedIssue: { identifier: "SAY-30" } },
    ] },
    inverseRelations: { nodes: [
      { type: "blocks", issue: { identifier: "SAY-10" } },
      { type: "related", issue: { identifier: "SAY-30" } },
    ] },
  });
  assert.deepEqual(summary, {
    blocks: ["SAY-20"],
    blockedBy: ["SAY-10"],
    related: ["SAY-30"],
  });
});

test("rendered body is canonical Linear content plus managed metadata", () => {
  const body = renderGithubBody({
    id: "linear-uuid",
    identifier: "SAY-86",
    title: "Mirror bridge",
    description: "## Goal\n\nKeep GitHub public.",
    priority: 3,
    url: "https://linear.app/sayosomi/issue/SAY-86/mirror-bridge",
    updatedAt: "2026-08-21T02:00:00.000Z",
    state: { name: "Todo", type: "unstarted" },
    labels: { nodes: [{ name: "Ready" }, { name: "Improvement" }] },
    project: null,
    parent: null,
    relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "SAY-90" } }] },
    inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "SAY-80" } }] },
  });
  assert.match(body, /Keep GitHub public\./);
  assert.match(body, /Linear status: Todo/);
  assert.match(body, /Linear priority: Medium/);
  assert.match(body, /Linear blocks: SAY-90/);
  assert.match(body, /Linear blocked by: SAY-80/);
  assert.match(body, /<!-- linear-issue-id:linear-uuid -->/);
});

test("webhook routing accepts issue events only", () => {
  assert.equal(shouldQueuePayload({ type: "Issue", action: "update" }), true);
  assert.equal(shouldQueuePayload({ type: "Issue", action: "remove" }), false);
  assert.equal(shouldQueuePayload({ type: "IssueLabel", action: "create" }), false);
  assert.equal(shouldQueuePayload({ type: "Comment", action: "create" }), false);
});

test("issue id extraction accepts Issue payloads", () => {
  assert.equal(extractIssueId({ type: "Issue", data: { id: "issue-a" } }), "issue-a");
  assert.equal(extractIssueId({ type: "IssueLabel", data: { id: "label-a" } }), null);
});

test("webhook timestamp must be within one minute", () => {
  assert.equal(isFreshWebhook(1_000_000, 1_059_999), true);
  assert.equal(isFreshWebhook(1_000_000, 1_060_001), false);
});

test("Linear HMAC signature verification uses the raw body", async () => {
  const secret = "test-secret";
  const body = JSON.stringify({ type: "Issue", webhookTimestamp: Date.now() });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(await verifyLinearSignature(body, signature, secret), true);
  assert.equal(await verifyLinearSignature(`${body} `, signature, secret), false);
});

test("scheduled safety sweep message reuses Issue reconciliation routing", () => {
  const message = safetySweepMessage("issue-a");
  assert.equal(message.source, "scheduled-safety-sweep");
  assert.equal(extractIssueId(message.payload), "issue-a");
  assert.equal(shouldQueuePayload(message.payload), true);
});

test("scheduled safety sweep paginates archived team issues and enqueues each issue", async () => {
  const queryCalls = [];
  const sent = [];
  const pages = [
    {
      team: {
        issues: {
          nodes: [{ id: "issue-a" }, { id: "issue-b" }],
          pageInfo: { hasNextPage: true, endCursor: "next-page" },
        },
      },
    },
    {
      team: {
        issues: {
          nodes: [{ id: "issue-c" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  ];
  const env = { LINEAR_TEAM_ID: "team-a" };
  const enqueued = await enqueueSafetySweep(env, {
    linearGraphql: async (query, variables) => {
      queryCalls.push({ query, variables });
      return pages.shift();
    },
    send: async (message) => {
      sent.push(message);
    },
  });

  assert.equal(enqueued, 3);
  assert.deepEqual(queryCalls.map((call) => call.variables), [
    { id: "team-a", after: null },
    { id: "team-a", after: "next-page" },
  ]);
  assert.match(queryCalls[0].query, /includeArchived: true/);
  assert.deepEqual(sent.map((message) => extractIssueId(message.payload)), ["issue-a", "issue-b", "issue-c"]);
});

test("Worker exposes a scheduled handler and Wrangler deploys it every 12 hours", async () => {
  assert.equal(typeof worker.scheduled, "function");
  const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText);
  assert.deepEqual(config.triggers?.crons, ["0 */12 * * *"]);
});
