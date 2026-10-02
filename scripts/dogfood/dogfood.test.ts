import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDogfood,
  createSnapshotIdentity,
  defaultDogfoodRoot,
  launchDogfood,
  parseBuildArguments,
  parseLaunchArguments,
  resolveDogfoodRoot,
  validateSnapshot,
  type DogfoodDependencies,
  type DogfoodDependencyOverrides,
  type DogfoodFileSystem,
  type DogfoodSpawnOptions
} from "./dogfood";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

type BuildContext = {
  parent: string;
  repositoryPath: string;
  dogfoodRoot: string;
  events: string[];
};

type GitState = {
  branch?: string;
  status?: string;
  headSha?: string;
  originMainSha?: string;
  statusCalls?: number;
};

const temporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(join(tmpdir(), "nuinuicad-dogfood-test-"));
  createdDirectories.push(directory);
  return directory;
};

const writeText = (path: string, content: string): void => {
  fs.mkdirSync(join(path, ".."), { recursive: true });
  fs.writeFileSync(path, content, "utf8");
};

const makeBuildContext = (): BuildContext => {
  const parent = temporaryDirectory();
  const repositoryPath = join(parent, "repository");
  const extensionPath = join(repositoryPath, "vscode-extension");
  fs.mkdirSync(extensionPath, { recursive: true });
  const extensionPackage = {
    name: "nuinuicad",
    main: "./dist/extension.js",
    contributes: {
      viewsContainers: { activitybar: [{ icon: "media/spline.svg" }] },
      commands: [{ icon: { light: "media/spline.svg", dark: "media/spline.svg" } }],
      languages: [{ id: "nui", configuration: "./language-configuration.json" }],
      grammars: [{ language: "nui", path: "./syntaxes/nui.tmLanguage.json" }]
    }
  };
  writeText(join(extensionPath, "package.json"), JSON.stringify(extensionPackage));
  writeText(join(extensionPath, "package.nls.json"), "{}\n");
  writeText(join(extensionPath, "package.nls.ja.json"), "{}\n");
  writeText(join(extensionPath, "language-configuration.json"), "{}\n");
  writeText(join(extensionPath, "syntaxes", "nui.tmLanguage.json"), "{\"scopeName\":\"source.nui\"}\n");
  writeText(join(extensionPath, "media", "spline.svg"), "<svg/>\n");
  writeText(join(extensionPath, "media", "nested", "extra.svg"), "<svg/>\n");
  writeText(join(extensionPath, "dist", "extension.js"), "extension runtime\n");
  writeText(join(extensionPath, "dist", "webview.js"), "webview runtime\n");
  writeText(join(extensionPath, "dist", "webview.css"), "body{}\n");

  writeText(join(extensionPath, "src", "extension.ts"), "must not ship\n");
  writeText(join(extensionPath, "README.md"), "must not ship\n");
  writeText(join(extensionPath, "dist", "webview.js.map"), "must not ship\n");
  writeText(join(extensionPath, "node_modules", "not-runtime", "index.js"), "must not ship\n");

  const evaluatorName = process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio";
  const evaluatorPath = join(repositoryPath, "rust-evaluator", "target", "release", evaluatorName);
  writeText(evaluatorPath, "release evaluator binary\n");
  if (process.platform !== "win32") fs.chmodSync(evaluatorPath, 0o755);

  return {
    parent,
    repositoryPath,
    dogfoodRoot: join(parent, "dogfood-root"),
    events: []
  };
};

const buildOverrides = (
  context: BuildContext,
  gitState: GitState = {},
  overrides: DogfoodDependencyOverrides = {}
): DogfoodDependencyOverrides => ({
  repositoryPath: context.repositoryPath,
  homeDirectory: () => context.parent,
  workingDirectory: () => context.parent,
  platform: process.platform,
  architecture: process.arch,
  environment: {},
  createTemporaryId: (() => {
    let id = 0;
    return () => `test-${++id}`;
  })(),
  fetchOrigin: () => { context.events.push("fetch"); },
  getBranch: () => gitState.branch ?? "main",
  getWorkingTreeStatus: () => {
    gitState.statusCalls = (gitState.statusCalls ?? 0) + 1;
    return gitState.status ?? "";
  },
  getHeadSha: () => gitState.headSha ?? SHA_A,
  getOriginMainSha: () => gitState.originMainSha ?? gitState.headSha ?? SHA_A,
  buildVscode: () => { context.events.push("build:vscode"); },
  buildEvaluator: () => { context.events.push("build:evaluator"); },
  print: () => undefined,
  ...overrides
});

const buildSelectedSnapshot = (context: BuildContext, sha = SHA_A): ReturnType<typeof buildDogfood> =>
  buildDogfood(["--root", context.dogfoodRoot], buildOverrides(context, { headSha: sha, originMainSha: sha }));

const snapshotPathFor = (context: BuildContext, identity: string): string =>
  join(context.dogfoodRoot, "snapshots", identity);

const currentSelectionText = (context: BuildContext): string =>
  fs.readFileSync(join(context.dogfoodRoot, "current.json"), "utf8");

const launchOverrides = (
  context: BuildContext,
  overrides: DogfoodDependencyOverrides = {}
): DogfoodDependencyOverrides => ({
  homeDirectory: () => context.parent,
  workingDirectory: () => context.parent,
  environment: {},
  platform: process.platform,
  architecture: process.arch,
  print: () => undefined,
  ...overrides
});

const failingOrSuccessfulSpawn = (
  capture: { command?: string; args?: string[]; options?: DogfoodSpawnOptions },
  exitCode = 0
): DogfoodDependencies["spawn"] => (command, args, options) => {
  capture.command = command;
  capture.args = args;
  capture.options = options;
  const child = new EventEmitter();
  queueMicrotask(() => child.emit("exit", exitCode));
  return child as unknown as Pick<import("node:child_process").ChildProcess, "once">;
};

describe("dogfood snapshot identity and paths", () => {
  it("derives an exact deterministic identity and metadata for the process tuple", () => {
    const identity = createSnapshotIdentity(SHA_A, process.platform, process.arch);
    expect(identity).toBe(`${SHA_A}-${process.platform}-${process.arch}`);

    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context, SHA_A);
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      identity,
      gitSha: SHA_A,
      platform: process.platform,
      architecture: process.arch,
      extensionPath: "extension",
      evaluatorPath: process.platform === "win32" ? "bin/evaluation_stdio.exe" : "bin/evaluation_stdio"
    });
  });

  it("resolves the default root and --root overrides to absolute paths", () => {
    const home = join(tmpdir(), "home-for-dogfood");
    const cwd = join(tmpdir(), "workdir-for-dogfood");
    expect(defaultDogfoodRoot(home)).toBe(resolve(home, ".nuinuicad", "dogfood"));
    expect(resolveDogfoodRoot(undefined, { homeDirectory: () => home, workingDirectory: () => cwd }))
      .toBe(resolve(home, ".nuinuicad", "dogfood"));
    expect(resolveDogfoodRoot("relative-dogfood", { homeDirectory: () => home, workingDirectory: () => cwd }))
      .toBe(resolve(cwd, "relative-dogfood"));
    expect(parseBuildArguments(["--root", "/tmp/dogfood"])).toEqual({ root: "/tmp/dogfood" });
    expect(() => parseBuildArguments(["--root", ""])).toThrow("Missing path after --root");
    expect(parseLaunchArguments(["--root", "/tmp/dogfood", "pattern.nui"]))
      .toEqual({ root: "/tmp/dogfood", target: "pattern.nui" });

    const context = makeBuildContext();
    const relativeRoot = "dogfood-override";
    const metadata = buildDogfood(["--root", relativeRoot], buildOverrides(context, {}, {
      workingDirectory: () => context.parent
    }));
    expect(fs.existsSync(join(context.parent, relativeRoot, "snapshots", metadata.identity, "snapshot.json"))).toBe(true);
  });
});

describe("dogfood build and immutable publication", () => {
  it("copies only allowlisted runtime resources and records deterministic content hashes", () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    const snapshotPath = snapshotPathFor(context, metadata.identity);
    const relativeFiles: string[] = [];
    const walk = (directory: string, relative = ""): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute, nextRelative);
        else relativeFiles.push(nextRelative);
      }
    };
    walk(snapshotPath);

    expect(relativeFiles.sort()).toEqual([...Object.keys(metadata.files), "snapshot.json"].sort());
    expect(Object.keys(metadata.files)).toContain("extension/package.nls.ja.json");
    expect(Object.keys(metadata.files)).toContain("extension/media/nested/extra.svg");
    expect(Object.keys(metadata.files)).toContain("extension/syntaxes/nui.tmLanguage.json");
    expect(relativeFiles).not.toContain("extension/src/extension.ts");
    expect(relativeFiles).not.toContain("extension/README.md");
    expect(relativeFiles).not.toContain("extension/dist/webview.js.map");
    expect(relativeFiles).not.toContain("extension/node_modules/not-runtime/index.js");
    expect(relativeFiles).not.toContain("rust-evaluator/target/release/evaluation_stdio");

    const extensionHash = createHash("sha256")
      .update(fs.readFileSync(join(snapshotPath, "extension", "dist", "extension.js")))
      .digest("hex");
    expect(metadata.files["extension/dist/extension.js"]).toBe(extensionHash);
    expect(validateSnapshot(snapshotPath, { platform: process.platform, architecture: process.arch })).toEqual(metadata);
  });

  it("fetches origin before accepting a fresh clean main HEAD and selects only after snapshot publication", () => {
    const context = makeBuildContext();
    const events: string[] = [];
    let originMainSha = SHA_B;
    const realFileSystem = fs as unknown as DogfoodFileSystem;
    const observedFileSystem = new Proxy(realFileSystem, {
      get(target, property) {
        if (property === "renameSync") {
          return (from: string, to: string): void => {
            if (to === join(context.dogfoodRoot, "current.json")) {
              const selectedSnapshotPath = snapshotPathFor(context, SHA_B + `-${process.platform}-${process.arch}`);
              expect(fs.existsSync(join(selectedSnapshotPath, "snapshot.json"))).toBe(true);
              expect(validateSnapshot(selectedSnapshotPath).gitSha).toBe(SHA_B);
              events.push("select-current");
            } else {
              events.push("publish-snapshot");
            }
            fs.renameSync(from, to);
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    }) as DogfoodFileSystem;
    const overrides = buildOverrides(context, { headSha: SHA_B }, {
      fileSystem: observedFileSystem,
      fetchOrigin: () => {
        context.events.push("fetch");
        originMainSha = SHA_B;
      },
      getOriginMainSha: () => originMainSha,
      buildVscode: () => context.events.push("build:vscode"),
      buildEvaluator: () => context.events.push("build:evaluator")
    });
    overrides.getWorkingTreeStatus = () => "";
    const metadata = buildDogfood(["--root", context.dogfoodRoot], overrides);

    expect(metadata.gitSha).toBe(SHA_B);
    expect(context.events.slice(0, 3)).toEqual(["fetch", "build:vscode", "build:evaluator"]);
    expect(events).toEqual(["publish-snapshot", "select-current"]);
    expect(JSON.parse(currentSelectionText(context)) as unknown).toEqual({ schemaVersion: 1, identity: metadata.identity });
  });

  it.each([
    ["build", (context: BuildContext) => buildOverrides(context, { headSha: SHA_B, originMainSha: SHA_B }, {
      buildVscode: () => { throw new Error("build rejected"); }
    })],
    ["copy", (context: BuildContext) => {
      fs.rmSync(join(context.repositoryPath, "vscode-extension", "dist", "webview.css"));
      return buildOverrides(context, { headSha: SHA_B, originMainSha: SHA_B });
    }],
    ["validation", (context: BuildContext) => {
      const base = fs as unknown as DogfoodFileSystem;
      const fileSystem = new Proxy(base, {
        get(target, property) {
          if (property === "writeFileSync") {
            const original = Reflect.get(target, property) as (...args: unknown[]) => unknown;
            return (...args: unknown[]): unknown => {
              if (typeof args[0] === "string" && args[0].endsWith("snapshot.json")) {
                const metadata = JSON.parse(String(args[1])) as Record<string, unknown>;
                metadata.schemaVersion = 99;
                return original.call(target, args[0], JSON.stringify(metadata), "utf8");
              }
              return original.apply(target, args);
            };
          }
          const value = Reflect.get(target, property) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) as DogfoodFileSystem;
      return buildOverrides(context, { headSha: SHA_B, originMainSha: SHA_B }, { fileSystem });
    }]
  ] as const)("preserves the prior current selection when %s fails", (_failureKind, getOverrides) => {
    const context = makeBuildContext();
    const initial = buildSelectedSnapshot(context, SHA_A);
    const previousSelection = currentSelectionText(context);
    expect(() => buildDogfood(["--root", context.dogfoodRoot], getOverrides(context))).toThrow();
    expect(currentSelectionText(context)).toBe(previousSelection);
    expect(validateSnapshot(snapshotPathFor(context, initial.identity)).gitSha).toBe(SHA_A);
  });

  it("rejects a checkout that becomes dirty after build and copy", () => {
    const context = makeBuildContext();
    buildSelectedSnapshot(context, SHA_A);
    const priorSelection = currentSelectionText(context);
    let statusReads = 0;
    const overrides = buildOverrides(context, { headSha: SHA_B, originMainSha: SHA_B }, {
      getWorkingTreeStatus: () => (++statusReads === 1 ? "" : " M vscode-extension/dist/extension.js")
    });
    expect(() => buildDogfood(["--root", context.dogfoodRoot], overrides)).toThrow("left the source checkout dirty");
    expect(currentSelectionText(context)).toBe(priorSelection);
  });

  it.each([
    ["dirty checkout", { status: " M src/file.ts" }, "clean working tree"],
    ["non-main checkout", { branch: "sayosomi/say-443-topic" }, "requires branch main"],
    ["HEAD mismatch", { headSha: SHA_A, originMainSha: SHA_B }, "HEAD to equal freshly fetched origin/main"]
  ] as const)("rejects a %s before running either production build", (_caseName, state, message) => {
    const context = makeBuildContext();
    const overrides = buildOverrides(context, state);
    expect(() => buildDogfood(["--root", context.dogfoodRoot], overrides)).toThrow(message);
    expect(context.events).toEqual(["fetch"]);
  });

  it("validates an existing immutable identity without rebuilding or rewriting it", () => {
    const context = makeBuildContext();
    const initial = buildSelectedSnapshot(context, SHA_A);
    const snapshotPath = snapshotPathFor(context, initial.identity);
    const metadataPath = join(snapshotPath, "snapshot.json");
    const originalMetadata = fs.readFileSync(metadataPath, "utf8");
    const buildVscode = vi.fn();
    const buildEvaluator = vi.fn();

    const repeated = buildDogfood(["--root", context.dogfoodRoot], buildOverrides(context, { headSha: SHA_A, originMainSha: SHA_A }, {
      buildVscode,
      buildEvaluator
    }));

    expect(repeated).toEqual(initial);
    expect(buildVscode).not.toHaveBeenCalled();
    expect(buildEvaluator).not.toHaveBeenCalled();
    expect(fs.readFileSync(metadataPath, "utf8")).toBe(originalMetadata);
  });

  it("rejects a corrupt existing immutable identity without overwriting it", () => {
    const context = makeBuildContext();
    const initial = buildSelectedSnapshot(context, SHA_A);
    const snapshotPath = snapshotPathFor(context, initial.identity);
    const metadataPath = join(snapshotPath, "snapshot.json");
    fs.writeFileSync(metadataPath, "corrupt immutable metadata\n", "utf8");
    const buildVscode = vi.fn();

    expect(() => buildDogfood(["--root", context.dogfoodRoot], buildOverrides(context, { headSha: SHA_A, originMainSha: SHA_A }, { buildVscode })))
      .toThrow("Malformed snapshot.json");
    expect(buildVscode).not.toHaveBeenCalled();
    expect(fs.readFileSync(metadataPath, "utf8")).toBe("corrupt immutable metadata\n");
  });

  it.each(["snapshot-directory", "current-selection"] as const)(
    "preserves the previous current selection when %s publication fails",
    (publicationBoundary) => {
      const context = makeBuildContext();
      buildSelectedSnapshot(context, SHA_A);
      const previousSelection = currentSelectionText(context);
      const base = fs as unknown as DogfoodFileSystem;
      const fileSystem = new Proxy(base, {
        get(target, property) {
          if (property === "renameSync") {
            return (from: string, to: string): void => {
              const isSnapshotPublication = to === snapshotPathFor(context, `${SHA_B}-${process.platform}-${process.arch}`);
              const isCurrentPublication = to === join(context.dogfoodRoot, "current.json");
              if ((publicationBoundary === "snapshot-directory" && isSnapshotPublication) ||
                  (publicationBoundary === "current-selection" && isCurrentPublication)) {
                throw new Error(`injected ${publicationBoundary} publication failure`);
              }
              fs.renameSync(from, to);
            };
          }
          const value = Reflect.get(target, property) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) as DogfoodFileSystem;

      expect(() => buildDogfood(["--root", context.dogfoodRoot], buildOverrides(context, {
        headSha: SHA_B,
        originMainSha: SHA_B
      }, { fileSystem }))).toThrow(`injected ${publicationBoundary} publication failure`);
      expect(currentSelectionText(context)).toBe(previousSelection);
      if (publicationBoundary === "snapshot-directory") {
        expect(fs.readdirSync(join(context.dogfoodRoot, "snapshots")).some((name) => name.startsWith(".tmp-"))).toBe(false);
      } else {
        expect(fs.existsSync(snapshotPathFor(context, `${SHA_B}-${process.platform}-${process.arch}`))).toBe(true);
      }
      expect(fs.readdirSync(context.dogfoodRoot).some((name) => name.startsWith(".current.json."))).toBe(false);
    }
  );
});

describe("dogfood launcher validation and runtime boundary", () => {
  it("rejects a platform mismatch before spawning VS Code", async () => {
    const context = makeBuildContext();
    buildSelectedSnapshot(context);
    const spawn = vi.fn();
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      platform: process.platform === "win32" ? "linux" : "win32",
      spawn: spawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("Snapshot platform mismatch");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an architecture mismatch before spawning VS Code", async () => {
    const context = makeBuildContext();
    buildSelectedSnapshot(context);
    const spawn = vi.fn();
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      architecture: `${process.arch}-other`,
      spawn: spawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("Snapshot architecture mismatch");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects malformed metadata before spawning VS Code", async () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    fs.writeFileSync(join(snapshotPathFor(context, metadata.identity), "snapshot.json"), "{\"schemaVersion\":999}\n", "utf8");
    const spawn = vi.fn();
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      spawn: spawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("unsupported or missing field");
    expect(spawn).not.toHaveBeenCalled();

    const currentContext = makeBuildContext();
    buildSelectedSnapshot(currentContext);
    fs.writeFileSync(join(currentContext.dogfoodRoot, "current.json"), "not-json\n", "utf8");
    const currentSpawn = vi.fn();
    await expect(launchDogfood(["--root", currentContext.dogfoodRoot], launchOverrides(currentContext, {
      spawn: currentSpawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("Malformed current.json");
    expect(currentSpawn).not.toHaveBeenCalled();
  });

  it("rejects missing runtime files and missing manifest entries before spawning", async () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    const snapshotPath = snapshotPathFor(context, metadata.identity);
    const missingSpawn = vi.fn();
    fs.rmSync(join(snapshotPath, "extension", "dist", "webview.css"));
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      spawn: missingSpawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("runtime file set differs");
    expect(missingSpawn).not.toHaveBeenCalled();

    const second = makeBuildContext();
    const secondMetadata = buildSelectedSnapshot(second);
    const secondSnapshotPath = snapshotPathFor(second, secondMetadata.identity);
    const alteredManifest = { ...secondMetadata.files };
    delete alteredManifest["extension/dist/webview.css"];
    fs.writeFileSync(join(secondSnapshotPath, "snapshot.json"), JSON.stringify({ ...secondMetadata, files: alteredManifest }, null, 2), "utf8");
    const missingManifestSpawn = vi.fn();
    await expect(launchDogfood(["--root", second.dogfoodRoot], launchOverrides(second, {
      spawn: missingManifestSpawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("missing required runtime file: extension/dist/webview.css");
    expect(missingManifestSpawn).not.toHaveBeenCalled();
  });

  it("rejects content hash corruption and an unusable evaluator before spawning", async () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    const snapshotPath = snapshotPathFor(context, metadata.identity);
    fs.appendFileSync(join(snapshotPath, "extension", "dist", "extension.js"), "corrupt");
    const hashSpawn = vi.fn();
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      spawn: hashSpawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("content hash mismatch");
    expect(hashSpawn).not.toHaveBeenCalled();

    const second = makeBuildContext();
    const secondMetadata = buildSelectedSnapshot(second);
    const evaluatorPath = join(snapshotPathFor(second, secondMetadata.identity), ...secondMetadata.evaluatorPath.split("/"));
    fs.rmSync(evaluatorPath);
    const evaluatorSpawn = vi.fn();
    await expect(launchDogfood(["--root", second.dogfoodRoot], launchOverrides(second, {
      spawn: evaluatorSpawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("runtime file set differs");
    expect(evaluatorSpawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("rejects a non-executable evaluator before spawning VS Code", async () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    const evaluatorPath = join(snapshotPathFor(context, metadata.identity), ...metadata.evaluatorPath.split("/"));
    fs.chmodSync(evaluatorPath, 0o644);
    const spawn = vi.fn();
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      spawn: spawn as unknown as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("not executable");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("launches a zero-target new window with only snapshot runtime paths", async () => {
    const context = makeBuildContext();
    const metadata = buildSelectedSnapshot(context);
    const capture: { command?: string; args?: string[]; options?: DogfoodSpawnOptions } = {};
    const messages: string[] = [];
    const result = await launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      environment: { NUINUICAD_VSCODE_CLI: "/custom/code", KEEP_ME: "yes" },
      spawn: failingOrSuccessfulSpawn(capture, 0),
      print: (message) => messages.push(message)
    }));

    expect(result).toBe(0);
    expect(capture.command).toBe("/custom/code");
    expect(capture.args).toEqual([
      "--new-window",
      `--extensionDevelopmentPath=${resolve(snapshotPathFor(context, metadata.identity), "extension")}`
    ]);
    expect(capture.options?.env).toMatchObject({
      KEEP_ME: "yes",
      NUINUICAD_RUST_EVALUATION_BINARY: resolve(snapshotPathFor(context, metadata.identity), ...metadata.evaluatorPath.split("/"))
    });
    expect(capture.options?.env?.NUINUICAD_RUST_EVALUATION_BINARY).not.toContain(context.repositoryPath);
    expect(capture.options?.stdio).toBe("inherit");
    expect(messages).toEqual([
      `Dogfood SHA: ${metadata.gitSha}`,
      `Snapshot: ${resolve(snapshotPathFor(context, metadata.identity))}`
    ]);
  });

  it("forwards exactly one external file or workspace target as the final argument", async () => {
    const context = makeBuildContext();
    buildSelectedSnapshot(context);
    const capture: { command?: string; args?: string[]; options?: DogfoodSpawnOptions } = {};
    await launchDogfood(["--root", context.dogfoodRoot, "workspace with spaces"], launchOverrides(context, {
      spawn: failingOrSuccessfulSpawn(capture)
    }));
    expect(capture.args?.at(-1)).toBe("workspace with spaces");
    expect(capture.args).toHaveLength(3);
  });

  it("rejects multiple positional targets and unknown options", () => {
    expect(() => parseLaunchArguments(["first.nui", "second.nui"])).toThrow("at most one");
    expect(() => parseLaunchArguments(["--surprise"])).toThrow("Unknown dogfood:launch option");
    expect(() => parseBuildArguments(["--surprise"])).toThrow("Unknown dogfood:build option");
  });

  it("propagates a VS Code spawn error as a launch failure", async () => {
    const context = makeBuildContext();
    buildSelectedSnapshot(context);
    const spawn = (): Pick<import("node:child_process").ChildProcess, "once"> => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn denied")));
      return child as unknown as Pick<import("node:child_process").ChildProcess, "once">;
    };
    await expect(launchDogfood(["--root", context.dogfoodRoot], launchOverrides(context, {
      spawn: spawn as DogfoodDependencies["spawn"]
    }))).rejects.toThrow("Could not launch VS Code: spawn denied");
  });
});
