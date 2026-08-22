import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VscodeObservationBridge } from "../../src/node/vscodeObservationBridge";
import { observeVscode } from "./vscodeObserve";

const temporaryDirectories: string[] = [];
const bridges: VscodeObservationBridge[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "nuinuicad-mcp-vscode-observe-"));
  temporaryDirectories.push(directory);
  return directory;
};

const deterministicRandom = (value: number): typeof randomBytes =>
  ((size: number) => Buffer.alloc(size, value)) as typeof randomBytes;

const observationFor = (
  documentPath: string,
  overrides: Record<string, unknown> = {}
) => ({
  activeDocumentUri: `file://${documentPath}`,
  documents: [{
    documentUri: `file://${documentPath}`,
    documentPath,
    documentVersion: 3,
    isDirty: false,
    activeSurface: "source",
    sourceSelection: {
      anchor: { line: 1, character: 2 },
      active: { line: 1, character: 2 },
      start: { line: 1, character: 2 },
      end: { line: 1, character: 2 },
      isEmpty: true
    },
    diagnostics: [],
    canvasSessionPresent: false,
    outputPreviewSessionPresent: false,
    canvas: null,
    sourceText: "nui 4\npoint A = coordinate(x: 0, y: 0)\n",
    ...overrides
  }]
});

const bridgeFor = async (
  descriptorDirectory: string,
  value: number,
  documentPath: string,
  overrides: Record<string, unknown> = {},
  sourceRequestLog?: boolean[]
) => {
  const bridge = new VscodeObservationBridge({
    descriptorDirectory,
    randomBytesFn: deterministicRandom(value),
    pid: 2000 + value,
    now: () => new Date(`2026-08-22T01:00:${String(value).padStart(2, "0")}.000Z`),
    workspaceFolderPaths: [descriptorDirectory],
    observationProvider: ({ includeSourceText }) => {
      sourceRequestLog?.push(includeSourceText);
      const observation = observationFor(documentPath, overrides);
      if (includeSourceText) return observation;
      return {
        ...observation,
        documents: observation.documents.map((document) => {
          const compact = { ...document };
          delete compact.sourceText;
          return compact;
        })
      };
    }
  });
  bridges.push(bridge);
  const descriptor = await bridge.ready;
  return { bridge, descriptor };
};

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("vscode_observe", () => {
  it("returns explicit unavailable when no live observation instance exists", async () => {
    const descriptorDirectory = temporaryDirectory();

    await expect(observeVscode({}, { descriptorDirectory, timeoutMs: 100 })).resolves.toEqual({
      status: "unavailable",
      reason: "no-instances",
      candidates: []
    });
  });

  it("selects the sole live instance, omits source text by default, and stays JSON-friendly", async () => {
    const descriptorDirectory = temporaryDirectory();
    const documentPath = join(descriptorDirectory, "only.nui");
    const { descriptor } = await bridgeFor(descriptorDirectory, 1, documentPath);

    const result = await observeVscode({}, { descriptorDirectory });

    expect(result).toMatchObject({
      status: "ok",
      instance: {
        instanceId: descriptor.instanceId,
        documentPaths: [documentPath]
      },
      indexing: {
        sourceSelection: {
          line: "zero-based",
          character: "zero-based-UTF-16-code-unit"
        }
      }
    });
    const observation = result.observation as { documents: Array<Record<string, unknown>> };
    expect(observation.documents[0]).not.toHaveProperty("sourceText");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.instance).not.toHaveProperty("authToken");
  });

  it("fetches exact current source text only after compact instance resolution", async () => {
    const descriptorDirectory = temporaryDirectory();
    const documentPath = join(descriptorDirectory, "source.nui");
    const sourceRequests: boolean[] = [];
    await bridgeFor(descriptorDirectory, 2, documentPath, {}, sourceRequests);

    const result = await observeVscode(
      { includeSourceText: true },
      { descriptorDirectory }
    );

    expect(result.status).toBe("ok");
    const observation = result.observation as { documents: Array<Record<string, unknown>> };
    expect(observation.documents[0]?.sourceText).toBe(
      "nui 4\npoint A = coordinate(x: 0, y: 0)\n"
    );
    expect(sourceRequests).toEqual([false, true]);
  });

  it("uses explicit instanceId before other candidates", async () => {
    const descriptorDirectory = temporaryDirectory();
    const firstPath = join(descriptorDirectory, "first.nui");
    const secondPath = join(descriptorDirectory, "second.nui");
    await bridgeFor(descriptorDirectory, 3, firstPath);
    const { descriptor: secondDescriptor } = await bridgeFor(descriptorDirectory, 4, secondPath);

    const result = await observeVscode(
      { instanceId: secondDescriptor.instanceId },
      { descriptorDirectory }
    );

    expect(result).toMatchObject({
      status: "ok",
      instance: {
        instanceId: secondDescriptor.instanceId,
        documentPaths: [secondPath]
      }
    });
  });

  it("selects documentPath only when exactly one live instance reports it open", async () => {
    const descriptorDirectory = temporaryDirectory();
    const requestedPath = join(descriptorDirectory, "requested.nui");
    const otherPath = join(descriptorDirectory, "other.nui");
    const { descriptor: requestedDescriptor } = await bridgeFor(
      descriptorDirectory,
      5,
      requestedPath
    );
    await bridgeFor(descriptorDirectory, 6, otherPath);

    const result = await observeVscode(
      { documentPath: requestedPath },
      { descriptorDirectory }
    );

    expect(result).toMatchObject({
      status: "ok",
      instance: { instanceId: requestedDescriptor.instanceId }
    });
  });

  it("returns explicit ambiguity instead of guessing between live candidates", async () => {
    const descriptorDirectory = temporaryDirectory();
    await bridgeFor(descriptorDirectory, 7, join(descriptorDirectory, "one.nui"));
    await bridgeFor(descriptorDirectory, 8, join(descriptorDirectory, "two.nui"));

    const result = await observeVscode({}, { descriptorDirectory });

    expect(result).toMatchObject({
      status: "ambiguous",
      reason: "multiple-instances"
    });
    expect(result.candidates).toHaveLength(2);
    expect((result.candidates as Array<Record<string, unknown>>)[0]).not.toHaveProperty("authToken");
  });

  it("returns stale instead of publishing a non-current Canvas runtime snapshot", async () => {
    const descriptorDirectory = temporaryDirectory();
    const documentPath = join(descriptorDirectory, "stale.nui");
    await bridgeFor(descriptorDirectory, 9, documentPath, {
      activeSurface: "canvas",
      canvasSessionPresent: true,
      canvas: {
        documentVersion: 2,
        selectedElementIds: ["line-ab"],
        isCurrent: false,
        isStale: true
      }
    });

    const result = await observeVscode({}, { descriptorDirectory });

    expect(result).toMatchObject({
      status: "stale",
      reason: "runtime-snapshot-not-current",
      staleDocuments: [{
        documentPath,
        documentVersion: 3,
        canvasDocumentVersion: 2,
        isCurrent: false,
        isStale: true
      }]
    });
    expect(result).not.toHaveProperty("observation");
  });
});
