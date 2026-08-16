import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import process from "node:process";
import {
  assertBenchmarkFixtureManifest,
  type BenchmarkFixtureManifest,
  type BenchmarkFixtureManifestEntry
} from "../../src/performance/benchmarkFixtureManifest";
import {
  assertBenchmarkResult,
  type BenchmarkMachine,
  type BenchmarkRenderSurface,
  type BenchmarkResult
} from "../../src/performance/benchmarkResultSchema";
import { readBenchmarkResultFile, writeBenchmarkResultFile } from "./benchmarkResultIo";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultManifestPath = resolve(repositoryRoot, "performance/fixtures/manifest.json");
export const CAPTURE_VSCODE_COMPLETION_TIMEOUT_MS = 10 * 60_000;
export const CAPTURE_VSCODE_SHUTDOWN_TIMEOUT_MS = 10_000;

export type CaptureVscodeOptions = {
  fixtureId: string;
  baselinePath: string;
  outputPath: string;
  manifestPath?: string;
  repositoryPath?: string;
  extensionPath?: string;
};

export type VscodeBenchmarkCaptureConfig = {
  runId: string;
  fixtureId: string;
  fixtureHash: string;
  fixtureSource: string;
  fixture: BenchmarkFixtureManifestEntry;
  resultPath: string;
  build: {
    gitCommit: string;
    appVersion: string;
    machine: BenchmarkMachine;
  };
  expectedRenderSurface: BenchmarkRenderSurface;
};

export type VscodeLaunchHandle = {
  exit: Promise<number>;
  terminate: () => void;
};

export type CaptureVscodeDependencies = {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  hashSource: (source: string) => string;
  getGitCommit: (repositoryPath: string) => string;
  getMachine: () => BenchmarkMachine;
  getExtensionVersion: (extensionPath: string) => string;
  createRunId: () => string;
  createTempDirectory: () => string;
  writeFile: (path: string, content: string) => void;
  buildExtension: (repositoryPath: string) => void;
  buildRust: (repositoryPath: string) => void;
  launchVscode: (
    config: VscodeBenchmarkCaptureConfig,
    repositoryPath: string,
    extensionPath: string,
    fixturePath: string,
    rustBinaryPath: string
  ) => VscodeLaunchHandle;
  readResult: typeof readBenchmarkResultFile;
  writeResult: typeof writeBenchmarkResultFile;
  removeTempDirectory: (path: string) => void;
};

const defaultDependencies = (): CaptureVscodeDependencies => ({
  readFile: (path) => readFileSync(path, "utf8"),
  fileExists: (path) => existsSync(path),
  hashSource: (source) => `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`,
  getGitCommit: (repositoryPath) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim(),
  getMachine: () => {
    const cpus = os.cpus();
    return {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpuModel: cpus[0]?.model || "unknown",
      logicalCpuCount: Math.max(1, cpus.length)
    };
  },
  getExtensionVersion: (extensionPath) => (JSON.parse(readFileSync(join(extensionPath, "package.json"), "utf8")) as { version: string }).version,
  createRunId: () => randomUUID(),
  createTempDirectory: () => mkdtempSync(join(os.tmpdir(), "nuinuicad-vscode-capture-")),
  writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  buildExtension: (repositoryPath) => execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:vscode"], { cwd: repositoryPath, stdio: "inherit" }),
  buildRust: (repositoryPath) => execFileSync("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "evaluation_stdio"], { cwd: repositoryPath, stdio: "inherit" }),
  launchVscode: (config, repositoryPath, extensionPath, fixturePath, rustBinaryPath) => launchVscode(config, repositoryPath, extensionPath, fixturePath, rustBinaryPath),
  readResult: readBenchmarkResultFile,
  writeResult: writeBenchmarkResultFile,
  removeTempDirectory: (path) => rmSync(path, { recursive: true, force: true })
});

export const launchVscode = (
  config: VscodeBenchmarkCaptureConfig,
  repositoryPath: string,
  extensionPath: string,
  fixturePath: string,
  rustBinaryPath: string,
  spawnProcess: typeof spawn = spawn
): VscodeLaunchHandle => {
  const command = process.env.NUINUICAD_VSCODE_CLI ?? "code";
  const userDataPath = resolve(config.resultPath, "..", "user-data");
  const extensionsPath = resolve(config.resultPath, "..", "extensions");
  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(extensionsPath, { recursive: true });
  const child = spawnProcess(command, [
    "--new-window",
    "--user-data-dir", userDataPath,
    "--extensions-dir", extensionsPath,
    `--extensionDevelopmentPath=${extensionPath}`,
    "--skip-welcome",
    "--skip-sessions-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    fixturePath
  ], {
    cwd: repositoryPath,
    env: {
      ...process.env,
      NUINUICAD_VSCODE_BENCHMARK_CONFIG: JSON.stringify(config),
      NUINUICAD_RUST_EVALUATION_BINARY: rustBinaryPath
    },
    stdio: "inherit"
  });
  const exit = new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  return {
    exit,
    terminate: () => child.kill()
  };
};

export const parseCaptureVscodeArgs = (argv: readonly string[]): CaptureVscodeOptions => {
  let fixtureId: string | undefined;
  let baselinePath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") fixtureId = argv[++index];
    else if (argument === "--baseline") baselinePath = argv[++index];
    else if (argument === "--output") outputPath = argv[++index];
    else throw new Error(`Unknown capture option: ${argument}`);
  }
  if (!fixtureId) throw new Error("Missing required --fixture <fixture-id>");
  if (!baselinePath) throw new Error("Missing required --baseline <tauri-result.json>");
  if (!outputPath) throw new Error("Missing required --output <path>");
  return { fixtureId, baselinePath, outputPath };
};

const manifestEntryFor = (manifest: BenchmarkFixtureManifest, fixtureId: string): BenchmarkFixtureManifestEntry => {
  const entry = manifest.fixtures.find((fixture) => fixture.id === fixtureId);
  if (!entry) throw new Error(`Unknown benchmark fixture: ${fixtureId}`);
  return entry;
};

const sameMachine = (left: BenchmarkMachine, right: BenchmarkMachine): boolean =>
  left.platform === right.platform &&
  left.arch === right.arch &&
  left.osRelease === right.osRelease &&
  left.cpuModel === right.cpuModel &&
  left.logicalCpuCount === right.logicalCpuCount;

const renderSurfaceIsCoherent = (surface: BenchmarkRenderSurface): boolean =>
  surface.backingWidthPx === Math.round(surface.cssWidthPx * surface.devicePixelRatio) &&
  surface.backingHeightPx === Math.round(surface.cssHeightPx * surface.devicePixelRatio);

export const assertVscodeBaseline = (baseline: BenchmarkResult, fixtureId: string, fixtureHash: string, machine: BenchmarkMachine): void => {
  if (baseline.target !== "tauri") throw new Error(`VS Code benchmark baseline must target "tauri", received "${baseline.target}"`);
  if (baseline.fixture.id !== fixtureId || baseline.fixture.hash !== fixtureHash) {
    throw new Error(`VS Code benchmark baseline fixture mismatch: expected ${fixtureId}/${fixtureHash}, received ${baseline.fixture.id}/${baseline.fixture.hash}`);
  }
  if (!sameMachine(baseline.environment.machine, machine)) {
    throw new Error(`VS Code benchmark machine mismatch: baseline=${JSON.stringify(baseline.environment.machine)}, actual=${JSON.stringify(machine)}`);
  }
  if (!renderSurfaceIsCoherent(baseline.environment.renderSurface)) {
    throw new Error(`VS Code benchmark baseline render surface is incoherent: ${JSON.stringify(baseline.environment.renderSurface)}`);
  }
};

export const assertVscodeResultIdentity = (
  result: BenchmarkResult,
  expected: { fixtureId: string; fixtureHash: string; gitCommit: string }
): void => {
  if (result.target !== "vscode") throw new Error(`Benchmark result target mismatch: expected "vscode", received "${result.target}"`);
  if (result.fixture.id !== expected.fixtureId) throw new Error(`Benchmark result fixture.id mismatch: expected "${expected.fixtureId}", received "${result.fixture.id}"`);
  if (result.fixture.hash !== expected.fixtureHash) throw new Error(`Benchmark result fixture.hash mismatch: expected "${expected.fixtureHash}", received "${result.fixture.hash}"`);
  if (result.build.gitCommit !== expected.gitCommit) throw new Error(`Benchmark result build.gitCommit mismatch: expected "${expected.gitCommit}", received "${result.build.gitCommit}"`);
};

export const captureVscode = async (
  options: CaptureVscodeOptions,
  dependencyOverrides: Partial<CaptureVscodeDependencies> = {}
): Promise<void> => {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const repositoryPath = options.repositoryPath ?? repositoryRoot;
  const extensionPath = options.extensionPath ?? resolve(repositoryPath, "vscode-extension");
  const baseline = dependencies.readResult(options.baselinePath);
  const manifest = JSON.parse(dependencies.readFile(manifestPath)) as unknown;
  assertBenchmarkFixtureManifest(manifest);
  const fixture = manifestEntryFor(manifest, options.fixtureId);
  const fixtureSourcePath = resolve(dirname(manifestPath), fixture.file);
  const fixtureSource = dependencies.readFile(fixtureSourcePath);
  const actualHash = dependencies.hashSource(fixtureSource);
  if (actualHash !== fixture.hash) throw new Error(`Fixture hash mismatch for ${fixture.id}: expected ${fixture.hash}, received ${actualHash}`);
  const machine = dependencies.getMachine();
  assertVscodeBaseline(baseline, fixture.id, fixture.hash, machine);
  const gitCommit = dependencies.getGitCommit(repositoryPath);
  if (!/^[0-9a-f]{40}$/i.test(gitCommit)) throw new Error(`gitCommit must be a full 40-character SHA: ${gitCommit}`);
  const tempDirectory = dependencies.createTempDirectory();
  const runId = dependencies.createRunId();
  const resultPath = join(tempDirectory, `${runId}.json`);
  const fixturePath = join(tempDirectory, `${fixture.id}.nui`);
  const extensionVersion = dependencies.getExtensionVersion(extensionPath);
  const config: VscodeBenchmarkCaptureConfig = {
    runId,
    fixtureId: fixture.id,
    fixtureHash: fixture.hash,
    fixtureSource,
    fixture,
    resultPath,
    build: { gitCommit, appVersion: extensionVersion, machine },
    expectedRenderSurface: baseline.environment.renderSurface
  };
  dependencies.writeFile(fixturePath, fixtureSource);
  const rustBinaryPath = resolve(repositoryPath, "src-tauri", "target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");

  try {
    dependencies.buildExtension(repositoryPath);
    dependencies.buildRust(repositoryPath);
    const launch = dependencies.launchVscode(config, repositoryPath, extensionPath, fixturePath, rustBinaryPath);
    const deadline = Date.now() + CAPTURE_VSCODE_COMPLETION_TIMEOUT_MS;
    while (!dependencies.fileExists(resultPath) && !dependencies.fileExists(`${resultPath}.error.json`)) {
      if (Date.now() >= deadline) {
        launch.terminate();
        throw new Error("VS Code benchmark did not report completion before timeout");
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    launch.terminate();
    if (dependencies.fileExists(`${resultPath}.error.json`)) throw new Error(`VS Code benchmark failed: ${dependencies.readFile(`${resultPath}.error.json`)}`);
    const result = dependencies.readResult(resultPath);
    assertVscodeResultIdentity(result, { fixtureId: fixture.id, fixtureHash: fixture.hash, gitCommit });
    assertBenchmarkResult(result);
    dependencies.writeResult(options.outputPath, result);
    await Promise.race([launch.exit, new Promise((resolveDelay) => setTimeout(resolveDelay, CAPTURE_VSCODE_SHUTDOWN_TIMEOUT_MS))]);
  } finally {
    dependencies.removeTempDirectory(tempDirectory);
  }
};

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  await captureVscode(parseCaptureVscodeArgs(argv));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
