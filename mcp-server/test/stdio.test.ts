import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = path.join(repoRoot, "mcp-server/dist/server.js");
const temporaryDirectories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  const { stat } = await import("node:fs/promises");
  try {
    await stat(serverEntry);
  } catch {
    const { execFile } = await import("node:child_process");
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
    child.stdin.end();
    if (!child.killed) child.kill();
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

type JsonRpcResponse = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

const startServer = () => {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  children.push(child);

  const responses = new Map<number, JsonRpcResponse>();
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  const protocolNoise: string[] = [];
  const stderr: string[] = [];
  const reader = createInterface({ input: child.stdout });

  reader.on("line", (line) => {
    if (!line.trim()) return;
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      protocolNoise.push(line);
      return;
    }
    if (typeof parsed.id !== "number") return;
    const waiter = pending.get(parsed.id);
    if (waiter) {
      pending.delete(parsed.id);
      waiter(parsed);
    } else {
      responses.set(parsed.id, parsed);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));

  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const responseFor = (id: number): Promise<JsonRpcResponse> => {
    const existing = responses.get(id);
    if (existing) {
      responses.delete(id);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response ${id}. stderr: ${stderr.join("")}`));
      }, 5000);
      pending.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  };

  return { child, send, responseFor, protocolNoise };
};

const initialize = async (session: ReturnType<typeof startServer>) => {
  session.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "nuinuicad-mcp-test", version: "1.0.0" }
    }
  });
  const response = await session.responseFor(1);
  expect(response.error).toBeUndefined();
  session.send({ jsonrpc: "2.0", method: "notifications/initialized" });
};

describe("nuinuiCAD MCP stdio server", () => {
  it("initializes, lists only document_inspect, calls it, and keeps stdout protocol-only", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-stdio-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "sample.nui");
    await writeFile(filePath, "nui 4\npoint A = coordinate(x: 0, y: 0)", "utf8");

    const session = startServer();
    await initialize(session);

    session.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResponse = await session.responseFor(2);
    expect(listResponse.error).toBeUndefined();
    const tools = (listResponse.result as { tools?: Array<{ name: string }> } | undefined)?.tools;
    expect(tools?.map((tool) => tool.name)).toEqual(["document_inspect"]);

    session.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "document_inspect", arguments: { path: filePath } }
    });
    const callResponse = await session.responseFor(3);
    expect(callResponse.error).toBeUndefined();
    const result = callResponse.result as {
      isError?: boolean;
      structuredContent?: { compileStatus?: string; currentSemantics?: { available?: boolean } };
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      compileStatus: "valid",
      currentSemantics: { available: true }
    });

    session.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "document_inspect", arguments: {} }
    });
    const invalidResponse = await session.responseFor(4);
    expect(invalidResponse.error).toBeUndefined();
    expect(invalidResponse.result).toMatchObject({ isError: true });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.protocolNoise).toEqual([]);
  });
});
