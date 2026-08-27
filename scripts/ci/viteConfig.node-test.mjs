import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createVitest } from "vitest/node";

const configFile = fileURLToPath(new URL("../../vite.config.ts", import.meta.url));

const reporterNames = (reporters) => reporters.map((reporter) => Array.isArray(reporter) ? reporter[0] : "inline");

const resolvedReporters = async ({ githubActions, junit }) => {
  const originalGithubActions = process.env.GITHUB_ACTIONS;
  const originalJunitOutputFile = process.env.VITEST_JUNIT_OUTPUT_FILE;
  if (githubActions) process.env.GITHUB_ACTIONS = "true";
  else delete process.env.GITHUB_ACTIONS;
  if (junit) process.env.VITEST_JUNIT_OUTPUT_FILE = "/tmp/nuinui-vitest-config-junit.xml";
  else delete process.env.VITEST_JUNIT_OUTPUT_FILE;

  const vitest = await createVitest("test", { run: true, config: configFile });
  try {
    return reporterNames(vitest.projects[0].config.reporters);
  } finally {
    await vitest.close();
    if (originalGithubActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = originalGithubActions;
    if (originalJunitOutputFile === undefined) delete process.env.VITEST_JUNIT_OUTPUT_FILE;
    else process.env.VITEST_JUNIT_OUTPUT_FILE = originalJunitOutputFile;
  }
};

test("JUnit extends Vitest's GitHub Actions defaults without changing local reporters", async () => {
  const localReporters = await resolvedReporters({ githubActions: false, junit: false });
  const githubActionsReporters = await resolvedReporters({ githubActions: true, junit: false });
  const githubActionsWithJunit = await resolvedReporters({ githubActions: true, junit: true });

  assert.ok(!localReporters.includes("junit"));
  assert.ok(githubActionsReporters.includes("github-actions"));
  assert.deepEqual(githubActionsWithJunit.slice(0, -1), githubActionsReporters);
  assert.equal(githubActionsWithJunit.at(-1), "junit");
});
