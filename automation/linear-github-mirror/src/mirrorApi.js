const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

export const DOCUMENT_LABEL = "Linear Document";
export const DOCUMENT_MARKER_PREFIX = "linear-document-id:";
export const ISSUE_MARKER_PREFIX = "linear-issue-id:";
export const COMMENT_MARKER_PREFIX = "linear-comment-id:";
export const COMMENT_PARENT_MARKER_PREFIX = "linear-comment-parent-id:";
export const COMMENT_UPDATED_MARKER_PREFIX = "linear-comment-updated-at:";
export const GITHUB_ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

const HISTORICAL_LINEAR_ISSUE = {
  id: "8bc80133-54b9-48f9-ac73-456d0823855e",
  identifier: "SAY-385",
  canonicalGithubIssueNumber: 1108,
  duplicateGithubIssueNumber: 1107,
};

export async function linearGraphql(query, variables, env) {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: env.LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Linear API ${response.status}: ${JSON.stringify(json)}`);
  if (json?.errors?.length) throw new Error(`Linear GraphQL: ${JSON.stringify(json.errors)}`);
  return json?.data ?? {};
}

export async function githubFetch(path, init, env) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "nuinuicad-linear-github-mirror",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

export async function findGithubIssueByMarker(marker, env, gh = githubFetch) {
  const matches = [];
  const labelFilter = marker.startsWith(DOCUMENT_MARKER_PREFIX)
    ? `&labels=${encodeURIComponent(DOCUMENT_LABEL)}`
    : "";
  const needle = `<!-- ${marker} -->`;

  for (let page = 1; ; page += 1) {
    const rows = await gh(
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?state=all&per_page=100&page=${page}${labelFilter}`,
      {},
      env,
    );
    if (!Array.isArray(rows)) break;
    for (const issue of rows) {
      if (issue?.pull_request) continue;
      if (String(issue?.body ?? "").includes(needle) && Number.isInteger(issue?.number)) {
        matches.push(issue.number);
      }
    }
    if (rows.length < 100) break;
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error(`Multiple GitHub issues contain mirror marker ${marker}`);
  return matches[0];
}

export async function resolveGithubIssueAttachment(issue, env, gh = githubFetch) {
  const isHistoricalCandidate = issue?.identifier === HISTORICAL_LINEAR_ISSUE.identifier ||
    issue?.id === HISTORICAL_LINEAR_ISSUE.id;
  if (isHistoricalCandidate) return resolveHistoricalGithubIssueAttachment(issue, env, gh);

  const attachments = issue?.attachments?.nodes ?? [];
  if (!Array.isArray(attachments)) throw new Error("Linear issue attachments are malformed");

  return githubIssueNumberFromAttachments(attachments, env, issue?.identifier ?? issue?.id ?? "issue");
}

export function githubIssueNumberFromAttachments(attachments, env, issueLabel = "issue") {
  const issueNumbers = new Set();
  for (const attachment of attachments) {
    const match = typeof attachment?.url === "string" ? attachment.url.match(GITHUB_ISSUE_URL_RE) : null;
    if (!match || match[1] !== env.GITHUB_OWNER || match[2] !== env.GITHUB_REPO) continue;
    const number = Number(match[3]);
    if (Number.isSafeInteger(number) && number > 0) issueNumbers.add(number);
  }

  if (issueNumbers.size > 1) throw new Error(`Ambiguous GitHub issue attachments for Linear ${issueLabel}`);
  return issueNumbers.values().next().value ?? null;
}

async function resolveHistoricalGithubIssueAttachment(issue, env, gh) {
  if (issue?.id !== HISTORICAL_LINEAR_ISSUE.id || issue?.identifier !== HISTORICAL_LINEAR_ISSUE.identifier) {
    throw new Error("Historical SAY-385 GitHub attachment recovery requires the exact Linear issue UUID and identifier");
  }

  const attachments = issue?.attachments?.nodes;
  if (!Array.isArray(attachments)) throw new Error("Historical SAY-385 Linear attachments are incomplete");

  const issueNumbers = new Set();
  for (const attachment of attachments) {
    const url = attachment?.url;
    const match = typeof url === "string" ? url.match(GITHUB_ISSUE_URL_RE) : null;
    if (!match) throw new Error("Historical SAY-385 has an invalid GitHub issue attachment");
    if (match[1] !== env.GITHUB_OWNER || match[2] !== env.GITHUB_REPO) {
      throw new Error("Historical SAY-385 GitHub attachment points to a different repository");
    }
    const number = Number(match[3]);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error("Historical SAY-385 has an invalid GitHub issue number");
    }
    issueNumbers.add(number);
  }

  const canonical = HISTORICAL_LINEAR_ISSUE.canonicalGithubIssueNumber;
  const duplicate = HISTORICAL_LINEAR_ISSUE.duplicateGithubIssueNumber;
  const acceptedSet = (issueNumbers.size === 1 && issueNumbers.has(canonical)) ||
    (issueNumbers.size === 2 && issueNumbers.has(canonical) && issueNumbers.has(duplicate));
  if (!acceptedSet) throw new Error("Historical SAY-385 GitHub attachments do not match the approved {1108} or {1107, 1108} set");

  await verifyHistoricalGithubIssue(canonical, env, gh);
  if (issueNumbers.has(duplicate)) await verifyHistoricalGithubIssue(duplicate, env, gh);
  return canonical;
}

async function verifyHistoricalGithubIssue(issueNumber, env, gh) {
  const githubIssue = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {}, env);
  if (!isRecord(githubIssue) || githubIssue.number !== issueNumber || typeof githubIssue.body !== "string") {
    throw new Error(`Historical SAY-385 GitHub issue #${issueNumber} response is incomplete or mismatched`);
  }
  if (githubIssue.pull_request) throw new Error(`Historical SAY-385 GitHub #${issueNumber} is a pull request`);

  const expectedMarker = `<!-- ${ISSUE_MARKER_PREFIX}${HISTORICAL_LINEAR_ISSUE.id} -->`;
  const markerValues = [...githubIssue.body.matchAll(/<!--\s*linear-issue-id:([^\s>]+)\s*-->/g)].map((match) => match[1]);
  if (!githubIssue.body.includes(expectedMarker) || markerValues.length !== 1 || markerValues[0] !== HISTORICAL_LINEAR_ISSUE.id) {
    throw new Error(`Historical SAY-385 GitHub #${issueNumber} has a mismatched Linear issue marker`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function ensureGithubLabel(name, env, gh = githubFetch) {
  try {
    await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels/${encodeURIComponent(name)}`, {}, env);
    return;
  } catch (error) {
    if (!String(error?.message ?? "").includes("404")) throw error;
  }
  try {
    await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color: "ededed" }),
    }, env);
  } catch (error) {
    if (!String(error?.message ?? "").includes("422")) throw error;
  }
}

export async function closeGithubIssueNotPlanned(issueNumber, env, gh = githubFetch) {
  await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
  }, env);
}
