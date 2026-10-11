import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../src/worker.js";

const webhookSecret = "worker-test-secret";
const missingMode = Symbol("missing mode");

function envFor(mode, overrides = {}) {
  const env = {
    LINEAR_WEBHOOK_SECRET: webhookSecret,
    LINEAR_TEAM_ID: "team-a",
    LINEAR_INITIATIVE_ID: "initiative-a",
    LINEAR_API_KEY: "linear-test-key",
    GITHUB_TOKEN: "github-test-token",
    GITHUB_OWNER: "sayosomi",
    GITHUB_REPO: "nuinuiCAD",
    LINEAR_EVENTS: { send: async () => {} },
    ...overrides,
  };
  if (mode === missingMode) delete env.MIRROR_MODE;
  else env.MIRROR_MODE = mode;
  return env;
}

function webhookRequest(payload, { secret = webhookSecret, timestamp = Date.now(), signature } = {}) {
  const body = JSON.stringify({ ...payload, webhookTimestamp: timestamp });
  const hmac = signature ?? createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://mirror.test/webhooks/linear", {
    method: "POST",
    headers: { "Linear-Signature": hmac, "Linear-Delivery": "delivery-a" },
    body,
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function withFetchMock(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function healthMode(env) {
  const response = await worker.fetch(new Request("https://mirror.test/health"), env);
  return { status: response.status, body: await response.json() };
}

test("health reports the effective mode and keeps ok compatible", async (t) => {
  for (const [name, mode, expected] of [
    ["active", "active", "active"],
    ["disabled", "disabled", "disabled"],
    ["missing", missingMode, "disabled"],
    ["unknown", "paused", "disabled"],
    ["wrong case", "ACTIVE", "disabled"],
    ["malformed", { value: "active" }, "disabled"],
  ]) {
    await t.test(name, async () => {
      const { status, body } = await healthMode(envFor(mode));
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true, mirrorMode: expected });
      assert.equal(JSON.stringify(body).includes(webhookSecret), false);
    });
  }
});

test("active webhook preserves signature validation and dispatches eligible payloads to Queue", async () => {
  const sent = [];
  const env = envFor("active", { LINEAR_EVENTS: { send: async (message) => sent.push(message) } });
  const payload = { type: "Comment", action: "create", data: { id: "comment-a" } };

  const response = await worker.fetch(webhookRequest(payload), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].deliveryId, "delivery-a");
  assert.deepEqual(
    { type: sent[0].payload.type, action: sent[0].payload.action, data: sent[0].payload.data },
    payload,
  );
  assert.equal(Number.isFinite(sent[0].payload.webhookTimestamp), true);
});

test("Wrangler explicitly configures active mode", async () => {
  const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText);
  assert.equal(config.vars?.MIRROR_MODE, "active");
});

test("disabled webhook still rejects invalid signatures and stale timestamps", async () => {
  let sends = 0;
  const env = envFor("disabled", { LINEAR_EVENTS: { send: async () => { sends += 1; } } });
  const payload = { type: "Issue", action: "update", data: { id: "issue-a" } };

  const invalidSignature = await worker.fetch(webhookRequest(payload, { secret: "wrong-secret" }), env);
  const stale = await worker.fetch(webhookRequest(payload, { timestamp: Date.now() - 61_000 }), env);
  const valid = await worker.fetch(webhookRequest(payload), env);

  assert.equal(invalidSignature.status, 401);
  assert.equal(await invalidSignature.text(), "Invalid signature");
  assert.equal(stale.status, 401);
  assert.equal(await stale.text(), "Stale webhook");
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true, disabled: true });
  assert.equal(sends, 0);
});

test("disabled Queue explicitly acknowledges Issue, Comment, Document, and finalizer messages without API calls", async () => {
  const acked = [];
  const messages = ["Issue", "Comment", "Document", "DocumentSweepFinalize"].map((type, index) => ({
    body: { payload: { type, action: "reconcile", data: { id: `message-${index}` } } },
    ack: () => acked.push(type),
    retry: () => assert.fail(`disabled ${type} message must not be retried`),
  }));

  await withFetchMock(async () => assert.fail("disabled Queue must not call network dependencies"), async () => {
    await worker.queue({ messages }, envFor("disabled"));
  });

  assert.deepEqual(acked, ["Issue", "Comment", "Document", "DocumentSweepFinalize"]);
});

test("active Queue routes Issue, Comment, Document, and finalizer messages through reconciliation", async () => {
  const networkCalls = [];
  const issue = {
    id: "issue-a",
    identifier: "SAY-86",
    title: "Active mirror issue",
    description: "Body",
    priority: 3,
    updatedAt: "2026-10-11T00:00:00.000Z",
    url: "https://linear.app/sayosomi/issue/SAY-86/active-mirror-issue",
    team: { id: "team-a" },
    state: { name: "In Progress", type: "started" },
    labels: { nodes: [] },
    attachments: { nodes: [{ url: "https://github.com/sayosomi/nuinuiCAD/issues/401" }] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    project: null,
    parent: null,
  };
  const documents = [
    { number: 501, body: "Document A\n\n<!-- linear-document-id:doc-a -->" },
    { number: 502, body: "Orphan\n\n<!-- linear-document-id:doc-orphan -->" },
  ];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    networkCalls.push({ host: url.hostname, path: url.pathname, search: url.search, method });

    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("query MirrorIssueCommentParent(")) {
        return jsonResponse({ data: { issue: { ...issue, attachments: { nodes: issue.attachments.nodes } } } });
      }
      if (query.includes("query MirrorIssueComments(")) {
        return jsonResponse({ data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false } } } } });
      }
      assert.fail(`unexpected Linear query: ${query}`);
    }

    if (url.hostname === "api.github.com") {
      if (url.pathname.endsWith("/issues/comments") && method === "GET") {
        return jsonResponse([{ id: 91, body: "Comment\n\n<!-- linear-comment-id:comment-a -->" }]);
      }
      if (url.pathname.endsWith("/issues/comments/91") && method === "DELETE") return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/issues/401/comments") && method === "GET") return jsonResponse([]);
      if (url.pathname.endsWith("/issues") && method === "GET" && url.searchParams.has("labels")) {
        return jsonResponse(documents);
      }
      if (url.pathname.endsWith("/issues/401") && method === "PATCH") return jsonResponse({});
      if (["/issues/501", "/issues/502"].some((suffix) => url.pathname.endsWith(suffix)) && method === "PATCH") {
        return jsonResponse({});
      }
      assert.fail(`unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
    }

    assert.fail(`unexpected network host: ${url.hostname}`);
  };

  const messages = [
    { body: { payload: { type: "Issue", action: "update", data: { id: "issue-a" } } } },
    { body: { payload: { type: "Comment", action: "remove", data: { id: "comment-a" } } } },
    { body: { payload: { type: "Document", action: "remove", data: { id: "doc-a" } } } },
    { body: { payload: { type: "DocumentSweepFinalize", action: "reconcile", data: { documentIds: ["doc-current"] } } } },
  ];

  await withFetchMock(mockFetch, async () => worker.queue({ messages }, envFor("active")));

  assert.ok(networkCalls.some((call) => call.host === "api.linear.app" && call.path === "/graphql"));
  assert.ok(networkCalls.some((call) => call.path.endsWith("/issues/401") && call.method === "PATCH"));
  assert.ok(networkCalls.some((call) => call.path.endsWith("/issues/comments/91") && call.method === "DELETE"));
  assert.ok(networkCalls.some((call) => call.path.endsWith("/issues/501") && call.method === "PATCH"));
  assert.ok(networkCalls.some((call) => call.path.endsWith("/issues/502") && call.method === "PATCH"));
});

test("disabled Cron does not query Linear or enqueue either safety sweep", async () => {
  let sends = 0;
  await withFetchMock(async () => assert.fail("disabled Cron must not query Linear"), async () => {
    await worker.scheduled({}, envFor("disabled", { LINEAR_EVENTS: { send: async () => { sends += 1; } } }));
  });
  assert.equal(sends, 0);
});

test("active Cron preserves Issue and Document safety-sweep dispatch", async () => {
  const sent = [];
  const env = envFor("active", { LINEAR_EVENTS: { send: async (message) => sent.push(message) } });
  const mockFetch = async (input, init = {}) => {
    assert.equal(new URL(input).hostname, "api.linear.app");
    const { query } = JSON.parse(init.body);
    if (query.includes("query MirrorTeamIssues(")) {
      return jsonResponse({ data: { team: { issues: { nodes: [{ id: "issue-sweep" }], pageInfo: { hasNextPage: false } } } } });
    }
    if (query.includes("query MirrorDocuments(")) {
      return jsonResponse({ data: { documents: { nodes: [{ id: "document-sweep" }], pageInfo: { hasNextPage: false } } } });
    }
    assert.fail(`unexpected Linear query: ${query}`);
  };

  await withFetchMock(mockFetch, async () => worker.scheduled({}, env));

  assert.deepEqual(sent, [
    { source: "scheduled-safety-sweep", payload: { type: "Issue", action: "reconcile", data: { id: "issue-sweep" } } },
    { source: "scheduled-document-safety-sweep", payload: { type: "Document", action: "reconcile", data: { id: "document-sweep" } } },
    { source: "scheduled-document-safety-sweep", payload: { type: "DocumentSweepFinalize", action: "reconcile", data: { documentIds: ["document-sweep"] } } },
  ]);
});

test("missing and unsupported modes fail closed across webhook, Queue, and Cron", async (t) => {
  for (const [name, mode] of [["missing", missingMode], ["unsupported", "paused"]]) {
    await t.test(name, async () => {
      const sent = [];
      const env = envFor(mode, { LINEAR_EVENTS: { send: async (message) => sent.push(message) } });
      const acked = [];
      const message = {
        body: { payload: { type: "Issue", action: "update", data: { id: "issue-a" } } },
        ack: () => acked.push(true),
      };

      await withFetchMock(async () => assert.fail("fail-closed handlers must not call network dependencies"), async () => {
        const webhook = await worker.fetch(webhookRequest({ type: "Issue", action: "update", data: { id: "issue-a" } }), env);
        assert.equal(webhook.status, 200);
        assert.deepEqual(await webhook.json(), { ok: true, disabled: true });
        await worker.queue({ messages: [message] }, env);
        await worker.scheduled({}, env);
      });

      assert.deepEqual(acked, [true]);
      assert.deepEqual(sent, []);
      assert.deepEqual(await healthMode(env), { status: 200, body: { ok: true, mirrorMode: "disabled" } });
    });
  }
});
