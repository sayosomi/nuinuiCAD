import {
  DOCUMENT_LABEL,
  DOCUMENT_MARKER_PREFIX,
  closeGithubIssueNotPlanned,
  ensureGithubLabel,
  findGithubIssueByMarker,
  githubFetch,
  linearGraphql,
} from "./mirrorApi.js";
import { fetchDocumentComments, reconcileCommentsToGithubIssue } from "./comments.js";

const DOCUMENT_QUERY = `
  query MirrorDocument($id: String!) {
    document(id: $id) {
      id title content archivedAt trashed updatedAt url documentContentId
      initiative {
        id
        parentInitiatives(first: 50, includeArchived: true) { nodes { id } }
      }
      project {
        id
        initiatives(first: 50, includeArchived: true) {
          nodes { id parentInitiatives(first: 50, includeArchived: true) { nodes { id } } }
        }
      }
      issue {
        id
        project {
          id
          initiatives(first: 50, includeArchived: true) {
            nodes { id parentInitiatives(first: 50, includeArchived: true) { nodes { id } } }
          }
        }
      }
    }
  }
`;

const DOCUMENTS_QUERY = `
  query MirrorDocuments($after: String) {
    documents(first: 50, after: $after, includeArchived: true) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CREATE_VISIBILITY_ATTEMPTS = 12;
const CREATE_VISIBILITY_DELAY_MS = 1_000;

export function documentSafetySweepMessage(documentId) {
  return {
    source: "scheduled-document-safety-sweep",
    payload: { type: "Document", action: "reconcile", data: { id: documentId } },
  };
}

export function documentSweepFinalizeMessage(documentIds) {
  return {
    source: "scheduled-document-safety-sweep",
    payload: { type: "DocumentSweepFinalize", action: "reconcile", data: { documentIds } },
  };
}

export async function enqueueDocumentSafetySweep(env, options = {}) {
  const queryLinear = options.linearGraphql ?? linearGraphql;
  const send = options.send ?? ((message) => env.LINEAR_EVENTS.send(message));
  let after = null;
  const documentIds = [];
  while (true) {
    const data = await queryLinear(DOCUMENTS_QUERY, { after }, env);
    const documents = data.documents;
    if (!documents) break;
    for (const document of documents.nodes ?? []) {
      if (typeof document?.id !== "string") continue;
      documentIds.push(document.id);
      await send(documentSafetySweepMessage(document.id));
    }
    if (!documents.pageInfo?.hasNextPage) break;
    after = documents.pageInfo?.endCursor ?? null;
    if (!after) throw new Error("Linear document pagination reported a next page without an end cursor");
  }
  await send(documentSweepFinalizeMessage(documentIds));
  console.log("Scheduled Linear document safety sweep enqueued", { enqueued: documentIds.length });
  return documentIds.length;
}

export async function handleDocumentPayload(payload, env, options = {}) {
  const documentId = payload?.data?.id;
  if (typeof documentId !== "string") return;
  const gh = options.githubFetch ?? githubFetch;
  if (payload.action === "remove") {
    const issueNumber = await findGithubDocumentIssueByLinearId(documentId, env, gh);
    if (issueNumber != null) await closeGithubIssueNotPlanned(issueNumber, env, gh);
    return;
  }
  await reconcileDocumentById(documentId, env, options);
}

export async function reconcileDocumentById(documentId, env, options = {}) {
  const queryLinear = options.linearGraphql ?? linearGraphql;
  const gh = options.githubFetch ?? githubFetch;
  const data = await queryLinear(DOCUMENT_QUERY, { id: documentId }, env);
  const document = data.document ?? null;
  if (!document) return null;

  const inScope = isDocumentInNuinuiCadScope(document, env.LINEAR_INITIATIVE_ID);
  let issueNumber = await findGithubDocumentIssueByLinearId(document.id, env, gh);
  if (!inScope) {
    if (issueNumber != null) await closeGithubIssueNotPlanned(issueNumber, env, gh);
    return null;
  }

  await ensureGithubLabel(DOCUMENT_LABEL, env, gh);
  if (issueNumber == null) {
    issueNumber = await createGithubDocumentIssue(document, env, gh);
    await waitForGithubDocumentVisibility(document.id, issueNumber, env, {
      githubFetch: gh,
      sleep: options.sleep,
      attempts: options.visibilityAttempts,
      delayMs: options.visibilityDelayMs,
    });
  }
  await updateGithubDocumentIssue(issueNumber, document, env, gh);
  const comments = await fetchDocumentComments(document.id, env, queryLinear);
  await reconcileCommentsToGithubIssue(comments, issueNumber, env, { githubFetch: gh });
  return issueNumber;
}

export async function reconcileDocumentSweepFinalize(payload, env, options = {}) {
  const gh = options.githubFetch ?? githubFetch;
  const current = new Set(Array.isArray(payload?.data?.documentIds) ? payload.data.documentIds : []);
  for (let page = 1; ; page += 1) {
    const rows = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?state=all&labels=${encodeURIComponent(DOCUMENT_LABEL)}&per_page=100&page=${page}`, {}, env);
    if (!Array.isArray(rows)) break;
    for (const issue of rows) {
      const documentId = extractLinearDocumentId(issue?.body);
      if (!documentId || current.has(documentId)) continue;
      await closeGithubIssueNotPlanned(issue.number, env, gh);
    }
    if (rows.length < 100) break;
  }
}

export function isDocumentInNuinuiCadScope(document, initiativeId) {
  if (!document || typeof initiativeId !== "string" || initiativeId.length === 0) return false;
  const matches = (initiative) => {
    if (!initiative) return false;
    if (initiative.id === initiativeId) return true;
    return (initiative.parentInitiatives?.nodes ?? []).some((parent) => parent?.id === initiativeId);
  };
  if (matches(document.initiative)) return true;
  for (const initiative of document.project?.initiatives?.nodes ?? []) if (matches(initiative)) return true;
  for (const initiative of document.issue?.project?.initiatives?.nodes ?? []) if (matches(initiative)) return true;
  return false;
}

export function renderGithubDocumentBody(document) {
  const content = String(document?.content ?? "").trimEnd();
  return [
    content,
    content ? "\n---" : "---",
    `Original Linear document: [${document.title || "Untitled"}](${document.url})`,
    "",
    `<!-- ${DOCUMENT_MARKER_PREFIX}${document.id} -->`,
    `<!-- linear-document-updated-at:${document.updatedAt ?? new Date().toISOString()} -->`,
  ].join("\n");
}

export function extractLinearDocumentId(body) {
  const match = String(body ?? "").match(/<!--\s*linear-document-id:([^\s>]+)\s*-->/);
  return match?.[1] ?? null;
}

export async function waitForGithubDocumentVisibility(documentId, expectedIssueNumber, env, options = {}) {
  const gh = options.githubFetch ?? githubFetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0
    ? options.attempts
    : CREATE_VISIBILITY_ATTEMPTS;
  const delayMs = Number.isFinite(options.delayMs) && options.delayMs >= 0
    ? options.delayMs
    : CREATE_VISIBILITY_DELAY_MS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const visibleIssueNumber = await findGithubDocumentIssueByLinearId(documentId, env, gh);
    if (visibleIssueNumber === expectedIssueNumber) return visibleIssueNumber;
    if (visibleIssueNumber != null) {
      throw new Error(
        `Linear document ${documentId} resolved to GitHub #${visibleIssueNumber} after creating #${expectedIssueNumber}`,
      );
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new Error(
    `GitHub document mirror #${expectedIssueNumber} was not visible after creation for Linear document ${documentId}`,
  );
}

async function findGithubDocumentIssueByLinearId(documentId, env, gh) {
  return findGithubIssueByMarker(`${DOCUMENT_MARKER_PREFIX}${documentId}`, env, gh);
}

async function createGithubDocumentIssue(document, env, gh) {
  const response = await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: document.title || "Untitled Linear Document",
      body: renderGithubDocumentBody(document),
      labels: [DOCUMENT_LABEL],
    }),
  }, env);
  if (!Number.isInteger(response?.number)) throw new Error("GitHub document mirror create response had no issue number");
  return response.number;
}

async function updateGithubDocumentIssue(issueNumber, document, env, gh) {
  const closed = Boolean(document.archivedAt || document.trashed);
  const body = {
    title: document.title || "Untitled Linear Document",
    body: renderGithubDocumentBody(document),
    state: closed ? "closed" : "open",
    labels: [DOCUMENT_LABEL],
  };
  if (closed) body.state_reason = "not_planned";
  await gh(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }, env);
}
