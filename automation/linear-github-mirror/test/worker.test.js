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

test("Wrangler explicitly configures disabled mode", async () => {
  const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText);
  assert.equal(config.vars?.MIRROR_MODE, "disabled");
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
      if (query.includes("query MirrorComment(")) return jsonResponse({ data: { comment: {
        id: "comment-a",
        archivedAt: "2026-10-11T00:00:00.000Z",
        issueId: "issue-a",
        issue: { id: "issue-a", archivedAt: null },
        documentContent: null,
      } } });
      if (query.includes("query MirrorIssueCommentParent(")) {
        return jsonResponse({ data: { issue: { ...issue, attachments: { nodes: issue.attachments.nodes } } } });
      }
      if (query.includes("query MirrorIssueComments(")) {
        return jsonResponse({ data: { issue: { id: issue.id, archivedAt: null, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
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

test("active Queue recovers an archived marker match, updates it, and reconciles comments idempotently", async () => {
  const calls = [];
  const issue = {
    id: "dd552676-79bb-4231-85ec-180cb19f7f12",
    identifier: "SAY-452",
    title: "Archived Linear mirror",
    description: "Canonical archived issue body",
    priority: 2,
    updatedAt: "2026-10-11T00:00:00.000Z",
    archivedAt: "2026-10-10T00:00:00.000Z",
    url: "https://linear.app/sayosomi/issue/SAY-452/archived-linear-mirror",
    team: { id: "team-a", name: "SAY", key: "SAY" },
    state: { id: "state-canceled", name: "Canceled", type: "canceled" },
    labels: { nodes: [{ name: "Archive" }] },
    attachments: { nodes: [] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    project: null,
    parent: null,
  };
  const linearComment = {
    id: "comment-say-452",
    body: "Keep this comment on the existing mirror.",
    archivedAt: null,
    createdAt: "2026-10-09T00:00:00.000Z",
    editedAt: null,
    updatedAt: "2026-10-09T00:00:00.000Z",
    parentId: issue.id,
  };
  const githubComments = [];
  let nextCommentId = 1;
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const call = { host: url.hostname, path: url.pathname, search: url.search, method };
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      call.query = query;
      calls.push(call);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("query MirrorIssueCommentParent(")) {
        return jsonResponse({ data: { issue: { ...issue, attachments: { nodes: [] } } } });
      }
      if (query.includes("query MirrorIssueComments(")) {
        return jsonResponse({
          data: { issue: { id: issue.id, archivedAt: issue.archivedAt, comments: { nodes: [linearComment], pageInfo: { hasNextPage: false, endCursor: null } } } },
        });
      }
      assert.fail(`unexpected Linear query: ${query}`);
    }
    if (url.hostname === "api.github.com") {
      if (init.body) call.body = JSON.parse(init.body);
      calls.push(call);
      if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues" && method === "GET") {
        return jsonResponse([{
          number: 1224,
          body: `Existing GitHub issue\n\n<!-- linear-issue-id:${issue.id} -->`,
        }]);
      }
      if (url.pathname === "/repos/sayosomi/nuinuiCAD/labels" && method === "GET") {
        return jsonResponse([{ name: "Archive" }]);
      }
      if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1224" && method === "PATCH") {
        return jsonResponse({ number: 1224 });
      }
      if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1224/comments" && method === "GET") {
        return jsonResponse(githubComments);
      }
      if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1224/comments" && method === "POST") {
        const created = { id: nextCommentId++, body: call.body.body };
        githubComments.push(created);
        return jsonResponse(created, 201);
      }
      assert.fail(`unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
    }
    assert.fail(`unexpected network host: ${url.hostname}`);
  };

  const message = {
    body: { payload: { type: "Issue", action: "reconcile", data: { id: issue.id } } },
  };
  await withFetchMock(mockFetch, async () => {
    await worker.queue({ messages: [message, message] }, envFor("active"));
  });

  const canonicalQueries = calls.filter((call) => call.query?.includes("query MirrorIssue("));
  assert.equal(canonicalQueries.length, 2);
  assert.ok(canonicalQueries.every((call) => call.query.includes("archivedAt")));
  assert.equal(calls.filter((call) => call.query?.includes("mutation AttachGithubIssue(")).length, 0);

  const issuePatches = calls.filter((call) => call.path === "/repos/sayosomi/nuinuiCAD/issues/1224" && call.method === "PATCH");
  assert.equal(issuePatches.length, 2);
  assert.deepEqual({
    title: issuePatches[0].body.title,
    state: issuePatches[0].body.state,
    labels: issuePatches[0].body.labels,
    state_reason: issuePatches[0].body.state_reason,
  }, {
    title: issue.title,
    state: "closed",
    labels: ["Archive"],
    state_reason: "not_planned",
  });
  assert.match(issuePatches[0].body.body, /Canonical archived issue body/);
  assert.match(issuePatches[0].body.body, /linear-issue-id:dd552676-79bb-4231-85ec-180cb19f7f12/);
  assert.deepEqual(issuePatches[1].body, issuePatches[0].body);

  const issueCommentFetches = calls.filter((call) => call.query?.includes("query MirrorIssueComments("));
  assert.equal(issueCommentFetches.length, 2);
  const commentCreates = calls.filter((call) => call.path === "/repos/sayosomi/nuinuiCAD/issues/1224/comments" && call.method === "POST");
  assert.equal(commentCreates.length, 1);
  assert.match(commentCreates[0].body.body, /Keep this comment on the existing mirror\./);
  assert.match(commentCreates[0].body.body, /linear-comment-id:comment-say-452/);
  assert.equal(githubComments.length, 1);
  assert.equal(calls.filter((call) => call.path === "/repos/sayosomi/nuinuiCAD/issues" && call.method === "POST").length, 0);

  const firstIssuePatch = calls.findIndex((call) => call.path === "/repos/sayosomi/nuinuiCAD/issues/1224" && call.method === "PATCH");
  const firstCommentFetch = calls.findIndex((call) => call.query?.includes("query MirrorIssueComments("));
  const firstCommentCreate = calls.findIndex((call) => call.path === "/repos/sayosomi/nuinuiCAD/issues/1224/comments" && call.method === "POST");
  assert.ok(firstIssuePatch < firstCommentFetch);
  assert.ok(firstCommentFetch < firstCommentCreate);
});

test("archived SAY-385 mirrors all three inherited comments to #1108 exactly once", async () => {
  const calls = [];
  const linearIssueId = "8bc80133-54b9-48f9-ac73-456d0823855e";
  const issue = {
    id: linearIssueId,
    identifier: "SAY-385",
    title: "Historical duplicate mirror",
    description: "Canonical Linear body",
    priority: 2,
    updatedAt: "2026-10-11T00:00:00.000Z",
    archivedAt: "2026-10-11T09:26:36.464Z",
    url: "https://linear.app/sayosomi/issue/SAY-385/historical-duplicate-mirror",
    team: { id: "team-a", name: "SAY", key: "SAY" },
    state: { id: "state-done", name: "Done", type: "completed" },
    labels: { nodes: [] },
    attachments: { nodes: [
      { id: "attachment-1107", title: "GitHub #1107", url: "https://github.com/sayosomi/nuinuiCAD/issues/1107" },
      { id: "attachment-1108", title: "GitHub #1108", url: "https://github.com/sayosomi/nuinuiCAD/issues/1108" },
    ] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    project: null,
    parent: null,
  };
  const linearComments = Array.from({ length: 3 }, (_, index) => ({
    id: `comment-say-385-${index + 1}`,
    body: `Preserve historical comment ${index + 1} on the canonical mirror.`,
    archivedAt: issue.archivedAt,
    createdAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    editedAt: null,
    updatedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    parentId: linearIssueId,
  }));
  const githubComments = [];
  let nextCommentId = 11000;
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const call = { host: url.hostname, path: url.pathname, search: url.search, method };
    if (init.body) call.body = JSON.parse(init.body);
    calls.push(call);

    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      call.query = query;
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("query MirrorIssueCommentParent(")) return jsonResponse({ data: { issue } });
      if (query.includes("query MirrorIssueComments(")) {
        return jsonResponse({ data: { issue: { id: linearIssueId, archivedAt: issue.archivedAt, comments: {
          nodes: linearComments,
          pageInfo: { hasNextPage: false, endCursor: null },
        } } } });
      }
      assert.fail(`unexpected Linear query: ${query}`);
    }

    if (url.hostname !== "api.github.com") assert.fail(`unexpected host: ${url.hostname}`);
    if ([1107, 1108].some((number) => url.pathname === `/repos/sayosomi/nuinuiCAD/issues/${number}`) && method === "GET") {
      const number = Number(url.pathname.split("/").at(-1));
      return jsonResponse({ number, body: `Historical mirror\n\n<!-- linear-issue-id:${linearIssueId} -->` });
    }
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1108" && method === "PATCH") {
      return jsonResponse({ number: 1108 });
    }
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1108/comments" && url.search === "?per_page=100&page=1" && method === "GET") {
      return jsonResponse(githubComments);
    }
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1108/comments" && !url.search && method === "POST") {
      const created = { id: nextCommentId++, body: call.body.body };
      githubComments.push(created);
      return jsonResponse(created, 201);
    }
    assert.fail(`unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
  };

  const message = {
    body: { payload: { type: "Issue", action: "reconcile", data: { id: linearIssueId } } },
  };
  await withFetchMock(mockFetch, async () => {
    await worker.queue({ messages: [message, message] }, envFor("active"));
  });

  const patches = calls.filter(({ path, method }) => path.startsWith("/repos/sayosomi/nuinuiCAD/issues/") && method === "PATCH");
  assert.deepEqual(patches.map(({ path }) => path), [
    "/repos/sayosomi/nuinuiCAD/issues/1108",
    "/repos/sayosomi/nuinuiCAD/issues/1108",
  ]);
  assert.equal(calls.some(({ path, method }) => path.endsWith("/issues/1107") && method === "PATCH"), false);
  assert.equal(calls.filter(({ query }) => query?.includes("mutation AttachGithubIssue(")).length, 0);

  const verificationGets = calls.filter(({ path, method, search }) => method === "GET" && !search && /\/issues\/(1107|1108)$/.test(path));
  assert.deepEqual(verificationGets.map(({ path }) => path.split("/").at(-1)), ["1108", "1107", "1108", "1107", "1108", "1107", "1108", "1107"]);
  const commentReads = calls.filter(({ path, search }) => path.endsWith("/comments") && search === "?per_page=100&page=1");
  assert.equal(commentReads.length, 2);
  assert.ok(commentReads.every(({ path }) => path === "/repos/sayosomi/nuinuiCAD/issues/1108/comments"));
  const commentCreates = calls.filter(({ path, method }) => method === "POST" && path.endsWith("/comments"));
  assert.deepEqual(commentCreates.map(({ path }) => path), Array(3).fill("/repos/sayosomi/nuinuiCAD/issues/1108/comments"));
  assert.equal(githubComments.length, 3);
  assert.deepEqual(githubComments.map(({ body }) => body.match(/linear-comment-id:(comment-say-385-\d)/)?.[1]), [
    "comment-say-385-1",
    "comment-say-385-2",
    "comment-say-385-3",
  ]);
  assert.equal(calls.some(({ path, method }) => path.includes("/issues/1107/comments") && ["GET", "POST", "PATCH", "DELETE"].includes(method)), false);
});

test("active Queue propagates incomplete comment reconciliation without acknowledging the message", async () => {
  const linearCalls = [];
  const githubCalls = [];
  let acknowledgements = 0;
  const message = {
    body: { payload: { type: "Comment", action: "create", data: { id: "comment-a" } } },
    ack: () => { acknowledgements += 1; },
  };
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      linearCalls.push(query);
      if (query.includes("query MirrorComment(")) {
        return jsonResponse({ data: { comment: {
          id: "comment-a", archivedAt: null, issueId: "issue-a",
          issue: { id: "issue-a", archivedAt: null }, documentContent: null,
        } } });
      }
      if (query.includes("query MirrorIssueCommentParent(")) {
        return jsonResponse({
          data: {
            issue: {
              id: "issue-a",
              identifier: "SAY-86",
              team: { id: "team-a" },
              attachments: { nodes: [{ url: "https://github.com/sayosomi/nuinuiCAD/issues/401" }] },
            },
          },
        });
      }
      if (query.includes("query MirrorIssueComments(")) return jsonResponse({ data: { issue: { id: "issue-a", archivedAt: null } } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    if (url.hostname === "api.github.com") {
      githubCalls.push({ path: url.pathname, method });
      assert.fail(`incomplete Linear comments must not call GitHub: ${method} ${url.pathname}`);
    }
    assert.fail(`unexpected network host: ${url.hostname}`);
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withFetchMock(mockFetch, async () => assert.rejects(
      worker.queue({ messages: [message] }, envFor("active")),
      /Linear issue comments connection is missing or malformed/,
    ));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(linearCalls.length, 3);
  assert.deepEqual(githubCalls, []);
  assert.equal(acknowledgements, 0);
});

test("active Queue propagates a missing Issue comment parent without acknowledging the message", async () => {
  let acknowledgements = 0;
  const message = {
    body: { payload: { type: "Comment", action: "create", data: { id: "comment-a" } } },
    ack: () => { acknowledgements += 1; },
  };
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, "api.linear.app");
    const { query } = JSON.parse(init.body);
    if (query.includes("query MirrorComment(")) {
      return jsonResponse({ data: { comment: {
        id: "comment-a", archivedAt: null, issueId: "issue-a",
        issue: { id: "issue-a", archivedAt: null }, documentContent: null,
      } } });
    }
    if (query.includes("query MirrorIssueCommentParent(")) return jsonResponse({ data: {} });
    assert.fail(`unexpected Linear query: ${query}`);
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withFetchMock(mockFetch, async () => assert.rejects(
      worker.queue({ messages: [message] }, envFor("active")),
      /Linear issue comment parent is missing, malformed, or mismatched/,
    ));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(acknowledgements, 0);
});

test("active Queue propagates missing or malformed Linear Comment records without GitHub mutation or acknowledgement", async (t) => {
  for (const [name, response] of [
    ["missing comment", { data: {} }],
    ["mismatched comment ID", { data: { comment: { id: "other-comment", archivedAt: null } } }],
    ["missing archive marker", { data: { comment: { id: "comment-a" } } }],
  ]) {
    await t.test(name, async () => {
      let acknowledgements = 0;
      let githubCalls = 0;
      const message = {
        body: { payload: { type: "Comment", action: "update", data: { id: "comment-a" } } },
        ack: () => { acknowledgements += 1; },
      };
      const mockFetch = async (input) => {
        const url = new URL(input);
        if (url.hostname === "api.linear.app") return jsonResponse(response);
        if (url.hostname === "api.github.com") githubCalls += 1;
        assert.fail(`incomplete Linear comment data must not call GitHub: ${url.hostname}`);
      };

      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        await withFetchMock(mockFetch, async () => assert.rejects(
          worker.queue({ messages: [message] }, envFor("active")),
          /Linear comment is missing or malformed/,
        ));
      } finally {
        console.error = originalConsoleError;
      }

      assert.equal(githubCalls, 0);
      assert.equal(acknowledgements, 0);
    });
  }
});

test("active Queue propagates malformed GitHub comment-list data for removal without acknowledgement", async (t) => {
  for (const [name, response, expectedError] of [
    ["non-array page", { message: "temporarily unavailable" }, /GitHub issue comment list page 1 returned a malformed response/],
    ["malformed row", [{ id: 51 }], /GitHub issue comment list page 1 contains a malformed comment at index 0/],
  ]) {
    await t.test(name, async () => {
      let acknowledgements = 0;
      const githubCalls = [];
      const message = {
        body: { payload: { type: "Comment", action: "remove", data: { id: "comment-a" } } },
        ack: () => { acknowledgements += 1; },
      };
      const mockFetch = async (input, init = {}) => {
        const url = new URL(input);
        const method = init.method ?? "GET";
        if (url.hostname === "api.linear.app") {
          return jsonResponse({ data: { comment: {
            id: "comment-a",
            archivedAt: "2026-10-11T01:00:00.000Z",
            issueId: "issue-a",
            issue: { id: "issue-a", archivedAt: null },
            documentContent: null,
          } } });
        }
        githubCalls.push({ path: url.pathname, method });
        return jsonResponse(response);
      };

      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        await withFetchMock(mockFetch, async () => assert.rejects(
          worker.queue({ messages: [message] }, envFor("active")),
          expectedError,
        ));
      } finally {
        console.error = originalConsoleError;
      }

      assert.equal(githubCalls.length, 1);
      assert.equal(githubCalls[0].method, "GET");
      assert.equal(acknowledgements, 0);
    });
  }
});

test("ordinary Comment reconciliation does not restore an individually archived comment", async () => {
  const parentArchivedAt = "2026-10-11T00:00:00.000Z";
  const commentArchivedAt = "2026-10-10T00:00:00.000Z";
  const githubCalls = [];
  const message = {
    body: { payload: { type: "Comment", action: "update", data: { id: "comment-a" } } },
  };
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorComment(")) return jsonResponse({ data: { comment: {
        id: "comment-a",
        archivedAt: commentArchivedAt,
        issueId: "issue-a",
        issue: { id: "issue-a", archivedAt: parentArchivedAt },
        documentContent: null,
      } } });
      if (query.includes("query MirrorIssueCommentParent(")) return jsonResponse({ data: { issue: {
        id: "issue-a",
        identifier: "SAY-86",
        team: { id: "team-a" },
        attachments: { nodes: [{ url: "https://github.com/sayosomi/nuinuiCAD/issues/401" }] },
      } } });
      if (query.includes("query MirrorIssueComments(")) return jsonResponse({ data: { issue: {
        id: "issue-a",
        archivedAt: parentArchivedAt,
        comments: {
          nodes: [{
            id: "comment-a",
            body: "Previously archived comment",
            archivedAt: commentArchivedAt,
            createdAt: "2026-10-09T00:00:00.000Z",
            editedAt: null,
            updatedAt: "2026-10-09T00:00:00.000Z",
            parentId: "issue-a",
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      } } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    githubCalls.push({ path: url.pathname, method });
    if (url.pathname.endsWith("/issues/401/comments") && method === "GET") {
      return jsonResponse([{ id: 51, body: "Archived\n\n<!-- linear-comment-id:comment-a -->" }]);
    }
    if (url.pathname.endsWith("/issues/comments/51") && method === "DELETE") return new Response(null, { status: 204 });
    assert.fail(`unexpected GitHub request: ${method} ${url.pathname}`);
  };

  await withFetchMock(mockFetch, async () => worker.queue({ messages: [message] }, envFor("active")));

  assert.ok(githubCalls.some(({ path, method }) => path.endsWith("/issues/comments/51") && method === "DELETE"));
});

test("parent-cascade Comment event preserves its managed history", async () => {
  const archivedAt = "2026-10-11T09:26:36.464Z";
  const githubCalls = [];
  const comment = {
    id: "comment-cascade",
    body: "Keep this historical comment.",
    archivedAt,
    createdAt: "2026-10-02T00:00:00.000Z",
    editedAt: null,
    updatedAt: "2026-10-02T00:00:00.000Z",
    parentId: "issue-a",
  };
  const expectedBody = [
    comment.body,
    "",
    "<!-- linear-comment-id:comment-cascade -->",
    "<!-- linear-comment-updated-at:2026-10-02T00:00:00.000Z -->",
    "<!-- linear-comment-parent-id:issue-a -->",
  ].join("\n");
  const message = {
    body: { payload: { type: "Comment", action: "update", data: { id: comment.id } } },
  };
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorComment(")) return jsonResponse({ data: { comment: {
        id: comment.id,
        archivedAt,
        issueId: "issue-a",
        issue: { id: "issue-a", archivedAt },
        documentContent: null,
      } } });
      if (query.includes("query MirrorIssueCommentParent(")) return jsonResponse({ data: { issue: {
        id: "issue-a",
        identifier: "SAY-86",
        team: { id: "team-a" },
        attachments: { nodes: [{ url: "https://github.com/sayosomi/nuinuiCAD/issues/401" }] },
      } } });
      if (query.includes("query MirrorIssueComments(")) return jsonResponse({ data: { issue: {
        id: "issue-a",
        archivedAt,
        comments: { nodes: [comment], pageInfo: { hasNextPage: false, endCursor: null } },
      } } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    githubCalls.push({ path: url.pathname, method });
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/401/comments" && method === "GET") {
      return jsonResponse([{ id: 51, body: expectedBody }]);
    }
    assert.fail(`unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
  };

  await withFetchMock(mockFetch, async () => worker.queue({ messages: [message] }, envFor("active")));

  assert.equal(githubCalls.some(({ path, method }) => path.endsWith("/issues/comments/51") && method === "DELETE"), false);
  assert.equal(githubCalls.some(({ path, method }) => path.endsWith("/issues/comments/51") && method === "PATCH"), false);
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
