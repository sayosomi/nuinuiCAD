import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const buildScript = resolve(repositoryRoot, "scripts/vscode/build.mjs");
const extensionBundle = resolve(repositoryRoot, "vscode-extension/dist/extension.js");

beforeAll(async () => {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    execFile(process.execPath, [buildScript], { cwd: repositoryRoot }, (error, stdout, stderr) => {
      if (error) {
        rejectBuild(new Error(`build:vscode failed: ${stderr || stdout || error.message}`));
        return;
      }
      resolveBuild();
    });
  });
});

describe("VS Code extension build", () => {
  it("replaces Vite-only environment accesses in the Node extension bundle", async () => {
    const source = await readFile(extensionBundle, "utf8");
    expect(source).not.toMatch(
      /(?:import\.meta|import_meta\d*)\.env\.(?:DEV|VITE_EVALUATION_ENGINE)\b/
    );
  });
});
