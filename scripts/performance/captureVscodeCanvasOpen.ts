import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import process from "node:process";
import {
  CANVAS_OPEN_CAPTURE_SCHEMA_VERSION,
  DEFAULT_CANVAS_OPEN_COLD_SAMPLES,
  DEFAULT_CANVAS_OPEN_HOST_TIMEOUT_MS,
  DEFAULT_CANVAS_OPEN_PANEL_TIMEOUT_MS,
  DEFAULT_CANVAS_OPEN_WARM_SAMPLES,
  DEFAULT_CANVAS_OPEN_WARMUPS,
  canvasOpenSampleStatistics,
  type CanvasOpenCaptureResult,
  type CanvasOpenFixtureContract,
  type CanvasOpenHostConfig,
  type CanvasOpenHostRunResult,
  type CanvasOpenMode
} from "../../src/performance/canvasOpenCapture";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultFixtureDirectory = resolve(repositoryRoot, "performance/fixtures/canvas-open-v1");
const CAPTURE_POLL_INTERVAL_MS = 100;
const CAPTURE_SHUTDOWN_TIMEOUT_MS = 10_000;
const TEMP_DIRECTORY_CLEANUP_ATTEMPTS = 10;
const TEMP_DIRECTORY_CLEANUP_RETRY_MS = 100;

type CanvasOpenFixtureManifestEntry = CanvasOpenFixtureContract & {
  rootFile: string;
  files: readonly { path: string; sha256: string }[];
};

type CanvasOpenFixtureManifest = {
  schemaVersion: 1;
  fixtures: readonly CanvasOpenFixtureManifestEntry[];
};

export type CaptureVscodeCanvasOpenOptions = {
  fixtureId: string;
  outputPath: string;
  smoke: boolean;
  coldSamples?: number;
  warmups?: number;
  warmSamples?: number;
  panelTimeoutMs?: number;
  hostTimeoutMs?: number;
  repositoryPath?: string;
  fixtureDirectory?: string;
};

export type VscodeCanvasOpenLaunchHandle = {
  exit: Promise<number>;
  terminate: () => void;
};

export type CaptureVscodeCanvasOpenDependencies = {
  readFile: (path: string) => string;
  readBytes: (path: string) => Uint8Array;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  createTempDirectory: () => string;
  removeTempDirectory: (path: string) => void;
  mkdir: (path: string) => void;
  copyFile: (source: string, target: string) => void;
  getCommit: (repositoryPath: string) => string;
  isWorkingTreeClean: (repositoryPath: string) => boolean;
  getMachine: () => CanvasOpenCaptureResult["machine"];
  getExtensionVersion: (extensionPath: string) => string;
  buildExtension: (repositoryPath: string) => void;
  buildRustRelease: (repositoryPath: string) => void;
  hashFile: (path: string) => string;
  launchHost: (input: {
    config: CanvasOpenHostConfig;
    repositoryPath: string;
    extensionPath: string;
    workspaceRoot: string;
    rootFilePath: string;
    rustBinaryPath: string;
    userDataPath: string;
    extensionsPath: string;
  }) => VscodeCanvasOpenLaunchHandle;
  now: () => number;
  delay: (ms: number) => Promise<void>;
};

const defaultDependencies = (): CaptureVscodeCanvasOpenDependencies => ({
  readFile: (path) => readFileSync(path, "utf8"),
  readBytes: (path) => readFileSync(path),
  fileExists: existsSync,
  writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  createTempDirectory: () => mkdtempSync(join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "nuinui-canvas-open-")),
  removeTempDirectory: (path) => rmSync(path, { recursive: true, force: true }),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  copyFile: (source, target) => copyFileSync(source, target),
  getCommit: (repositoryPath) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).trim(),
  isWorkingTreeClean: (repositoryPath) => execFileSync("git", ["status", "--porcelain=v1"], { cwd: repositoryPath, encoding: "utf8" }).trim().length === 0,
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
  buildExtension: (repositoryPath) => execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:vscode"], { cwd: repositoryPath, stdio: "inherit" }),
  buildRustRelease: (repositoryPath) => execFileSync("cargo", ["build", "--release", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { cwd: repositoryPath, stdio: "inherit" }),
  hashFile: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
  launchHost: (input) => launchVscodeCanvasOpen(input),
  now: () => Date.now(),
  delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
});

const launchVscodeCanvasOpen = (input: Parameters<CaptureVscodeCanvasOpenDependencies["launchHost"]>[0]): VscodeCanvasOpenLaunchHandle => {
  mkdirSync(input.userDataPath, { recursive: true });
  mkdirSync(input.extensionsPath, { recursive: true });
  const command = process.env.NUINUICAD_VSCODE_CLI ?? "code";
  const child = spawn(command, [
    "--new-window",
    "--wait",
    "--user-data-dir", input.userDataPath,
    "--extensions-dir", input.extensionsPath,
    `--extensionDevelopmentPath=${input.extensionPath}`,
    "--skip-welcome",
    "--skip-sessions-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    input.rootFilePath
  ], {
    cwd: input.repositoryPath,
    env: {
      ...process.env,
      NUINUICAD_VSCODE_CANVAS_OPEN_CAPTURE_CONFIG: JSON.stringify(input.config),
      NUINUICAD_RUST_EVALUATION_BINARY: input.rustBinaryPath
    },
    stdio: "ignore",
    detached: process.platform !== "win32"
  });
  const exit = new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  let terminated = false;
  return {
    exit,
    terminate: () => {
      if (terminated) return;
      terminated = true;
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
      }
      if (!child.killed) child.kill("SIGTERM");
    }
  };
};

const positiveInteger = (value: string | undefined, flag: string): number => {
  if (!value || !/^\d+$/.test(value)) throw new Error(`Expected a positive integer after ${flag}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer after ${flag}`);
  return parsed;
};

export const parseCaptureVscodeCanvasOpenArgs = (argv: readonly string[]): CaptureVscodeCanvasOpenOptions => {
  let fixtureId: string | undefined;
  let outputPath: string | undefined;
  let smoke = false;
  let coldSamples: number | undefined;
  let warmups: number | undefined;
  let warmSamples: number | undefined;
  let panelTimeoutMs: number | undefined;
  let hostTimeoutMs: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") fixtureId = argv[++index];
    else if (argument === "--output") outputPath = argv[++index];
    else if (argument === "--smoke") smoke = true;
    else if (argument === "--cold-samples") coldSamples = positiveInteger(argv[++index], argument);
    else if (argument === "--warmups") warmups = positiveInteger(argv[++index], argument);
    else if (argument === "--warm-samples") warmSamples = positiveInteger(argv[++index], argument);
    else if (argument === "--panel-timeout-ms") panelTimeoutMs = positiveInteger(argv[++index], argument);
    else if (argument === "--host-timeout-ms") hostTimeoutMs = positiveInteger(argv[++index], argument);
    else throw new Error(`Unknown Canvas-open capture option: ${argument}`);
  }
  if (fixtureId !== "single-root" && fixtureId !== "imported") {
    throw new Error("Required --fixture must be single-root or imported");
  }
  if (!outputPath) throw new Error("Missing required --output <path>");
  if (smoke && (coldSamples !== undefined || warmups !== undefined || warmSamples !== undefined)) {
    throw new Error("--smoke uses its fixed one-cold, one-warmup, one-warm-sample protocol");
  }
  if (!smoke && warmSamples !== undefined && warmSamples < 21) {
    throw new Error("Repeatable warm sampling requires at least 21 measured samples");
  }
  return {
    fixtureId,
    outputPath,
    smoke,
    ...(coldSamples === undefined ? {} : { coldSamples }),
    ...(warmups === undefined ? {} : { warmups }),
    ...(warmSamples === undefined ? {} : { warmSamples }),
    ...(panelTimeoutMs === undefined ? {} : { panelTimeoutMs }),
    ...(hostTimeoutMs === undefined ? {} : { hostTimeoutMs })
  };
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const validateFixtureManifest = (value: unknown): CanvasOpenFixtureManifest => {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value) || value.schemaVersion !== 1 || !("fixtures" in value) || !Array.isArray(value.fixtures)) {
    throw new Error("Canvas-open fixture manifest has an unsupported shape");
  }
  const ids = new Set<string>();
  for (const rawEntry of value.fixtures) {
    if (typeof rawEntry !== "object" || rawEntry === null) throw new Error("Canvas-open fixture entry must be an object");
    const entry = rawEntry as Partial<CanvasOpenFixtureManifestEntry>;
    if (
      typeof entry.id !== "string" || ids.has(entry.id) ||
      (entry.kind !== "single-root" && entry.kind !== "imported") ||
      typeof entry.rootFile !== "string" || !Array.isArray(entry.files) ||
      typeof entry.hash !== "string" || !/^sha256:[0-9a-f]{64}$/i.test(entry.hash) ||
      typeof entry.rootSourceSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(entry.rootSourceSha256) ||
      !Number.isSafeInteger(entry.expectedDependencyCount) || entry.expectedDependencyCount! < 0 ||
      !Number.isSafeInteger(entry.minimumRuntimeElementCount) || entry.minimumRuntimeElementCount! < 1 ||
      !Number.isSafeInteger(entry.minimumComputedGeometryCount) || entry.minimumComputedGeometryCount! < 1 ||
      !Number.isSafeInteger(entry.minimumDrawablePrimitiveCount) || entry.minimumDrawablePrimitiveCount! < 1
    ) throw new Error("Canvas-open fixture manifest contains an invalid fixture entry");
    ids.add(entry.id);
    if (entry.files.length === 0 || entry.files.some((file) =>
      typeof file.path !== "string" || file.path.startsWith("/") || file.path.includes("..") ||
      typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(file.sha256)
    )) throw new Error(`Canvas-open fixture ${entry.id} has invalid file identities`);
    if (!entry.files.some((file) => file.path === entry.rootFile && file.sha256 === entry.rootSourceSha256)) {
      throw new Error(`Canvas-open fixture ${entry.id} root source hash is not listed`);
    }
    if (entry.kind === "imported" && entry.expectedDependencyCount! < 1) {
      throw new Error(`Imported fixture ${entry.id} must require a saved dependency`);
    }
    if (entry.kind === "single-root" && entry.expectedDependencyCount !== 0) {
      throw new Error(`Single-root fixture ${entry.id} must not declare dependencies`);
    }
  }
  return value as CanvasOpenFixtureManifest;
};

const fixtureFor = (manifest: CanvasOpenFixtureManifest, fixtureId: string): CanvasOpenFixtureManifestEntry => {
  const fixture = manifest.fixtures.find((entry) => entry.id === fixtureId);
  if (!fixture) throw new Error(`Unknown Canvas-open fixture: ${fixtureId}`);
  return fixture;
};

const fixtureHashFor = (
  fixture: CanvasOpenFixtureManifestEntry,
  fixtureDirectory: string,
  dependencies: Pick<CaptureVscodeCanvasOpenDependencies, "readBytes">
): { hash: string; files: { path: string; sha256: string }[] } => {
  const files = fixture.files.map((entry) => {
    const actual = sha256(dependencies.readBytes(resolve(fixtureDirectory, entry.path)));
    if (actual !== entry.sha256) throw new Error(`Canvas-open fixture hash mismatch: fixture=${fixture.id}, file=${entry.path}`);
    return { path: entry.path, sha256: actual };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const identity = `canvas-open-v1\n${files.map((file) => `${file.path}\0${file.sha256}\n`).join("")}`;
  const actualFixtureHash = `sha256:${sha256(new TextEncoder().encode(identity))}`;
  if (actualFixtureHash !== fixture.hash) throw new Error(`Canvas-open fixture identity mismatch: fixture=${fixture.id}`);
  return { hash: actualFixtureHash, files };
};

const copyFixtureWorkspace = (
  fixture: CanvasOpenFixtureManifestEntry,
  fixtureDirectory: string,
  workspaceRoot: string,
  dependencies: Pick<CaptureVscodeCanvasOpenDependencies, "readBytes" | "writeFile" | "mkdir">
): string => {
  dependencies.mkdir(workspaceRoot);
  for (const file of fixture.files) {
    const source = resolve(fixtureDirectory, file.path);
    const target = resolve(workspaceRoot, file.path);
    dependencies.mkdir(dirname(target));
    dependencies.writeFile(target, new TextDecoder().decode(dependencies.readBytes(source)));
  }
  return resolve(workspaceRoot, fixture.rootFile);
};

const validHostRunResult = (
  value: unknown,
  expected: { runId: string; mode: CanvasOpenMode; fixture: CanvasOpenFixtureContract; measuredSampleCount: number }
): value is CanvasOpenHostRunResult => {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<CanvasOpenHostRunResult>;
  return result.schemaVersion === CANVAS_OPEN_CAPTURE_SCHEMA_VERSION &&
    result.runId === expected.runId &&
    result.mode === expected.mode &&
    result.status === "complete" &&
    result.fixtureId === expected.fixture.id &&
    result.fixtureHash === expected.fixture.hash &&
    Number.isSafeInteger(result.hostPid) && result.hostPid! > 0 &&
    Array.isArray(result.samples) && result.samples.length === expected.measuredSampleCount &&
    result.samples.every((sample) => sample.mode === expected.mode && sample.fixtureId === expected.fixture.id &&
      sample.fixtureHash === expected.fixture.hash && Number.isFinite(sample.hostElapsedMs) && sample.hostElapsedMs >= 0);
};

const temporaryDirectoryCleanupErrorCode = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;

const removeTemporaryDirectoryWithRetry = async (
  removeTempDirectory: (path: string) => void,
  delay: (ms: number) => Promise<void>,
  path: string
): Promise<void> => {
  const retryableCodes = new Set(["ENOTEMPTY", "EBUSY", "EPERM"]);
  for (let attempt = 1; attempt <= TEMP_DIRECTORY_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      removeTempDirectory(path);
      return;
    } catch (error) {
      const code = temporaryDirectoryCleanupErrorCode(error);
      if (!code || !retryableCodes.has(code) || attempt === TEMP_DIRECTORY_CLEANUP_ATTEMPTS) {
        if (code && retryableCodes.has(code)) {
          throw new Error(`VS Code Canvas-open capture cleanup failed (${code}) after ${attempt} attempts`, { cause: error });
        }
        throw error;
      }
      await delay(TEMP_DIRECTORY_CLEANUP_RETRY_MS);
    }
  }
};

export const runCanvasOpenHost = async (
  input: {
    config: CanvasOpenHostConfig;
    repositoryPath: string;
    extensionPath: string;
    workspaceRoot: string;
    rootFilePath: string;
    rustBinaryPath: string;
    userDataPath: string;
    extensionsPath: string;
  },
  dependencyOverrides: Pick<CaptureVscodeCanvasOpenDependencies,
    "launchHost" | "fileExists" | "readFile" | "now" | "delay" | "removeTempDirectory"
  > & { cleanupPath: string }
): Promise<CanvasOpenHostRunResult> => {
  let launch: VscodeCanvasOpenLaunchHandle | null = null;
  try {
    launch = dependencyOverrides.launchHost(input);
    const exitState = launch.exit.then(
      (code) => ({ kind: "exit" as const, code }),
      (error: unknown) => ({ kind: "error" as const, error })
    );
    const exitStateValue: { current: Awaited<typeof exitState> | null } = { current: null };
    void exitState.then((value) => { exitStateValue.current = value; });
    const deadline = dependencyOverrides.now() + input.config.hostTimeoutMs;
    while (!dependencyOverrides.fileExists(input.config.resultPath) && !dependencyOverrides.fileExists(`${input.config.resultPath}.error.json`)) {
      if (dependencyOverrides.fileExists(`${input.config.resultPath}.error.json`)) {
        throw new Error(`VS Code Canvas-open host failed: ${dependencyOverrides.readFile(`${input.config.resultPath}.error.json`)}`);
      }
      if (dependencyOverrides.now() >= deadline) {
        const status = dependencyOverrides.fileExists(input.config.statusPath)
          ? dependencyOverrides.readFile(input.config.statusPath)
          : "no Webview status was received";
        throw new Error(`VS Code Canvas-open host timed out after ${input.config.hostTimeoutMs} ms; latest status: ${status}`);
      }
      if (exitStateValue.current?.kind === "error") {
        const error = exitStateValue.current.error;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "launch-error";
        throw new Error(`VS Code launch failed (${code})`);
      }
      if (exitStateValue.current?.kind === "exit") {
        throw new Error(`VS Code launch process exited with status ${exitStateValue.current.code} before capture completion`);
      }
      await dependencyOverrides.delay(CAPTURE_POLL_INTERVAL_MS);
    }
    if (dependencyOverrides.fileExists(`${input.config.resultPath}.error.json`)) {
      throw new Error(`VS Code Canvas-open host failed: ${dependencyOverrides.readFile(`${input.config.resultPath}.error.json`)}`);
    }
    const raw = JSON.parse(dependencyOverrides.readFile(input.config.resultPath)) as unknown;
    if (!validHostRunResult(raw, {
      runId: input.config.runId,
      mode: input.config.mode,
      fixture: input.config.fixture,
      measuredSampleCount: input.config.measuredSampleCount
    })) throw new Error("VS Code Canvas-open host returned an invalid result identity or sample count");

    const exitDeadline = dependencyOverrides.now() + CAPTURE_SHUTDOWN_TIMEOUT_MS;
    while (exitStateValue.current === null && dependencyOverrides.now() < exitDeadline) {
      await dependencyOverrides.delay(CAPTURE_POLL_INTERVAL_MS);
    }
    if (exitStateValue.current?.kind === "exit" && exitStateValue.current.code !== 0) {
      throw new Error(`VS Code host shutdown returned status ${exitStateValue.current.code}`);
    }
    if (exitStateValue.current === null) {
      launch.terminate();
      throw new Error("VS Code benchmark host did not shut down after requesting its isolated window to close");
    }
    return raw;
  } finally {
    launch?.terminate();
    await removeTemporaryDirectoryWithRetry(
      dependencyOverrides.removeTempDirectory,
      dependencyOverrides.delay,
      dependencyOverrides.cleanupPath
    );
  }
};

const createHostConfig = (input: {
  runId: string;
  resultPath: string;
  statusPath: string;
  mode: CanvasOpenMode;
  warmupCount: number;
  measuredSampleCount: number;
  panelTimeoutMs: number;
  hostTimeoutMs: number;
  fixture: CanvasOpenFixtureContract;
}): CanvasOpenHostConfig => ({ schemaVersion: CANVAS_OPEN_CAPTURE_SCHEMA_VERSION, ...input } as CanvasOpenHostConfig);

export const captureVscodeCanvasOpen = async (
  options: CaptureVscodeCanvasOpenOptions,
  dependencyOverrides: Partial<CaptureVscodeCanvasOpenDependencies> = {}
): Promise<CanvasOpenCaptureResult> => {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const repositoryPath = options.repositoryPath ?? repositoryRoot;
  const fixtureDirectory = options.fixtureDirectory ?? defaultFixtureDirectory;
  const extensionPath = resolve(repositoryPath, "vscode-extension");
  const manifest = validateFixtureManifest(JSON.parse(dependencies.readFile(resolve(fixtureDirectory, "manifest.json"))) as unknown);
  const fixtureEntry = fixtureFor(manifest, options.fixtureId);
  const fixtureIdentity = fixtureHashFor(fixtureEntry, fixtureDirectory, dependencies);
  const fixture: CanvasOpenFixtureContract = {
    id: fixtureEntry.id,
    hash: fixtureIdentity.hash,
    rootSourceSha256: fixtureEntry.rootSourceSha256,
    kind: fixtureEntry.kind,
    expectedDependencyCount: fixtureEntry.expectedDependencyCount,
    minimumRuntimeElementCount: fixtureEntry.minimumRuntimeElementCount,
    minimumComputedGeometryCount: fixtureEntry.minimumComputedGeometryCount,
    minimumDrawablePrimitiveCount: fixtureEntry.minimumDrawablePrimitiveCount
  };
  const gitCommit = dependencies.getCommit(repositoryPath);
  if (!/^[0-9a-f]{40}$/i.test(gitCommit)) throw new Error("Canvas-open capture requires a full source commit SHA");
  if (!dependencies.isWorkingTreeClean(repositoryPath)) throw new Error("Canvas-open capture requires a clean committed source tree");
  const machine = dependencies.getMachine();
  const panelTimeoutMs = options.panelTimeoutMs ?? DEFAULT_CANVAS_OPEN_PANEL_TIMEOUT_MS;
  const hostTimeoutMs = options.hostTimeoutMs ?? DEFAULT_CANVAS_OPEN_HOST_TIMEOUT_MS;
  if (!Number.isSafeInteger(panelTimeoutMs) || panelTimeoutMs < 1 || !Number.isSafeInteger(hostTimeoutMs) || hostTimeoutMs < panelTimeoutMs) {
    throw new Error("Canvas-open capture timeouts must be positive and host timeout must cover panel timeout");
  }
  const coldSampleCount = options.smoke ? 1 : options.coldSamples ?? DEFAULT_CANVAS_OPEN_COLD_SAMPLES;
  const warmupCount = options.smoke ? 1 : options.warmups ?? DEFAULT_CANVAS_OPEN_WARMUPS;
  const warmSampleCount = options.smoke ? 1 : options.warmSamples ?? DEFAULT_CANVAS_OPEN_WARM_SAMPLES;
  if (!options.smoke && warmSampleCount < 21) throw new Error("Repeatable warm sampling requires at least 21 measured samples");

  dependencies.buildExtension(repositoryPath);
  dependencies.buildRustRelease(repositoryPath);
  const rustBinaryPath = resolve(repositoryPath, "rust-evaluator", "target", "release", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  const rustEvaluationBinarySha256 = dependencies.hashFile(rustBinaryPath);
  const extensionVersion = dependencies.getExtensionVersion(extensionPath);
  if (!extensionVersion) throw new Error("VS Code extension version is unavailable");

  const runHost = async (mode: CanvasOpenMode, sampleCount: number, warmups: number): Promise<CanvasOpenHostRunResult> => {
    const tempDirectory = dependencies.createTempDirectory();
    let hostRunnerOwnsCleanup = false;
    try {
      const workspaceRoot = resolve(tempDirectory, "workspace");
      const rootFilePath = copyFixtureWorkspace(fixtureEntry, fixtureDirectory, workspaceRoot, dependencies);
      const resultPath = resolve(tempDirectory, "result.json");
      const statusPath = resolve(tempDirectory, "status.json");
      const config = createHostConfig({
        runId: randomUUID(),
        resultPath,
        statusPath,
        mode,
        warmupCount: warmups,
        measuredSampleCount: sampleCount,
        panelTimeoutMs,
        hostTimeoutMs,
        fixture
      });
      hostRunnerOwnsCleanup = true;
      return await runCanvasOpenHost({
        config,
        repositoryPath,
        extensionPath,
        workspaceRoot,
        rootFilePath,
        rustBinaryPath,
        userDataPath: resolve(tempDirectory, "user-data"),
        extensionsPath: resolve(tempDirectory, "extensions")
      }, {
        launchHost: dependencies.launchHost,
        fileExists: dependencies.fileExists,
        readFile: dependencies.readFile,
        now: dependencies.now,
        delay: dependencies.delay,
        removeTempDirectory: dependencies.removeTempDirectory,
        cleanupPath: tempDirectory
      });
    } catch (error) {
      if (!hostRunnerOwnsCleanup) dependencies.removeTempDirectory(tempDirectory);
      throw error;
    }
  };

  const coldHostRuns: CanvasOpenHostRunResult[] = [];
  for (let index = 0; index < coldSampleCount; index += 1) {
    coldHostRuns.push(await runHost("cold", 1, 0));
  }
  const warmHostRun = await runHost("warm", warmSampleCount, warmupCount);
  const coldSamples = coldHostRuns.flatMap((hostRun) => hostRun.samples);
  const warmSamples = warmHostRun.samples;
  const coldHostPids = coldHostRuns.map((hostRun) => hostRun.hostPid);
  if (new Set(coldHostPids).size !== coldHostPids.length) {
    throw new Error("Cold samples did not use independent VS Code Extension Host processes");
  }
  if (warmSamples.some((sample) => sample.hostPid !== warmHostRun.hostPid)) {
    throw new Error("Warm reopen samples did not stay in one VS Code Extension Host process");
  }

  const coldStats = canvasOpenSampleStatistics(coldSamples);
  const warmStats = canvasOpenSampleStatistics(warmSamples);
  const renderSurface = {
    description: "VS Code Webview Canvas 2D backing surface" as const,
    coldSamples: coldSamples.map((sample) => sample.renderSurface),
    warmSamples: warmSamples.map((sample) => sample.renderSurface)
  };
  const result: CanvasOpenCaptureResult = {
    schemaVersion: CANVAS_OPEN_CAPTURE_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    sourceCommitSha: gitCommit,
    rustEvaluationBinarySha256,
    rustBuildProfile: "release",
    machine,
    fixture: {
      id: fixture.id,
      hash: fixture.hash,
      kind: fixture.kind,
      rootSourceSha256: fixture.rootSourceSha256,
      expectedDependencyCount: fixture.expectedDependencyCount,
      minimumRuntimeElementCount: fixture.minimumRuntimeElementCount,
      minimumComputedGeometryCount: fixture.minimumComputedGeometryCount,
      minimumDrawablePrimitiveCount: fixture.minimumDrawablePrimitiveCount,
      files: fixtureIdentity.files
    },
    renderSurface,
    protocol: { coldSamples: coldSampleCount, warmups: warmupCount, warmSamples: warmSampleCount, panelTimeoutMs, hostTimeoutMs },
    cold: {
      independentHostCount: new Set(coldHostPids).size,
      hostPids: coldHostPids,
      ...coldStats,
      rawSamples: coldSamples
    },
    warm: {
      hostPid: warmHostRun.hostPid,
      ...warmStats,
      rawSamples: warmSamples
    },
    notes: [
      "Primary latency is Extension Host monotonic time from immediately before createWebviewPanel to receipt of the validated Webview acknowledgement.",
      "Webview duration is process-local and is not subtracted from Extension Host duration.",
      "The acknowledgement follows current graph-backed Canvas drawing and the next requestAnimationFrame callback; physical display scanout is not measured.",
      "No latency pass/fail threshold is applied."
    ]
  };
  dependencies.mkdir(dirname(resolve(options.outputPath)));
  dependencies.writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
};

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  const options = parseCaptureVscodeCanvasOpenArgs(argv);
  const result = await captureVscodeCanvasOpen(options);
  console.log(JSON.stringify({
    fixture: result.fixture.id,
    cold: { count: result.cold.count, p50Ms: result.cold.p50Ms, p95Ms: result.cold.p95Ms },
    warm: { count: result.warm.count, p50Ms: result.warm.p50Ms, p95Ms: result.warm.p95Ms },
    output: options.outputPath
  }, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
