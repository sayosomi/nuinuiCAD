import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import process from "node:process";
import {
  assertBenchmarkFixtureManifest,
  type BenchmarkFixtureManifest,
  type BenchmarkFixtureManifestEntry
} from "../../src/performance/benchmarkFixtureManifest";
import type { BenchmarkMachine } from "../../src/performance/benchmarkResultSchema";
import {
  readBenchmarkResultFile,
  writeBenchmarkResultFile
} from "./benchmarkResultIo";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultManifestPath = resolve(repositoryRoot, "performance/fixtures/manifest.json");
const CAPTURE_COMPLETION_TIMEOUT_MS = 120_000;

export type CaptureTauriOptions = {
  fixtureId: string;
  outputPath: string;
  manifestPath?: string;
  repositoryPath?: string;
};

export type TauriBenchmarkCaptureConfig = {
  runId: string;
  fixtureId: string;
  fixtureHash: string;
  fixtureSource: string;
  fixture: BenchmarkFixtureManifestEntry;
  resultPath: string;
  build: {
    gitCommit: string;
    machine: BenchmarkMachine;
  };
};

export type CaptureTauriDependencies = {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  hashSource: (source: string) => string;
  getGitCommit: (repositoryPath: string) => string;
  getMachine: () => BenchmarkMachine;
  createRunId: () => string;
  createTempDirectory: () => string;
  launchTauri: (config: TauriBenchmarkCaptureConfig, repositoryPath: string) => Promise<number>;
  readResult: typeof readBenchmarkResultFile;
  writeResult: typeof writeBenchmarkResultFile;
  removeTempDirectory: (path: string) => void;
};

export class TauriCaptureChildProcessError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Tauri benchmark process exited with code ${exitCode}`);
    this.name = "TauriCaptureChildProcessError";
    this.exitCode = exitCode;
  }
}

const defaultDependencies = (): CaptureTauriDependencies => ({
  readFile: (path) => readFileSync(path, "utf8"),
  fileExists: (path) => existsSync(path),
  hashSource: (source) => `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`,
  getGitCommit: (repositoryPath) => execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryPath,
    encoding: "utf8"
  }).trim(),
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
  createRunId: () => randomUUID(),
  createTempDirectory: () => mkdtempSync(join(os.tmpdir(), "nuinuicad-tauri-capture-")),
  launchTauri: (config, repositoryPath) => {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCommand, ["run", "desktop:dev", "--", "--no-watch"], {
      cwd: repositoryPath,
      env: {
        ...process.env,
        VITE_EVALUATION_ENGINE: "rust",
        VITE_BENCHMARK_CAPTURE_CONFIG: JSON.stringify(config)
      },
      stdio: "inherit",
      detached: process.platform !== "win32"
    });
    return new Promise<number>((resolveExit, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let finished = false;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
      };
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true;
        cleanup();
        callback();
      };
      const onError = (error: Error) => finish(() => reject(error));
      const onExit = (code: number | null) => finish(() => resolveExit(code ?? 1));
      const terminate = () => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
          else child.kill();
        } catch {
          child.kill();
        }
      };
      const checkCompletion = () => {
        if (existsSync(config.resultPath) || existsSync(`${config.resultPath}.error.json`)) {
          finish(() => {
            terminate();
            resolveExit(0);
          });
          return;
        }
        if (Date.now() >= completionDeadline) {
          finish(() => {
            terminate();
            reject(new Error("Tauri benchmark did not report completion before timeout"));
          });
          return;
        }
        timer = setTimeout(checkCompletion, 100);
      };
      const completionDeadline = Date.now() + CAPTURE_COMPLETION_TIMEOUT_MS;
      child.once("error", onError);
      child.once("exit", onExit);
      checkCompletion();
    });
  },
  readResult: readBenchmarkResultFile,
  writeResult: writeBenchmarkResultFile,
  removeTempDirectory: (path) => rmSync(path, { recursive: true, force: true })
});

export const parseCaptureTauriArgs = (argv: readonly string[]): CaptureTauriOptions => {
  let fixtureId: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") fixtureId = argv[++index];
    else if (argument === "--output") outputPath = argv[++index];
    else throw new Error(`Unknown capture option: ${argument}`);
  }
  if (!fixtureId) throw new Error("Missing required --fixture <fixture-id>");
  if (!outputPath) throw new Error("Missing required --output <path>");
  return { fixtureId, outputPath };
};

const manifestEntryFor = (
  manifest: BenchmarkFixtureManifest,
  fixtureId: string
): BenchmarkFixtureManifestEntry => {
  const entry = manifest.fixtures.find((fixture) => fixture.id === fixtureId);
  if (!entry) throw new Error(`Unknown benchmark fixture: ${fixtureId}`);
  return entry;
};

export const captureTauri = async (
  options: CaptureTauriOptions,
  dependencyOverrides: Partial<CaptureTauriDependencies> = {}
): Promise<void> => {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const manifestPath = options.manifestPath ?? defaultManifestPath;
  const repositoryPath = options.repositoryPath ?? repositoryRoot;
  const manifest = JSON.parse(dependencies.readFile(manifestPath)) as unknown;
  assertBenchmarkFixtureManifest(manifest);
  const fixture = manifestEntryFor(manifest, options.fixtureId);
  const fixtureSourcePath = resolve(dirname(manifestPath), fixture.file);
  const fixtureSource = dependencies.readFile(fixtureSourcePath);
  const actualHash = dependencies.hashSource(fixtureSource);
  if (actualHash !== fixture.hash) {
    throw new Error(`Fixture hash mismatch for ${fixture.id}: expected ${fixture.hash}, received ${actualHash}`);
  }

  const gitCommit = dependencies.getGitCommit(repositoryPath);
  if (!/^[0-9a-f]{40}$/i.test(gitCommit)) {
    throw new Error(`gitCommit must be a full 40-character SHA: ${gitCommit}`);
  }
  const machine = dependencies.getMachine();
  const runId = dependencies.createRunId();
  const tempDirectory = dependencies.createTempDirectory();
  const temporaryResultPath = join(tempDirectory, `${runId}.json`);
  const config: TauriBenchmarkCaptureConfig = {
    runId,
    fixtureId: fixture.id,
    fixtureHash: fixture.hash,
    fixtureSource,
    fixture,
    resultPath: temporaryResultPath,
    build: { gitCommit, machine }
  };

  try {
    const exitCode = await dependencies.launchTauri(config, repositoryPath);
    if (exitCode !== 0) throw new TauriCaptureChildProcessError(exitCode);

    const errorPath = `${temporaryResultPath}.error.json`;
    if (dependencies.fileExists(errorPath)) {
      throw new Error(`Tauri benchmark failed: ${dependencies.readFile(errorPath)}`);
    }
    if (!dependencies.fileExists(temporaryResultPath)) {
      throw new Error(`Tauri benchmark did not produce ${temporaryResultPath}`);
    }
    const result = dependencies.readResult(temporaryResultPath);
    dependencies.writeResult(options.outputPath, result);
  } finally {
    dependencies.removeTempDirectory(tempDirectory);
  }
};

export const main = async (argv: readonly string[] = process.argv.slice(2)): Promise<void> => {
  await captureTauri(parseCaptureTauriArgs(argv));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TauriCaptureChildProcessError ? error.exitCode : 1;
  });
}
