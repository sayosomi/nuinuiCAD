import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  MAX_ARTIFACT_BYTES,
  extractStructuredFailureFromArchive,
  reportMappingForFailure
} from "./structuredTestResults.mjs";

const UNAVAILABLE = "unavailable";
const MAX_DISCORD_MESSAGE_LENGTH = 2000;
const DISPLAY_CAPS = Object.freeze({
  repository: 180,
  conclusion: 40,
  prNumber: 32,
  title: 400,
  headSha: 64,
  runAttempt: 32,
  runUrl: 350,
  job: 160,
  step: 160,
  testName: 400
});

const nonSuccessConclusion = (conclusion) =>
  typeof conclusion === "string" && conclusion !== "success";

const failureConclusion = (conclusion) =>
  ["failure", "cancelled", "timed_out", "action_required"].includes(conclusion);

const truncate = (value, maxLength) => {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
};

const normalizeDisplay = (value) => {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
};

const asText = (value, maxLength) => {
  const normalized = normalizeDisplay(value);
  return normalized ? truncate(normalized, maxLength) : UNAVAILABLE;
};

const apiUrl = (repository, path) =>
  `https://api.github.com/repos/${repository}${path}`;

const request = async (url, token, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  return response;
};

const readBoundedResponse = async (response, maxBytes) => {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= maxBytes ? buffer : null;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
};

const bestEffort = async (callback) => {
  try {
    return await callback();
  } catch {
    return null;
  }
};

const selectFailedJob = (jobs) => {
  const failed = jobs.filter((job) => failureConclusion(job?.conclusion));
  return failed.find((job) => job?.name !== "CI") ?? failed[0] ?? null;
};

const selectFailedStep = (job) =>
  (Array.isArray(job?.steps) ? job.steps : []).find((step) => failureConclusion(step?.conclusion)) ?? null;

const artifactNameForJob = (jobName, runAttempt) => {
  if (!Number.isSafeInteger(runAttempt) || runAttempt <= 0) return null;
  const artifactKey = {
    "Classify changes": "classification",
    Node: "node",
    "Rust + parity": "rust-parity"
  }[jobName];
  return artifactKey ? `nuinuicad-ci-test-results-${artifactKey}-attempt-${runAttempt}` : null;
};

export const fetchFailureDetails = async ({ repository, runId, runAttempt, prNumber, token, fetchImpl = fetch }) => {
  const fallback = { title: UNAVAILABLE, job: UNAVAILABLE, step: UNAVAILABLE, testName: null };
  if (
    !token ||
    !repository ||
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt <= 0 ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0
  ) {
    return fallback;
  }

  const [pr, jobsPayload] = await Promise.all([
    bestEffort(async () => (await request(apiUrl(repository, `/pulls/${prNumber}`), token, fetchImpl)).json()),
    bestEffort(async () => (await request(apiUrl(repository, `/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`), token, fetchImpl)).json())
  ]);
  const job = selectFailedJob(Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []);
  const step = selectFailedStep(job);
  const details = {
    title: asText(pr?.title, DISPLAY_CAPS.title),
    job: asText(job?.name, DISPLAY_CAPS.job),
    step: asText(step?.name, DISPLAY_CAPS.step),
    testName: null
  };

  const reportSpec = reportMappingForFailure(job?.name, step?.name);
  const artifactName = artifactNameForJob(job?.name, runAttempt);
  if (!reportSpec || !artifactName) return details;

  const archive = await bestEffort(async () => {
    const artifactsPayload = await (await request(
      apiUrl(repository, `/actions/runs/${runId}/artifacts?per_page=100`),
      token,
      fetchImpl
    )).json();
    const matchingArtifacts = (Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [])
      .filter((artifact) => artifact?.name === artifactName);
    if (matchingArtifacts.length !== 1 || matchingArtifacts[0]?.expired === true) return null;

    const artifactId = matchingArtifacts[0]?.id;
    if (!Number.isSafeInteger(artifactId) || artifactId <= 0) return null;
    const response = await request(apiUrl(repository, `/actions/artifacts/${artifactId}/zip`), token, fetchImpl);
    return readBoundedResponse(response, MAX_ARTIFACT_BYTES);
  });
  details.testName = extractStructuredFailureFromArchive(archive, reportSpec);
  return details;
};

const ciFailureFromEvent = (event) => {
  const run = event?.workflow_run;
  if (run?.event !== "pull_request" || !nonSuccessConclusion(run?.conclusion) || !Array.isArray(run?.pull_requests)) {
    throw new Error("Expected one non-success pull_request workflow_run event");
  }
  const pullRequests = run.pull_requests;
  if (pullRequests.length === 0) return { run, pullRequest: null };
  if (pullRequests.length !== 1) {
    throw new Error("Expected one non-success pull_request workflow_run event");
  }
  const pullRequest = pullRequests[0];
  if (!Number.isInteger(pullRequest?.number) || !/^[0-9a-f]{40}$/i.test(run?.head_sha ?? "")) {
    throw new Error("workflow_run event does not identify a pull request and head SHA safely");
  }
  return { run, pullRequest };
};

export const buildCiFailureContent = ({ repository, prNumber, details, run }) => {
  const lines = [
    `⚠️ [${asText(repository, DISPLAY_CAPS.repository)}] CI ${asText(run?.conclusion, DISPLAY_CAPS.conclusion)} — PR #${asText(prNumber, DISPLAY_CAPS.prNumber)}`,
    asText(details?.title, DISPLAY_CAPS.title),
    `head SHA: ${asText(run?.head_sha, DISPLAY_CAPS.headSha)}`,
    `run attempt: ${asText(run?.run_attempt, DISPLAY_CAPS.runAttempt)}`,
    `Actions run: ${asText(run?.html_url, DISPLAY_CAPS.runUrl)}`,
    `failed job: ${asText(details?.job, DISPLAY_CAPS.job)}`,
    `failed step: ${asText(details?.step, DISPLAY_CAPS.step)}`
  ];
  const testName = asText(details?.testName, DISPLAY_CAPS.testName);
  if (testName !== UNAVAILABLE) lines.push(`failed test: ${testName}`);
  return truncate(lines.join("\n"), MAX_DISCORD_MESSAGE_LENGTH);
};

export const postDiscord = async ({ webhookUrl, content, fetchImpl = fetch }) => {
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is required");
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP status ${response.status}`);
};

export const notifyCiFailure = async ({ event, environment = process.env, fetchImpl = fetch }) => {
  const { run, pullRequest } = ciFailureFromEvent(event);
  if (!pullRequest) return;
  const repository = environment.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  const details = await fetchFailureDetails({
    repository,
    runId: run.id,
    runAttempt: run.run_attempt,
    prNumber: pullRequest.number,
    token: environment.GITHUB_TOKEN,
    fetchImpl
  });
  await postDiscord({
    webhookUrl: environment.DISCORD_WEBHOOK_URL,
    content: buildCiFailureContent({ repository, prNumber: pullRequest.number, details, run }),
    fetchImpl
  });
};

export const notifyMergedPullRequest = async ({ environment = process.env, fetchImpl = fetch }) => {
  const repository = asText(environment.REPOSITORY_NAME, DISPLAY_CAPS.repository);
  const number = asText(environment.PR_NUMBER, DISPLAY_CAPS.prNumber);
  const title = asText(environment.PR_TITLE, DISPLAY_CAPS.title);
  const url = asText(environment.PR_URL, DISPLAY_CAPS.runUrl);
  await postDiscord({
    webhookUrl: environment.DISCORD_WEBHOOK_URL,
    content: truncate(`✅ [${repository}] PR #${number} merged\n${title}\n${url}`, MAX_DISCORD_MESSAGE_LENGTH),
    fetchImpl
  });
};

const main = async () => {
  const mode = process.argv[2];
  if (mode === "merge") return notifyMergedPullRequest({});
  if (mode === "ci-failure") {
    if (!process.env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is required");
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    return notifyCiFailure({ event });
  }
  throw new Error("Usage: discordPrNotification.mjs <merge|ci-failure>");
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
