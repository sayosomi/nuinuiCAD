import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const UNAVAILABLE = "unavailable";

const nonSuccessConclusion = (conclusion) =>
  typeof conclusion === "string" && conclusion !== "success";

const failureConclusion = (conclusion) =>
  ["failure", "cancelled", "timed_out", "action_required"].includes(conclusion);

const asText = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : UNAVAILABLE;

const apiUrl = (repository, path) =>
  `https://api.github.com/repos/${repository}${path}`;

export const extractCurrentRunnerTestName = (logText) => {
  if (typeof logText !== "string") return null;
  const normalized = logText.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");

  // These are the three test reporters used by ci.yml. Keep this deliberately
  // narrow: it is a notification hint, not a general Actions-log parser.
  const vitestFailure = normalized.match(/^\s*FAIL\s+.+?\s+>\s+.+?\s+>\s+(.+?)\s*$/m);
  if (vitestFailure) return vitestFailure[1].trim();

  const vitest = normalized.match(/^\s*×\s+(.+?)(?:\s+\d+ms)?\s*$/m);
  if (vitest) return vitest[1].trim();

  const nodeTest = normalized.match(/^\s*not ok \d+ - (.+?)\s*$/m);
  if (nodeTest) return nodeTest[1].trim();

  const cargoTest = normalized.match(/^test (.+?) \.\.\. FAILED\s*$/m);
  if (cargoTest) return cargoTest[1].trim();

  return null;
};

const readZipEntries = (archive) => {
  const endSignature = 0x06054b50;
  const directorySignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let end = -1;

  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index -= 1) {
    if (archive.readUInt32LE(index) === endSignature) {
      end = index;
      break;
    }
  }
  if (end < 0) return [];

  const entryCount = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== directorySignature) break;
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== localSignature) continue;
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const endOffset = start + compressedSize;
    if (endOffset > archive.length) continue;

    try {
      const compressed = archive.subarray(start, endOffset);
      const body = compression === 0
        ? compressed
        : compression === 8
          ? inflateRawSync(compressed)
          : null;
      if (body) entries.push({ name, text: body.toString("utf8") });
    } catch {
      // One malformed log entry must not prevent the Discord notification.
    }
  }

  return entries;
};

export const extractCurrentRunnerTestNameFromArchive = (archive) => {
  if (!Buffer.isBuffer(archive) || archive.length > MAX_LOG_BYTES) return null;
  for (const entry of readZipEntries(archive)) {
    const testName = extractCurrentRunnerTestName(entry.text);
    if (testName) return testName;
  }
  return null;
};

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

const bestEffort = async (callback) => {
  try {
    return await callback();
  } catch {
    return null;
  }
};

const selectFailedJob = (jobs) => {
  const failed = jobs.filter((job) => failureConclusion(job.conclusion));
  return failed.find((job) => job.name !== "CI") ?? failed[0] ?? null;
};

const selectFailedStep = (job) =>
  job?.steps?.find((step) => failureConclusion(step.conclusion)) ?? null;

export const fetchFailureDetails = async ({ repository, runId, prNumber, token, fetchImpl = fetch }) => {
  const fallback = { title: UNAVAILABLE, job: UNAVAILABLE, step: UNAVAILABLE, testName: null };
  if (!token || !repository || !runId || !prNumber) return fallback;

  const [pr, jobsPayload] = await Promise.all([
    bestEffort(async () => (await request(apiUrl(repository, `/pulls/${prNumber}`), token, fetchImpl)).json()),
    bestEffort(async () => (await request(apiUrl(repository, `/actions/runs/${runId}/jobs?per_page=100`), token, fetchImpl)).json())
  ]);
  const job = selectFailedJob(Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : []);
  const step = selectFailedStep(job);
  const details = {
    title: asText(pr?.title),
    job: asText(job?.name),
    step: asText(step?.name),
    testName: null
  };

  if (!job || !step || !/test|tests|parity|stress/i.test(step.name ?? "")) return details;
  const archive = await bestEffort(async () => {
    const response = await request(apiUrl(repository, `/actions/jobs/${job.id}/logs`), token, fetchImpl);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_LOG_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= MAX_LOG_BYTES ? buffer : null;
  });
  details.testName = extractCurrentRunnerTestNameFromArchive(archive);
  return details;
};

const ciFailureFromEvent = (event) => {
  const run = event?.workflow_run;
  const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  if (run?.event !== "pull_request" || !nonSuccessConclusion(run?.conclusion) || pullRequests.length !== 1) {
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
    `⚠️ [${repository}] CI ${asText(run.conclusion)} — PR #${prNumber}`,
    details.title,
    `head SHA: ${asText(run.head_sha)}`,
    `run attempt: ${asText(run.run_attempt == null ? null : String(run.run_attempt))}`,
    `Actions run: ${asText(run.html_url)}`,
    `failed job: ${details.job}`,
    `failed step: ${details.step}`
  ];
  if (details.testName) lines.push(`failed test: ${details.testName}`);
  return lines.join("\n");
};

export const postDiscord = async ({ webhookUrl, content, fetchImpl = fetch }) => {
  if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is required");
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP status ${response.status}`);
};

export const notifyCiFailure = async ({ event, environment = process.env, fetchImpl = fetch }) => {
  const { run, pullRequest } = ciFailureFromEvent(event);
  const repository = environment.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  const details = await fetchFailureDetails({
    repository,
    runId: run.id,
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
  const repository = asText(environment.REPOSITORY_NAME);
  const number = asText(environment.PR_NUMBER);
  const title = asText(environment.PR_TITLE);
  const url = asText(environment.PR_URL);
  await postDiscord({
    webhookUrl: environment.DISCORD_WEBHOOK_URL,
    content: `✅ [${repository}] PR #${number} merged\n${title}\n${url}`,
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
