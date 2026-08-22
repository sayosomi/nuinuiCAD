import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  createDocumentEvaluationRuntime,
  type DocumentEvaluationDto,
  type DocumentEvaluationOptions,
  type DocumentEvaluationRuntime
} from "./documentEvaluation";
import { inspectNuiDocument } from "./documentSnapshot";
import {
  queryNuiDocumentDefinition,
  queryNuiDocumentReferences
} from "./documentSemanticQueries";
import { observeVscode } from "./vscodeObserve";

const SERVER_NAME = "nuinuicad-mcp";
const SERVER_VERSION = "0.1.0";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

type DocumentEvaluateHandler = (
  requestedPath: string,
  options: DocumentEvaluationOptions
) => Promise<DocumentEvaluationDto>;

type McpServerDependencies = {
  documentEvaluate?: DocumentEvaluateHandler;
};

let defaultEvaluationRuntime: DocumentEvaluationRuntime | null = null;

const defaultDocumentEvaluate: DocumentEvaluateHandler = async (requestedPath, options) => {
  defaultEvaluationRuntime ??= createDocumentEvaluationRuntime(repositoryRoot);
  return await defaultEvaluationRuntime.evaluate(requestedPath, options);
};

export const createNuinuiCadMcpServer = (
  dependencies: McpServerDependencies = {}
): McpServer => {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  const documentEvaluate = dependencies.documentEvaluate ?? defaultDocumentEvaluate;

  server.registerTool(
    "document_inspect",
    {
      description: "Inspect one absolute file-backed .nui document using the exact current source snapshot.",
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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

  server.registerTool(
    "document_evaluate",
    {
      description: "Evaluate one exact-current file-backed .nui document with the production Rust evaluator.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        path: absoluteNuiPathSchema,
        requestedElementIds: z.array(z.string().min(1)).max(1000).optional(),
        includeEvaluatedElementIds: z.boolean().optional()
      })
    },
    async ({ path, requestedElementIds, includeEvaluatedElementIds }) => {
      try {
        return successfulToolResult(await documentEvaluate(path, {
          ...(requestedElementIds ? { requestedElementIds } : {}),
          ...(includeEvaluatedElementIds !== undefined ? { includeEvaluatedElementIds } : {})
        }));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );

  server.registerTool(
    "vscode_observe",
    {
      description: "Observe exact-current read-only nuinuiCAD state from a live developer-enabled VS Code Extension Host.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        instanceId: z.string().min(1).optional(),
        documentPath: absoluteNuiPathSchema.optional(),
        includeSourceText: z.boolean().optional()
      })
    },
    async ({ instanceId, documentPath, includeSourceText }) => {
      try {
        return successfulToolResult(await observeVscode({
          ...(instanceId ? { instanceId } : {}),
          ...(documentPath ? { documentPath } : {}),
          ...(includeSourceText !== undefined ? { includeSourceText } : {})
        }));
      } catch (error) {
        return failedToolResult(error);
      }
    }
  );

  return server;
};

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
};

export const runNuinuiCadMcpStdioServer = async (): Promise<void> => {
  try {
    await serveStdio(() => createNuinuiCadMcpServer());
  } finally {
    defaultEvaluationRuntime?.dispose();
    defaultEvaluationRuntime = null;
  }
};

if (isMainModule()) {
  runNuinuiCadMcpStdioServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
