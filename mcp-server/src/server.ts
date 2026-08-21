import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { inspectNuiDocument } from "./documentSnapshot";

const SERVER_NAME = "nuinuicad-mcp";
const SERVER_VERSION = "0.1.0";

export const createNuinuiCadMcpServer = (): McpServer => {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  server.registerTool(
    "document_inspect",
    {
      description: "Inspect one absolute file-backed .nui document using the exact current source snapshot.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path to a .nui file")
      })
    },
    async ({ path }) => {
      try {
        const result = await inspectNuiDocument(path);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true
        };
      }
    }
  );

  return server;
};

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
};

export const runNuinuiCadMcpStdioServer = async (): Promise<void> => {
  await serveStdio(createNuinuiCadMcpServer);
};

if (isMainModule()) {
  runNuinuiCadMcpStdioServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
