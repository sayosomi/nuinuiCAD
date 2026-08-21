const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const GITHUB_API_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

export const DOCUMENT_LABEL = "Linear Document";
export const DOCUMENT_MARKER_PREFIX = "linear-document-id:";
export const COMMENT_MARKER_PREFIX = "linear-comment-id:";
export const COMMENT_PARENT_MARKER_PREFIX = "linear-comment-parent-id:";
export const COMMENT_UPDATED_MARKER_PREFIX = "linear-comment-updated-at:";
export const GITHUB_ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

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
