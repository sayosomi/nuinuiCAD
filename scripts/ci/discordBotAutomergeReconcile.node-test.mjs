import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const TEST_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(TEST_FILE), "../..");
const REPOSITORY = "sayosomi/nuinuiCAD";
const REVIEWED_SHA = "a".repeat(40);
const MERGE_SHA = "b".repeat(40);
const PR_NUMBER = 1398;
const RECEIPT = `<!-- discord-bot-merge-notified:${MERGE_SHA} -->`;
const TEST_WEBHOOK = "https://discord.invalid/mock";

const fakeCli = (mode, args) => {
  const statePath = process.env.RECONCILE_STATE;
  if (!statePath) throw new Error("RECONCILE_STATE is required");
  const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const writeState = (state) => writeFileSync(statePath, JSON.stringify(state));

  if (mode === "sleep") {
    const [duration] = args;
    if (duration !== "5") throw new Error(`unexpected sleep duration: ${duration}`);
    const state = readState();
    state.simulatedSeconds += 5;
    state.sleeps.push(5);
    writeState(state);
    return;
  }

  if (mode === "date") {
    if (args.join(" ") !== "-u -d 48 hours ago +%Y-%m-%dT%H:%M:%SZ") {
      throw new Error(`unexpected date invocation: ${args.join(" ")}`);
    }
    process.stdout.write("2026-10-14T00:00:00Z\n");
    return;
  }

  if (mode === "notify") {
    const state = readState();
    if (args.join(" ") !== "scripts/ci/discordPrNotification.mjs merge") {
      throw new Error(`unexpected notification command: ${args.join(" ")}`);
    }
    if (process.env.DISCORD_WEBHOOK_URL !== TEST_WEBHOOK) {
      throw new Error("notification attempted without the isolated test webhook");
    }
    state.notifications.push({
      repository: process.env.REPOSITORY_NAME,
      number: process.env.PR_NUMBER,
      title: process.env.PR_TITLE,
      url: process.env.PR_URL
    });
    writeState(state);
    return;
  }

  if (mode !== "gh") throw new Error(`unknown fake command: ${mode}`);

  const state = readState();
  const route = args.find((argument) => argument.startsWith("repos/"));
  if (!route) throw new Error(`missing GitHub API route: ${args.join(" ")}`);
  state.apiCalls.push(route);

  if (args.includes("-X") && args[args.indexOf("-X") + 1] === "POST") {
    const body = args.find((argument) => argument.startsWith("body="))?.slice("body=".length);
    if (route !== `repos/${REPOSITORY}/issues/${PR_NUMBER}/comments` || body !== RECEIPT) {
      throw new Error(`unexpected receipt write: ${route} ${body}`);
    }
    state.receipts.push(body);
    writeState(state);
    process.stdout.write('{"id":1}\n');
    return;
  }

  const pullRequest = () => {
    const isMerged = state.alreadyMerged || (
      state.mergeAtSeconds !== null && state.simulatedSeconds >= state.mergeAtSeconds
    );
    const reservation = state.reservation === "cancel-after-sleep" && state.simulatedSeconds >= 5
      ? "none"
      : state.reservation === "change-after-sleep" && state.simulatedSeconds >= 5
        ? "changed"
        : state.reservation === "cancel-after-sleep" || state.reservation === "change-after-sleep"
          ? "bot"
          : state.reservation;
    const pr = {
      number: PR_NUMBER,
      title: "Reviewed merge",
      html_url: `https://github.com/${REPOSITORY}/pull/${PR_NUMBER}`,
      state: isMerged ? "closed" : "open",
      merged: isMerged,
      merged_at: isMerged ? "2026-10-15T00:02:00Z" : null,
      merged_by: isMerged ? { login: "github-actions[bot]" } : null,
      merge_commit_sha: MERGE_SHA,
      head: {
        sha: REVIEWED_SHA,
        repo: { full_name: REPOSITORY }
      },
      base: {
        ref: "main",
        repo: { full_name: REPOSITORY }
      },
      auto_merge: reservation === "bot"
        ? { merge_method: "merge", enabled_by: { login: "github-actions[bot]" } }
        : reservation === "changed"
          ? { merge_method: "squash", enabled_by: { login: "reviewer" } }
          : null,
      updated_at: "2026-10-15T00:02:00Z"
    };

    if (state.drift === "head") pr.head.sha = "c".repeat(40);
    if (state.drift === "base") pr.base.ref = "release";
    return pr;
  };

  if (route === `repos/${REPOSITORY}/commits/${REVIEWED_SHA}/pulls?per_page=100`) {
    process.stdout.write(`${JSON.stringify([{
      number: PR_NUMBER,
      head: { sha: REVIEWED_SHA, repo: { full_name: REPOSITORY } },
      base: { ref: "main", repo: { full_name: REPOSITORY } }
    }])}\n`);
    return;
  }

  if (route === `repos/${REPOSITORY}/pulls?state=closed&sort=updated&direction=desc&per_page=100`) {
    state.scanCalls += 1;
    writeState(state);
    const pr = pullRequest();
    const merged = pr.merged || state.includeUnmergedInScan;
    process.stdout.write(`${JSON.stringify(merged ? [{
      number: PR_NUMBER,
      merged_at: pr.merged || state.includeUnmergedInScan
        ? "2026-10-15T00:02:00Z"
        : null,
      updated_at: pr.updated_at
    }] : [])}\n`);
    return;
  }

  if (route === `repos/${REPOSITORY}/pulls/${PR_NUMBER}`) {
    state.prReads += 1;
    writeState(state);
    process.stdout.write(`${JSON.stringify(pullRequest())}\n`);
    return;
  }

  if (route === `repos/${REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100`) {
    process.stdout.write(`${JSON.stringify(state.receipts.map((body) => ({
      user: { login: "github-actions[bot]" }, body
    })))}\n`);
    return;
  }

  throw new Error(`unexpected GitHub API route: ${route}`);
};

if (process.argv[2] === "--fake-command") {
  try {
    fakeCli(process.argv[3], process.argv.slice(4));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
} else {
  const extractRunScript = (workflow, stepName) => {
    const stepHeading = `      - name: ${stepName}`;
    const stepStart = workflow.indexOf(stepHeading);
    assert.notEqual(stepStart, -1, `workflow step not found: ${stepName}`);
    const runMatch = /^        run: \|$/m.exec(workflow.slice(stepStart));
    assert.ok(runMatch, `literal Bash run block not found: ${stepName}`);
    const bodyStart = stepStart + runMatch.index + runMatch[0].length;
    const lines = workflow.slice(bodyStart).replace(/^\r?\n/, "").split(/\r?\n/u);
    const bodyIndent = 10;
    const scriptLines = [];
    for (const line of lines) {
      if (line.trim() === "") {
        scriptLines.push("");
        continue;
      }
      const indentation = /^ */u.exec(line)[0].length;
      if (indentation < bodyIndent) break;
      scriptLines.push(line.slice(bodyIndent));
    }
    while (scriptLines.at(-1) === "") scriptLines.pop();
    return scriptLines.join("\n");
  };

  const workflow = await readFile(
    new URL("../../.github/workflows/discord-bot-automerge-reconcile.yml", import.meta.url),
    "utf8"
  );
  const settleScript = extractRunScript(
    workflow,
    "Allow CI-triggered bot auto-merge to settle before reconciliation"
  );
  const notificationScanScript = extractRunScript(
    workflow,
    "Send previously missed GitHub-token merge notifications once"
  );

  const shellSyntax = (script) => spawnSync("/bin/bash", ["-n"], {
    cwd: REPOSITORY_ROOT,
    input: script,
    encoding: "utf8"
  });

  const createHarness = async (overrides = {}) => {
    const root = await mkdtemp(join(tmpdir(), "discord-bot-automerge-reconcile-"));
    const bin = join(root, "bin");
    const statePath = join(root, "state.json");
    await mkdir(bin);
    const initialState = {
      simulatedSeconds: 0,
      sleeps: [],
      apiCalls: [],
      notifications: [],
      receipts: [],
      scanCalls: 0,
      prReads: 0,
      mergeAtSeconds: null,
      alreadyMerged: false,
      reservation: "bot",
      drift: null,
      includeUnmergedInScan: false,
      ...overrides
    };
    await writeFile(statePath, JSON.stringify(initialState));
    const wrapper = (mode) => `#!/bin/sh\nexec "$RECONCILE_NODE_EXECUTABLE" "$RECONCILE_TEST_SCRIPT" --fake-command ${mode} "$@"\n`;
    for (const [command, mode] of [["gh", "gh"], ["sleep", "sleep"], ["date", "date"], ["node", "notify"]]) {
      const path = join(bin, command);
      await writeFile(path, wrapper(mode));
      await chmod(path, 0o755);
    }

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      RECONCILE_NODE_EXECUTABLE: process.execPath,
      RECONCILE_TEST_SCRIPT: TEST_FILE,
      RECONCILE_STATE: statePath,
      GH_TOKEN: "test-token",
      REPO: REPOSITORY,
      REVIEWED_SHA,
      DISCORD_WEBHOOK_URL: TEST_WEBHOOK
    };

    const readState = async () => JSON.parse(await readFile(statePath, "utf8"));
    const runStep = (script) => spawnSync("/bin/bash", ["-euo", "pipefail", "-c", script], {
      cwd: REPOSITORY_ROOT,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    const runReconciliation = () => {
      const settle = runStep(settleScript);
      if (settle.status !== 0) return { settle, scan: null };
      return { settle, scan: runStep(notificationScanScript) };
    };

    return { root, readState, runStep, runReconciliation };
  };

  const withHarness = async (overrides, action) => {
    const harness = await createHarness(overrides);
    try {
      await action(harness);
    } finally {
      await rm(harness.root, { recursive: true, force: true });
    }
  };

  test("extracts syntactically valid Bash from both reconciliation workflow steps", () => {
    for (const script of [settleScript, notificationScanScript]) {
      const result = shellSyntax(script);
      assert.equal(result.status, 0, result.stderr);
      assert.match(script, /^set -euo pipefail/m);
    }
  });

  test("a bot merge after 120 simulated seconds is found by the same reconciliation invocation", async () => {
    await withHarness({ mergeAtSeconds: 120 }, async (harness) => {
      const { settle, scan } = harness.runReconciliation();
      assert.equal(settle.status, 0, settle.stderr);
      assert.match(settle.stderr, /PR #1398 merged; run notification scan/u);
      assert.equal(scan.status, 0, scan.stderr);
      assert.match(scan.stdout, /DISCORD BOT MERGE NOTIFIED PR #1398/u);

      const state = await harness.readState();
      assert.equal(state.sleeps.reduce((total, seconds) => total + seconds, 0), 120);
      assert.equal(state.sleeps.length, 24);
      assert.equal(state.prReads, 26);
      assert.equal(state.scanCalls, 1);
      assert.equal(state.notifications.length, 1);
      assert.deepEqual(state.receipts, [RECEIPT]);
    });
  });

  test("an ordinary non-bot PR exits without waiting", async () => {
    await withHarness({ reservation: "none" }, async (harness) => {
      const { settle, scan } = harness.runReconciliation();
      assert.equal(settle.status, 0, settle.stderr);
      assert.match(settle.stderr, /no active GitHub-bot auto-merge; skip wait/u);
      assert.equal(scan.status, 0, scan.stderr);
      const state = await harness.readState();
      assert.equal(state.prReads, 1);
      assert.equal(state.sleeps.length, 0);
      assert.equal(state.notifications.length, 0);
    });
  });

  test("head or base drift terminates the wait safely", async (t) => {
    for (const drift of ["head", "base"]) {
      await t.test(`${drift} drift`, async () => {
        await withHarness({ drift }, async (harness) => {
          const { settle, scan } = harness.runReconciliation();
          assert.equal(settle.status, 0, settle.stderr);
          assert.match(settle.stderr, /PR head\/base drift/u);
          assert.equal(scan.status, 0, scan.stderr);
          const state = await harness.readState();
          assert.equal(state.prReads, 1);
          assert.equal(state.sleeps.length, 0);
          assert.equal(state.notifications.length, 0);
        });
      });
    }
  });

  test("a cancelled or changed bot reservation terminates the wait safely", async (t) => {
    for (const reservation of ["cancel-after-sleep", "change-after-sleep"]) {
      await t.test(`${reservation} reservation`, async () => {
        await withHarness({ reservation }, async (harness) => {
          const { settle, scan } = harness.runReconciliation();
          assert.equal(settle.status, 0, settle.stderr);
          assert.match(settle.stderr, /no active GitHub-bot auto-merge; skip wait/u);
          assert.equal(scan.status, 0, scan.stderr);
          const state = await harness.readState();
          assert.equal(state.prReads, 2);
          assert.equal(state.sleeps.length, 1);
          assert.equal(state.notifications.length, 0);
        });
      });
    }
  });

  test("an unmerged pull request never reaches the merge notification side effect", async () => {
    await withHarness({ reservation: "none", includeUnmergedInScan: true }, async (harness) => {
      const { settle, scan } = harness.runReconciliation();
      assert.equal(settle.status, 0, settle.stderr);
      assert.equal(scan.status, 0, scan.stderr);
      const state = await harness.readState();
      assert.equal(state.scanCalls, 1);
      assert.equal(state.prReads, 2);
      assert.equal(state.notifications.length, 0);
      assert.deepEqual(state.receipts, []);
    });
  });

  test("the full bounded wait expires after 59 five-second sleeps without notification", async () => {
    await withHarness({}, async (harness) => {
      const { settle, scan } = harness.runReconciliation();
      assert.equal(settle.status, 0, settle.stderr);
      assert.match(settle.stderr, /still pending after bounded wait/u);
      assert.equal(scan.status, 0, scan.stderr);
      const state = await harness.readState();
      assert.equal(state.prReads, 60);
      assert.equal(state.sleeps.length, 59);
      assert.equal(state.sleeps.reduce((total, seconds) => total + seconds, 0), 295);
      assert.equal(state.notifications.length, 0);
      assert.deepEqual(state.receipts, []);
    });
  });

  test("a durable successful-send receipt suppresses delivery on later reconciliation", async () => {
    await withHarness({ alreadyMerged: true }, async (harness) => {
      const first = harness.runReconciliation();
      assert.equal(first.settle.status, 0, first.settle.stderr);
      assert.equal(first.scan.status, 0, first.scan.stderr);
      assert.match(first.scan.stdout, /DISCORD BOT MERGE NOTIFIED PR #1398/u);

      const second = harness.runReconciliation();
      assert.equal(second.settle.status, 0, second.settle.stderr);
      assert.equal(second.scan.status, 0, second.scan.stderr);
      assert.match(second.scan.stdout, /ALREADY NOTIFIED PR #1398/u);

      const state = await harness.readState();
      assert.equal(state.notifications.length, 1);
      assert.deepEqual(state.receipts, [RECEIPT]);
      assert.equal(state.scanCalls, 2);
    });
  });
}
