import {
  COMMENT_MARKER_PREFIX,
  COMMENT_PARENT_MARKER_PREFIX,
  COMMENT_UPDATED_MARKER_PREFIX,
  GITHUB_ISSUE_URL_RE,
  findGithubIssueByMarker,
  githubFetch,
  linearGraphql,
} from "./mirrorApi.js";

const IGNORED_IDENTIFIERS = new Set(["SAY-39", "SAY-75", "SAY-84", "SAY-85"]);

const ISSUE_COMMENT_PARENT_QUERY = `
  query MirrorIssueCommentParent($id: String!) {
    issue(id: $id) {
      id
      identifier
      team { id }
      attachments { nodes { url } }
    }
  }
`;

const ISSUE_COMMENTS_QUERY = `
  query MirrorIssueComments($id: String!, $after: String) {
    issue(id: $id) {
      comments(first: 50, after: $after, includeArchived: true) {
        nodes { id body archivedAt createdAt editedAt updatedAt parentId }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const DOCUMENT_COMMENTS_QUERY = `
  query MirrorDocumentComments($id: String!, $after: String) {
    document(id: $id) {
      comments(first: 50, after: $after, includeArchived: true) {
        nodes { id body archivedAt createdAt editedAt updatedAt parentId }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const COMMENT_QUERY = `
  query MirrorComment($id: String!) {
    comment(id: $id) {
      id
      archivedAt
      issueId
      issue { id }
      documentContent { document { id } }
    }
  }
`;

export async function handleCommentPayload(payload, env, options = {}) {
  const commentId = payload?.data?.id;
  if (typeof commentId !== "string") return;
  const gh = options.githubFetch ?? githubFetch;
  if (payload.action === "remove") {
    await deleteGithubCommentByLinearId(commentId, env, { githubFetch: gh });
    return;
  }

  const queryLinear = options.linearGraphql ?? linearGraphql;
  const data = await queryLinear(COMMENT_QUERY, { id: commentId }, env);
  const comment = data.comment;
  if (!comment || comment.archivedAt) {
    await deleteGithubCommentByLinearId(commentId, env, { githubFetch: gh });
    return;
  }

  const issueId = comment.issueId ?? comment.issue?.id ?? payload?.data?.issueId;
  if (typeof issueId === "string") {
    await reconcileIssueComments(issueId, env, { ...options, linearGraphql: queryLinear, githubFetch: gh });
    return;
  }

  const documentId = comment.documentContent?.document?.id;
  if (typeof documentId === "string" && typeof options.reconcileDocument === "function") {
    await options.reconcileDocument(documentId, env, { ...options, linearGraphql: queryLinear, githubFetch: gh });
  }
}

export async function reconcileIssueComments(issueId, env, options = {}) {
  const queryLinear = options.linearGraphql ?? linearGraphql;
  const gh = options.githubFetch ?? githubFetch;
  const data = await queryLinear(ISSUE_COMMENT_PARENT_QUERY, { id: issueId }, env);
  const issue = data.issue;
  if (!issue || issue.team?.id !== env.LINEAR_TEAM_ID || !shouldMirrorIssueIdentifier(issue.identifier)) return false;

  const issueNumber = await resolveExistingGithubIssueNumber(issue, env, gh);
  if (issueNumber == null) {
    await env.LINEAR_EVENTS.send({
      source: "comment-parent-reconcile",
      payload: { type: "Issue", action: "reconcile", data: { id: issueId } },
    });
    return false;
  }

  const comments = await fetchAllLinearComments("issue", issueId, env, queryLinear);
  await reconcileCommentsToGithubIssue(comments, issueNumber, env, { githubFetch: gh });
  return true;
}

export async function fetchDocumentComments(documentId, env, queryLinear = linearGraphql) {
  return fetchAllLinearComments("document", documentId, env, queryLinear);
}

async function fetchAllLinearComments(parentType, parentId, env, queryLinear) {
  const query = parentType === "issue" ? ISSUE_COMMENTS_QUERY : DOCUMENT_COMMENTS_QUERY;
  let after = null;
  const result = [];
  while (true) {
    const data = await queryLinear(query, { id: parentId, after }, env);
    const connection = parentType === "issue" ? data.issue?.comments : data.document?.comments;
    if (!connection) break;
    for (const comment of connection.nodes ?? []) {
      if (!comment?.id || comment.archivedAt) continue;
      result.push(comment);
    }
    if (!connection.pageInfo?.hasNextPage) break;
    after = connection.pageInfo?.endCursor ?? null;
    if (!after) throw new Error(`Linear ${parentType} comment pagination reported a next page without an end cursor`);
  }
  return result;
}

function shouldMirrorIssueIdentifier(identifier) {
  return typeof identifier === "string" && !IGNORED_IDENTIFIERS.has(identifier);
}

async function resolveExistingGithubIssueNumber(issue, env, gh) {
  for (const attachment of issue.attachments?.nodes ?? []) {
    const match = typeof attachment?.url === "string" ? attachment.url.match(GITHUB_ISSUE_URL_RE) : null;
    if (match && match[1] === env.GITHUB_OWNER && match[2] === env.GITHUB_REPO) return Number(match[3]);
  }
  const legacy = legacyGithubIssueNumber(issue.identifier);
  if (legacy != null) return legacy;
  return findGithubIssueByMarker(`linear-issue-id:${issue.id}`, env, gh);
}

function legacyGithubIssueNumber(identifier) {
  const match = /^SAY-(\d+)$/.exec(identifier ?? "");
  if (!match) return null;
  const number = Number(match[1]);
  if (number >= 9 && number <= 38) return number + 177;
  if (number >= 40 && number <= 74) return number + 176;
  return null;
}

export function renderGithubComment(comment) {
  const body = String(comment?.body ?? "").trimEnd();
  const updatedAt = comment?.editedAt ?? comment?.updatedAt ?? comment?.createdAt ?? "unknown";
  const markers = [
    `<!-- ${COMMENT_MARKER_PREFIX}${comment.id} -->`,
    `<!-- ${COMMENT_UPDATED_MARKER_PREFIX}${updatedAt} -->`,
  ];
  if (comment?.parentId) markers.push(`<!-- ${COMMENT_PARENT_MARKER_PREFIX}${comment.parentId} -->`);
  return [body, body ? "" : null, ...markers].filter((value) => value != null).join("\n");
}

export function extractLinearCommentId(body) {
  const match = String(body ?? "").match(/<!--\s*linear-comment-id:([^\s>]+)\s*-->/);
  return match?.[1] ?? null;
}

export async function reconcileCommentsToGithubIssue(linearComments, issueNumber, env, options = {}) {
  const gh = options.githubFetch ?? githubFetch;
  const githubComments = await listGithubIssueComments(issueNumber, env, gh);
  const managed = new Map();
  for (const comment of githubComments) {
    const linearId = extractLinearCommentId(comment?.body);
    if (!linearId) continue;
    const entries = managed.get(linearId) ?? [];
    entries.push(comment);
    managed.set(linearId, entries);
  }

  const desiredIds = new Set();
  for (const linearComment of linearComments) {
    if (!linearComment?.id) continue;
    desiredIds.add(linearComment.id);
    const rendered = renderGithubComment(linearComment);
    const existing = managed.get(linearComment.id) ?? [];
    if (existing.length === 0) {
      await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: rendered }),
      }, env);
      continue;
    }
    const [primary, ...duplicates] = existing.sort((a, b) => Number(a.id) - Number(b.id));
    if (primary.body !== rendered) {
      await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments/${primary.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: rendered }),
      }, env);
    }
    for (const duplicate of duplicates) {
      await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments/${duplicate.id}`, { method: "DELETE" }, env);
    }
  }

  for (const [linearId, comments] of managed) {
    if (desiredIds.has(linearId)) continue;
    for (const comment of comments) {
      await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments/${comment.id}`, { method: "DELETE" }, env);
    }
  }
}

async function listGithubIssueComments(issueNumber, env, gh) {
  const result = [];
  for (let page = 1; ; page += 1) {
    const rows = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/comments?per_page=100&page=${page}`, {}, env);
    if (!Array.isArray(rows)) break;
    result.push(...rows);
    if (rows.length < 100) break;
  }
  return result;
}

async function listAllGithubIssueComments(env, gh) {
  const result = [];
  for (let page = 1; ; page += 1) {
    const rows = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments?per_page=100&page=${page}`, {}, env);
    if (!Array.isArray(rows)) break;
    result.push(...rows);
    if (rows.length < 100) break;
  }
  return result;
}

export async function deleteGithubCommentByLinearId(linearCommentId, env, options = {}) {
  const gh = options.githubFetch ?? githubFetch;
  const comments = await listAllGithubIssueComments(env, gh);
  for (const comment of comments) {
    if (extractLinearCommentId(comment?.body) !== linearCommentId) continue;
    await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments/${comment.id}`, { method: "DELETE" }, env);
  }
}
