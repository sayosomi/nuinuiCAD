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
}, 60_000);

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
  it("lists and calls headless/VS Code tools with schema validation and protocol-only stdout", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nuinuicad-mcp-stdio-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "sample.nui");
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = offset(from: @A, dx: 1, dy: 0)",
      "point C = offset(from: @A, dx: 2, dy: 0)"
    ].join("\n");
    await writeFile(filePath, source, "utf8");
    const semanticPosition = source.indexOf("@A") + "@A".length;

    const session = startServer();
    await initialize(session);

    session.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResponse = await session.responseFor(2);
    expect(listResponse.error).toBeUndefined();
    const tools = (listResponse.result as {
      tools?: Array<{
        name: string;
        inputSchema?: { properties?: Record<string, unknown> };
        annotations?: { readOnlyHint?: boolean };
      }>;
    } | undefined)?.tools;
    expect(tools?.map((tool) => tool.name)).toEqual([
      "document_inspect",
      "document_definition",
      "document_references",
      "document_evaluate",
      "vscode_observe"
    ]);
    expect(tools?.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    const vscodeObserveTool = tools?.find((tool) => tool.name === "vscode_observe");
    expect(Object.keys(vscodeObserveTool?.inputSchema?.properties ?? {})).toEqual([
      "instanceId",
      "documentPath",
      "includeSourceText"
    ]);

    session.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "document_inspect", arguments: { path: filePath } }
    });
    const inspectResponse = await session.responseFor(3);
    expect(inspectResponse.error).toBeUndefined();
    const inspectResult = inspectResponse.result as {
      isError?: boolean;
      structuredContent?: { compileStatus?: string; currentSemantics?: { available?: boolean } };
    };
    expect(inspectResult.isError).not.toBe(true);
    expect(inspectResult.structuredContent).toMatchObject({
      compileStatus: "valid",
      currentSemantics: { available: true }
    });

    session.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "document_definition",
        arguments: { path: filePath, position: semanticPosition }
      }
    });
    const definitionResponse = await session.responseFor(4);
    expect(definitionResponse.error).toBeUndefined();
    expect(definitionResponse.result).toMatchObject({
      structuredContent: {
        status: "resolved",
        indexing: { line: "one-based" }
      }
    });

    session.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "document_references",
        arguments: { path: filePath, position: semanticPosition }
      }
    });
    const referencesResponse = await session.responseFor(5);
    expect(referencesResponse.error).toBeUndefined();
    const referencesResult = referencesResponse.result as {
      structuredContent?: { status?: string; referenceRanges?: unknown[] };
    };
    expect(referencesResult.structuredContent?.status).toBe("resolved");
    expect(referencesResult.structuredContent?.referenceRanges).toHaveLength(2);

    session.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "document_inspect", arguments: {} }
    });
    const invalidInspectResponse = await session.responseFor(6);
    expect(invalidInspectResponse.error).toBeUndefined();
    expect(invalidInspectResponse.result).toMatchObject({ isError: true });

    session.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "document_definition",
        arguments: { path: filePath, position: -1 }
      }
    });
    const invalidPositionResponse = await session.responseFor(7);
    expect(invalidPositionResponse.error).toBeUndefined();
    expect(invalidPositionResponse.result).toMatchObject({ isError: true });

    session.send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "document_references",
        arguments: { path: "relative.nui", position: 0 }
      }
    });
    const invalidPathResponse = await session.responseFor(8);
    expect(invalidPathResponse.error).toBeUndefined();
    expect(invalidPathResponse.result).toMatchObject({ isError: true });

    session.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "vscode_observe",
        arguments: { documentPath: "relative.nui" }
      }
    });
    const invalidObservationPathResponse = await session.responseFor(9);
    expect(invalidObservationPathResponse.error).toBeUndefined();
    expect(invalidObservationPathResponse.result).toMatchObject({ isError: true });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.protocolNoise).toEqual([]);
  });
});
