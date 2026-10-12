import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deleteGithubCommentByLinearId,
  extractLinearCommentId,
  fetchDocumentComments,
  handleCommentPayload,
  reconcileIssueComments,
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

const commentEnv = { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD", LINEAR_TEAM_ID: "team-a" };

function linearComment(id, overrides = {}) {
  return {
    id,
    body: `Comment ${id}`,
    archivedAt: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    editedAt: null,
    updatedAt: "2026-10-11T00:00:00.000Z",
    parentId: "issue-a",
    ...overrides,
  };
}

function linearCommentsPage(parentType, nodes = [], pageInfo = { hasNextPage: false, endCursor: null }, id, archivedAt = null) {
  id ??= parentType === "issue" ? "issue-a" : "doc-a";
  return { [parentType]: { id, archivedAt, comments: { nodes, pageInfo } } };
}

const issueCommentParent = {
  id: "issue-a",
  archivedAt: null,
  identifier: "SAY-86",
  team: { id: "team-a" },
  attachments: { nodes: [{ url: "https://github.com/sayosomi/nuinuiCAD/issues/401" }] },
};

const SAY_385_ID = "8bc80133-54b9-48f9-ac73-456d0823855e";

function say385IssueCommentParent(issueNumbers = [1108, 1107]) {
  return {
    id: SAY_385_ID,
    identifier: "SAY-385",
    team: { id: "team-a" },
    attachments: {
      nodes: issueNumbers.map((number) => ({
        url: `https://github.com/sayosomi/nuinuiCAD/issues/${number}`,
      })),
    },
  };
}

function say385GithubIssue(number) {
  return {
    number,
    body: `Historical mirror\n\n<!-- linear-issue-id:${SAY_385_ID} -->`,
  };
}

async function reconcileIssueCommentPages(pages, githubFetch = async () => []) {
  return reconcileIssueComments("issue-a", commentEnv, {
    linearGraphql: async (query, { after }) => {
      if (query.includes("MirrorIssueCommentParent")) return { issue: issueCommentParent };
      return pages.get(after ?? null);
    },
    githubFetch,
  });
}

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

test("valid zero-comment Issue and Document connections are accepted", async () => {
  const githubCalls = [];
  const issuePages = new Map([[null, linearCommentsPage("issue")]]);
  assert.equal(await reconcileIssueCommentPages(issuePages, async (path) => {
    githubCalls.push(path);
    return [];
  }), true);
  assert.equal(githubCalls.length, 1);

  const documentComments = await fetchDocumentComments("doc-a", commentEnv, async () => linearCommentsPage("document"));
  assert.deepEqual(documentComments, []);
});

test("a missing Issue comments connection fails closed", async () => {
  await assert.rejects(
    reconcileIssueCommentPages(new Map([[null, { issue: issueCommentParent }]]), async () => {
      assert.fail("GitHub comments must not be read for incomplete Linear data");
    }),
    /Linear issue comments connection is missing or malformed/,
  );
});

test("a missing Issue comment parent fails closed", async () => {
  await assert.rejects(
    reconcileIssueComments("issue-a", commentEnv, {
      linearGraphql: async () => ({}),
      githubFetch: async () => assert.fail("GitHub must not be touched when the Linear parent is missing"),
    }),
    /Linear issue comment parent is missing, malformed, or mismatched/,
  );
});

test("a missing Document comments connection fails closed", async () => {
  await assert.rejects(
    fetchDocumentComments("doc-a", commentEnv, async () => ({ document: { id: "doc-a", archivedAt: null } })),
    /Linear document comments connection is missing or malformed/,
  );
});

test("malformed Linear comment nodes and pagination fail closed", async (t) => {
  const cases = [
    ["parent is missing", {}],
    ["parent ID does not match", { document: { id: "other-doc", comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }],
    ["nodes are missing", { document: { id: "doc-a", archivedAt: null, comments: { pageInfo: { hasNextPage: false, endCursor: null } } } }],
    ["a node has no usable ID", linearCommentsPage("document", [{ ...linearComment(""), id: " " }])],
    ["an active node has no body", linearCommentsPage("document", [{ ...linearComment("bad"), body: null }])],
    ["pageInfo is missing", { document: { id: "doc-a", archivedAt: null, comments: { nodes: [] } } }],
    ["hasNextPage is not a boolean", linearCommentsPage("document", [], { hasNextPage: "false", endCursor: null })],
    ["endCursor is missing", { document: { id: "doc-a", archivedAt: null, comments: { nodes: [], pageInfo: { hasNextPage: false } } } }],
    ["a next page has no cursor", linearCommentsPage("document", [linearComment("page-a")], { hasNextPage: true, endCursor: null })],
  ];

  for (const [name, response] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        fetchDocumentComments("doc-a", commentEnv, async () => response),
        /parent is missing|malformed nodes|malformed node|malformed pagination|incomplete or did not advance/,
      );
    });
  }
});

test("Issue and Document parent archive metadata must be present, valid, and stable across pages", async (t) => {
  const cases = [
    ["Issue parent archive metadata is missing", "issue", [
      { issue: { id: "issue-a", comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } },
    ], /archive metadata is missing or malformed/],
    ["Issue parent archive metadata is malformed", "issue", [
      linearCommentsPage("issue", [], undefined, "issue-a", "yesterday"),
    ], /archive metadata is missing or malformed/],
    ["Issue parent archive metadata is not a complete date-time", "issue", [
      linearCommentsPage("issue", [], undefined, "issue-a", "2026"),
    ], /archive metadata is missing or malformed/],
    ["Issue parent archive metadata has an invalid calendar date", "issue", [
      linearCommentsPage("issue", [], undefined, "issue-a", "2026-02-30T00:00:00.000Z"),
    ], /archive metadata is missing or malformed/],
    ["Issue parent archive metadata has an invalid time", "issue", [
      linearCommentsPage("issue", [], undefined, "issue-a", "2026-10-11T24:00:00.000Z"),
    ], /archive metadata is missing or malformed/],
    ["Issue parent archive metadata changes between pages", "issue", [
      linearCommentsPage("issue", [linearComment("first")], { hasNextPage: true, endCursor: "next" }, "issue-a", null),
      linearCommentsPage("issue", [linearComment("second")], undefined, "issue-a", "2026-10-11T09:26:36.464Z"),
    ], /changed during pagination/],
    ["Document parent archive metadata changes between pages", "document", [
      linearCommentsPage("document", [linearComment("first")], { hasNextPage: true, endCursor: "next" }, "doc-a", null),
      linearCommentsPage("document", [linearComment("second")], undefined, "doc-a", "2026-09-21T06:08:50.742Z"),
    ], /changed during pagination/],
  ];

  for (const [name, parentType, pages, expectedError] of cases) {
    await t.test(name, async () => {
      const githubCalls = [];
      const queryLinear = async (query, { after }) => {
        if (query.includes("MirrorIssueCommentParent")) return { issue: issueCommentParent };
        return pages[after === null ? 0 : 1];
      };
      if (parentType === "issue") {
        await assert.rejects(reconcileIssueComments("issue-a", commentEnv, {
          linearGraphql: queryLinear,
          githubFetch: async (...args) => { githubCalls.push(args); return []; },
        }), expectedError);
      } else {
        await assert.rejects(fetchDocumentComments("doc-a", commentEnv, async (_query, { after }) => pages[after === null ? 0 : 1]), expectedError);
      }
      assert.deepEqual(githubCalls, []);
    });
  }
});

test("retained parent-archived comments still require complete body and date validation", async (t) => {
  const parentArchivedAt = "2026-09-21T06:08:50.742Z";
  const malformedComments = [
    ["missing body", { ...linearComment("missing-body", { archivedAt: parentArchivedAt }), body: null }],
    ["missing creation date", { ...linearComment("missing-created", { archivedAt: parentArchivedAt }), createdAt: null }],
    ["missing update date", { ...linearComment("missing-updated", { archivedAt: parentArchivedAt }), updatedAt: null }],
    ["missing parent identity", { ...linearComment("missing-parent", { archivedAt: parentArchivedAt }), parentId: undefined }],
  ];

  for (const [name, comment] of malformedComments) {
    await t.test(name, async () => {
      await assert.rejects(fetchDocumentComments("doc-a", commentEnv, async () =>
        linearCommentsPage("document", [comment], undefined, "doc-a", parentArchivedAt)),
      /Linear document comments contain a malformed node/);
    });
  }
});

test("a missing second Linear page fails before any managed comment write", async () => {
  const calls = [];
  const githubCalls = [];
  await assert.rejects(reconcileIssueComments("issue-a", commentEnv, {
    linearGraphql: async (query, { after }) => {
      calls.push({ query, after });
      if (query.includes("MirrorIssueCommentParent")) return { issue: issueCommentParent };
      if (after === null) {
        return linearCommentsPage("issue", [linearComment("partial")], { hasNextPage: true, endCursor: "cursor-2" });
      }
      return undefined;
    },
    githubFetch: async (path, init = {}) => {
      githubCalls.push({ path, init });
      return [];
    },
  }), /Linear issue comment query returned malformed data/);

  assert.deepEqual(calls.filter((call) => call.query.includes("MirrorIssueComments")).map((call) => call.after), [null, "cursor-2"]);
  assert.deepEqual(githubCalls, []);
});

test("duplicate Linear comment IDs fail closed across pages", async () => {
  const githubCalls = [];
  const pages = new Map([
    [null, linearCommentsPage("issue", [linearComment("duplicate")], { hasNextPage: true, endCursor: "cursor-2" })],
    ["cursor-2", linearCommentsPage("issue", [linearComment("duplicate")])],
  ]);
  await assert.rejects(reconcileIssueCommentPages(pages, async (...args) => {
    githubCalls.push(args);
    return [];
  }), /duplicate comment ID duplicate/);
  assert.deepEqual(githubCalls, []);
});

test("malformed GitHub comment-list pages fail closed", async (t) => {
  for (const [name, response] of [
    ["non-array response", { message: "rate limited" }],
    ["malformed comment row", [{ id: 10 }]],
  ]) {
    await t.test(name, async () => {
      const calls = [];
      await assert.rejects(reconcileIssueCommentPages(
        new Map([[null, linearCommentsPage("issue", [linearComment("current")])]]),
        async (path, init = {}) => {
          calls.push({ path, init });
          return response;
        },
      ), /GitHub issue comment list page 1/);
      assert.equal(calls.length, 1);
      assert.equal(calls.some(({ init }) => ["POST", "PATCH", "DELETE"].includes(init.method)), false);
    });
  }
});

test("completed Linear comment pagination reconciles all pages and preserves GitHub-only comments", async () => {
  const linearCalls = [];
  const githubCalls = [];
  const pages = new Map([
    [null, linearCommentsPage("issue", [linearComment("current-a")], { hasNextPage: true, endCursor: "cursor-2" })],
    ["cursor-2", linearCommentsPage("issue", [linearComment("current-b")])],
  ]);
  const githubComments = [
    { id: 41, body: "Removed\n\n<!-- linear-comment-id:removed -->" },
    { id: 42, body: "Human-owned GitHub comment" },
  ];

  await reconcileIssueComments("issue-a", commentEnv, {
    linearGraphql: async (query, variables) => {
      linearCalls.push(variables.after);
      if (query.includes("MirrorIssueCommentParent")) return { issue: issueCommentParent };
      return pages.get(variables.after ?? null);
    },
    githubFetch: async (path, init = {}) => {
      githubCalls.push({ path, init });
      if (path.includes("/issues/401/comments?")) return githubComments;
      return {};
    },
  });

  assert.deepEqual(linearCalls, [undefined, null, "cursor-2"]);
  assert.equal(githubCalls.filter(({ init }) => init.method === "POST").length, 2);
  assert.ok(githubCalls.some(({ path, init }) => path.endsWith("/issues/comments/41") && init.method === "DELETE"));
  assert.equal(githubCalls.some(({ path, init }) => path.endsWith("/issues/comments/42")), false);
});

test("SAY-385 managed comment reads and writes use only #1108 and stay idempotent", async () => {
  const calls = [];
  const githubComments = [];
  let nextGithubCommentId = 100;
  const historicalComment = linearComment("say385-comment", { parentId: SAY_385_ID });
  const options = {
    linearGraphql: async (query) => {
      if (query.includes("MirrorIssueCommentParent")) return { issue: say385IssueCommentParent() };
      if (query.includes("MirrorIssueComments")) return linearCommentsPage("issue", [historicalComment], undefined, SAY_385_ID);
      assert.fail(`unexpected Linear query: ${query}`);
    },
    githubFetch: async (path, init = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined });
      if (path === "/repos/sayosomi/nuinuiCAD/issues/1108" && method === "GET") return say385GithubIssue(1108);
      if (path === "/repos/sayosomi/nuinuiCAD/issues/1107" && method === "GET") return say385GithubIssue(1107);
      if (path === "/repos/sayosomi/nuinuiCAD/issues/1108/comments?per_page=100&page=1" && method === "GET") return githubComments;
      if (path === "/repos/sayosomi/nuinuiCAD/issues/1108/comments" && method === "POST") {
        const created = { id: nextGithubCommentId++, body: JSON.parse(init.body).body };
        githubComments.push(created);
        return created;
      }
      assert.fail(`unexpected GitHub request: ${method} ${path}`);
    },
  };

  assert.equal(await reconcileIssueComments(SAY_385_ID, commentEnv, options), true);
  assert.equal(await reconcileIssueComments(SAY_385_ID, commentEnv, options), true);

  assert.deepEqual(calls.filter(({ method, path }) => method === "GET" && /\/issues\/(1107|1108)$/.test(path)).map(({ path }) => path), [
    "/repos/sayosomi/nuinuiCAD/issues/1108",
    "/repos/sayosomi/nuinuiCAD/issues/1107",
    "/repos/sayosomi/nuinuiCAD/issues/1108",
    "/repos/sayosomi/nuinuiCAD/issues/1107",
  ]);
  const commentReads = calls.filter(({ path }) => path.includes("/issues/") && path.includes("/comments?"));
  const commentWrites = calls.filter(({ path, method }) => path.includes("/issues/") && path.endsWith("/comments") && method === "POST");
  assert.deepEqual(commentReads.map(({ path }) => path), [
    "/repos/sayosomi/nuinuiCAD/issues/1108/comments?per_page=100&page=1",
    "/repos/sayosomi/nuinuiCAD/issues/1108/comments?per_page=100&page=1",
  ]);
  assert.deepEqual(commentWrites.map(({ path }) => path), ["/repos/sayosomi/nuinuiCAD/issues/1108/comments"]);
  assert.equal(githubComments.length, 1);
  assert.match(githubComments[0].body, /linear-comment-id:say385-comment/);
});

test("SAY-385 GitHub parent lookup failures propagate before comment reads or writes", async () => {
  const calls = [];
  await assert.rejects(reconcileIssueComments(SAY_385_ID, commentEnv, {
    linearGraphql: async (query) => {
      calls.push({ type: "linear", query });
      if (query.includes("MirrorIssueCommentParent")) return { issue: say385IssueCommentParent([1108]) };
      assert.fail(`comment pages must not be read after parent verification fails: ${query}`);
    },
    githubFetch: async (path, init = {}) => {
      calls.push({ type: "github", path, method: init.method ?? "GET" });
      throw new Error("GitHub API 503: temporarily unavailable");
    },
  }), /GitHub API 503/);

  assert.equal(calls.filter((call) => call.type === "linear").length, 1);
  assert.deepEqual(calls.filter((call) => call.type === "github"), [{
    type: "github",
    path: "/repos/sayosomi/nuinuiCAD/issues/1108",
    method: "GET",
  }]);
});

test("archived Print Layout Document reconciles all 55 inherited comments across two pages", async () => {
  const documentId = "print-layout-document";
  const archivedAt = "2026-09-21T06:08:50.742Z";
  const document = {
    id: documentId,
    title: "Print Layout",
    content: "Historical print layout notes",
    archivedAt,
    trashed: false,
    updatedAt: archivedAt,
    url: "https://linear.app/sayosomi/document/print-layout",
    initiative: { id: "initiative-a" },
  };
  const comments = Array.from({ length: 55 }, (_, index) => linearComment(`print-comment-${index + 1}`, {
    archivedAt,
    createdAt: `2026-09-${String(1 + (index % 20)).padStart(2, "0")}T06:08:50.742Z`,
    updatedAt: archivedAt,
    parentId: documentId,
  }));
  const githubComments = [];
  const calls = [];
  let nextGithubCommentId = 2000;
  const githubIssue = {
    number: 308,
    body: `Print Layout\n\n<!-- linear-document-id:${documentId} -->`,
  };
  const queryLinear = async (query, { after } = {}) => {
    if (query.includes("query MirrorDocument(")) return { document };
    if (query.includes("query MirrorDocumentComments(")) {
      assert.match(query, /archivedAt/);
      calls.push({ type: "linear-comments", after });
      const page = after === "document-comments-page-2" ? comments.slice(50) : comments.slice(0, 50);
      const hasNextPage = after === null;
      return linearCommentsPage("document", page, {
        hasNextPage,
        endCursor: hasNextPage ? "document-comments-page-2" : null,
      }, documentId, archivedAt);
    }
    assert.fail(`unexpected Linear query: ${query}`);
  };
  const githubFetch = async (path, init = {}) => {
    const method = init.method ?? "GET";
    const call = { type: "github", path, method };
    if (init.body) call.body = JSON.parse(init.body);
    calls.push(call);
    if (path.includes("/issues?state=all")) return [githubIssue];
    if (path.endsWith("/labels/Linear%20Document")) return { name: "Linear Document" };
    if (path === "/repos/sayosomi/nuinuiCAD/issues/308/comments?per_page=100&page=1") return githubComments;
    if (path === "/repos/sayosomi/nuinuiCAD/issues/308/comments" && method === "POST") {
      const created = { id: nextGithubCommentId++, body: call.body.body };
      githubComments.push(created);
      return created;
    }
    return {};
  };

  await reconcileDocumentById(documentId, {
    ...commentEnv,
    LINEAR_INITIATIVE_ID: "initiative-a",
  }, { linearGraphql: queryLinear, githubFetch });
  await reconcileDocumentById(documentId, {
    ...commentEnv,
    LINEAR_INITIATIVE_ID: "initiative-a",
  }, { linearGraphql: queryLinear, githubFetch });

  assert.deepEqual(calls.filter(({ type }) => type === "linear-comments").map(({ after }) => after), [
    null,
    "document-comments-page-2",
    null,
    "document-comments-page-2",
  ]);
  const managedComments = githubComments.filter(({ body }) => extractLinearCommentId(body) !== null);
  assert.equal(managedComments.length, 55);
  assert.equal(calls.filter(({ method, path }) => method === "POST" && path.endsWith("/issues/308/comments")).length, 55);
  assert.equal(calls.some(({ method, path }) => method === "DELETE" && path.includes("/issues/comments/")), false);
  assert.equal(calls.some(({ method, path }) => method === "PATCH" && path.includes("/issues/comments/")), false);
});

test("individually archived Linear comments stay excluded from desired managed comments", async () => {
  const calls = [];
  const archived = linearComment("archived", { archivedAt: "2026-10-11T01:00:00.000Z" });
  await reconcileIssueCommentPages(new Map([[null, linearCommentsPage("issue", [archived])]]), async (path, init = {}) => {
    calls.push({ path, init });
    if (path.includes("/issues/401/comments?")) {
      return [{ id: 51, body: "Archived mirror\n\n<!-- linear-comment-id:archived -->" }];
    }
    return {};
  });
  assert.ok(calls.some(({ path, init }) => path.endsWith("/issues/comments/51") && init.method === "DELETE"));
});

test("parent-cascade archived comments remain in the reconciled history", async () => {
  const calls = [];
  const archivedAt = "2026-10-11T09:26:36.464Z";
  const inherited = linearComment("inherited", { archivedAt });
  await reconcileIssueComments("issue-a", commentEnv, {
    linearGraphql: async (query) => {
      if (query.includes("MirrorIssueCommentParent")) return { issue: issueCommentParent };
      return linearCommentsPage("issue", [inherited], undefined, "issue-a", archivedAt);
    },
    githubFetch: async (path, init = {}) => {
      calls.push({ path, init });
      if (path.includes("/issues/401/comments?")) {
        return [{ id: 52, body: "Old inherited mirror\n\n<!-- linear-comment-id:inherited -->" }];
      }
      return {};
    },
  });

  assert.ok(calls.some(({ path, init }) => path.endsWith("/issues/comments/52") && init.method === "PATCH"));
  assert.equal(calls.some(({ path, init }) => path.endsWith("/issues/comments/52") && init.method === "DELETE"), false);
});

test("explicit Comment removal deletes only a verified individual archive", async (t) => {
  const commentArchivedAt = "2026-10-11T01:00:00.000Z";
  const cases = [
    ["active parent", null, true],
    ["parent archived at a different instant", "2026-10-11T09:26:36.464Z", true],
    ["parent-cascade timestamp", commentArchivedAt, false],
  ];

  for (const [name, parentArchivedAt, shouldDelete] of cases) {
    await t.test(name, async () => {
      const calls = [];
      await handleCommentPayload({ type: "Comment", action: "remove", data: { id: "removed" } }, commentEnv, {
        linearGraphql: async (query) => {
          assert.match(query, /issue \{ id archivedAt \}/);
          return { comment: {
            id: "removed",
            archivedAt: commentArchivedAt,
            issueId: "issue-a",
            issue: { id: "issue-a", archivedAt: parentArchivedAt },
            documentContent: null,
          } };
        },
        githubFetch: async (path, init = {}) => {
          calls.push({ path, init });
          if (path.includes("/issues/comments?")) {
            return [{ id: 70, body: "Managed\n\n<!-- linear-comment-id:removed -->" }];
          }
          return null;
        },
      });

      assert.equal(calls.some(({ path, init }) => path.endsWith("/issues/comments/70") && init.method === "DELETE"), shouldDelete);
      assert.equal(calls.some(({ init }) => init.method === "DELETE"), shouldDelete);
    });
  }
});

test("ambiguous explicit Comment removal fails closed before GitHub access", async (t) => {
  for (const [name, comment] of [
    ["missing parent archive timestamp", {
      id: "removed", archivedAt: "2026-10-11T01:00:00.000Z", issueId: "issue-a",
      issue: { id: "issue-a" }, documentContent: null,
    }],
    ["comment is not archived", {
      id: "removed", archivedAt: null, issueId: "issue-a",
      issue: { id: "issue-a", archivedAt: null }, documentContent: null,
    }],
    ["issue identity mismatch", {
      id: "removed", archivedAt: "2026-10-11T01:00:00.000Z", issueId: "issue-a",
      issue: { id: "issue-other", archivedAt: null }, documentContent: null,
    }],
  ]) {
    await t.test(name, async () => {
      let githubCalls = 0;
      await assert.rejects(handleCommentPayload({ type: "Comment", action: "remove", data: { id: "removed" } }, commentEnv, {
        linearGraphql: async () => ({ comment }),
        githubFetch: async () => { githubCalls += 1; return []; },
      }));
      assert.equal(githubCalls, 0);
    });
  }
});

test("explicit Document Comment removal uses the Document archive timestamp", async () => {
  const calls = [];
  await handleCommentPayload({ type: "Comment", action: "remove", data: { id: "document-comment" } }, commentEnv, {
    linearGraphql: async (query) => {
      assert.match(query, /documentContent \{ document \{ id archivedAt \} \}/);
      return { comment: {
        id: "document-comment",
        archivedAt: "2026-09-20T00:00:00.000Z",
        issueId: null,
        issue: null,
        documentContent: { document: { id: "doc-a", archivedAt: null } },
      } };
    },
    githubFetch: async (path, init = {}) => {
      calls.push({ path, init });
      if (path.includes("/issues/comments?")) {
        return [{ id: 71, body: "Managed\n\n<!-- linear-comment-id:document-comment -->" }];
      }
      return null;
    },
  });

  assert.ok(calls.some(({ path, init }) => path.endsWith("/issues/comments/71") && init.method === "DELETE"));
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
      linearGraphql: async (query) => query.includes("MirrorDocumentComments")
        ? linearCommentsPage("document", [], undefined, document.id)
        : { document },
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
