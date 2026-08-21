import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deleteGithubCommentByLinearId,
  extractLinearCommentId,
  reconcileCommentsToGithubIssue,
  renderGithubComment,
} from "../src/comments.js";
import {
  documentSafetySweepMessage,
  documentSweepFinalizeMessage,
  enqueueDocumentSafetySweep,
  extractLinearDocumentId,
  handleDocumentPayload,
  isDocumentInNuinuiCadScope,
  reconcileDocumentById,
  reconcileDocumentSweepFinalize,
  renderGithubDocumentBody,
  waitForGithubDocumentVisibility,
} from "../src/documents.js";
import { shouldQueueExtendedPayload } from "../src/extensions.js";
import { findGithubIssueByMarker } from "../src/mirrorApi.js";
import worker from "../src/worker.js";

test("extended webhook routing accepts Issue, Comment, and Document", () => {
  assert.equal(shouldQueueExtendedPayload({ type: "Issue", action: "update" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Issue", action: "remove" }), false);
  assert.equal(shouldQueueExtendedPayload({ type: "Comment", action: "create" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Comment", action: "update" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Comment", action: "remove" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Document", action: "create" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Document", action: "update" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Document", action: "remove" }), true);
  assert.equal(shouldQueueExtendedPayload({ type: "Project", action: "update" }), false);
});

test("document safety sweep messages preserve IDs and finalizer set", () => {
  assert.deepEqual(documentSafetySweepMessage("doc-a"), {
    source: "scheduled-document-safety-sweep",
    payload: { type: "Document", action: "reconcile", data: { id: "doc-a" } },
  });
  assert.deepEqual(documentSweepFinalizeMessage(["doc-a"]), {
    source: "scheduled-document-safety-sweep",
    payload: { type: "DocumentSweepFinalize", action: "reconcile", data: { documentIds: ["doc-a"] } },
  });
});

test("document safety sweep paginates and enqueues a finalizer", async () => {
  const pages = [
    { documents: { nodes: [{ id: "doc-a" }, { id: "doc-b" }], pageInfo: { hasNextPage: true, endCursor: "next" } } },
    { documents: { nodes: [{ id: "doc-c" }], pageInfo: { hasNextPage: false, endCursor: null } } },
  ];
  const sent = [];
  const calls = [];
  const count = await enqueueDocumentSafetySweep({}, {
    linearGraphql: async (_query, variables) => {
      calls.push(variables);
      return pages.shift();
    },
    send: async (message) => sent.push(message),
  });
  assert.equal(count, 3);
  assert.deepEqual(calls, [{ after: null }, { after: "next" }]);
  assert.deepEqual(sent.slice(0, 3).map((message) => message.payload.data.id), ["doc-a", "doc-b", "doc-c"]);
  assert.deepEqual(sent[3].payload.data.documentIds, ["doc-a", "doc-b", "doc-c"]);
});

test("comment rendering preserves body and stable hidden markers", () => {
  const body = renderGithubComment({
    id: "comment-a",
    body: "Progress update",
    parentId: "comment-parent",
    editedAt: "2026-08-21T04:00:00.000Z",
  });
  assert.match(body, /^Progress update/);
  assert.equal(extractLinearCommentId(body), "comment-a");
  assert.match(body, /linear-comment-parent-id:comment-parent/);
  assert.match(body, /linear-comment-updated-at:2026-08-21T04:00:00.000Z/);
});

test("comment reconciliation creates, updates, deletes stale comments, and removes duplicates", async () => {
  const calls = [];
  const githubComments = [
    { id: 10, body: "old\n\n<!-- linear-comment-id:a -->\n<!-- linear-comment-updated-at:old -->" },
    { id: 11, body: "duplicate\n\n<!-- linear-comment-id:a -->" },
    { id: 12, body: "stale\n\n<!-- linear-comment-id:stale -->" },
    { id: 13, body: "GitHub-only comment" },
  ];
  const githubFetch = async (path, init = {}) => {
    calls.push({ path, init });
    if (path.includes("/issues/99/comments?")) return githubComments;
    if (init.method === "POST") return { id: 20 };
    return null;
  };
  const env = { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" };
  await reconcileCommentsToGithubIssue([
    { id: "a", body: "new", updatedAt: "now" },
    { id: "b", body: "second", updatedAt: "now" },
  ], 99, env, { githubFetch });

  assert.ok(calls.some((call) => call.path.endsWith("/issues/comments/10") && call.init.method === "PATCH"));
  assert.ok(calls.some((call) => call.path.endsWith("/issues/comments/11") && call.init.method === "DELETE"));
  assert.ok(calls.some((call) => call.path.endsWith("/issues/comments/12") && call.init.method === "DELETE"));
  assert.ok(calls.some((call) => call.path.endsWith("/issues/99/comments") && call.init.method === "POST"));
  assert.equal(calls.some((call) => call.path.endsWith("/issues/comments/13")), false);
});

test("comment removal finds managed comment repository-wide", async () => {
  const calls = [];
  const githubFetch = async (path, init = {}) => {
    calls.push({ path, init });
    if (path.includes("/issues/comments?")) {
      return [
        { id: 21, body: "one\n\n<!-- linear-comment-id:target -->" },
        { id: 22, body: "unmanaged" },
      ];
    }
    return null;
  };
  await deleteGithubCommentByLinearId("target", { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" }, { githubFetch });
  assert.ok(calls.some((call) => call.path.endsWith("/issues/comments/21") && call.init.method === "DELETE"));
  assert.equal(calls.some((call) => call.path.endsWith("/issues/comments/22")), false);
});

test("document scope accepts direct initiative, project initiative, and ancestor initiative", () => {
  const target = "initiative-root";
  assert.equal(isDocumentInNuinuiCadScope({ initiative: { id: target } }, target), true);
  assert.equal(isDocumentInNuinuiCadScope({
    project: { initiatives: { nodes: [{ id: "child", parentInitiatives: { nodes: [{ id: target }] } }] } },
  }, target), true);
  assert.equal(isDocumentInNuinuiCadScope({
    issue: { project: { initiatives: { nodes: [{ id: target, parentInitiatives: { nodes: [] } }] } } },
  }, target), true);
  assert.equal(isDocumentInNuinuiCadScope({ team: { id: "team" } }, target), false);
});

test("document body carries source URL and durable markers", () => {
  const body = renderGithubDocumentBody({
    id: "doc-a",
    title: "Spec",
    content: "# Spec\n\nBody",
    url: "https://linear.app/example/document/spec",
    updatedAt: "2026-08-21T04:00:00.000Z",
  });
  assert.match(body, /# Spec/);
  assert.match(body, /Original Linear document:/);
  assert.equal(extractLinearDocumentId(body), "doc-a");
  assert.match(body, /linear-document-updated-at:2026-08-21T04:00:00.000Z/);
});

test("marker lookup uses repository issue listing so new document mirrors are immediately visible", async () => {
  const calls = [];
  const githubFetch = async (path) => {
    calls.push(path);
    return [
      { number: 269, body: "Pull request\n\n<!-- linear-document-id:doc-a -->", pull_request: { url: "https://api.github.com/repos/sayosomi/nuinuiCAD/pulls/269" } },
      { number: 270, body: "Document\n\n<!-- linear-document-id:doc-a -->" },
      { number: 271, body: "Other document" },
    ];
  };
  const issueNumber = await findGithubIssueByMarker(
    "linear-document-id:doc-a",
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    githubFetch,
  );
  assert.equal(issueNumber, 270);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/issues\?state=all/);
  assert.match(calls[0], /labels=Linear%20Document/);
  assert.equal(calls[0].includes("/search/issues"), false);
});

test("issue marker lookup ignores pull requests and selects the matching issue", async () => {
  const calls = [];
  const githubFetch = async (path) => {
    calls.push(path);
    return [
      { number: 272, body: "Pull request\n\n<!-- linear-issue-id:issue-a -->", pull_request: { url: "https://api.github.com/repos/sayosomi/nuinuiCAD/pulls/272" } },
      { number: 273, body: "Issue\n\n<!-- linear-issue-id:issue-a -->" },
    ];
  };
  const issueNumber = await findGithubIssueByMarker(
    "linear-issue-id:issue-a",
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    githubFetch,
  );
  assert.equal(issueNumber, 273);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/issues\?state=all/);
  assert.equal(calls[0].includes("/search/issues"), false);
});

test("issue marker lookup returns no match when only a pull request contains the marker", async () => {
  const githubFetch = async () => [
    { number: 274, body: "Pull request\n\n<!-- linear-issue-id:issue-only-pr -->", pull_request: { url: "https://api.github.com/repos/sayosomi/nuinuiCAD/pulls/274" } },
  ];
  const issueNumber = await findGithubIssueByMarker(
    "linear-issue-id:issue-only-pr",
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    githubFetch,
  );
  assert.equal(issueNumber, null);
});

test("archived and trashed Documents close their existing mirrors as not planned", async () => {
  const env = { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD", LINEAR_INITIATIVE_ID: "initiative-a" };

  for (const lifecycle of [
    { archivedAt: "2026-08-21T05:00:00.000Z", trashed: false },
    { archivedAt: null, trashed: true },
  ]) {
    const calls = [];
    const githubFetch = async (path, init = {}) => {
      calls.push({ path, init });
      if (path.includes("/issues?state=all")) {
        return [{ number: 301, body: "Document\n\n<!-- linear-document-id:doc-closed -->" }];
      }
      if (path.includes("/issues/301/comments?")) return [];
      return {};
    };
    const document = {
      id: "doc-closed",
      title: "Closed document",
      content: "Archived content",
      archivedAt: lifecycle.archivedAt,
      trashed: lifecycle.trashed,
      updatedAt: "2026-08-21T05:00:00.000Z",
      url: "https://linear.app/example/document/closed",
      initiative: { id: "initiative-a" },
    };

    await reconcileDocumentById("doc-closed", env, {
      linearGraphql: async () => ({ document }),
      githubFetch,
    });

    const update = calls.find((call) => call.init.method === "PATCH" && call.path.endsWith("/issues/301"));
    assert.ok(update);
    assert.deepEqual(JSON.parse(update.init.body), {
      title: "Closed document",
      body: "Archived content\n\n---\nOriginal Linear document: [Closed document](https://linear.app/example/document/closed)\n\n<!-- linear-document-id:doc-closed -->\n<!-- linear-document-updated-at:2026-08-21T05:00:00.000Z -->",
      state: "closed",
      labels: ["Linear Document"],
      state_reason: "not_planned",
    });
  }
});

test("removed Documents close their existing mirrors as not planned", async () => {
  const calls = [];
  const githubFetch = async (path, init = {}) => {
    calls.push({ path, init });
    if (path.includes("/issues?state=all")) {
      return [{ number: 302, body: "Document\n\n<!-- linear-document-id:doc-removed -->" }];
    }
    return {};
  };

  await handleDocumentPayload(
    { type: "Document", action: "remove", data: { id: "doc-removed" } },
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    { githubFetch },
  );

  const close = calls.find((call) => call.init.method === "PATCH" && call.path.endsWith("/issues/302"));
  assert.ok(close);
  assert.deepEqual(JSON.parse(close.init.body), { state: "closed", state_reason: "not_planned" });
});

test("Document sweep finalizer closes orphaned managed mirrors", async () => {
  const calls = [];
  const githubFetch = async (path, init = {}) => {
    calls.push({ path, init });
    if (path.includes("/issues?state=all")) {
      return [
        { number: 303, body: "Current\n\n<!-- linear-document-id:doc-current -->" },
        { number: 304, body: "Orphan\n\n<!-- linear-document-id:doc-orphan -->" },
        { number: 305, body: "Unmanaged Linear Document issue" },
      ];
    }
    return {};
  };

  await reconcileDocumentSweepFinalize(
    documentSweepFinalizeMessage(["doc-current"]).payload,
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    { githubFetch },
  );

  const closes = calls.filter((call) => call.init.method === "PATCH");
  assert.equal(closes.length, 1);
  assert.equal(closes[0].path, "/repos/sayosomi/nuinuiCAD/issues/304");
  assert.deepEqual(JSON.parse(closes[0].init.body), { state: "closed", state_reason: "not_planned" });
});

test("document creation waits for marker visibility before releasing the serialized queue", async () => {
  let lookupCount = 0;
  const sleeps = [];
  const githubFetch = async () => {
    lookupCount += 1;
    if (lookupCount < 3) return [];
    return [{ number: 273, body: "Document\n\n<!-- linear-document-id:doc-a -->" }];
  };

  const issueNumber = await waitForGithubDocumentVisibility(
    "doc-a",
    273,
    { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" },
    {
      githubFetch,
      attempts: 4,
      delayMs: 250,
      sleep: async (ms) => sleeps.push(ms),
    },
  );

  assert.equal(issueNumber, 273);
  assert.equal(lookupCount, 3);
  assert.deepEqual(sleeps, [250, 250]);
});

test("Wrangler uses the extended Worker entrypoint", async () => {
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof worker.queue, "function");
  assert.equal(typeof worker.scheduled, "function");
  const configText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText);
  assert.equal(config.main, "src/worker.js");
  assert.equal(config.vars?.LINEAR_INITIATIVE_ID, "635dd66c-cd88-46be-bd0b-64bbbe7cf18c");
});
