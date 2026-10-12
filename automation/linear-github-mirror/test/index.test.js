import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, {
  enqueueSafetySweep,
  extractIssueId,
  githubStateFromLinearState,
  isFreshWebhook,
  legacyGithubIssueNumber,
  mirrorPayload,
  priorityName,
  renderGithubBody,
  safetySweepMessage,
  shouldMirrorIssue,
  shouldQueuePayload,
  summarizeRelations,
  verifyLinearSignature,
} from "../src/index.js";
import { ISSUE_MARKER_PREFIX, resolveGithubIssueAttachment } from "../src/mirrorApi.js";

const mirrorEnv = {
  LINEAR_API_KEY: "linear-test-key",
  LINEAR_TEAM_ID: "team-a",
  GITHUB_TOKEN: "github-test-token",
  GITHUB_OWNER: "sayosomi",
  GITHUB_REPO: "nuinuiCAD",
};

function linearIssue(overrides = {}) {
  return {
    id: "linear-issue-a",
    identifier: "SAY-452",
    title: "Archived mirror recovery",
    description: "Canonical Linear body",
    priority: 2,
    updatedAt: "2026-10-11T00:00:00.000Z",
    archivedAt: null,
    url: "https://linear.app/sayosomi/issue/SAY-452/archived-mirror-recovery",
    team: { id: "team-a", name: "SAY", key: "SAY" },
    state: { id: "state-a", name: "Todo", type: "unstarted" },
    labels: { nodes: [] },
    project: null,
    parent: null,
    attachments: { nodes: [] },
    relations: { nodes: [] },
    inverseRelations: { nodes: [] },
    ...overrides,
  };
}

function githubMarkerMatch(issue, number) {
  return { number, body: `Mirror body\n\n<!-- linear-issue-id:${issue.id} -->` };
}

const SAY_385_ID = "8bc80133-54b9-48f9-ac73-456d0823855e";

function say385Issue(issueNumbers = [1108, 1107], overrides = {}) {
  return linearIssue({
    id: SAY_385_ID,
    identifier: "SAY-385",
    title: "Historical duplicate mirror",
    state: { id: "state-done", name: "Done", type: "completed" },
    attachments: {
      nodes: issueNumbers.map((number) => ({
        url: `https://github.com/sayosomi/nuinuiCAD/issues/${number}`,
      })),
    },
    ...overrides,
  });
}

function say385GithubIssue(number, overrides = {}) {
  return {
    number,
    body: `Historical mirror\n\n<!-- ${ISSUE_MARKER_PREFIX}${SAY_385_ID} -->`,
    ...overrides,
  };
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

test("shared GitHub issue attachment resolution is repository-specific and preserves a single target", async () => {
  const env = { GITHUB_OWNER: "sayosomi", GITHUB_REPO: "nuinuiCAD" };
  const githubCalls = [];
  assert.equal(await resolveGithubIssueAttachment({
    id: "linear-issue-a",
    identifier: "SAY-86",
    attachments: { nodes: [
      { url: "https://github.com/sayosomi/other/issues/4" },
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/260" },
    ] },
  }, env, async (...args) => githubCalls.push(args)), 260);
  assert.deepEqual(githubCalls, []);
});

test("ordinary issue attachment ambiguity fails closed before any GitHub request", async () => {
  const githubCalls = [];
  await assert.rejects(resolveGithubIssueAttachment({
    id: "linear-issue-a",
    identifier: "SAY-86",
    attachments: { nodes: [
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/401" },
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/402" },
    ] },
  }, mirrorEnv, async (...args) => githubCalls.push(args)), /Ambiguous GitHub issue attachments/);
  assert.deepEqual(githubCalls, []);
});

test("SAY-385 attachment sets resolve to #1108 regardless of order", async (t) => {
  for (const attachmentOrder of [[1108, 1107], [1107, 1108]]) {
    await t.test(attachmentOrder.join(","), async () => {
      const githubPaths = [];
      const resolved = await resolveGithubIssueAttachment(say385Issue(attachmentOrder), mirrorEnv, async (path) => {
        githubPaths.push(path);
        return say385GithubIssue(Number(path.split("/").at(-1)));
      });

      assert.equal(resolved, 1108);
      assert.deepEqual(githubPaths, [
        "/repos/sayosomi/nuinuiCAD/issues/1108",
        "/repos/sayosomi/nuinuiCAD/issues/1107",
      ]);
    });
  }
});

test("SAY-385 sole #1108 attachment is accepted only after marker verification", async () => {
  const githubPaths = [];
  const resolved = await resolveGithubIssueAttachment(say385Issue([1108]), mirrorEnv, async (path) => {
    githubPaths.push(path);
    return say385GithubIssue(1108);
  });
  assert.equal(resolved, 1108);
  assert.deepEqual(githubPaths, ["/repos/sayosomi/nuinuiCAD/issues/1108"]);
});

test("SAY-385 rejects every attachment set except the approved canonical sets", async (t) => {
  for (const [name, attachmentUrls] of [
    ["no attachments", []],
    ["sole duplicate", ["https://github.com/sayosomi/nuinuiCAD/issues/1107"]],
    ["unexpected third issue", [1108, 1107, 1109].map((number) => `https://github.com/sayosomi/nuinuiCAD/issues/${number}`)],
    ["unexpected issue", [1108, 1109].map((number) => `https://github.com/sayosomi/nuinuiCAD/issues/${number}`)],
    ["mismatched repository", [
      "https://github.com/sayosomi/nuinuiCAD/issues/1108",
      "https://github.com/sayosomi/other/issues/1107",
    ]],
    ["pull request", ["https://github.com/sayosomi/nuinuiCAD/pull/1108"]],
  ]) {
    await t.test(name, async () => {
      const githubCalls = [];
      const issue = say385Issue([], {
        attachments: { nodes: attachmentUrls.map((url) => ({ url })) },
      });
      await assert.rejects(resolveGithubIssueAttachment(issue, mirrorEnv, async (...args) => githubCalls.push(args)));
      assert.deepEqual(githubCalls, []);
    });
  }
});

test("SAY-385 recovery requires the exact Linear UUID and identifier", async (t) => {
  for (const [name, overrides] of [
    ["wrong UUID", { id: "different-linear-uuid" }],
    ["wrong identifier", { identifier: "SAY-386" }],
  ]) {
    await t.test(name, async () => {
      const githubCalls = [];
      await assert.rejects(
        resolveGithubIssueAttachment(say385Issue([1108], overrides), mirrorEnv, async (...args) => githubCalls.push(args)),
        /exact Linear issue UUID and identifier/,
      );
      assert.deepEqual(githubCalls, []);
    });
  }
});

test("SAY-385 GitHub verification rejects missing, malformed, pull-request, or mismarked issues", async (t) => {
  const cases = [
    ["missing marker", { number: 1108, body: "Historical mirror" }, /mismatched Linear issue marker/],
    ["wrong marker", { number: 1108, body: "<!-- linear-issue-id:different-id -->" }, /mismatched Linear issue marker/],
    ["multiple markers", { ...say385GithubIssue(1108), body: `<!-- linear-issue-id:${SAY_385_ID} --><!-- linear-issue-id:different-id -->` }, /mismatched Linear issue marker/],
    ["pull request", say385GithubIssue(1108, { pull_request: { url: "https://api.github.com/repos/sayosomi/nuinuiCAD/pulls/1108" } }), /is a pull request/],
    ["incomplete response", { number: 1108 }, /response is incomplete or mismatched/],
    ["wrong issue number", say385GithubIssue(1107), /response is incomplete or mismatched/],
  ];
  for (const [name, response, expectedError] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        resolveGithubIssueAttachment(say385Issue([1108]), mirrorEnv, async () => response),
        expectedError,
      );
    });
  }

  await t.test("missing GitHub issue", async () => {
    await assert.rejects(
      resolveGithubIssueAttachment(say385Issue([1108]), mirrorEnv, async () => {
        throw new Error("GitHub API 404: Not Found");
      }),
      /GitHub API 404/,
    );
  });

  await t.test("GitHub API error", async () => {
    await assert.rejects(
      resolveGithubIssueAttachment(say385Issue([1108]), mirrorEnv, async () => {
        throw new Error("GitHub API 503: unavailable");
      }),
      /GitHub API 503/,
    );
  });

  await t.test("mismarked duplicate", async () => {
    await assert.rejects(
      resolveGithubIssueAttachment(say385Issue([1108, 1107]), mirrorEnv, async (path) => {
        const number = Number(path.split("/").at(-1));
        return number === 1108 ? say385GithubIssue(number) : { number, body: "<!-- linear-issue-id:wrong-id -->" };
      }),
      /Historical SAY-385 GitHub #1107 has a mismatched Linear issue marker/,
    );
  });
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

test("non-archived marker recovery still attaches the existing GitHub issue", async () => {
  const issue = linearIssue();
  const linearMutations = [];
  const githubWrites = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("mutation AttachGithubIssue(")) {
        linearMutations.push(JSON.parse(init.body));
        return jsonResponse({ data: { attachmentCreate: { success: true, attachment: { id: "attachment-a" } } } });
      }
      assert.fail(`unexpected Linear query: ${query}`);
    }
    if (url.hostname === "api.github.com") {
      if (url.pathname.endsWith("/issues") && method === "GET") {
        return jsonResponse([githubMarkerMatch(issue, 1224)]);
      }
      if (url.pathname.endsWith("/issues/1224") && method === "PATCH") {
        githubWrites.push({ path: url.pathname, body: JSON.parse(init.body) });
        return jsonResponse({});
      }
      assert.fail(`unexpected GitHub request: ${method} ${url.pathname}${url.search}`);
    }
    assert.fail(`unexpected network host: ${url.hostname}`);
  };

  await withFetchMock(mockFetch, () => mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv));

  assert.equal(linearMutations.length, 1);
  assert.equal(linearMutations[0].query.includes("mutation AttachGithubIssue("), true);
  assert.deepEqual(linearMutations[0].variables.input, {
    issueId: issue.id,
    title: "GitHub #1224",
    subtitle: "Public mirror",
    url: "https://github.com/sayosomi/nuinuiCAD/issues/1224",
    metadata: { integration: "nuinuicad-linear-github-mirror", githubIssueNumber: 1224 },
  });
  assert.equal(githubWrites.length, 1);
  assert.equal(githubWrites[0].body.state, "open");
});

test("Issue reconciliation selects verified SAY-385 #1108 and never mutates #1107", async () => {
  const issue = say385Issue([1108, 1107]);
  const githubCalls = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      assert.fail(`unexpected Linear mutation or query: ${query}`);
    }

    githubCalls.push({ path: url.pathname, method });
    if (["/repos/sayosomi/nuinuiCAD/issues/1108", "/repos/sayosomi/nuinuiCAD/issues/1107"].includes(url.pathname) && method === "GET") {
      const number = Number(url.pathname.split("/").at(-1));
      return jsonResponse(say385GithubIssue(number));
    }
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/1108" && method === "PATCH") return jsonResponse({ number: 1108 });
    assert.fail(`unexpected GitHub request: ${method} ${url.pathname}`);
  };

  await withFetchMock(mockFetch, () => mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv));

  assert.deepEqual(githubCalls.filter(({ method }) => method === "PATCH").map(({ path }) => path), [
    "/repos/sayosomi/nuinuiCAD/issues/1108",
  ]);
  assert.deepEqual(githubCalls.filter(({ method }) => method === "GET").map(({ path }) => path), [
    "/repos/sayosomi/nuinuiCAD/issues/1108",
    "/repos/sayosomi/nuinuiCAD/issues/1107",
  ]);
});

test("ordinary multi-attachment Issue fails before any GitHub request or mutation", async () => {
  const issue = linearIssue({
    attachments: { nodes: [
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/401" },
      { url: "https://github.com/sayosomi/nuinuiCAD/issues/402" },
    ] },
  });
  const calls = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ host: url.hostname, method: init.method ?? "GET" });
    if (url.hostname === "api.linear.app") return jsonResponse({ data: { issue } });
    assert.fail(`GitHub must not be called for ambiguous attachments: ${url.pathname}`);
  };

  await withFetchMock(mockFetch, () => assert.rejects(
    mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv),
    /Ambiguous GitHub issue attachments/,
  ));
  assert.deepEqual(calls, [{ host: "api.linear.app", method: "POST" }]);
});

test("legacy Issue mapping still attaches and updates its historical GitHub target", async () => {
  const issue = linearIssue({ identifier: "SAY-9" });
  const calls = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      calls.push({ host: url.hostname, query });
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("mutation AttachGithubIssue(")) return jsonResponse({ data: { attachmentCreate: { success: true } } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    calls.push({ host: url.hostname, path: url.pathname, method });
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/186" && method === "GET") return jsonResponse({ number: 186 });
    if (url.pathname === "/repos/sayosomi/nuinuiCAD/issues/186" && method === "PATCH") return jsonResponse({ number: 186 });
    assert.fail(`unexpected GitHub request: ${method} ${url.pathname}`);
  };

  await withFetchMock(mockFetch, () => mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv));
  assert.equal(calls.some((call) => call.query?.includes("mutation AttachGithubIssue(")), true);
  assert.deepEqual(calls.filter((call) => call.method === "PATCH").map((call) => call.path), [
    "/repos/sayosomi/nuinuiCAD/issues/186",
  ]);
});

test("duplicate marker matches fail closed before any GitHub write", async () => {
  const issue = linearIssue();
  const githubCalls = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    if (url.hostname === "api.github.com") {
      githubCalls.push({ method, path: url.pathname });
      if (url.pathname.endsWith("/issues") && method === "GET") {
        return jsonResponse([githubMarkerMatch(issue, 1224), githubMarkerMatch(issue, 1225)]);
      }
      assert.fail(`unexpected GitHub mutation: ${method} ${url.pathname}`);
    }
    assert.fail(`unexpected network host: ${url.hostname}`);
  };

  await withFetchMock(mockFetch, async () => {
    await assert.rejects(
      mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv),
      /Multiple GitHub issues contain mirror marker/,
    );
  });

  assert.deepEqual(githubCalls.map(({ method }) => method), ["GET"]);
});

test("Linear issue refetch GraphQL errors propagate without GitHub calls", async () => {
  const calls = [];
  const mockFetch = async (input, init = {}) => {
    calls.push({ host: new URL(input).hostname, method: init.method ?? "GET" });
    return jsonResponse({ errors: [{ message: "canonical Linear refetch failed" }] });
  };

  await withFetchMock(mockFetch, async () => {
    await assert.rejects(
      mirrorPayload({ type: "Issue", data: { id: "linear-issue-a" } }, mirrorEnv),
      /Linear GraphQL:.*canonical Linear refetch failed/,
    );
  });

  assert.deepEqual(calls, [{ host: "api.linear.app", method: "POST" }]);
});

test("GitHub marker lookup API errors propagate without GitHub writes", async () => {
  const issue = linearIssue();
  const githubCalls = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      assert.fail(`unexpected Linear query: ${query}`);
    }
    githubCalls.push({ method, path: url.pathname });
    return jsonResponse({ message: "GitHub temporarily unavailable" }, 503);
  };

  await withFetchMock(mockFetch, async () => {
    await assert.rejects(
      mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv),
      /GitHub API 503/,
    );
  });

  assert.deepEqual(githubCalls.map(({ method }) => method), ["GET"]);
});

test("unrelated attachmentCreate GraphQL errors propagate for non-archived recovery", async () => {
  const issue = linearIssue();
  const githubCalls = [];
  const linearMutations = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.hostname === "api.linear.app") {
      const { query } = JSON.parse(init.body);
      if (query.includes("query MirrorIssue(")) return jsonResponse({ data: { issue } });
      if (query.includes("mutation AttachGithubIssue(")) {
        linearMutations.push(query);
        return jsonResponse({ errors: [{ message: "attachment permission denied" }] });
      }
      assert.fail(`unexpected Linear query: ${query}`);
    }
    githubCalls.push({ method, path: url.pathname });
    if (url.pathname.endsWith("/issues") && method === "GET") {
      return jsonResponse([githubMarkerMatch(issue, 1224)]);
    }
    assert.fail(`unexpected GitHub mutation: ${method} ${url.pathname}`);
  };

  await withFetchMock(mockFetch, async () => {
    await assert.rejects(
      mirrorPayload({ type: "Issue", data: { id: issue.id } }, mirrorEnv),
      /Linear GraphQL:.*attachment permission denied/,
    );
  });

  assert.equal(linearMutations.length, 1);
  assert.deepEqual(githubCalls.map(({ method }) => method), ["GET"]);
});
