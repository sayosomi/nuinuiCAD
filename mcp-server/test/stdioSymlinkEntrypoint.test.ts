import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = path.join(repoRoot, "mcp-server/dist/server.js");
const temporaryDirectories: string[] = [];
const children: ReturnType<typeof spawn>[] = [];

beforeAll(async () => {
  try {
    await stat(serverEntry);
  } catch {
    await new Promise<void>((resolve, reject) => {
      execFile("npm", ["run", "build:mcp"], { cwd: repoRoot }, (error, _stdout, stderr) => {
        if (error) reject(new Error(`build:mcp failed: ${stderr || error.message}`));
        else resolve();
      });
    });
  }
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.stdin?.end();
    if (!child.killed) child.kill();
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const readResponse = (
  child: ReturnType<typeof spawn>,
  id: number
): Promise<{ id?: number; result?: Record<string, unknown>; error?: unknown }> => {
  return new Promise((resolve, reject) => {
    const stderr: string[] = [];
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
    const reader = createInterface({ input: child.stdout! });
    const timeout = setTimeout(() => {
      reader.close();
      reject(new Error(`Timed out waiting for MCP response ${id}. stderr: ${stderr.join("")}`));
    }, 5000);
    reader.on("line", (line) => {
      if (!line.trim()) return;
      const response = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: unknown };
      if (response.id !== id) return;
      clearTimeout(timeout);
      reader.close();
      resolve(response);
    });
  });
};

describe("nuinuiCAD MCP stdio symlinked entrypoint", () => {
  it("serves Codex legacy initialize when Node launches the bundle through a symlinked path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-symlink-"));
    temporaryDirectories.push(directory);
    const linkedDist = path.join(directory, "linked-dist");
    await symlink(path.dirname(serverEntry), linkedDist, "dir");
    const linkedEntry = path.join(linkedDist, path.basename(serverEntry));

    const child = spawn(process.execPath, [linkedEntry], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    children.push(child);

    child.stdin!.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex-symlink-regression", version: "1.0.0" }
      }
    })}\n`);

    const initializeResponse = await readResponse(child, 1);
    expect(initializeResponse.error).toBeUndefined();
    expect(initializeResponse.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "nuinuicad-mcp", version: "0.1.0" }
    });
  });
});
