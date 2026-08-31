import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileDslDocument } from "../../src/dsl/dslDocument";
import { parseDsl } from "../../src/dsl/dslParser";
import { selectedElementSourcesForCanvasObservation } from "../../src/vscode/canvasObservation";
import { VscodeObservationBridge } from "../../src/node/vscodeObservationBridge";
import { inspectNuiDocument } from "./documentSnapshot";
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
    sourceText: "nui 1\npoint A = coordinate(x: 0, y: 0)\n",
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
        documents: observation.documents.map((document) => Object.fromEntries(
          Object.entries(document).filter(([key]) => key !== "sourceText")
        ))
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
      "nui 1\npoint A = coordinate(x: 0, y: 0)\n"
    );
    expect(sourceRequests).toEqual([false, true]);
  });

  it("projects Canvas runtime selection into the headless stable snapshot identity", async () => {
    const descriptorDirectory = temporaryDirectory();
    const documentPath = join(descriptorDirectory, "selection.nui");
    const sourceText = [
      "nui 1",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout L {",
      "  place @G(at: (0, 0))",
      "}",
      ""
    ].join("\n");
    writeFileSync(documentPath, sourceText, "utf8");
    const inspected = await inspectNuiDocument(documentPath);
    const expectedAbId = inspected.summary.elements.find((element) => element.name === "AB")?.id;
    expect(expectedAbId).toMatch(/^line-mcp-/);

    const runtimeAbId = "line-runtime-ab";
    const sourceRequests: boolean[] = [];
    await bridgeFor(descriptorDirectory, 10, documentPath, {
      activeSurface: "canvas",
      canvasSessionPresent: true,
      sourceText,
      canvas: {
        documentVersion: 3,
        selectedElementIds: [runtimeAbId],
        selectedElementSources: [{
          runtimeElementId: runtimeAbId,
          sourceStatementIndex: 2,
          elementType: "line"
        }],
        selectionSubject: { kind: "elements" },
        compiledDocumentRevision: 1,
        previewActive: false,
        evaluationRevision: 1,
        evaluationRequestRevision: 1,
        evaluationStatus: "ready",
        evaluationSource: "rust",
        rustEligible: true,
        isStale: false,
        isCurrent: true,
        errorCount: 0,
        warningCount: 0,
        errorSummaries: [],
        warningSummaries: []
      }
    }, sourceRequests);

    const result = await observeVscode({ documentPath }, { descriptorDirectory });

    expect(result.status).toBe("ok");
    const observation = result.observation as { documents: Array<Record<string, unknown>> };
    const document = observation.documents[0]!;
    const canvas = document.canvas as Record<string, unknown>;
    expect(canvas.selectedElementIds).toEqual([expectedAbId]);
    expect(canvas.runtimeSelectedElementIds).toEqual([runtimeAbId]);
    expect(document).not.toHaveProperty("sourceText");
    expect(sourceRequests).toEqual([false, true]);
  });

  it("projects compiler-backed Module selections to the same ordered identities as document_inspect", async () => {
    const descriptorDirectory = temporaryDirectory();
    const documentPath = join(descriptorDirectory, "module-selection.nui");
    const sourceText = [
      "nui 1",
      "module Inner() {",
      "  group Body {",
      "    point P = coordinate(x: 1, y: 2)",
      "  }",
      "}",
      "module Outer() {",
      "  instance Nested = Inner()",
      "  point Q = coordinate(x: 3, y: 4)",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    writeFileSync(documentPath, sourceText, "utf8");

    const parsed = parseDsl(sourceText);
    const liveCompiled = compileDslDocument(sourceText, {
      preparsed: parsed,
      assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `live:${index}`] as const))
    });
    expect(liveCompiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(liveCompiled.document).not.toBeNull();

    const liveElements = liveCompiled.document!.elements;
    const first = liveElements.find((element) => element.name === "First")!;
    const second = liveElements.find((element) => element.name === "Second")!;
    const firstNested = liveElements.find((element) => element.name === "Nested" && element.parentGroupId === first.id)!;
    const secondNested = liveElements.find((element) => element.name === "Nested" && element.parentGroupId === second.id)!;
    const firstBody = liveElements.find((element) => element.name === "Body" && element.parentGroupId === firstNested.id)!;
    const secondBody = liveElements.find((element) => element.name === "Body" && element.parentGroupId === secondNested.id)!;
    const selected = [first, secondBody, firstNested, second, firstBody];
    const selectedElementIds = selected.map((element) => element.id);
    const selectedElementSources = selectedElementSourcesForCanvasObservation(
      selectedElementIds,
      liveCompiled,
      liveElements
    );
    expect(selectedElementSources).toHaveLength(selected.length);

    const inspected = await inspectNuiDocument(documentPath);
    const inspectedById = new Map(inspected.summary.elements.map((element) => [element.id, element] as const));
    const inspectedChain = (id: string): string[] => {
      const element = inspectedById.get(id);
      if (!element) throw new Error(`missing inspected element ${id}`);
      return element.parentGroupId ? [...inspectedChain(element.parentGroupId), element.name] : [element.name];
    };
    const liveById = new Map(liveElements.map((element) => [element.id, element] as const));
    const liveChain = (id: string): string[] => {
      const element = liveById.get(id);
      if (!element) throw new Error(`missing live element ${id}`);
      return element.parentGroupId ? [...liveChain(element.parentGroupId), element.name] : [element.name];
    };
    const expectedStableIds = selected.map((element) => {
      const chain = liveChain(element.id);
      return inspected.summary.elements.find((candidate) =>
        candidate.type === element.type &&
        candidate.name === element.name &&
        JSON.stringify(inspectedChain(candidate.id)) === JSON.stringify(chain)
      )?.id;
    });
    expect(expectedStableIds.every((id): id is string => id !== undefined)).toBe(true);

    await bridgeFor(descriptorDirectory, 11, documentPath, {
      activeSurface: "canvas",
      canvasSessionPresent: true,
      sourceText,
      canvas: {
        documentVersion: 3,
        selectedElementIds,
        selectedElementSources,
        selectionSubject: { kind: "elements" },
        compiledDocumentRevision: 1,
        previewActive: false,
        evaluationRevision: 1,
        evaluationRequestRevision: 1,
        evaluationStatus: "ready",
        evaluationSource: "rust",
        rustEligible: true,
        isStale: false,
        isCurrent: true,
        errorCount: 0,
        warningCount: 0,
        errorSummaries: [],
        warningSummaries: []
      }
    });

    const result = await observeVscode({ documentPath }, { descriptorDirectory });
    expect(result.status).toBe("ok");
    const observation = result.observation as { documents: Array<Record<string, unknown>> };
    const canvas = observation.documents[0]!.canvas as Record<string, unknown>;
    expect(canvas.selectedElementIds).toEqual(expectedStableIds);
    expect(canvas.runtimeSelectedElementIds).toEqual(selectedElementIds);
  });

  it("fails closed without a partial stable/runtime selection when proof is incomplete or duplicated", async () => {
    const sourceText = "nui 1\npoint A = coordinate(x: 0, y: 0)\n";

    const cases = [
      [{ runtimeElementId: "runtime-a", sourceStatementIndex: 1, elementType: "freePoint" }],
      [
        { runtimeElementId: "runtime-a", sourceStatementIndex: 1, elementType: "freePoint" },
        { runtimeElementId: "runtime-a", sourceStatementIndex: 1, elementType: "freePoint" }
      ],
      [
        { runtimeElementId: "runtime-a", runtimeKind: "moduleBody", sourceStatementPath: [-1] },
        { runtimeElementId: "runtime-b", runtimeKind: "moduleBody", sourceStatementPath: [1] }
      ]
    ];
    for (const [index, selectedElementSources] of cases.entries()) {
      const descriptorDirectory = temporaryDirectory();
      const documentPath = join(descriptorDirectory, "invalid-selection.nui");
      writeFileSync(documentPath, sourceText, "utf8");
      const bridge = await bridgeFor(
        descriptorDirectory,
        12 + index,
        documentPath,
        {
          activeSurface: "canvas",
          canvasSessionPresent: true,
          sourceText,
          canvas: {
            documentVersion: 3,
            selectedElementIds: ["runtime-a", "runtime-b"],
            selectedElementSources,
            selectionSubject: { kind: "elements" },
            compiledDocumentRevision: 1,
            previewActive: false,
            evaluationRevision: 1,
            evaluationRequestRevision: 1,
            evaluationStatus: "ready",
            evaluationSource: "rust",
            rustEligible: true,
            isStale: false,
            isCurrent: true,
            errorCount: 0,
            warningCount: 0,
            errorSummaries: [],
            warningSummaries: []
          }
        }
      );
      expect(bridge.descriptor.instanceId).toBeDefined();
      const result = await observeVscode({ documentPath }, { descriptorDirectory });
      expect(result.status).toBe("ok");
      const observation = result.observation as { documents: Array<Record<string, unknown>> };
      const canvas = observation.documents[0]!.canvas as Record<string, unknown>;
      expect(canvas.selectedElementIds).toEqual(["runtime-a", "runtime-b"]);
      expect(canvas).not.toHaveProperty("runtimeSelectedElementIds");
    }
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
