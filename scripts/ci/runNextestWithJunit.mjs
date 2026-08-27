import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

const reportName = process.argv[2];
const cargoArguments = process.argv.slice(3);
const runnerTemp = process.env.RUNNER_TEMP;

if (!runnerTemp || !reportName || basename(reportName) !== reportName || !/^[A-Za-z0-9._-]+\.xml$/.test(reportName)) {
  throw new Error("Usage: runNextestWithJunit.mjs <report-name.xml> [cargo-nextest arguments]");
}

const reportPath = join(runnerTemp, reportName);
const configDirectory = await mkdtemp(join(runnerTemp, "nuinui-nextest-config-"));
const configPath = join(configDirectory, "junit.toml");
await writeFile(configPath, `[profile.ci.junit]\npath = ${JSON.stringify(reportPath)}\n`, "utf8");

let result;
try {
  result = spawnSync(process.env.CARGO || "cargo", [
    "nextest",
    "run",
    "--locked",
    "--config-file",
    ".config/nextest-ci.toml",
    "--tool-config-file",
    `nuinuicad-ci:${configPath}`,
    "--user-config-file",
    "none",
    "--profile",
    "ci",
    ...cargoArguments
  ], { stdio: "inherit", env: process.env });
} finally {
  await rm(configDirectory, { recursive: true, force: true });
}

if (result.error) throw result.error;
process.exit(result.status ?? 1);
