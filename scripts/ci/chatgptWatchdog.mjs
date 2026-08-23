import { pathToFileURL } from "node:url";

export const WATCHDOG_MARKER = "chatgpt-watchdog:v1";
export const WATCHDOG_ISSUE_NUMBER = 514;
export const WATCHDOG_TIMEOUT_MS = 15 * 60 * 1000;

const WATCHDOG_STATES = new Set(["active", "timed_out", "done"]);
const MARKER_PREFIX = `<!-- ${WATCHDOG_MARKER}\n`;
const MARKER_SUFFIX = "\n-->";

const requireNonEmptyString = (value, field) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Watchdog field ${field} must be a non-empty string`);
  }
  return value;
};

const requireIsoTimestamp = (value, field) => {
  requireNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Watchdog field ${field} must be an ISO-8601 timestamp`);
  }
  return value;
};

const toEpochMs = (value, field) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} must be a valid date/time`);
  }
  return timestamp;
};

export const validateWatchdogRecord = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Watchdog payload must be a JSON object");
  }

  const marker = requireNonEmptyString(input.marker, "marker");
  if (marker !== WATCHDOG_MARKER) {
    throw new Error(`Unsupported watchdog marker: ${marker}`);
  }

  const state = requireNonEmptyString(input.state, "state");
  if (!WATCHDOG_STATES.has(state)) {
    throw new Error(`Unsupported watchdog state: ${state}`);
  }

  const record = {
    marker,
    linear_issue: requireNonEmptyString(input.linear_issue, "linear_issue"),
    title: requireNonEmptyString(input.title, "title"),
    url: requireNonEmptyString(input.url, "url"),
    state,
    started_at: requireIsoTimestamp(input.started_at, "started_at"),
    heartbeat_at: requireIsoTimestamp(input.heartbeat_at, "heartbeat_at")
  };

  if (input.timed_out_at !== undefined && input.timed_out_at !== null) {
    record.timed_out_at = requireIsoTimestamp(input.timed_out_at, "timed_out_at");
  }

  if (state === "timed_out" && !record.timed_out_at) {
    throw new Error("timed_out watchdog records require timed_out_at");
  }

  return record;
};

export const parseWatchdogComment = (body) => {
  if (typeof body !== "string" || !body.includes(WATCHDOG_MARKER)) {
    return null;
  }

  const start = body.indexOf(MARKER_PREFIX);
  if (start < 0) {
    throw new Error("Watchdog marker is present but the record header is malformed");
  }

  const payloadStart = start + MARKER_PREFIX.length;
  const end = body.indexOf(MARKER_SUFFIX, payloadStart);
  if (end < 0) {
    throw new Error("Watchdog record is missing its closing marker");
  }

  let parsed;
  try {
    parsed = JSON.parse(body.slice(payloadStart, end));
  } catch (error) {
    throw new Error(`Watchdog record contains invalid JSON: ${error.message}`);
  }

  return validateWatchdogRecord(parsed);
};

export const formatWatchdogComment = (input) => {
  const record = validateWatchdogRecord(input);
  const timedOutLine = record.timed_out_at
    ? `\nTimed out: \`${record.timed_out_at}\``
    : "";

  return `${MARKER_PREFIX}${JSON.stringify(record)}${MARKER_SUFFIX}\nChatGPT watchdog: \`${record.linear_issue}\` — **${record.state}**\nLast heartbeat: \`${record.heartbeat_at}\`${timedOutLine}\nLinear: ${record.url}`;
};

export const startWatchdogRecord = ({ linearIssue, title, url }, at) => {
  const timestamp = new Date(toEpochMs(at, "start time")).toISOString();
  return validateWatchdogRecord({
    marker: WATCHDOG_MARKER,
    linear_issue: linearIssue,
    title,
    url,
    state: "active",
    started_at: timestamp,
    heartbeat_at: timestamp
  });
};

export const heartbeatWatchdogRecord = (input, at) => {
  const record = validateWatchdogRecord(input);
  const timestamp = new Date(toEpochMs(at, "heartbeat time")).toISOString();
  const { timed_out_at: _timedOutAt, ...withoutTimeout } = record;
  return validateWatchdogRecord({
    ...withoutTimeout,
    state: "active",
    heartbeat_at: timestamp
  });
};

export const doneWatchdogRecord = (input, at) => {
  const record = heartbeatWatchdogRecord(input, at);
  return validateWatchdogRecord({ ...record, state: "done" });
};

export const timedOutWatchdogRecord = (input, at) => {
  const record = validateWatchdogRecord(input);
  const timestamp = new Date(toEpochMs(at, "timeout time")).toISOString();
  return validateWatchdogRecord({
    ...record,
    state: "timed_out",
    timed_out_at: timestamp
  });
};

export const isWatchdogExpired = (
  input,
  now,
  timeoutMs = WATCHDOG_TIMEOUT_MS
) => {
  const record = validateWatchdogRecord(input);
  if (record.state !== "active") {
    return false;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number");
  }
  const nowMs = toEpochMs(now, "current time");
  return nowMs - Date.parse(record.heartbeat_at) >= timeoutMs;
};

export const planWatchdogRun = (
  comments,
  now,
  timeoutMs = WATCHDOG_TIMEOUT_MS,
  allowedAuthor = null
) => {
  const nowMs = toEpochMs(now, "current time");
  const decisions = [];
  const malformed = [];

  for (const comment of comments) {
    if (!comment || typeof comment.body !== "string") {
      continue;
    }

    if (allowedAuthor && comment.user?.login !== allowedAuthor) {
      continue;
    }

    let record;
    try {
      record = parseWatchdogComment(comment.body);
    } catch (error) {
      malformed.push({
        commentId: comment.id ?? null,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (!record || !isWatchdogExpired(record, nowMs, timeoutMs)) {
      continue;
    }

    decisions.push({
      commentId: comment.id,
      record,
      updatedRecord: timedOutWatchdogRecord(record, nowMs)
    });
  }

  return { decisions, malformed };
};

const githubRequest = async ({ apiUrl, token, path, method = "GET", body }) => {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub API ${method} ${path} failed with ${response.status}: ${detail}`
    );
  }

  return response;
};

const listIssueComments = async ({ apiUrl, token, repository, issueNumber }) => {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const response = await githubRequest({
      apiUrl,
      token,
      path: `/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`
    });
    const batch = await response.json();
    if (!Array.isArray(batch)) {
      throw new Error("GitHub issue-comments response was not an array");
    }
    comments.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return comments;
};

const sendDiscordTimeout = async ({ webhookUrl, repository, record }) => {
  const content = [
    `⚠️ [${repository}] ChatGPT watchdog timeout`,
    `${record.linear_issue} — ${record.title}`,
    `Last heartbeat: ${record.heartbeat_at}`,
    record.url
  ].join("\n");

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord webhook failed with ${response.status}: ${detail}`);
  }
};

const updateIssueComment = async ({
  apiUrl,
  token,
  repository,
  commentId,
  record
}) => {
  await githubRequest({
    apiUrl,
    token,
    method: "PATCH",
    path: `/repos/${repository}/issues/comments/${commentId}`,
    body: { body: formatWatchdogComment(record) }
  });
};

export const runRemoteWatchdog = async ({
  token,
  repository,
  webhookUrl,
  issueNumber = WATCHDOG_ISSUE_NUMBER,
  timeoutMs = WATCHDOG_TIMEOUT_MS,
  apiUrl = "https://api.github.com",
  now = Date.now()
}) => {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!repository || !repository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY must be owner/repository");
  }
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is required");
  }

  const comments = await listIssueComments({
    apiUrl,
    token,
    repository,
    issueNumber
  });
  const repositoryOwner = repository.split("/")[0];
  const { decisions, malformed } = planWatchdogRun(
    comments,
    now,
    timeoutMs,
    repositoryOwner
  );

  for (const item of malformed) {
    console.warn(
      `Malformed watchdog record in GitHub comment ${item.commentId ?? "unknown"}: ${item.message}`
    );
  }

  for (const decision of decisions) {
    await sendDiscordTimeout({ webhookUrl, repository, record: decision.record });
    await updateIssueComment({
      apiUrl,
      token,
      repository,
      commentId: decision.commentId,
      record: decision.updatedRecord
    });
    console.log(
      `Timed out ${decision.record.linear_issue}; updated watchdog comment ${decision.commentId}`
    );
  }

  if (decisions.length === 0) {
    console.log("No expired active ChatGPT watchdog records found");
  }

  return { alerted: decisions.length, malformed: malformed.length };
};

const main = async () => {
  const timeoutMinutes = Number(process.env.WATCHDOG_TIMEOUT_MINUTES ?? "15");
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error("WATCHDOG_TIMEOUT_MINUTES must be a positive number");
  }

  await runRemoteWatchdog({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    issueNumber: Number(process.env.WATCHDOG_ISSUE_NUMBER ?? WATCHDOG_ISSUE_NUMBER),
    timeoutMs: timeoutMinutes * 60 * 1000,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com"
  });
};

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (entrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
