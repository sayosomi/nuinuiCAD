import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  buildCiFailureContent,
  fetchFailureDetails,
  notifyCiFailure
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
