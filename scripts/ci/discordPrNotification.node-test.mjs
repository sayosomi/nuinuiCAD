import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  buildMainPushContent,
  buildPullRequestLifecycleContent,
  buildCiFailureContent,
  fetchFailureDetails,
  notifyCiFailure,
  notifyMainPush,
  notifyMergedPullRequest,
  notifyPullRequestLifecycle
} from "./discordPrNotification.mjs";
import {
  MAX_ARTIFACT_BYTES,
  MAX_REPORT_BYTES,
  MAX_REPORT_TOTAL_BYTES,
  extractFailedTestFromJUnit,
  extractStructuredFailureFromArchive,
  reportMappingForFailure
} from "./structuredTestResults.mjs";

const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

const zip = (entries) => {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    const body = Buffer.from(entry.text ?? "");
    const compression = entry.compression ?? 8;
    const compressed = entry.compressed ?? (compression === 0 ? body : deflateRawSync(body));
    const name = Buffer.from(entry.name);
    const flags = entry.flags ?? 0;
    const compressedSize = entry.compressedSize ?? compressed.length;
    const uncompressedSize = entry.uncompressedSize ?? body.length;
    const hasDataDescriptor = (flags & 0x0008) !== 0;
    const descriptorSignature = entry.descriptorSignature ?? true;
    const descriptorCompressedSize = entry.descriptorCompressedSize ?? compressedSize;
    const descriptorUncompressedSize = entry.descriptorUncompressedSize ?? uncompressedSize;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compression, 8);
    local.writeUInt32LE(entry.localCompressedSize ?? (hasDataDescriptor ? 0 : compressedSize), 18);
    local.writeUInt32LE(entry.localUncompressedSize ?? (hasDataDescriptor ? 0 : uncompressedSize), 22);
    local.writeUInt16LE(name.length, 26);
    const descriptor = hasDataDescriptor
      ? (() => {
          const body = Buffer.alloc(descriptorSignature ? 16 : 12);
          let offset = 0;
          if (descriptorSignature) {
            body.writeUInt32LE(entry.descriptorSignatureValue ?? 0x08074b50, offset);
            offset += 4;
          }
          body.writeUInt32LE(0, offset);
          body.writeUInt32LE(descriptorCompressedSize, offset + 4);
          body.writeUInt32LE(descriptorUncompressedSize, offset + 8);
          return body;
        })()
      : Buffer.alloc(0);
    localRecords.push(Buffer.concat([local, name, compressed, descriptor]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compression, 10);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([central, name]));
    localOffset += localRecords.at(-1).length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
};

const junit = (body) => zip([{ name: "node-changed.xml", text: body }]);

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

const fetchForNodeChanged = ({ archive = junit('<testsuites><testcase name="failed"><failure /></testcase></testsuites>'), artifacts = [{ id: 456, name: "nuinuicad-ci-test-results-node-attempt-2" }], extra = {} } = {}) => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes("/pulls/99")) return response(JSON.stringify({ title: "Focused notification test" }));
    if (url.includes("/runs/123/attempts/2/jobs")) return response(JSON.stringify({ jobs: [
      { id: 7, name: "Node", conclusion: "failure", steps: [
        { name: "Install optional dependency", conclusion: "skipped" },
        { name: "Changed Node tests", conclusion: "failure" }
      ] }
    ] }));
    if (url.includes("/runs/123/artifacts")) return response(JSON.stringify({ artifacts }));
    if (url.includes("/actions/artifacts/456/zip")) return response(archive);
    if (extra[url]) return extra[url];
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, requests };
};

const mainPushEvent = {
  ref: "refs/heads/main",
  before: "a".repeat(40),
  after: "b".repeat(40),
  repository: { pushed_at: "2025-01-02T00:00:00Z" }
};

const mainPushEnvironment = {
  GITHUB_REPOSITORY: "sayosomi/nuinuiCAD",
  GITHUB_TOKEN: "token",
  DISCORD_WEBHOOK_URL: "https://discord.example/webhook"
};

const headShaForNumber = (number) => number.toString(16).padStart(2, "0").repeat(20);

const makePullRequest = ({ number, headSha = headShaForNumber(number), title = `PR ${number}`, createdAt = "2025-01-01T00:00:00Z", draft = false, state = "open", baseRef = "main" }) => ({
  number,
  title,
  html_url: `https://github.com/sayosomi/nuinuiCAD/pull/${number}`,
  created_at: createdAt,
  draft,
  state,
  base: { ref: baseRef },
  head: { sha: headSha }
});

const compareKey = (mainSha, headSha) => `${mainSha}...${headSha}`;

const fetchForMainPush = ({ pages = [[]], compares = {}, listStatus = 200, compareStatus = 200 } = {}) => {
  const requests = [];
  const posts = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === mainPushEnvironment.DISCORD_WEBHOOK_URL) {
      posts.push(JSON.parse(options.body));
      return response(null, { status: 204 });
    }

    const parsedUrl = new URL(url);
    if (parsedUrl.pathname.endsWith("/pulls")) {
      if (listStatus !== 200) return response(null, { status: listStatus });
      const page = Number(parsedUrl.searchParams.get("page"));
      const payload = pages[page - 1] ?? [];
      const headers = {};
      if (page < pages.length) {
        parsedUrl.searchParams.set("page", String(page + 1));
        headers.link = `<${parsedUrl}>; rel="next"`;
      }
      return response(JSON.stringify(payload), { headers });
    }

    const match = parsedUrl.pathname.match(/\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/iu);
    if (match) {
      if (compareStatus !== 200) return response(null, { status: compareStatus });
      const key = compareKey(match[1], match[2]);
      if (!Object.hasOwn(compares, key)) throw new Error(`unexpected compare ${key}`);
      return response(JSON.stringify({ behind_by: compares[key] }));
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, posts, requests };
};

const lifecycleEnvironment = {
  ...mainPushEnvironment,
  GITHUB_SHA: "c".repeat(40)
};

const lifecycleEvent = ({ action = "opened", pullRequest = makePullRequest({ number: 201 }) } = {}) => ({
  action,
  pull_request: pullRequest
});

const fetchForLifecycle = ({ behindBy = 1, compareStatus = 200 } = {}) => {
  const requests = [];
  const posts = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === lifecycleEnvironment.DISCORD_WEBHOOK_URL) {
      posts.push(JSON.parse(options.body));
      return response(null, { status: 204 });
    }

    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(/\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/iu);
    if (match) {
      if (compareStatus !== 200) return response(null, { status: compareStatus });
      return response(JSON.stringify({ behind_by: behindBy }));
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, posts, requests };
};

test("uses exact job and step mapping for structured reports", () => {
  assert.deepEqual(reportMappingForFailure("Node", "Changed Node tests"), {
    reportNames: ["node-changed.xml"],
    runner: "vitest"
  });
  assert.deepEqual(reportMappingForFailure("Classify changes", "Test change classifier"), {
    reportNames: ["classification-change-classifier.xml"],
    runner: "node"
  });
  assert.equal(reportMappingForFailure("Node", "Build"), null);
  assert.equal(reportMappingForFailure("CI", "Check required CI results"), null);
});

test("extracts the first failed Node testcase with its enclosing suite identifier", () => {
  const text = [
    "<testsuites>",
    "  <testcase name=\"passed\" />",
    "  <testsuite name=\"node:test suite\">",
    "    <testcase name=\"first failing test\"><failure /></testcase>",
    "    <testcase name=\"later failing test\"><error /></testcase>",
    "  </testsuite>",
    "</testsuites>"
  ].join("\n");
  assert.equal(extractFailedTestFromJUnit(text, "node"), "node:test suite > first failing test");
});

test("extracts a Vitest classname/file and full test name", () => {
  const text = [
    "<testsuites>",
    "  <testsuite name=\"vitest\">",
    "    <testcase classname=\"src/commands/rename.test.ts\" file=\"ignored-file.ts\" name=\"rename suite &gt; reports the failure &amp; keeps order\">",
    "      <failure type=\"AssertionError\" />",
    "    </testcase>",
    "  </testsuite>",
    "</testsuites>"
  ].join("\n");
  assert.equal(
    extractFailedTestFromJUnit(text, "vitest"),
    "src/commands/rename.test.ts > rename suite > reports the failure & keeps order"
  );
});

test("extracts a nextest Rust testcase and suite identifier", () => {
  const text = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<testsuites><testsuite name=\"nuinuicad_rust_evaluator::evaluation\">",
    "<testcase name=\"rejects_nan\"><error>panic</error></testcase>",
    "</testsuite></testsuites>"
  ].join("");
  const archive = zip([{ name: "rust-evaluator.xml", text }]);
  assert.equal(
    extractStructuredFailureFromArchive(archive, reportMappingForFailure("Rust + parity", "Test evaluator crate")),
    "nuinuicad_rust_evaluator::evaluation > rejects_nan"
  );
});

test("orders lifecycle stress reports numerically", () => {
  const report = (name) => `<testsuites><testsuite name="iteration"><testcase name="${name}"><failure /></testcase></testsuite></testsuites>`;
  const archive = zip([
    { name: "lifecycle-stress-10.xml", text: report("iteration ten") },
    { name: "lifecycle-stress-2.xml", text: report("iteration two") },
    { name: "lifecycle-stress-1.xml", text: "<testsuites />" }
  ]);
  assert.equal(
    extractStructuredFailureFromArchive(archive, reportMappingForFailure("Rust + parity", "Lifecycle stress tests")),
    "iteration two"
  );
});

test("selects only the current run-attempt artifact and never requests job logs", async () => {
  const { fetchImpl, requests } = fetchForNodeChanged({
    archive: junit('<testsuites><testcase name="current attempt failure"><failure /></testcase></testsuites>'),
    artifacts: [
      { id: 111, name: "nuinuicad-ci-test-results-node-attempt-1" },
      { id: 456, name: "nuinuicad-ci-test-results-node-attempt-2" }
    ]
  });
  const details = await fetchFailureDetails({
    repository: "sayosomi/nuinuiCAD",
    runId: 123,
    runAttempt: 2,
    prNumber: 99,
    token: "token",
    fetchImpl
  });
  assert.deepEqual(details, {
    title: "Focused notification test",
    job: "Node",
    step: "Changed Node tests",
    testName: "current attempt failure"
  });
  assert.ok(requests.some((url) => url.endsWith("/actions/runs/123/artifacts?per_page=100")));
  assert.ok(requests.some((url) => url.endsWith("/actions/runs/123/attempts/2/jobs?per_page=100")));
  assert.ok(!requests.some((url) => url.endsWith("/actions/runs/123/jobs?per_page=100")));
  assert.ok(requests.some((url) => url.endsWith("/actions/artifacts/456/zip")));
  assert.ok(!requests.some((url) => url.includes("/actions/jobs/") && url.endsWith("/logs")));
});

test("reads a mapped report from a multi-entry descriptor-bearing ZIP", () => {
  const archive = zip([
    {
      name: "unrelated-first.txt",
      text: "preceding entry",
      flags: 0x0008
    },
    {
      name: "node-changed.xml",
      text: '<testsuites><testcase name="descriptor failure"><failure /></testcase></testsuites>',
      flags: 0x0008
    },
    {
      name: "unrelated-last.txt",
      text: "following entry",
      flags: 0x0008
    }
  ]);
  assert.equal(
    extractStructuredFailureFromArchive(archive, reportMappingForFailure("Node", "Changed Node tests")),
    "descriptor failure"
  );
});

test("rejects inconsistent data descriptors", () => {
  const mapping = reportMappingForFailure("Node", "Changed Node tests");
  assert.equal(
    extractStructuredFailureFromArchive(
      zip([{
        name: "node-changed.xml",
        text: '<testsuites><testcase name="bad size"><failure /></testcase></testsuites>',
        flags: 0x0008,
        descriptorCompressedSize: 1
      }]),
      mapping
    ),
    null
  );
  assert.equal(
    extractStructuredFailureFromArchive(
      zip([{
        name: "node-changed.xml",
        text: '<testsuites><testcase name="bad signature"><failure /></testcase></testsuites>',
        flags: 0x0008,
        descriptorSignatureValue: 0x12345678
      }]),
      mapping
    ),
    null
  );
});

test("stale-attempt and missing artifacts fall back without downloading", async () => {
  for (const artifacts of [
    [{ id: 111, name: "nuinuicad-ci-test-results-node-attempt-1" }],
    []
  ]) {
    const { fetchImpl, requests } = fetchForNodeChanged({ artifacts });
    const details = await fetchFailureDetails({
      repository: "sayosomi/nuinuiCAD",
      runId: 123,
      runAttempt: 2,
      prNumber: 99,
      token: "token",
      fetchImpl
    });
    assert.equal(details.testName, null);
    assert.ok(!requests.some((url) => url.includes("/actions/artifacts/")));
  }
});

test("GitHub API failures fall back to base metadata", async () => {
  const details = await fetchFailureDetails({
    repository: "sayosomi/nuinuiCAD",
    runId: 123,
    runAttempt: 2,
    prNumber: 99,
    token: "token",
    fetchImpl: async () => { throw new Error("GitHub unavailable"); }
  });
  assert.deepEqual(details, { title: "unavailable", job: "unavailable", step: "unavailable", testName: null });
});

test("malformed ZIP, unsupported compression, and malformed XML fall back", () => {
  const mapping = reportMappingForFailure("Node", "Changed Node tests");
  assert.equal(extractStructuredFailureFromArchive(Buffer.from("not a zip"), mapping), null);
  assert.equal(extractStructuredFailureFromArchive(zip([{ name: "node-changed.xml", compression: 99, text: "<testsuites />" }]), mapping), null);
  assert.equal(extractStructuredFailureFromArchive(junit("<testsuites><testcase"), mapping), null);
  assert.equal(extractStructuredFailureFromArchive(junit("<junit><testcase name=\"drift\"><failure /></testcase></junit>"), mapping), null);
});

test("DOCTYPE and ENTITY declarations remain inert and do not expand", () => {
  const report = '<!DOCTYPE testsuites [<!ENTITY secret "should never appear">]><testsuites><testcase name="&secret;"><failure /></testcase></testsuites>';
  assert.equal(extractStructuredFailureFromArchive(junit(report), reportMappingForFailure("Node", "Changed Node tests")), null);
});

test("unexpected and traversal ZIP entries are ignored", () => {
  const archive = zip([
    { name: "../node-changed.xml", text: "<testsuites><testcase name=\"untrusted\"><failure /></testcase></testsuites>" },
    { name: "raw.log", text: "not structured test output" },
    { name: "node-changed.xml", text: "<testsuites><testcase name=\"trusted\"><failure /></testcase></testsuites>" }
  ]);
  assert.equal(
    extractStructuredFailureFromArchive(archive, reportMappingForFailure("Node", "Changed Node tests")),
    "trusted"
  );
});

test("rejects oversized artifact, report, and aggregate sizes", () => {
  const mapping = reportMappingForFailure("Node", "Changed Node tests");
  assert.equal(extractStructuredFailureFromArchive(Buffer.alloc(MAX_ARTIFACT_BYTES + 1), mapping), null);

  const oversizedReport = "<testsuites>" + "x".repeat(MAX_REPORT_BYTES) + "</testsuites>";
  assert.equal(extractStructuredFailureFromArchive(junit(oversizedReport), mapping), null);

  const lifecycleMapping = reportMappingForFailure("Rust + parity", "Lifecycle stress tests");
  const aggregateArchive = zip(Array.from({ length: 5 }, (_, index) => ({
    name: `lifecycle-stress-${index + 1}.xml`,
    text: "x".repeat(Math.floor(MAX_REPORT_TOTAL_BYTES / 5) + 1)
  })));
  assert.equal(extractStructuredFailureFromArchive(aggregateArchive, lifecycleMapping), null);
});

test("rejects ZIP entry-count and size-metadata violations", () => {
  const mapping = reportMappingForFailure("Node", "Changed Node tests");
  const tooManyEntries = zip(Array.from({ length: 33 }, (_, index) => ({
    name: `unrelated-${index}.txt`,
    text: "ignored"
  })));
  assert.equal(extractStructuredFailureFromArchive(tooManyEntries, mapping), null);

  const inconsistentSizes = zip([{ name: "node-changed.xml", text: "<testsuites />" }]);
  inconsistentSizes.writeUInt32LE(999, 18);
  assert.equal(extractStructuredFailureFromArchive(inconsistentSizes, mapping), null);
});

test("rejects decompression-bomb metadata instead of trusting declared size", () => {
  const body = "x".repeat(MAX_REPORT_BYTES + 1);
  const archive = zip([{
    name: "node-changed.xml",
    text: body,
    uncompressedSize: 1,
    localUncompressedSize: 1
  }]);
  assert.equal(extractStructuredFailureFromArchive(archive, reportMappingForFailure("Node", "Changed Node tests")), null);
});

test("Discord content is bounded, normalized, and suppresses mentions", async () => {
  const content = buildCiFailureContent({
    repository: "sayosomi/nuinuiCAD",
    prNumber: 99,
    details: {
      title: "title\n".repeat(1000),
      job: "Node\u0000job",
      step: "Changed Node tests",
      testName: "@everyone\n".repeat(1000)
    },
    run: failureEvent.workflow_run
  });
  assert.ok(content.length <= 2000);
  assert.doesNotMatch(content, /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);

  const posts = [];
  await notifyCiFailure({
    event: failureEvent,
    environment: {
      GITHUB_REPOSITORY: "sayosomi/nuinuiCAD",
      GITHUB_TOKEN: "token",
      DISCORD_WEBHOOK_URL: "https://discord.example/webhook"
    },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://discord.example/webhook") {
        posts.push(JSON.parse(options.body));
        return response(null, { status: 204 });
      }
      throw new Error("GitHub unavailable");
    }
  });
  assert.deepEqual(posts[0].allowed_mentions, { parse: [] });
});

test("explicit empty pull_requests remains a successful no-op", async () => {
  let requests = 0;
  await notifyCiFailure({
    event: { workflow_run: { event: "pull_request", conclusion: "failure", pull_requests: [] } },
    environment: {},
    fetchImpl: async () => {
      requests += 1;
      throw new Error("unexpected request");
    }
  });
  assert.equal(requests, 0);
});

test("ambiguous attribution remains fail closed", async () => {
  for (const pullRequests of [undefined, null, { length: 0 }, [{ number: 99 }, { number: 100 }]]) {
    const workflowRun = { ...failureEvent.workflow_run };
    if (pullRequests === undefined) delete workflowRun.pull_requests;
    else workflowRun.pull_requests = pullRequests;
    await assert.rejects(
      notifyCiFailure({ event: { workflow_run: workflowRun }, environment: {}, fetchImpl: async () => { throw new Error("unexpected"); } }),
      /Expected one non-success pull_request workflow_run event/
    );
  }
});

test("a valid Discord webhook failure remains a real error", async () => {
  await assert.rejects(
    notifyCiFailure({
      event: failureEvent,
      environment: {
        GITHUB_REPOSITORY: "sayosomi/nuinuiCAD",
        GITHUB_TOKEN: "token",
        DISCORD_WEBHOOK_URL: "https://discord.example/webhook"
      },
      fetchImpl: async (url) => {
        if (url === "https://discord.example/webhook") return response(null, { status: 500 });
        throw new Error("GitHub unavailable");
      }
    }),
    /Discord webhook returned HTTP status 500/
  );
});

test("the notification helper has no raw Actions-log or console-regex interface", async () => {
  const source = await readFile(new URL("./discordPrNotification.mjs", import.meta.url), "utf8");
  const structuredSource = await readFile(new URL("./structuredTestResults.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /actions\/jobs/);
  assert.doesNotMatch(source, /extractCurrentRunnerTestName/);
  assert.doesNotMatch(source, /not ok|\.\.\. FAILED|FAIL\\s|×/);
  assert.doesNotMatch(structuredSource, /writeFile|writeFileSync|unzip|extractTo/);
});

test("notifies exactly once when a PR becomes behind after the main push", async () => {
  const pullRequest = makePullRequest({ number: 101 });
  const { fetchImpl, posts, requests } = fetchForMainPush({
    pages: [[pullRequest]],
    compares: {
      [compareKey(mainPushEvent.before, pullRequest.head.sha)]: 0,
      [compareKey(mainPushEvent.after, pullRequest.head.sha)]: 1
    }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /PR #101 out of date/u);
  assert.match(posts[0].content, /latest main integration required/u);
  assert.match(posts[0].content, /main SHA: a{40} → b{40}/u);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 2);
});

test("does not notify a PR that was already behind before the main push", async () => {
  const pullRequest = makePullRequest({ number: 102 });
  const { fetchImpl, posts, requests } = fetchForMainPush({
    pages: [[pullRequest]],
    compares: { [compareKey(mainPushEvent.before, pullRequest.head.sha)]: 1 }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 0);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 1);
});

test("does not notify a PR that is still current after the main push", async () => {
  const pullRequest = makePullRequest({ number: 103 });
  const { fetchImpl, posts } = fetchForMainPush({
    pages: [[pullRequest]],
    compares: {
      [compareKey(mainPushEvent.before, pullRequest.head.sha)]: 0,
      [compareKey(mainPushEvent.after, pullRequest.head.sha)]: 0
    }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 0);
});

test("does not compare or notify draft PRs", async () => {
  const pullRequest = makePullRequest({ number: 104, draft: true });
  const { fetchImpl, posts, requests } = fetchForMainPush({ pages: [[pullRequest]] });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 0);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 0);
});

test("notifies only qualifying transitions among multiple PRs", async () => {
  const qualifying = makePullRequest({ number: 105 });
  const alreadyBehind = makePullRequest({ number: 106 });
  const stillCurrent = makePullRequest({ number: 107 });
  const { fetchImpl, posts } = fetchForMainPush({
    pages: [[qualifying, alreadyBehind, stillCurrent]],
    compares: {
      [compareKey(mainPushEvent.before, qualifying.head.sha)]: 0,
      [compareKey(mainPushEvent.after, qualifying.head.sha)]: 2,
      [compareKey(mainPushEvent.before, alreadyBehind.head.sha)]: 1,
      [compareKey(mainPushEvent.before, stillCurrent.head.sha)]: 0,
      [compareKey(mainPushEvent.after, stillCurrent.head.sha)]: 0
    }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /PR #105/u);
  assert.doesNotMatch(posts[0].content, /PR #106|PR #107/u);
});

test("does not notify a PR created after the push-time oracle", async () => {
  const pullRequest = makePullRequest({ number: 108, createdAt: "2025-01-02T00:00:01Z" });
  const { fetchImpl, posts, requests } = fetchForMainPush({ pages: [[pullRequest]] });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 0);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 0);
});

test("uses a strict production-shape numeric pushed_at boundary for PR time filtering", async () => {
  const createdAtPush = makePullRequest({ number: 114, createdAt: "2025-01-02T00:00:00.000Z" });
  const createdBeforePush = makePullRequest({ number: 115, createdAt: "2025-01-01T00:00:00Z" });
  const createdAfterPush = makePullRequest({ number: 116, createdAt: "2025-01-02T00:00:01Z" });
  const numericPushEvent = {
    ...mainPushEvent,
    repository: { pushed_at: 1735776000 }
  };
  const { fetchImpl, posts } = fetchForMainPush({
    pages: [[createdAtPush, createdBeforePush, createdAfterPush]],
    compares: {
      [compareKey(mainPushEvent.before, createdBeforePush.head.sha)]: 0,
      [compareKey(mainPushEvent.after, createdBeforePush.head.sha)]: 1
    }
  });

  await notifyMainPush({ event: numericPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /PR #115/u);
  assert.doesNotMatch(posts[0].content, /PR #114|PR #116/u);
});

test("follows pull request pagination and processes a qualifying PR beyond page one", async () => {
  const pullRequest = makePullRequest({ number: 109 });
  const { fetchImpl, posts, requests } = fetchForMainPush({
    pages: [
      [makePullRequest({ number: 110, draft: true })],
      [pullRequest]
    ],
    compares: {
      [compareKey(mainPushEvent.before, pullRequest.head.sha)]: 0,
      [compareKey(mainPushEvent.after, pullRequest.head.sha)]: 1
    }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /PR #109/u);
  assert.ok(requests.some(({ url }) => url.includes("/pulls?") && url.includes("page=2")));
});

test("sanitizes untrusted display text and keeps Discord mentions disabled", async () => {
  const pullRequest = makePullRequest({ number: 111, title: "@everyone\n<title>\u0000" });
  const { fetchImpl, posts } = fetchForMainPush({
    pages: [[pullRequest]],
    compares: {
      [compareKey(mainPushEvent.before, pullRequest.head.sha)]: 0,
      [compareKey(mainPushEvent.after, pullRequest.head.sha)]: 1
    }
  });

  await notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].allowed_mentions.parse.length, 0);
  assert.doesNotMatch(posts[0].content.split("\n")[1], /[\u0000-\u001f\u007f-\u009f]/u);
  assert.match(posts[0].content, /@everyone <title>/u);
  assert.equal(buildMainPushContent({ repository: "repo", pullRequest, before: mainPushEvent.before, after: mainPushEvent.after }).length <= 2000, true);
});

test("fails safely on malformed push SHAs without making API requests", async () => {
  const requests = [];
  await assert.rejects(
    notifyMainPush({
      event: { ...mainPushEvent, before: "not-a-sha" },
      environment: mainPushEnvironment,
      fetchImpl: async (url) => {
        requests.push(url);
        throw new Error("unexpected request");
      }
    }),
    /valid before and after SHAs/u
  );
  assert.equal(requests.length, 0);
});

test("fails closed when the push-time oracle is malformed or unavailable", async () => {
  for (const pushedAt of [undefined, null, "not-a-time", "2025-02-30T00:00:00Z", {}, NaN, Infinity, -1, 1.5, 8640000000001, Number.MAX_SAFE_INTEGER]) {
    const event = { ...mainPushEvent, repository: { pushed_at: pushedAt } };
    const requests = [];
    await assert.rejects(
      notifyMainPush({
        event,
        environment: mainPushEnvironment,
        fetchImpl: async (url) => {
          requests.push(url);
          throw new Error("unexpected request");
        }
      }),
      /valid repository pushed_at time/u
    );
    assert.equal(requests.length, 0);
  }
});

test("fails when the pull request list API fails", async () => {
  const { fetchImpl, posts } = fetchForMainPush({ listStatus: 500 });

  await assert.rejects(
    notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl }),
    /GitHub API returned 500/u
  );
  assert.equal(posts.length, 0);
});

test("fails when a compare API call fails", async () => {
  const pullRequest = makePullRequest({ number: 112 });
  const { fetchImpl, posts } = fetchForMainPush({ pages: [[pullRequest]], compareStatus: 500 });

  await assert.rejects(
    notifyMainPush({ event: mainPushEvent, environment: mainPushEnvironment, fetchImpl }),
    /GitHub API returned 500/u
  );
  assert.equal(posts.length, 0);
});

test("notifies exactly once for an opened PR that is behind event-time main", async () => {
  const pullRequest = makePullRequest({ number: 201, title: "Opened notification" });
  const { fetchImpl, posts, requests } = fetchForLifecycle({ behindBy: 2 });

  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "opened", pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl
  });

  assert.equal(posts.length, 1);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 1);
  assert.match(posts[0].content, /PR #201 out of date/u);
  assert.match(posts[0].content, /latest main integration required/u);
  assert.match(posts[0].content, /event-time main SHA: c{40}/u);
  assert.match(posts[0].content, new RegExp(`PR head SHA: ${pullRequest.head.sha}`, "u"));
  assert.match(requests[0].url, new RegExp(`/compare/${lifecycleEnvironment.GITHUB_SHA}\.\.\.${pullRequest.head.sha}$`, "u"));
});

test("does not notify an opened PR that is current with event-time main", async () => {
  const { fetchImpl, posts, requests } = fetchForLifecycle({ behindBy: 0 });

  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "opened" }),
    environment: lifecycleEnvironment,
    fetchImpl
  });

  assert.equal(posts.length, 0);
  assert.equal(requests.filter(({ url }) => url.includes("/compare/")).length, 1);
});

test("does not compare or notify a draft opened PR", async () => {
  const pullRequest = makePullRequest({ number: 202, draft: true });
  const { fetchImpl, posts, requests } = fetchForLifecycle({ behindBy: 1 });

  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "opened", pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl
  });

  assert.equal(posts.length, 0);
  assert.equal(requests.length, 0);
});

test("notifies ready_for_review PRs only when they are behind", async () => {
  const pullRequest = makePullRequest({ number: 203 });
  const behind = fetchForLifecycle({ behindBy: 1 });
  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "ready_for_review", pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl: behind.fetchImpl
  });
  assert.equal(behind.posts.length, 1);

  const current = fetchForLifecycle({ behindBy: 0 });
  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "ready_for_review", pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl: current.fetchImpl
  });
  assert.equal(current.posts.length, 0);
});

test("notifies reopened PRs only when they are behind and skips draft reopenings", async () => {
  const pullRequest = makePullRequest({ number: 204 });
  const reopened = fetchForLifecycle({ behindBy: 1 });
  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "reopened", pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl: reopened.fetchImpl
  });
  assert.equal(reopened.posts.length, 1);

  const draft = fetchForLifecycle({ behindBy: 1 });
  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ action: "reopened", pullRequest: { ...pullRequest, draft: true } }),
    environment: lifecycleEnvironment,
    fetchImpl: draft.fetchImpl
  });
  assert.equal(draft.posts.length, 0);
  assert.equal(draft.requests.length, 0);
});

test("explicit non-main lifecycle bases are successful no-ops", async () => {
  const { fetchImpl, posts, requests } = fetchForLifecycle({ behindBy: 1 });

  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ pullRequest: makePullRequest({ number: 205, baseRef: "release" }) }),
    environment: {},
    fetchImpl
  });

  assert.equal(posts.length, 0);
  assert.equal(requests.length, 0);
});

test("rejects malformed actionable lifecycle identity before API requests", async () => {
  const pullRequest = makePullRequest({ number: 206 });
  const invalidEvents = [
    { name: "missing action", event: { pull_request: pullRequest } },
    { name: "unsupported action", event: lifecycleEvent({ action: "synchronize", pullRequest }) },
    { name: "missing pull request", event: { action: "opened" } },
    { name: "missing base", event: lifecycleEvent({ pullRequest: { ...pullRequest, base: undefined } }) },
    { name: "missing state", event: lifecycleEvent({ pullRequest: { ...pullRequest, state: undefined } }) },
    { name: "closed state", event: lifecycleEvent({ pullRequest: { ...pullRequest, state: "closed" } }) },
    { name: "missing number", event: lifecycleEvent({ pullRequest: { ...pullRequest, number: undefined } }) },
    { name: "invalid head SHA", event: lifecycleEvent({ pullRequest: { ...pullRequest, head: { sha: "not-a-sha" } } }) }
  ];

  for (const { name, event } of invalidEvents) {
    let requests = 0;
    await assert.rejects(
      notifyPullRequestLifecycle({
        event,
        environment: lifecycleEnvironment,
        fetchImpl: async () => {
          requests += 1;
          throw new Error("unexpected request");
        }
      }),
      (error) => error instanceof Error && error.message.length > 0,
      name
    );
    assert.equal(requests, 0, name);
  }

  for (const environment of [
    { ...lifecycleEnvironment, GITHUB_SHA: undefined },
    { ...lifecycleEnvironment, GITHUB_SHA: "not-a-sha" },
    { ...lifecycleEnvironment, GITHUB_REPOSITORY: undefined },
    { ...lifecycleEnvironment, GITHUB_TOKEN: undefined }
  ]) {
    let requests = 0;
    await assert.rejects(
      notifyPullRequestLifecycle({
        event: lifecycleEvent({ pullRequest }),
        environment,
        fetchImpl: async () => {
          requests += 1;
          throw new Error("unexpected request");
        }
      })
    );
    assert.equal(requests, 0);
  }
});

test("fails on lifecycle compare errors without posting to Discord", async () => {
  const { fetchImpl, posts } = fetchForLifecycle({ compareStatus: 500 });

  await assert.rejects(
    notifyPullRequestLifecycle({
      event: lifecycleEvent({ action: "opened" }),
      environment: lifecycleEnvironment,
      fetchImpl
    }),
    /GitHub API returned 500/u
  );
  assert.equal(posts.length, 0);
});

test("sanitizes and bounds lifecycle content while disabling Discord mentions", async () => {
  const pullRequest = makePullRequest({ number: 207, title: "@everyone\n<title>\u0000" });
  const content = buildPullRequestLifecycleContent({
    repository: "sayosomi/nuinuiCAD",
    pullRequest: { ...pullRequest, title: "title\n".repeat(1000) },
    mainSha: lifecycleEnvironment.GITHUB_SHA
  });
  assert.ok(content.length <= 2000);
  assert.doesNotMatch(content, /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);

  const { fetchImpl, posts } = fetchForLifecycle({ behindBy: 1 });
  await notifyPullRequestLifecycle({
    event: lifecycleEvent({ pullRequest }),
    environment: lifecycleEnvironment,
    fetchImpl
  });
  assert.match(posts[0].content, /@everyone <title>/u);
  assert.match(posts[0].content, /event-time main SHA: c{40}/u);
  assert.match(posts[0].content, new RegExp(`PR head SHA: ${pullRequest.head.sha}`, "u"));
  assert.deepEqual(posts[0].allowed_mentions, { parse: [] });
});

test("keeps merged pull request notification behavior covered", async () => {
  const posts = [];
  await notifyMergedPullRequest({
    environment: {
      DISCORD_WEBHOOK_URL: mainPushEnvironment.DISCORD_WEBHOOK_URL,
      REPOSITORY_NAME: "sayosomi/nuinuiCAD",
      PR_NUMBER: 113,
      PR_TITLE: "Merged notification",
      PR_URL: "https://github.com/sayosomi/nuinuiCAD/pull/113"
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, mainPushEnvironment.DISCORD_WEBHOOK_URL);
      posts.push(JSON.parse(options.body));
      return response(null, { status: 204 });
    }
  });

  assert.match(posts[0].content, /PR #113 merged/u);
  assert.deepEqual(posts[0].allowed_mentions, { parse: [] });
});
