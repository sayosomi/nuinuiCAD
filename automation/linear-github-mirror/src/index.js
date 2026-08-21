import { findGithubIssueByMarker } from "./mirrorApi.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MIRROR_MARKER_PREFIX = "linear-issue-id:";
const GITHUB_ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;
const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"];
const IGNORED_IDENTIFIERS = new Set(["SAY-39", "SAY-75", "SAY-84", "SAY-85"]);

const ISSUE_QUERY = `
  query MirrorIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      priority
      updatedAt
      url
      team { id name key }
      state { id name type }
      labels { nodes { name } }
      project { id name }
      parent { identifier title }
      attachments { nodes { id title url } }
      relations(first: 50) {
        nodes {
          type
          relatedIssue { identifier title state { name type } }
        }
      }
      inverseRelations(first: 50) {
        nodes {
          type
          issue { identifier title state { name type } }
        }
      }
    }
  }
`;

const TEAM_ISSUES_QUERY = `
  query MirrorTeamIssues($id: String!, $after: String) {
    team(id: $id) {
      issues(first: 50, after: $after, includeArchived: true) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const ATTACHMENT_CREATE_MUTATION = `
  mutation AttachGithubIssue($input: AttachmentCreateInput!) {
    attachmentCreate(input: $input) {
      success
      attachment { id url }
    }
  }
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (request.method !== "POST" || url.pathname !== "/webhooks/linear") {
      return new Response("Not found", { status: 404 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("Linear-Signature");
    if (!signature || !(await verifyLinearSignature(rawBody, signature, env.LINEAR_WEBHOOK_SECRET))) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!isFreshWebhook(payload.webhookTimestamp, Date.now())) {
      return new Response("Stale webhook", { status: 401 });
    }

    if (!shouldQueuePayload(payload)) {
      return jsonResponse({ ok: true, ignored: true });
    }

    await env.LINEAR_EVENTS.send({
      deliveryId: request.headers.get("Linear-Delivery") ?? null,
      payload,
    });

    return jsonResponse({ ok: true, queued: true });
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await mirrorPayload(message.body?.payload ?? message.body, env);
      } catch (error) {
        console.error("Linear -> GitHub mirror failed", safeError(error));
        throw error;
      }
    }
  },

  async scheduled(_controller, env) {
    await enqueueSafetySweep(env);
  },
};

export function shouldQueuePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.type === "Issue") return payload.action !== "remove";
  return false;
}

export function extractIssueId(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data;
  if (!data || typeof data !== "object") return null;
  if (payload.type === "Issue" && typeof data.id === "string") return data.id;
  return null;
}

export function safetySweepMessage(issueId) {
  return {
    source: "scheduled-safety-sweep",
    payload: {
      type: "Issue",
      action: "reconcile",
      data: { id: issueId },
    },
  };
}

export async function enqueueSafetySweep(env, dependencies = {}) {
  const queryLinear = dependencies.linearGraphql ?? linearGraphql;
  const send = dependencies.send ?? ((message) => env.LINEAR_EVENTS.send(message));
  let after = null;
  let enqueued = 0;

  while (true) {
    const data = await queryLinear(TEAM_ISSUES_QUERY, { id: env.LINEAR_TEAM_ID, after }, env);
    const issues = data.team?.issues;
    if (!issues) break;

    for (const issue of issues.nodes ?? []) {
      if (typeof issue?.id !== "string") continue;
      await send(safetySweepMessage(issue.id));
      enqueued += 1;
    }

    if (!issues.pageInfo?.hasNextPage) break;
    after = issues.pageInfo?.endCursor ?? null;
    if (!after) throw new Error("Linear team issue pagination reported a next page without an end cursor");
  }

  console.log("Scheduled Linear safety sweep enqueued", { enqueued });
  return enqueued;
}

export async function mirrorPayload(payload, env) {
  const issueId = extractIssueId(payload);
  if (!issueId) {
    console.warn("Ignoring webhook without an issue id", { type: payload?.type, action: payload?.action });
    return;
  }

  const issue = await fetchLinearIssue(issueId, env);
  if (!issue) return;
  if (issue.team?.id !== env.LINEAR_TEAM_ID) {
    console.warn("Ignoring issue from another Linear team", { identifier: issue.identifier });
    return;
  }
  if (!shouldMirrorIssue(issue)) {
    console.warn("Ignoring excluded migration/shadow issue", { identifier: issue.identifier });
    return;
  }

  const issueNumber = await resolveGithubIssueNumber(issue, env);
  await ensureGithubLabels(issue.labels?.nodes ?? [], env);
  await updateGithubIssue(issueNumber, issue, env);
}

export function shouldMirrorIssue(issue) {
  const identifier = issue?.identifier;
  return typeof identifier === "string" && !IGNORED_IDENTIFIERS.has(identifier);
}

export async function fetchLinearIssue(issueId, env) {
  const data = await linearGraphql(ISSUE_QUERY, { id: issueId }, env);
  return data.issue ?? null;
}

async function resolveGithubIssueNumber(issue, env) {
  const attached = githubIssueNumberFromAttachments(issue.attachments?.nodes ?? [], env);
  if (attached != null) return attached;

  const legacy = legacyGithubIssueNumber(issue.identifier);
  if (legacy != null) {
    await assertGithubIssueExists(legacy, env);
    await attachGithubIssue(issue, legacy, env);
    return legacy;
  }

  const recovered = await findGithubIssueByLinearId(issue.id, env);
  if (recovered != null) {
    await attachGithubIssue(issue, recovered, env);
    return recovered;
  }

  const created = await createGithubIssue(issue, env);
  await attachGithubIssue(issue, created, env);
  return created;
}

export function githubIssueNumberFromAttachments(attachments, env) {
  for (const attachment of attachments) {
    if (!attachment || typeof attachment.url !== "string") continue;
    const match = attachment.url.match(GITHUB_ISSUE_URL_RE);
    if (!match) continue;
    if (match[1] !== env.GITHUB_OWNER || match[2] !== env.GITHUB_REPO) continue;
    return Number(match[3]);
  }
  return null;
}

export function legacyGithubIssueNumber(identifier) {
  const match = /^SAY-(\d+)$/.exec(identifier ?? "");
  if (!match) return null;
  const number = Number(match[1]);
  if (number >= 9 && number <= 38) return number + 177;
  if (number >= 40 && number <= 74) return number + 176;
  return null;
}

async function createGithubIssue(issue, env) {
  const body = renderGithubBody(issue);
  const response = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: issue.title, body }),
  }, env);
  if (!Number.isInteger(response.number)) throw new Error("GitHub create issue response had no issue number");
  return response.number;
}

async function findGithubIssueByLinearId(linearIssueId, env) {
  return findGithubIssueByMarker(`${MIRROR_MARKER_PREFIX}${linearIssueId}`, env, githubFetch);
}

async function assertGithubIssueExists(issueNumber, env) {
  await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {}, env);
}

async function attachGithubIssue(issue, issueNumber, env) {
  const url = `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`;
  await linearGraphql(ATTACHMENT_CREATE_MUTATION, {
    input: {
      issueId: issue.id,
      title: `GitHub #${issueNumber}`,
      subtitle: "Public mirror",
      url,
      metadata: {
        integration: "nuinuicad-linear-github-mirror",
        githubIssueNumber: issueNumber,
      },
    },
  }, env);
}

async function ensureGithubLabels(labels, env) {
  const desired = [...new Set(labels.map((label) => label?.name).filter(Boolean))];
  if (desired.length === 0) return;

  const existing = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels?per_page=100`, {}, env);
  const names = new Set((Array.isArray(existing) ? existing : []).map((label) => label.name));

  for (const name of desired) {
    if (names.has(name)) continue;
    try {
      await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels`, {
        method: "POST",
        body: JSON.stringify({ name, color: "ededed" }),
      }, env);
      names.add(name);
    } catch (error) {
      if (!String(error?.message ?? "").includes("422")) throw error;
    }
  }
}

async function updateGithubIssue(issueNumber, issue, env) {
  const state = githubStateFromLinearState(issue.state?.name, issue.state?.type);
  const labels = [...new Set((issue.labels?.nodes ?? []).map((label) => label?.name).filter(Boolean))];
  const body = {
    title: issue.title,
    body: renderGithubBody(issue),
    state: state.state,
    labels,
  };
  if (state.state === "closed") body.state_reason = state.reason;

  await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }, env);
}

export function githubStateFromLinearState(name, type) {
  if (name === "Done" || type === "completed") return { state: "closed", reason: "completed" };
  if (name === "Canceled" || name === "Duplicate" || type === "canceled") {
    return { state: "closed", reason: "not_planned" };
  }
  return { state: "open", reason: null };
}

export function priorityName(priority) {
  return PRIORITY_NAMES[Number(priority)] ?? "No priority";
}

export function renderGithubBody(issue) {
  const description = (issue.description ?? "").trimEnd();
  const labels = (issue.labels?.nodes ?? []).map((label) => label.name).filter(Boolean);
  const relationSummary = summarizeRelations(issue);
  const metadata = [
    `Original Linear issue: [${issue.identifier}](${issue.url})`,
    `Linear status: ${issue.state?.name ?? "Unknown"}`,
    `Linear priority: ${priorityName(issue.priority)}`,
    `Linear labels: ${labels.length > 0 ? labels.join(", ") : "None"}`,
    `Linear project: ${issue.project?.name ?? "None"}`,
    `Linear parent: ${issue.parent?.identifier ?? "None"}`,
    `Linear blocks: ${formatIdentifiers(relationSummary.blocks)}`,
    `Linear blocked by: ${formatIdentifiers(relationSummary.blockedBy)}`,
    `Linear related: ${formatIdentifiers(relationSummary.related)}`,
  ];

  return [
    description,
    description ? "\n---" : "---",
    ...metadata,
    "",
    `<!-- ${MIRROR_MARKER_PREFIX}${issue.id} -->`,
    `<!-- linear-mirror-updated-at:${issue.updatedAt ?? new Date().toISOString()} -->`,
  ].join("\n");
}

export function summarizeRelations(issue) {
  const blocks = [];
  const blockedBy = [];
  const related = [];

  for (const relation of issue.relations?.nodes ?? []) {
    const identifier = relation?.relatedIssue?.identifier;
    if (!identifier) continue;
    if (relation.type === "blocks") blocks.push(identifier);
    else if (relation.type === "related" || relation.type === "similar") related.push(identifier);
  }

  for (const relation of issue.inverseRelations?.nodes ?? []) {
    const identifier = relation?.issue?.identifier;
    if (!identifier) continue;
    if (relation.type === "blocks") blockedBy.push(identifier);
    else if (relation.type === "related" || relation.type === "similar") related.push(identifier);
  }

  return {
    blocks: [...new Set(blocks)].sort(),
    blockedBy: [...new Set(blockedBy)].sort(),
    related: [...new Set(related)].sort(),
  };
}

function formatIdentifiers(values) {
  return values.length > 0 ? values.join(", ") : "None";
}

async function linearGraphql(query, variables, env) {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Linear API ${response.status}: ${JSON.stringify(json)}`);
  if (json?.errors?.length) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json?.data ?? {};
}

async function githubFetch(path, init, env) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "nuinuiCAD-linear-github-mirror",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

export async function verifyLinearSignature(rawBody, headerSignature, secret) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(headerSignature ?? "")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  const expected = hexToBytes(headerSignature);
  if (!expected || expected.length !== signed.length) return false;
  let diff = 0;
  for (let i = 0; i < signed.length; i += 1) diff |= signed[i] ^ expected[i];
  return diff === 0;
}

export function isFreshWebhook(timestamp, now, maxSkewMs = 60_000) {
  if (!Number.isFinite(Number(timestamp))) return false;
  return Math.abs(Number(now) - Number(timestamp)) <= maxSkewMs;
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}
