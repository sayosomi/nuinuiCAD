import {
  COMMENT_MARKER_PREFIX,
  COMMENT_PARENT_MARKER_PREFIX,
  COMMENT_UPDATED_MARKER_PREFIX,
  ISSUE_MARKER_PREFIX,
  findGithubIssueByMarker,
  githubFetch,
  linearGraphql,
  resolveGithubIssueAttachment,
} from "./mirrorApi.js";

const IGNORED_IDENTIFIERS = new Set(["SAY-39", "SAY-75", "SAY-84", "SAY-85"]);
const LINEAR_COMMENT_PAGE_SIZE = 50;
const GITHUB_COMMENT_PAGE_SIZE = 100;
const LINEAR_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

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
      id
      archivedAt
      comments(first: ${LINEAR_COMMENT_PAGE_SIZE}, after: $after, includeArchived: true) {
        nodes { id body archivedAt createdAt editedAt updatedAt parentId }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const DOCUMENT_COMMENTS_QUERY = `
  query MirrorDocumentComments($id: String!, $after: String) {
    document(id: $id) {
      id
      archivedAt
      comments(first: ${LINEAR_COMMENT_PAGE_SIZE}, after: $after, includeArchived: true) {
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
      issue { id archivedAt }
      documentContent { document { id archivedAt } }
    }
  }
`;

export async function handleCommentPayload(payload, env, options = {}) {
  const commentId = payload?.data?.id;
  if (typeof commentId !== "string") return;
  const gh = options.githubFetch ?? githubFetch;
  const queryLinear = options.linearGraphql ?? linearGraphql;
  const data = await queryLinear(COMMENT_QUERY, { id: commentId }, env);
  if (!isRecord(data)) throw new Error("Linear comment query returned malformed data");
  const comment = data.comment;
  if (!isRecord(comment) || comment.id !== commentId ||
      !Object.prototype.hasOwnProperty.call(comment, "archivedAt") ||
      (comment.archivedAt !== null && !isDateTimeString(comment.archivedAt))) {
    throw new Error("Linear comment is missing or malformed");
  }

  const parent = getCommentParentArchiveMetadata(comment);
  if (payload.action === "remove") {
    if (comment.archivedAt === null) {
      throw new Error("Linear Comment removal is ambiguous because the comment is not archived");
    }
    if (parent.archivedAt !== null && comment.archivedAt === parent.archivedAt) return;
    await deleteGithubCommentByLinearId(commentId, env, { githubFetch: gh });
    return;
  }

  if (parent.type === "issue") {
    await reconcileIssueComments(parent.id, env, { ...options, linearGraphql: queryLinear, githubFetch: gh });
    return;
  }

  if (typeof options.reconcileDocument === "function") {
    await options.reconcileDocument(parent.id, env, { ...options, linearGraphql: queryLinear, githubFetch: gh });
    return;
  }
  throw new Error("Linear Document comment has no reconciliation handler");
}

export async function reconcileIssueComments(issueId, env, options = {}) {
  const queryLinear = options.linearGraphql ?? linearGraphql;
  const gh = options.githubFetch ?? githubFetch;
  const data = await queryLinear(ISSUE_COMMENT_PARENT_QUERY, { id: issueId }, env);
  if (!isRecord(data)) throw new Error("Linear issue comment parent query returned malformed data");
  const issue = data.issue;
  if (!isRecord(issue) || issue.id !== issueId) throw new Error("Linear issue comment parent is missing, malformed, or mismatched");
  if (!isRecord(issue.team) || !isNonEmptyString(issue.team.id) || !isNonEmptyString(issue.identifier)) {
    throw new Error("Linear issue comment parent has malformed scope data");
  }
  if (issue.team.id !== env.LINEAR_TEAM_ID || !shouldMirrorIssueIdentifier(issue.identifier)) return false;

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
  const commentIds = new Set();
  const cursors = new Set();
  let parentArchivedAt;
  while (true) {
    const data = await queryLinear(query, { id: parentId, after }, env);
    if (!isRecord(data)) throw new Error(`Linear ${parentType} comment query returned malformed data`);
    const parent = data[parentType];
    if (!isRecord(parent) || parent.id !== parentId) throw new Error(`Linear ${parentType} comment parent is missing, malformed, or mismatched`);
    if (!Object.prototype.hasOwnProperty.call(parent, "archivedAt") ||
        (parent.archivedAt !== null && !isDateTimeString(parent.archivedAt))) {
      throw new Error(`Linear ${parentType} comment parent archive metadata is missing or malformed`);
    }
    if (parentArchivedAt === undefined) parentArchivedAt = parent.archivedAt;
    else if (parentArchivedAt !== parent.archivedAt) {
      throw new Error(`Linear ${parentType} comment parent archive metadata changed during pagination`);
    }
    const connection = parent.comments;
    if (!isRecord(connection)) throw new Error(`Linear ${parentType} comments connection is missing or malformed`);
    if (!Array.isArray(connection.nodes)) throw new Error(`Linear ${parentType} comments connection has malformed nodes`);

    for (const [index, comment] of connection.nodes.entries()) {
      validateLinearComment(comment, parentType, index, parentArchivedAt);
      if (commentIds.has(comment.id)) throw new Error(`Linear ${parentType} comments contain duplicate comment ID ${comment.id}`);
      commentIds.add(comment.id);
      if (isRetainedLinearComment(comment, parentArchivedAt)) result.push(comment);
    }

    const pageInfo = connection.pageInfo;
    if (!isRecord(pageInfo) || typeof pageInfo.hasNextPage !== "boolean" ||
        !Object.prototype.hasOwnProperty.call(pageInfo, "endCursor") ||
        (pageInfo.endCursor !== null && (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor.trim().length === 0))) {
      throw new Error(`Linear ${parentType} comments connection has malformed pagination information`);
    }
    if (!pageInfo.hasNextPage) break;

    const nextCursor = pageInfo.endCursor;
    if (typeof nextCursor !== "string" || nextCursor === after || cursors.has(nextCursor) || connection.nodes.length === 0) {
      throw new Error(`Linear ${parentType} comment pagination is incomplete or did not advance`);
    }
    cursors.add(nextCursor);
    after = nextCursor;
  }
  return result;
}

function validateLinearComment(comment, parentType, index, parentArchivedAt) {
  const invalid = () => { throw new Error(`Linear ${parentType} comments contain a malformed node at index ${index}`); };
  if (!isRecord(comment) || typeof comment.id !== "string" || comment.id.trim() === "") invalid();
  if (!Object.prototype.hasOwnProperty.call(comment, "archivedAt") ||
      (comment.archivedAt !== null && !isDateTimeString(comment.archivedAt))) invalid();
  if (!isRetainedLinearComment(comment, parentArchivedAt)) return;
  if (typeof comment.body !== "string" || !isDateTimeString(comment.createdAt) ||
      !Object.prototype.hasOwnProperty.call(comment, "editedAt") ||
      (comment.editedAt !== null && !isDateTimeString(comment.editedAt)) ||
      !isDateTimeString(comment.updatedAt) ||
      !Object.prototype.hasOwnProperty.call(comment, "parentId") ||
      (comment.parentId !== null && !isNonEmptyString(comment.parentId))) invalid();
}

function isRetainedLinearComment(comment, parentArchivedAt) {
  return comment.archivedAt === null ||
    (parentArchivedAt !== null && comment.archivedAt === parentArchivedAt);
}

function getCommentParentArchiveMetadata(comment) {
  if (!Object.prototype.hasOwnProperty.call(comment, "issueId") ||
      !Object.prototype.hasOwnProperty.call(comment, "issue") ||
      !Object.prototype.hasOwnProperty.call(comment, "documentContent")) {
    throw new Error("Linear comment parent archive metadata is missing or malformed");
  }

  const issueId = comment.issueId;
  const issue = comment.issue;
  const documentContent = comment.documentContent;
  const document = documentContent === null ? null : documentContent?.document;
  if (issueId !== null && !isNonEmptyString(issueId)) {
    throw new Error("Linear comment issue identity is malformed");
  }

  const hasIssueIdentity = issueId !== null || issue !== null;
  const hasDocumentIdentity = document !== null && document !== undefined;
  if (hasIssueIdentity === hasDocumentIdentity) {
    throw new Error("Linear comment parent archive metadata is missing, malformed, or ambiguous");
  }

  if (hasIssueIdentity) {
    if (!isRecord(issue) || !isNonEmptyString(issue.id) || issue.id !== issueId) {
      throw new Error("Linear comment Issue parent is missing, malformed, or mismatched");
    }
    return {
      type: "issue",
      id: issue.id,
      archivedAt: validateParentArchivedAt(issue, "Issue"),
    };
  }

  if (!isRecord(document) || !isNonEmptyString(document.id)) {
    throw new Error("Linear comment Document parent is missing or malformed");
  }
  return {
    type: "document",
    id: document.id,
    archivedAt: validateParentArchivedAt(document, "Document"),
  };
}

function validateParentArchivedAt(parent, parentType) {
  if (!Object.prototype.hasOwnProperty.call(parent, "archivedAt") ||
      (parent.archivedAt !== null && !isDateTimeString(parent.archivedAt))) {
    throw new Error(`Linear comment ${parentType} parent archive metadata is missing or malformed`);
  }
  return parent.archivedAt;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDateTimeString(value) {
  if (!isNonEmptyString(value)) return false;
  const match = value.match(LINEAR_DATE_TIME_RE);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, , , , hour, minute, second, , offsetHour, offsetMinute] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return false;
  const date = value.slice(0, 10);
  return new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}

function shouldMirrorIssueIdentifier(identifier) {
  return typeof identifier === "string" && !IGNORED_IDENTIFIERS.has(identifier);
}

async function resolveExistingGithubIssueNumber(issue, env, gh) {
  const attached = await resolveGithubIssueAttachment(issue, env, gh);
  if (attached != null) return attached;
  const legacy = legacyGithubIssueNumber(issue.identifier);
  if (legacy != null) return legacy;
  return findGithubIssueByMarker(`${ISSUE_MARKER_PREFIX}${issue.id}`, env, gh);
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
    if (!Array.isArray(rows)) throw new Error(`GitHub issue comment list page ${page} returned a malformed response`);
    for (const [index, comment] of rows.entries()) {
      if (!isRecord(comment) || !Number.isSafeInteger(comment.id) || comment.id <= 0 || typeof comment.body !== "string") {
        throw new Error(`GitHub issue comment list page ${page} contains a malformed comment at index ${index}`);
      }
    }
    result.push(...rows);
    if (rows.length < GITHUB_COMMENT_PAGE_SIZE) break;
  }
  return result;
}

async function listAllGithubIssueComments(env, gh) {
  const result = [];
  for (let page = 1; ; page += 1) {
    const rows = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/comments?per_page=${GITHUB_COMMENT_PAGE_SIZE}&page=${page}`, {}, env);
    if (!Array.isArray(rows)) throw new Error(`GitHub issue comment list page ${page} returned a malformed response`);
    for (const [index, comment] of rows.entries()) {
      if (!isRecord(comment) || !Number.isSafeInteger(comment.id) || comment.id <= 0 || typeof comment.body !== "string") {
        throw new Error(`GitHub issue comment list page ${page} contains a malformed comment at index ${index}`);
      }
    }
    result.push(...rows);
    if (rows.length < GITHUB_COMMENT_PAGE_SIZE) break;
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
