import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  buildCiFailureContent,
  extractCurrentRunnerTestName,
  extractCurrentRunnerTestNameFromArchive,
  fetchFailureDetails,
  notifyCiFailure
} from "./discordPrNotification.mjs";

const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

const zip = (name, text) => {
  const body = Buffer.from(text);
  const compressed = deflateRawSync(body);
  const filename = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
};

const failureEvent = {
  workflow_run: {
    event: "pull_request",
    conclusion: "failure",
    id: 123,
    head_sha: "a".repeat(40),
    run_attempt: 2,
    html_url: "https://github.com/sayosomi/nuinuiCAD/actions/runs/123",
    pull_requests: [{ number: 99 }]
  }
};

test("extracts only the reporters used by the current CI runners", () => {
  assert.equal(extractCurrentRunnerTestName(" × computes a sleeve curve 12ms"), "computes a sleeve curve");
  assert.equal(extractCurrentRunnerTestName("not ok 4 - classifies workflow files"), "classifies workflow files");
  assert.equal(extractCurrentRunnerTestName("test evaluator::rejects_nan ... FAILED"), "evaluator::rejects_nan");
  assert.equal(extractCurrentRunnerTestName("unrelated failure prose"), null);
  assert.equal(extractCurrentRunnerTestNameFromArchive(zip("job.txt", "not ok 1 - narrow failure")), "narrow failure");
});

test("uses a failed non-aggregate job and a test hint when Actions APIs are available", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes("/pulls/99")) return response(JSON.stringify({ title: "Focused notification test" }));
    if (url.includes("/runs/123/jobs")) return response(JSON.stringify({ jobs: [
      { id: 7, name: "Node", conclusion: "failure", steps: [{ name: "Changed Node tests", conclusion: "failure" }] },
      { id: 8, name: "CI", conclusion: "failure", steps: [{ name: "Check required CI results", conclusion: "failure" }] }
    ] }));
    if (url.includes("/jobs/7/logs")) return response(zip("job.txt", " × reports failed fixture 4ms"));
    throw new Error(`unexpected ${url}`);
  };
  const details = await fetchFailureDetails({ repository: "sayosomi/nuinuiCAD", runId: 123, prNumber: 99, token: "token", fetchImpl });
  assert.deepEqual(details, { title: "Focused notification test", job: "Node", step: "Changed Node tests", testName: "reports failed fixture" });
  assert.equal(requests.length, 3);
});

test("analysis failures leave required fields unavailable but still send Discord", async () => {
  const posts = [];
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://discord.example/webhook") {
      posts.push(JSON.parse(options.body));
      return response(null, { status: 204 });
    }
    throw new Error("GitHub API unavailable");
  };
  await notifyCiFailure({
    event: failureEvent,
    environment: { GITHUB_REPOSITORY: "sayosomi/nuinuiCAD", GITHUB_TOKEN: "token", DISCORD_WEBHOOK_URL: "https://discord.example/webhook" },
    fetchImpl
  });
  assert.match(posts[0].content, /PR #99/);
  assert.match(posts[0].content, /head SHA: a{40}/);
  assert.match(posts[0].content, /run attempt: 2/);
  assert.match(posts[0].content, /failed job: unavailable/);
  assert.match(posts[0].content, /failed step: unavailable/);
});

test("formats all required CI failure evidence", () => {
  const content = buildCiFailureContent({
    repository: "sayosomi/nuinuiCAD",
    prNumber: 99,
    details: { title: "Focused notification test", job: "Node", step: "Changed Node tests", testName: "reports failed fixture" },
    run: failureEvent.workflow_run
  });
  for (const expected of ["PR #99", "Focused notification test", "head SHA:", "CI failure", "run attempt: 2", "Actions run:", "failed job: Node", "failed step: Changed Node tests", "failed test: reports failed fixture"]) {
    assert.match(content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
