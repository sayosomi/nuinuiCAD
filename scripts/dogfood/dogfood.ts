import { execFileSync, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOGFOOD_SCHEMA_VERSION = 1;
export const DOGFOOD_DIRECTORY_NAME = "dogfood";
export const CURRENT_SELECTION_FILE = "current.json";
export const SNAPSHOT_METADATA_FILE = "snapshot.json";

const sourceRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requiredExtensionFiles = [
  "package.json",
  "language-configuration.json",
  "dist/extension.js",
  "dist/webview.js",
  "dist/webview.css"
] as const;

export type SnapshotMetadata = {
  schemaVersion: typeof DOGFOOD_SCHEMA_VERSION;
  identity: string;
  gitSha: string;
  platform: string;
  architecture: string;
  extensionPath: "extension";
  evaluatorPath: string;
  files: Record<string, string>;
};

export type CurrentSelection = {
  schemaVersion: typeof DOGFOOD_SCHEMA_VERSION;
  identity: string;
};

export type BuildDogfoodOptions = {
  root?: string;
  repositoryPath?: string;
};

export type LaunchDogfoodOptions = {
  root?: string;
  target?: string;
};

export type DogfoodFileSystem = Pick<typeof fs,
  | "chmodSync"
  | "closeSync"
  | "copyFileSync"
  | "existsSync"
  | "lstatSync"
  | "mkdirSync"
  | "mkdtempSync"
  | "openSync"
  | "readFileSync"
  | "readdirSync"
  | "renameSync"
  | "rmSync"
  | "statSync"
  | "unlinkSync"
  | "writeFileSync"
>;

export type DogfoodSpawnOptions = {
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
};

export type DogfoodDependencies = {
  fileSystem: DogfoodFileSystem;
  homeDirectory: () => string;
  workingDirectory: () => string;
  platform: string;
  architecture: string;
  environment: NodeJS.ProcessEnv;
  createTemporaryId: () => string;
  fetchOrigin: (repositoryPath: string) => void;
  getBranch: (repositoryPath: string) => string;
  getWorkingTreeStatus: (repositoryPath: string) => string;
  getHeadSha: (repositoryPath: string) => string;
  getOriginMainSha: (repositoryPath: string) => string;
  buildVscode: (repositoryPath: string) => void;
  buildEvaluator: (repositoryPath: string) => void;
  spawn: (command: string, args: string[], options: DogfoodSpawnOptions) => Pick<ChildProcess, "once">;
  print: (message: string) => void;
};

export type DogfoodDependencyOverrides = Partial<DogfoodDependencies> & { repositoryPath?: string };

export type ParsedBuildArguments = { root?: string };
export type ParsedLaunchArguments = { root?: string; target?: string };

const runGitText = (repositoryPath: string, args: string[]): string =>
  execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8" });

const defaultDependencies = (): DogfoodDependencies => ({
  fileSystem: fs,
  homeDirectory: homedir,
  workingDirectory: process.cwd,
  platform: process.platform,
  architecture: process.arch,
  environment: process.env,
  createTemporaryId: randomUUID,
  fetchOrigin: (repositoryPath) => {
    execFileSync("git", ["fetch", "origin"], { cwd: repositoryPath, stdio: "inherit" });
  },
  getBranch: (repositoryPath) => runGitText(repositoryPath, ["branch", "--show-current"]).trim(),
  getWorkingTreeStatus: (repositoryPath) => runGitText(repositoryPath, ["status", "--porcelain=v1", "--untracked-files=all"]).trimEnd(),
  getHeadSha: (repositoryPath) => runGitText(repositoryPath, ["rev-parse", "HEAD"]).trim(),
  getOriginMainSha: (repositoryPath) => runGitText(repositoryPath, ["rev-parse", "refs/remotes/origin/main"]).trim(),
  buildVscode: (repositoryPath) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npm, ["run", "build:vscode"], { cwd: repositoryPath, stdio: "inherit" });
  },
  buildEvaluator: (repositoryPath) => {
    execFileSync("cargo", ["build", "--release", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], {
      cwd: repositoryPath,
      stdio: "inherit"
    });
  },
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  print: (message) => console.log(message)
});

const withDependencies = (overrides: DogfoodDependencyOverrides = {}): DogfoodDependencies => ({
  ...defaultDependencies(),
  ...overrides
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unsupported or missing field`);
  }
};

const isFullGitSha = (value: string): boolean => /^[0-9a-f]{40}$/.test(value);
const isPlatformOrArchitecture = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== "." && value !== "..";

export const createSnapshotIdentity = (gitSha: string, platform: string, architecture: string): string => {
  if (!isFullGitSha(gitSha)) throw new Error(`Expected a full lowercase 40-character Git SHA, received: ${gitSha}`);
  if (!isPlatformOrArchitecture(platform)) throw new Error(`Invalid snapshot platform: ${platform}`);
  if (!isPlatformOrArchitecture(architecture)) throw new Error(`Invalid snapshot architecture: ${architecture}`);
  return `${gitSha}-${platform}-${architecture}`;
};

export const defaultDogfoodRoot = (homeDirectory = homedir()): string =>
  resolve(homeDirectory, ".nuinuicad", DOGFOOD_DIRECTORY_NAME);

export const resolveDogfoodRoot = (
  rootOverride: string | undefined,
  dependencies: Pick<DogfoodDependencies, "homeDirectory" | "workingDirectory">
): string => {
  const selected = rootOverride ?? defaultDogfoodRoot(dependencies.homeDirectory());
  return isAbsolute(selected) ? resolve(selected) : resolve(dependencies.workingDirectory(), selected);
};

export const parseBuildArguments = (argv: readonly string[]): ParsedBuildArguments => {
  let root: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      if (root !== undefined) throw new Error("Use --root at most once");
      const value = argv[index + 1];
      if (value === undefined || value === "" || value === "--") throw new Error("Missing path after --root");
      root = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown dogfood:build option: ${argument}`);
    } else {
      throw new Error(`dogfood:build does not accept a positional target: ${argument}`);
    }
  }
  return root === undefined ? {} : { root };
};

export const parseLaunchArguments = (argv: readonly string[]): ParsedLaunchArguments => {
  let root: string | undefined;
  const targets: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
    } else if (!positionalOnly && argument === "--root") {
      if (root !== undefined) throw new Error("Use --root at most once");
      const value = argv[index + 1];
      if (value === undefined || value === "" || value === "--") throw new Error("Missing path after --root");
      root = value;
      index += 1;
    } else if (!positionalOnly && argument.startsWith("-")) {
      throw new Error(`Unknown dogfood:launch option: ${argument}`);
    } else {
      targets.push(argument);
    }
  }
  if (targets.length > 1) throw new Error("dogfood:launch accepts at most one file or workspace target");
  return {
    ...(root === undefined ? {} : { root }),
    ...(targets[0] === undefined ? {} : { target: targets[0] })
  };
};

const assertSourcePreconditions = (repositoryPath: string, dependencies: DogfoodDependencies): string => {
  try {
    dependencies.fetchOrigin(repositoryPath);
  } catch (error) {
    throw new Error(`Could not fetch origin before dogfood build: ${errorMessage(error)}`, { cause: error });
  }

  const branch = dependencies.getBranch(repositoryPath);
  if (branch !== "main") {
    throw new Error(`dogfood:build requires branch main; current branch is ${branch || "detached HEAD"}`);
  }
  const status = dependencies.getWorkingTreeStatus(repositoryPath);
  if (status !== "") {
    throw new Error(`dogfood:build requires a clean working tree; git status reports:\n${status}`);
  }
  const headSha = dependencies.getHeadSha(repositoryPath);
  if (!isFullGitSha(headSha)) throw new Error(`HEAD is not a full lowercase 40-character Git SHA: ${headSha}`);
  const originMainSha = dependencies.getOriginMainSha(repositoryPath);
  if (!isFullGitSha(originMainSha)) throw new Error(`origin/main is not a full lowercase 40-character Git SHA: ${originMainSha}`);
  if (headSha !== originMainSha) {
    throw new Error(`dogfood:build requires HEAD to equal freshly fetched origin/main; HEAD=${headSha}, origin/main=${originMainSha}`);
  }
  return headSha;
};

const throwIfNotExists = (fileSystem: DogfoodFileSystem, path: string, label: string): void => {
  let stat: fs.Stats;
  try {
    stat = fileSystem.lstatSync(path);
  } catch (error) {
    if (isMissingPathError(error)) throw new Error(`Missing ${label}: ${path}`, { cause: error });
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Expected ${label} to be a regular file: ${path}`);
};

const isMissingPathError = (error: unknown): boolean =>
  isRecord(error) && error.code === "ENOENT";

const compareStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const collectTreeFiles = (rootPath: string, prefix: string, fileSystem: DogfoodFileSystem): string[] => {
  let rootStat: fs.Stats;
  try {
    rootStat = fileSystem.lstatSync(rootPath);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Expected a runtime resource directory: ${rootPath}`);

  const files: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    const entries = fileSystem.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime resources cannot contain symbolic links: ${absolutePath}`);
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile()) files.push(`${prefix}/${relativePath}`);
      else throw new Error(`Runtime resources must be regular files or directories: ${absolutePath}`);
    }
  };
  walk(rootPath, "");
  return files;
};

const collectExtensionSources = (extensionSource: string, fileSystem: DogfoodFileSystem): string[] => {
  const files = new Set<string>();
  for (const relativePath of requiredExtensionFiles) {
    const sourcePath = join(extensionSource, ...relativePath.split("/"));
    throwIfNotExists(fileSystem, sourcePath, `required extension runtime file ${relativePath}`);
    files.add(`extension/${relativePath}`);
  }

  const rootEntries = fileSystem.readdirSync(extensionSource, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!/^package\.nls.*\.json$/.test(entry.name)) continue;
    const sourcePath = join(extensionSource, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Localized package resource must be a regular file: ${sourcePath}`);
    files.add(`extension/${entry.name}`);
  }

  for (const directoryName of ["syntaxes", "media"]) {
    for (const relativePath of collectTreeFiles(join(extensionSource, directoryName), `extension/${directoryName}`, fileSystem)) {
      files.add(relativePath);
    }
  }

  return [...files].sort(compareStrings);
};

const evaluatorRelativePath = (platform: string): string =>
  platform === "win32" ? "bin/evaluation_stdio.exe" : "bin/evaluation_stdio";

const safeRuntimePath = (relativePath: string): boolean => {
  if (relativePath.includes("\\") || relativePath.startsWith("/")) return false;
  const parts = relativePath.split("/");
  return parts.length > 0 && parts.every((part) => part !== "" && part !== "." && part !== "..");
};

const isRuntimeAllowlisted = (relativePath: string, platform: string): boolean => {
  if (relativePath === evaluatorRelativePath(platform)) return true;
  if (requiredExtensionFiles.some((file) => relativePath === `extension/${file}`)) return true;
  return /^extension\/package\.nls.*\.json$/.test(relativePath) ||
    /^extension\/(?:syntaxes|media)\/.+/.test(relativePath);
};

const pathExists = (fileSystem: DogfoodFileSystem, path: string): boolean => {
  try {
    fileSystem.lstatSync(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
};

const runtimeFilePath = (snapshotPath: string, relativePath: string): string =>
  join(snapshotPath, ...relativePath.split("/"));

const hashFile = (fileSystem: DogfoodFileSystem, path: string): string =>
  createHash("sha256").update(fileSystem.readFileSync(path)).digest("hex");

const makeMetadata = (
  identity: string,
  gitSha: string,
  platform: string,
  architecture: string,
  files: Record<string, string>
): SnapshotMetadata => ({
  schemaVersion: DOGFOOD_SCHEMA_VERSION,
  identity,
  gitSha,
  platform,
  architecture,
  extensionPath: "extension",
  evaluatorPath: evaluatorRelativePath(platform),
  files
});

const copyRuntimeFiles = (
  repositoryPath: string,
  temporarySnapshotPath: string,
  platform: string,
  fileSystem: DogfoodFileSystem
): Record<string, string> => {
  const extensionSource = join(repositoryPath, "vscode-extension");
  const sourceFiles = collectExtensionSources(extensionSource, fileSystem);
  const evaluatorPath = join(repositoryPath, "rust-evaluator", "target", "release", platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  throwIfNotExists(fileSystem, evaluatorPath, "release evaluation_stdio binary");
  const runtimeFiles = [...sourceFiles, evaluatorRelativePath(platform)].sort(compareStrings);
  const manifest: Record<string, string> = {};

  for (const relativePath of runtimeFiles) {
    const sourcePath = relativePath === evaluatorRelativePath(platform)
      ? evaluatorPath
      : join(extensionSource, ...relativePath.slice("extension/".length).split("/"));
    const sourceStat = fileSystem.statSync(sourcePath);
    const destinationPath = runtimeFilePath(temporarySnapshotPath, relativePath);
    fileSystem.mkdirSync(dirname(destinationPath), { recursive: true });
    fileSystem.copyFileSync(sourcePath, destinationPath);
    fileSystem.chmodSync(destinationPath, sourceStat.mode & 0o777);
    manifest[relativePath] = hashFile(fileSystem, destinationPath);
  }
  return manifest;
};

const readJson = (fileSystem: DogfoodFileSystem, path: string, label: string): unknown => {
  let source: string;
  try {
    source = fileSystem.readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${label}: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Malformed ${label}: ${errorMessage(error)}`, { cause: error });
  }
};

const metadataFromUnknown = (value: unknown): SnapshotMetadata => {
  if (!isRecord(value)) throw new Error("Malformed snapshot metadata: expected a JSON object");
  assertExactKeys(value, ["schemaVersion", "identity", "gitSha", "platform", "architecture", "extensionPath", "evaluatorPath", "files"], "Snapshot metadata");
  if (value.schemaVersion !== DOGFOOD_SCHEMA_VERSION) throw new Error(`Unsupported snapshot schema version: ${String(value.schemaVersion)}`);
  if (typeof value.identity !== "string" || typeof value.gitSha !== "string" || typeof value.platform !== "string" || typeof value.architecture !== "string") {
    throw new Error("Malformed snapshot metadata: identity, Git SHA, platform, and architecture must be strings");
  }
  if (!isRecord(value.files) || typeof value.extensionPath !== "string" || typeof value.evaluatorPath !== "string") {
    throw new Error("Malformed snapshot metadata: paths and runtime file manifest are required");
  }
  const files = Object.create(null) as Record<string, string>;
  for (const [path, hash] of Object.entries(value.files)) {
    if (typeof hash !== "string") throw new Error(`Malformed SHA-256 entry for ${path}`);
    files[path] = hash;
  }
  return {
    schemaVersion: DOGFOOD_SCHEMA_VERSION,
    identity: value.identity,
    gitSha: value.gitSha,
    platform: value.platform,
    architecture: value.architecture,
    extensionPath: value.extensionPath as "extension",
    evaluatorPath: value.evaluatorPath,
    files
  };
};

const currentSelectionFromUnknown = (value: unknown): CurrentSelection => {
  if (!isRecord(value)) throw new Error("Malformed current.json: expected a JSON object");
  assertExactKeys(value, ["schemaVersion", "identity"], "current.json");
  if (value.schemaVersion !== DOGFOOD_SCHEMA_VERSION) throw new Error(`Unsupported current.json schema version: ${String(value.schemaVersion)}`);
  if (typeof value.identity !== "string" || !/^[0-9a-f]{40}-[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.identity)) {
    throw new Error("Malformed current.json: snapshot identity is invalid");
  }
  return { schemaVersion: DOGFOOD_SCHEMA_VERSION, identity: value.identity };
};

const expectedDirectoriesForFiles = (files: readonly string[]): string[] => {
  const directories = new Set<string>();
  for (const path of files) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) directories.add(segments.slice(0, index).join("/"));
  }
  return [...directories].sort(compareStrings);
};

const scanSnapshotTree = (
  snapshotPath: string,
  fileSystem: DogfoodFileSystem
): { files: string[]; directories: string[] } => {
  const rootStat = fileSystem.lstatSync(snapshotPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`Snapshot must be a real directory: ${snapshotPath}`);
  const files: string[] = [];
  const directories: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    const entries = fileSystem.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Snapshot cannot contain symbolic links: ${absolutePath}`);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`Snapshot may contain only regular files and directories: ${absolutePath}`);
      }
    }
  };
  walk(snapshotPath, "");
  return { files: files.sort(compareStrings), directories: directories.sort(compareStrings) };
};

const packageResourcePath = (value: string, label: string): string => {
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  if (!safeRuntimePath(normalized)) throw new Error(`Invalid extension package ${label} path: ${value}`);
  return `extension/${normalized}`;
};

const assertExtensionPackageResources = (
  snapshotPath: string,
  metadata: SnapshotMetadata,
  fileSystem: DogfoodFileSystem
): void => {
  const packagePath = runtimeFilePath(snapshotPath, "extension/package.json");
  const extensionPackage = readJson(fileSystem, packagePath, "extension package.json");
  if (!isRecord(extensionPackage) || extensionPackage.main !== "./dist/extension.js") {
    throw new Error("Snapshot extension package must use ./dist/extension.js as its entrypoint");
  }
  const contributes = isRecord(extensionPackage.contributes) ? extensionPackage.contributes : undefined;
  if (!contributes) throw new Error("Snapshot extension package is missing contributes resources");
  const resourcePaths: string[] = [];
  const languages = contributes.languages;
  if (!Array.isArray(languages) || languages.length === 0) throw new Error("Snapshot extension package is missing language configuration resources");
  for (const language of languages) {
    if (!isRecord(language) || typeof language.configuration !== "string") continue;
    resourcePaths.push(packageResourcePath(language.configuration, "language configuration"));
  }
  if (resourcePaths.length === 0) throw new Error("Snapshot extension package is missing language configuration resources");

  const grammars = contributes.grammars;
  if (!Array.isArray(grammars) || grammars.length === 0) throw new Error("Snapshot extension package is missing syntax grammar resources");
  let grammarPathCount = 0;
  for (const grammar of grammars) {
    if (!isRecord(grammar) || typeof grammar.path !== "string") continue;
    resourcePaths.push(packageResourcePath(grammar.path, "grammar"));
    grammarPathCount += 1;
  }
  if (grammarPathCount === 0) throw new Error("Snapshot extension package is missing syntax grammar resources");

  const collectIcons = (value: unknown, key?: string, nestedUnderIcon = false): void => {
    if (typeof value === "string") {
      if (nestedUnderIcon && (value.startsWith("./") || value.startsWith("media/"))) {
        resourcePaths.push(packageResourcePath(value, "icon"));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectIcons(entry, key, nestedUnderIcon));
      return;
    }
    if (isRecord(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        collectIcons(childValue, childKey, nestedUnderIcon || childKey === "icon");
      }
    }
  };
  collectIcons(contributes);

  for (const resourcePath of resourcePaths) {
    if (!Object.hasOwn(metadata.files, resourcePath)) throw new Error(`Snapshot is missing extension package resource: ${resourcePath}`);
  }
};

export type ValidateSnapshotOptions = {
  fileSystem?: DogfoodFileSystem;
  platform?: string;
  architecture?: string;
  expectedIdentity?: string;
  allowTemporaryDirectory?: boolean;
};

export const validateSnapshot = (snapshotPath: string, options: ValidateSnapshotOptions = {}): SnapshotMetadata => {
  const fileSystem = options.fileSystem ?? fs;
  const absoluteSnapshotPath = resolve(snapshotPath);
  const rawMetadata = readJson(fileSystem, join(absoluteSnapshotPath, SNAPSHOT_METADATA_FILE), "snapshot.json");
  const metadata = metadataFromUnknown(rawMetadata);
  if (!isFullGitSha(metadata.gitSha)) throw new Error(`Snapshot Git SHA is invalid: ${metadata.gitSha}`);
  if (metadata.identity !== createSnapshotIdentity(metadata.gitSha, metadata.platform, metadata.architecture)) {
    throw new Error("Snapshot identity does not match its Git SHA, platform, and architecture");
  }
  if (!options.allowTemporaryDirectory && basename(absoluteSnapshotPath) !== metadata.identity) {
    throw new Error("Snapshot directory name does not match its metadata identity");
  }
  if (options.expectedIdentity !== undefined && metadata.identity !== options.expectedIdentity) {
    throw new Error(`Selected snapshot identity mismatch: expected ${options.expectedIdentity}, received ${metadata.identity}`);
  }
  if (options.platform !== undefined && metadata.platform !== options.platform) {
    throw new Error(`Snapshot platform mismatch: snapshot=${metadata.platform}, current=${options.platform}`);
  }
  if (options.architecture !== undefined && metadata.architecture !== options.architecture) {
    throw new Error(`Snapshot architecture mismatch: snapshot=${metadata.architecture}, current=${options.architecture}`);
  }
  if (metadata.extensionPath !== "extension") throw new Error(`Unsupported extension runtime path: ${metadata.extensionPath}`);
  const expectedEvaluatorPath = evaluatorRelativePath(metadata.platform);
  if (metadata.evaluatorPath !== expectedEvaluatorPath) throw new Error(`Unsupported evaluator runtime path: ${metadata.evaluatorPath}`);

  const manifestPaths = Object.keys(metadata.files);
  if (manifestPaths.length === 0 || manifestPaths.some((path) => !safeRuntimePath(path))) {
    throw new Error("Snapshot runtime manifest contains an invalid or empty path set");
  }
  if (manifestPaths.some((path, index) => index > 0 && compareStrings(manifestPaths[index - 1] ?? "", path) >= 0)) {
    throw new Error("Snapshot runtime manifest paths are not in deterministic sorted order");
  }
  for (const [path, digest] of Object.entries(metadata.files)) {
    if (!isRuntimeAllowlisted(path, metadata.platform)) throw new Error(`Snapshot runtime manifest contains a disallowed file: ${path}`);
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`Snapshot runtime manifest contains an invalid SHA-256 digest for ${path}`);
  }

  const requiredRuntimeFiles = [
    ...requiredExtensionFiles.map((path) => `extension/${path}`),
    metadata.evaluatorPath
  ];
  for (const requiredPath of requiredRuntimeFiles) {
    if (!Object.hasOwn(metadata.files, requiredPath)) throw new Error(`Snapshot is missing required runtime file: ${requiredPath}`);
  }
  if (!manifestPaths.some((path) => path.startsWith("extension/syntaxes/"))) {
    throw new Error("Snapshot is missing syntax runtime resources under extension/syntaxes");
  }

  const { files: actualFiles, directories: actualDirectories } = scanSnapshotTree(absoluteSnapshotPath, fileSystem);
  const expectedFiles = [...manifestPaths, SNAPSHOT_METADATA_FILE].sort(compareStrings);
  if (actualFiles.length !== expectedFiles.length || actualFiles.some((path, index) => path !== expectedFiles[index])) {
    const missing = expectedFiles.filter((path) => !actualFiles.includes(path));
    const extra = actualFiles.filter((path) => !expectedFiles.includes(path));
    throw new Error(`Snapshot runtime file set differs from its manifest; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  }
  const expectedDirectories = expectedDirectoriesForFiles(expectedFiles);
  if (actualDirectories.length !== expectedDirectories.length || actualDirectories.some((path, index) => path !== expectedDirectories[index])) {
    throw new Error("Snapshot contains directories outside the manifest runtime allowlist");
  }

  for (const [relativePath, expectedHash] of Object.entries(metadata.files)) {
    const absolutePath = runtimeFilePath(absoluteSnapshotPath, relativePath);
    if (hashFile(fileSystem, absolutePath) !== expectedHash) throw new Error(`Snapshot content hash mismatch: ${relativePath}`);
  }

  const evaluatorStat = fileSystem.statSync(runtimeFilePath(absoluteSnapshotPath, metadata.evaluatorPath));
  if (metadata.platform !== "win32" && (evaluatorStat.mode & 0o111) === 0) {
    throw new Error(`Snapshot evaluator is not executable: ${metadata.evaluatorPath}`);
  }
  assertExtensionPackageResources(absoluteSnapshotPath, metadata, fileSystem);
  return metadata;
};

const makeCurrentSelection = (identity: string): CurrentSelection => ({
  schemaVersion: DOGFOOD_SCHEMA_VERSION,
  identity
});

const readCurrentIdentityIfValid = (root: string, fileSystem: DogfoodFileSystem): string | undefined => {
  const path = join(root, CURRENT_SELECTION_FILE);
  if (!pathExists(fileSystem, path)) return undefined;
  try {
    const stat = fileSystem.lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    return currentSelectionFromUnknown(readJson(fileSystem, path, "current.json")).identity;
  } catch {
    return undefined;
  }
};

const atomicallyWriteCurrentSelection = (
  root: string,
  selection: CurrentSelection,
  dependencies: DogfoodDependencies
): void => {
  const fileSystem = dependencies.fileSystem;
  const currentPath = join(root, CURRENT_SELECTION_FILE);
  const temporaryPath = join(root, `.${CURRENT_SELECTION_FILE}.${dependencies.createTemporaryId()}.tmp`);
  let ownsTemporaryFile = false;
  try {
    const descriptor = fileSystem.openSync(temporaryPath, "wx", 0o600);
    ownsTemporaryFile = true;
    try {
      fileSystem.writeFileSync(descriptor, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
    } finally {
      fileSystem.closeSync(descriptor);
    }
    fileSystem.renameSync(temporaryPath, currentPath);
    ownsTemporaryFile = false;
  } catch (error) {
    if (ownsTemporaryFile) {
      try {
        fileSystem.unlinkSync(temporaryPath);
      } catch {
        // Keep the original publication failure; this is the unique file created above.
      }
    }
    throw new Error(`Could not atomically update ${currentPath}: ${errorMessage(error)}`, { cause: error });
  }
};

const cleanupTemporarySnapshot = (path: string, dependencies: DogfoodDependencies): void => {
  if (!pathExists(dependencies.fileSystem, path)) return;
  const stat = dependencies.fileSystem.lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing to remove unexpected temporary snapshot state: ${path}`);
  dependencies.fileSystem.rmSync(path, { recursive: true, force: false });
};

export const buildDogfood = (
  argv: readonly string[],
  dependencyOverrides: DogfoodDependencyOverrides = {}
): SnapshotMetadata => {
  const parsed = parseBuildArguments(argv);
  const dependencies = withDependencies(dependencyOverrides);
  const root = resolveDogfoodRoot(parsed.root, dependencies);
  const effectiveRepositoryPath = resolve(dependencyOverrides.repositoryPath ?? sourceRepositoryRoot);
  const gitSha = assertSourcePreconditions(effectiveRepositoryPath, dependencies);
  const identity = createSnapshotIdentity(gitSha, dependencies.platform, dependencies.architecture);
  const snapshotsDirectory = join(root, "snapshots");
  const snapshotPath = join(snapshotsDirectory, identity);
  dependencies.fileSystem.mkdirSync(snapshotsDirectory, { recursive: true });

  if (pathExists(dependencies.fileSystem, snapshotPath)) {
    const metadata = validateSnapshot(snapshotPath, {
      fileSystem: dependencies.fileSystem,
      platform: dependencies.platform,
      architecture: dependencies.architecture,
      expectedIdentity: identity
    });
    if (readCurrentIdentityIfValid(root, dependencies.fileSystem) !== identity) {
      atomicallyWriteCurrentSelection(root, makeCurrentSelection(identity), dependencies);
    }
    return metadata;
  }

  let temporarySnapshotPath: string | undefined;
  let snapshotPublished = false;
  try {
    dependencies.buildVscode(effectiveRepositoryPath);
    dependencies.buildEvaluator(effectiveRepositoryPath);

    temporarySnapshotPath = dependencies.fileSystem.mkdtempSync(join(snapshotsDirectory, `.tmp-${identity}-`));
    const files = copyRuntimeFiles(effectiveRepositoryPath, temporarySnapshotPath, dependencies.platform, dependencies.fileSystem);
    const metadata = makeMetadata(identity, gitSha, dependencies.platform, dependencies.architecture, files);
    dependencies.fileSystem.writeFileSync(
      join(temporarySnapshotPath, SNAPSHOT_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8"
    );
    validateSnapshot(temporarySnapshotPath, {
      fileSystem: dependencies.fileSystem,
      platform: dependencies.platform,
      architecture: dependencies.architecture,
      expectedIdentity: identity,
      allowTemporaryDirectory: true
    });

    if (pathExists(dependencies.fileSystem, snapshotPath)) {
      throw new Error(`Snapshot identity appeared during build; refusing to overwrite it: ${snapshotPath}`);
    }
    dependencies.fileSystem.renameSync(temporarySnapshotPath, snapshotPath);
    temporarySnapshotPath = undefined;
    snapshotPublished = true;

    const publishedMetadata = validateSnapshot(snapshotPath, {
      fileSystem: dependencies.fileSystem,
      platform: dependencies.platform,
      architecture: dependencies.architecture,
      expectedIdentity: identity
    });
    const statusAfterBuild = dependencies.getWorkingTreeStatus(effectiveRepositoryPath);
    if (statusAfterBuild !== "") {
      throw new Error(`dogfood build left the source checkout dirty; refusing to select a snapshot. git status reports:\n${statusAfterBuild}`);
    }
    if (readCurrentIdentityIfValid(root, dependencies.fileSystem) !== identity) {
      atomicallyWriteCurrentSelection(root, makeCurrentSelection(identity), dependencies);
    }
    return publishedMetadata;
  } catch (error) {
    if (temporarySnapshotPath !== undefined) {
      try {
        cleanupTemporarySnapshot(temporarySnapshotPath, dependencies);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `${errorMessage(error)}; temporary snapshot cleanup also failed: ${errorMessage(cleanupError)}`,
          { cause: cleanupError }
        );
      }
    }
    if (snapshotPublished) {
      throw new Error(`${errorMessage(error)}; the new immutable snapshot remains unselected at ${snapshotPath}`, { cause: error });
    }
    throw error;
  }
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const selectedSnapshot = (
  root: string,
  dependencies: DogfoodDependencies
): { snapshotPath: string; extensionPath: string; evaluatorPath: string; metadata: SnapshotMetadata } => {
  const currentPath = join(root, CURRENT_SELECTION_FILE);
  if (!pathExists(dependencies.fileSystem, currentPath)) {
    throw new Error(`No dogfood snapshot is selected at ${currentPath}; run npm run dogfood:build first`);
  }
  throwIfNotExists(dependencies.fileSystem, currentPath, "current.json selection record");
  const selection = currentSelectionFromUnknown(readJson(dependencies.fileSystem, currentPath, "current.json"));
  const snapshotPath = join(root, "snapshots", selection.identity);
  const metadata = validateSnapshot(snapshotPath, {
    fileSystem: dependencies.fileSystem,
    platform: dependencies.platform,
    architecture: dependencies.architecture,
    expectedIdentity: selection.identity
  });
  return {
    snapshotPath: resolve(snapshotPath),
    extensionPath: resolve(snapshotPath, ...metadata.extensionPath.split("/")),
    evaluatorPath: resolve(snapshotPath, ...metadata.evaluatorPath.split("/")),
    metadata
  };
};

export const launchDogfood = async (
  argv: readonly string[],
  dependencyOverrides: DogfoodDependencyOverrides = {}
): Promise<number> => {
  const parsed = parseLaunchArguments(argv);
  const dependencies = withDependencies(dependencyOverrides);
  const root = resolveDogfoodRoot(parsed.root, dependencies);
  const selected = selectedSnapshot(root, dependencies);
  const command = dependencies.environment.NUINUICAD_VSCODE_CLI ?? "code";
  const args = ["--new-window", `--extensionDevelopmentPath=${selected.extensionPath}`];
  if (parsed.target !== undefined) args.push(parsed.target);
  const environment: NodeJS.ProcessEnv = {
    ...dependencies.environment,
    NUINUICAD_RUST_EVALUATION_BINARY: selected.evaluatorPath
  };

  dependencies.print(`Dogfood SHA: ${selected.metadata.gitSha}`);
  dependencies.print(`Snapshot: ${selected.snapshotPath}`);

  const child = dependencies.spawn(command, args, { env: environment, stdio: "inherit" });
  return await new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", (error) => rejectExit(new Error(`Could not launch VS Code: ${errorMessage(error)}`, { cause: error })));
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
};

export const getDogfoodRepositoryRoot = (): string => sourceRepositoryRoot;
