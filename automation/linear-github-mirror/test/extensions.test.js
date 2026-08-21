import assert from "node:assert/strict";
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
  isDocumentInNuinuiCadScope,
  renderGithubDocumentBody,
} from "../src/documents.js";
import { shouldQueueExtendedPayload } from "../src/extensions.js";

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
