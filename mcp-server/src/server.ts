import path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { inspectNuiDocument } from "./documentSnapshot";
import {
  queryNuiDocumentDefinition,
  queryNuiDocumentReferences
} from "./documentSemanticQueries";

const SERVER_NAME = "nuinuicad-mcp";
const SERVER_VERSION = "0.1.0";

const absoluteNuiPathSchema = z.string()
  .min(1)
  .refine((value) => path.isAbsolute(value), "Path must be absolute.")
  .refine((value) => path.extname(value).toLowerCase() === ".nui", "Path must reference a .nui file.")
  .describe("Absolute path to a .nui file");

const normalizedSourcePositionSchema = z.number()
  .int()
  .nonnegative()
  .describe("Zero-based UTF-16 code-unit offset in the source after CRLF is normalized to LF.");

const successfulToolResult = (result: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result) }],
  structuredContent: result
});

const failedToolResult = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const
  };
};

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
        path: absoluteNuiPathSchema
      })
    },
    async ({ path }) => {
      try {
        return successfulToolResult(await inspectNuiDocument(path));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );

  server.registerTool(
    "document_definition",
    {
      description: "Resolve the same-document declaration for a semantic reference in an exact current .nui snapshot.",
      inputSchema: z.object({
        path: absoluteNuiPathSchema,
        position: normalizedSourcePositionSchema
      })
    },
    async ({ path, position }) => {
      try {
        return successfulToolResult(await queryNuiDocumentDefinition(path, position));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );

  server.registerTool(
    "document_references",
    {
      description: "List ordered same-document references for the semantic symbol at a position in an exact current .nui snapshot.",
      inputSchema: z.object({
        path: absoluteNuiPathSchema,
        position: normalizedSourcePositionSchema
      })
    },
    async ({ path, position }) => {
      try {
        return successfulToolResult(await queryNuiDocumentReferences(path, position));
      } catch (error) {
        return failedToolResult(error);
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
