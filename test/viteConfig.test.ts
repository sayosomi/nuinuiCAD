import { resolve } from "node:path";
import { createVitest } from "vitest/node";
import { expect, test } from "vitest";

const configFile = resolve(process.cwd(), "vite.config.ts");

const reporterNames = (reporters: unknown[]) =>
  reporters.map((reporter) => Array.isArray(reporter) ? reporter[0] : "inline");

const restoreEnvironmentVariable = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

const resolvedReporters = async ({ githubActions, junit }: { githubActions: boolean; junit: boolean }) => {
  const originalGithubActions = process.env.GITHUB_ACTIONS;
  const originalJunitOutputFile = process.env.VITEST_JUNIT_OUTPUT_FILE;
  if (githubActions) process.env.GITHUB_ACTIONS = "true";
  else delete process.env.GITHUB_ACTIONS;
  if (junit) process.env.VITEST_JUNIT_OUTPUT_FILE = "/tmp/nuinui-vitest-config-junit.xml";
  else delete process.env.VITEST_JUNIT_OUTPUT_FILE;

  let vitest: Awaited<ReturnType<typeof createVitest>> | undefined;
  try {
    vitest = await createVitest("test", { run: true, config: configFile });
    return reporterNames(vitest.projects[0].config.reporters);
  } finally {
    if (vitest) await vitest.close();
    restoreEnvironmentVariable("GITHUB_ACTIONS", originalGithubActions);
    restoreEnvironmentVariable("VITEST_JUNIT_OUTPUT_FILE", originalJunitOutputFile);
  }
};

test("JUnit extends Vitest's GitHub Actions defaults without changing local reporters", async () => {
  const originalGithubActions = process.env.GITHUB_ACTIONS;
  const originalJunitOutputFile = process.env.VITEST_JUNIT_OUTPUT_FILE;
  process.env.GITHUB_ACTIONS = "baseline";
  process.env.VITEST_JUNIT_OUTPUT_FILE = "/tmp/nuinui-vitest-config-baseline.xml";

  try {
    const localReporters = await resolvedReporters({ githubActions: false, junit: false });
    expect(localReporters).not.toContain("junit");
    expect(process.env.GITHUB_ACTIONS).toBe("baseline");
    expect(process.env.VITEST_JUNIT_OUTPUT_FILE).toBe("/tmp/nuinui-vitest-config-baseline.xml");

    const githubActionsReporters = await resolvedReporters({ githubActions: true, junit: false });
    expect(githubActionsReporters).toContain("github-actions");
    expect(process.env.GITHUB_ACTIONS).toBe("baseline");
    expect(process.env.VITEST_JUNIT_OUTPUT_FILE).toBe("/tmp/nuinui-vitest-config-baseline.xml");

    const githubActionsWithJunit = await resolvedReporters({ githubActions: true, junit: true });
    expect(githubActionsWithJunit.slice(0, -1)).toEqual(githubActionsReporters);
    expect(githubActionsWithJunit.at(-1)).toBe("junit");
    expect(process.env.GITHUB_ACTIONS).toBe("baseline");
    expect(process.env.VITEST_JUNIT_OUTPUT_FILE).toBe("/tmp/nuinui-vitest-config-baseline.xml");
  } finally {
    restoreEnvironmentVariable("GITHUB_ACTIONS", originalGithubActions);
    restoreEnvironmentVariable("VITEST_JUNIT_OUTPUT_FILE", originalJunitOutputFile);
  }
});
