import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { TestProject, TestSpecification, WatcherTriggerPattern } from "vitest/node";

const providedBinaryKey = "rustStdioParityBinaryPath";
const buildTimeoutMs = 5 * 60 * 1000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoManifest = join(repositoryRoot, "rust-evaluator", "Cargo.toml");
const cargoTargetDirectory = join(repositoryRoot, "rust-evaluator", "target", "issue-1656-vitest");
const binaryName = process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio";
const binaryPath = join(cargoTargetDirectory, "debug", binaryName);
const targetTestFiles = new Set([
  resolve(repositoryRoot, "test/rootConstPointRust.integration.test.ts"),
  resolve(repositoryRoot, "test/vscodeGraphForwarding.integration.test.tsx")
]);

type VitestSelectionContext = TestProject["vitest"] & { filenamePattern?: string[] };
type CargoBuildError = Error & {
  code?: number | string | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
};

const isTargetSpecification = (specification: TestSpecification) =>
  targetTestFiles.has(resolve(specification.moduleId));

const isWithinDirectory = (directory: string, candidate: string) => {
  const pathFromDirectory = relative(directory, candidate);
  return pathFromDirectory === "" || (
    pathFromDirectory !== ".." &&
    !pathFromDirectory.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(pathFromDirectory)
  );
};

const writeCargoDiagnostics = (stdout: string, stderr: string) => {
  if (stdout) process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
};

const runCargoBuild = () => new Promise<{ stdout: string; stderr: string }>((resolveBuild, rejectBuild) => {
  execFile(
    "cargo",
    ["build", "--quiet", "--manifest-path", cargoManifest, "--bin", "evaluation_stdio"],
    {
      cwd: repositoryRoot,
      env: { ...process.env, CARGO_TARGET_DIR: cargoTargetDirectory },
      encoding: "utf8",
      timeout: buildTimeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 32 * 1024 * 1024
    },
    (error, stdout, stderr) => {
      if (error) {
        const buildError = error as CargoBuildError;
        buildError.stdout = stdout;
        buildError.stderr = stderr;
        rejectBuild(buildError);
        return;
      }
      resolveBuild({ stdout, stderr });
    }
  );
});

const createSnapshot = () => {
  const builtBinaryStats = statSync(binaryPath);
  if (!builtBinaryStats.isFile() || (builtBinaryStats.mode & 0o111) === 0) {
    throw new Error(`Cargo output is missing or not executable: ${binaryPath}`);
  }

  const snapshotDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-issue-1656-rust-"));
  try {
    const realRepositoryRoot = realpathSync(repositoryRoot);
    const realSnapshotDirectory = realpathSync(snapshotDirectory);
    if (isWithinDirectory(realRepositoryRoot, realSnapshotDirectory)) {
      throw new Error(`Rust binary snapshot must be outside the checkout: ${realSnapshotDirectory}`);
    }

    const snapshotBinaryPath = join(snapshotDirectory, binaryName);
    copyFileSync(binaryPath, snapshotBinaryPath);
    chmodSync(snapshotBinaryPath, 0o555);
    const snapshotStats = statSync(snapshotBinaryPath);
    if (!snapshotStats.isFile() || (snapshotStats.mode & 0o111) === 0 || (snapshotStats.mode & 0o222) !== 0) {
      throw new Error(`Rust binary snapshot is missing, non-executable, or writable: ${snapshotBinaryPath}`);
    }
    return { directory: snapshotDirectory, binary: snapshotBinaryPath };
  } catch (error) {
    rmSync(snapshotDirectory, { recursive: true, force: true });
    throw error;
  }
};

const installRustSourceWatchTrigger = (project: TestProject, selectedFiles: string[]) => {
  if (!project.vitest.config.watch) return;

  const root = resolve(project.vitest.config.root).replace(/\\/g, "/");
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trigger: WatcherTriggerPattern = {
    pattern: new RegExp(`^${escapedRoot}/rust-evaluator/(?:Cargo\\.(?:toml|lock)|build\\.rs|src/.+\\.rs)$`),
    testsToRun: () => selectedFiles.map((file) => relative(project.vitest.config.root, file).replace(/\\/g, "/"))
  };
  project.vitest.config.watchTriggerPatterns = [
    ...(project.vitest.config.watchTriggerPatterns ?? []),
    trigger
  ];
};

export default async function rustStdioGlobalSetup(project: TestProject): Promise<(() => void) | void> {
  const vitest = project.vitest as VitestSelectionContext;
  const selectedSpecifications = await project.vitest.getRelevantTestSpecifications(vitest.filenamePattern);
  const selectedTargets = selectedSpecifications.filter(isTargetSpecification);
  if (selectedTargets.length === 0) return;

  const selectedTargetFiles = [...new Set(selectedTargets.map((specification) => resolve(specification.moduleId)))];
  const snapshots = new Set<string>();
  installRustSourceWatchTrigger(project, selectedTargetFiles);

  const buildQueue = { current: Promise.resolve() as Promise<void> };
  const prepareForRun = () => {
    const nextBuild = buildQueue.current.then(buildAndProvide, buildAndProvide);
    buildQueue.current = nextBuild;
    return nextBuild;
  };

  const buildAndProvide = async () => {
    project.provide(providedBinaryKey as never, "" as never);
    const startedAt = performance.now();
    let stdout = "";
    let stderr = "";
    try {
      ({ stdout, stderr } = await runCargoBuild());
    } catch (error) {
      const buildError = error as CargoBuildError;
      writeCargoDiagnostics(buildError.stdout ?? stdout, buildError.stderr ?? stderr);
      const elapsedMs = performance.now() - startedAt;
      const failureReason = buildError.killed
        ? `timed out or was killed after the ${buildTimeoutMs} ms limit`
        : `exit code ${String(buildError.code ?? "unknown")}${buildError.signal ? `, signal ${buildError.signal}` : ""}`;
      const message = `[nuinuicad] Rust evaluation_stdio Cargo build failed after ${elapsedMs.toFixed(1)} ms (${failureReason})`;
      console.error(message);
      throw new Error(message, { cause: error });
    }

    writeCargoDiagnostics(stdout, stderr);
    let snapshotDirectory: string | undefined;
    try {
      const snapshot = createSnapshot();
      snapshotDirectory = snapshot.directory;
      project.provide(providedBinaryKey as never, snapshot.binary as never);
      snapshots.add(snapshot.directory);
      console.info(`[nuinuicad] Rust evaluation_stdio build completed in ${(performance.now() - startedAt).toFixed(1)} ms; snapshot ${snapshot.binary}`);
      return;
    } catch (error) {
      project.provide(providedBinaryKey as never, "" as never);
      if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
      const message = `[nuinuicad] Rust evaluation_stdio build succeeded, but its executable snapshot could not be published: ${String(error)}`;
      console.error(message);
      throw new Error(message, { cause: error });
    }
  };

  project.onTestsRerun(async (specifications) => {
    if (specifications.some(isTargetSpecification)) await prepareForRun();
  });

  await prepareForRun();
  return () => {
    for (const snapshotDirectory of snapshots) {
      rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  };
}
