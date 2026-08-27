import { spawnSync } from "node:child_process";
import { join } from "node:path";

const DEFAULT_ITERATIONS = 20;
const TEST_FILE = "src/node/vscodeObservationBridge.test.ts";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const parseIterations = () => {
  const raw = process.env.NUINUICAD_LIFECYCLE_STRESS_ITERATIONS;
  if (raw === undefined) return DEFAULT_ITERATIONS;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `NUINUICAD_LIFECYCLE_STRESS_ITERATIONS must be a positive integer, received: ${raw}`
    );
  }
  return parsed;
};

const iterations = parseIterations();

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  console.log(`[lifecycle-stress] iteration ${iteration}/${iterations}`);
  const testEnvironment = process.env.RUNNER_TEMP
    ? {
        ...process.env,
        VITEST_JUNIT_OUTPUT_FILE: join(process.env.RUNNER_TEMP, `lifecycle-stress-${iteration}.xml`)
      }
    : process.env;
  const result = spawnSync(npmCommand, ["test", "--", TEST_FILE], {
    stdio: "inherit",
    env: testEnvironment
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[lifecycle-stress] failed at iteration ${iteration}/${iterations}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[lifecycle-stress] passed ${iterations}/${iterations} iterations`);
