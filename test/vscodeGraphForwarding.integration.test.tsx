import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  analyzeDslLintDiagnostics, compileDslDocument, createModuleRuntimeContext,
  geometryValueOccurrenceKey
} from "@nuinuicad/nui-language";
import { compileFreshCanonicalText, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics, buildMultiDocumentImportGraph,
  documentIdFromHost, moduleDeclarationContributor
} from "@nuinuicad/nui-language/workspace";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult } from "../src/geometry/evaluationPayload";
import { buildRustEvaluationInput, type EvaluateDocumentInput } from "../src/geometry/rustEvaluationInput";
import { useEvaluationEngine } from "../src/geometry/useEvaluationEngine";
import type { EvaluationResult } from "../src/types/geometry";
import { initialCadDocumentState, useCadDocumentStore } from "../src/state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../src/state/cadUiStore";
import { VSCodeApp } from "../src/vscode/VSCodeApp";
import * as vscode from "vscode";
import { createVscodeModuleMultiDocumentHost } from "../vscode-extension/src/moduleMultiDocumentHost";
import { VscodeWebviewSessionRegistry } from "../src/vscode/vscodeWebviewSession";
import type { CanvasHostAdapter } from "../src/components/canvasHostAdapter";
import { compileModulePreviewRoot } from "../src/dsl/modulePreviewRoot";
import { queryModulePreviewTarget } from "../src/dsl/modulePreviewTarget";
import { buildModulePreviewEvaluationOptions } from "../src/vscode/modulePreviewEvaluation";
import type { VscodeMultiDocumentGraphPublication } from "../src/vscode/multiDocumentGraphTransport";
import { projectVscodeMultiDocumentCanvasRuntime } from "../src/vscode/multiDocumentRuntimeTransport";
import {
  buildIssue1651ImportedModuleCanvasEditFixture,
  issue1651DocumentVersion,
  issue1651RootDocumentUri
} from "../src/vscode/testSupport/issue1651ImportedModuleCanvasEditFixture";
import type { VscodeToExtensionMessage } from "../src/vscode/protocol";
import { createRustStdioParityClient, normalizeParityPayload } from "./evaluationParitySupport";

const canvas = vi.hoisted(() => ({
  evaluation: null as EvaluationResult | null,
  evaluateReferencePickCandidate: null as ((compiled: LastGoodDslDocument) => Promise<EvaluationResult>) | null,
  props: null as Record<string, unknown> | null
}));
type HostTestUri = { scheme: string; fsPath: string; toString: () => string };
type HostTestDocument = {
  uri: HostTestUri;
  fileName: string;
  version: number;
  isDirty: boolean;
  getText: () => string;
  offsetAt: (position: { line: number; character: number }) => number;
  positionAt: (offset: number) => { line: number; character: number };
};
const vscodeHost = vi.hoisted(() => ({
  documents: [] as HostTestDocument[],
  files: new Map<string, Uint8Array>(),
  openListeners: [] as Array<(document: HostTestDocument) => void>,
  changeListeners: [] as Array<(event: { document: HostTestDocument; contentChanges?: readonly unknown[] }) => void>,
  saveListeners: [] as Array<(document: HostTestDocument) => void>,
  closeListeners: [] as Array<(document: HostTestDocument) => void>,
  watcherChangeListeners: [] as Array<(uri: HostTestUri) => void>,
  watcherCreateListeners: [] as Array<(uri: HostTestUri) => void>,
  watcherDeleteListeners: [] as Array<(uri: HostTestUri) => void>
}));
const drawingSurface = vi.hoisted(() => ({ props: null as {
  hostAdapter: CanvasHostAdapter;
  evaluation: EvaluationResult;
  evaluationState?: { evaluationRevision?: number; isStale?: boolean };
} | null }));

vi.mock("vscode", () => {
  const fileUri = (filePath: string): HostTestUri => {
    const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
    return { scheme: "file", fsPath: normalized, toString: () => `file://${normalized}` };
  };
  class Position { constructor(public readonly line: number, public readonly character: number) {} }
  class Range { constructor(public readonly start: Position, public readonly end: Position) {} }
  class CompletionItem { constructor(public readonly label: string, public readonly kind: number) {} }
  class Location { constructor(public readonly uri: HostTestUri, public readonly range: Range) {} }
  class WorkspaceEdit { replace(): void {} }
  class FileSystemError extends Error { constructor(message: string, public readonly code?: string) { super(message); } }
  const disposable = () => ({ dispose: () => undefined });
  return {
    workspace: {
      get textDocuments() { return vscodeHost.documents; },
      fs: { readFile: async (uri: HostTestUri) => {
        const bytes = vscodeHost.files.get(uri.fsPath);
        if (!bytes) throw new FileSystemError(`missing ${uri.fsPath}`, "FileNotFound");
        return bytes;
      } },
      findFiles: async () => [],
      onDidOpenTextDocument: (listener: (document: HostTestDocument) => void) => { vscodeHost.openListeners.push(listener); return disposable(); },
      onDidChangeTextDocument: (listener: (event: { document: HostTestDocument; contentChanges?: readonly unknown[] }) => void) => { vscodeHost.changeListeners.push(listener); return disposable(); },
      onDidSaveTextDocument: (listener: (document: HostTestDocument) => void) => { vscodeHost.saveListeners.push(listener); return disposable(); },
      onDidCloseTextDocument: (listener: (document: HostTestDocument) => void) => { vscodeHost.closeListeners.push(listener); return disposable(); },
      createFileSystemWatcher: () => ({
        dispose: () => undefined,
        onDidChange: (listener: (uri: HostTestUri) => void) => { vscodeHost.watcherChangeListeners.push(listener); return disposable(); },
        onDidCreate: (listener: (uri: HostTestUri) => void) => { vscodeHost.watcherCreateListeners.push(listener); return disposable(); },
        onDidDelete: (listener: (uri: HostTestUri) => void) => { vscodeHost.watcherDeleteListeners.push(listener); return disposable(); }
      })
    },
    Uri: {
      file: fileUri,
      parse: (value: string) => value.startsWith("file://")
        ? fileUri(value.slice("file://".length))
        : { scheme: value.split(":", 1)[0] ?? "", fsPath: "", toString: () => value }
    },
    Position,
    Range,
    CompletionItem,
    CompletionItemKind: { Property: 1, Function: 2, Value: 3 },
    env: { language: "en" },
    Location,
    WorkspaceEdit,
    FileSystemError
  };
}, { virtual: true });

vi.mock("../src/vscode/VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: (props: {
    evaluationState: { evaluation: EvaluationResult };
    evaluateReferencePickCandidate: (compiled: LastGoodDslDocument) => Promise<EvaluationResult>;
  }) => {
    canvas.evaluation = props.evaluationState.evaluation;
    canvas.evaluateReferencePickCandidate = props.evaluateReferencePickCandidate;
    canvas.props = props as unknown as Record<string, unknown>;
    return <div data-testid="canvas" />;
  }
}));
vi.mock("../src/vscode/VSCodeBenchmarkCaptureRunner", () => ({ VSCodeBenchmarkCaptureRunner: () => null }));
vi.mock("../src/components/DrawingCanvas", () => ({
  DrawingCanvas: (props: {
    hostAdapter: CanvasHostAdapter;
    evaluation: EvaluationResult;
    evaluationState?: { evaluationRevision?: number; isStale?: boolean };
  }) => {
    drawingSurface.props = props;
    return <div data-testid="drawing-surface" />;
  }
}));

const source = `nui 1

record Measurements(bust: number)
const M: Measurements = Measurements(bust: 830)

point E = coordinate(x: 10, y: 20)
const dart_width: number = M.bust / 32 - 8

const P: point = polar(
  from: E,
  angle: 0,
  distance: dart_width
)

line ProbeLine = segment(
  start: E,
  end: P
)

point Probe = coordinate(
  x: P.x,
  y: P.y + 10
)`;

// The same graph-backed compiler products used by the VS Code root, even
// without imports. This deliberately does not substitute a model-only fixture.
const compileRoot = async (text: string): Promise<LastGoodDslDocument> => {
  const root = {
    kind: "root-current" as const, documentId: documentIdFromHost("file:///tmp/issue1541.nui"),
    normalizedSource: text, sourceRevision: 1
  };
  const graph = await buildMultiDocumentImportGraph({
    root, declarationContributors: [moduleDeclarationContributor],
    loader: { loadSavedDependency: async () => ({ status: "failed", reason: "missing" }) }
  });
  const analysis = analyzeMultiDocumentModuleSemantics(graph);
  const context = createModuleRuntimeContext(graph, analysis);
  expect(graph.valid && analysis.valid && context.valid).toBe(true);
  const artifact = graph.nodes.get(root.documentId)!.artifact;
  const compiled = compileDslDocument(text, {
    preparsed: artifact.parsed, assignedStatementIds: artifact.statementIdByStatementIndex,
    sourceRevision: 1, moduleRuntimeContext: context
  });
  expect(compiled.diagnostics).toEqual([]);
  expect(compiled.document).not.toBeNull();
  expect(projectVscodeMultiDocumentCanvasRuntime({ graph, compiled, graphRevision: 1 })).toBeNull();
  return compiled as LastGoodDslDocument;
};

const expectGeometry = (evaluation: EvaluationResult, x = 27.9375) => {
  expect(evaluation.errors).toEqual([]);
  expect(evaluation.geometryValueErrors ?? []).toEqual([]);
  const byName = (name: string) => [...evaluation.computedGeometry.values()].find(g => g.name === name);
  expect(byName("E")).toMatchObject({ kind: "point", x: 10, y: 20 });
  expect(byName("ProbeLine")).toMatchObject({
    kind: "line", start: { x: 10, y: 20 }, end: { x, y: 20 }, length: x - 10
  });
  expect(byName("Probe")).toMatchObject({ kind: "point", x, y: 30 });
};

describe("Issue #1541 VS Code dependency forwarding into production Rust", () => {
  let rust: ReturnType<typeof createRustStdioParityClient>;
  beforeAll(() => {
    const startedAt = performance.now();
    try {
      const prebuiltBinaryPath = inject("rustStdioParityBinaryPath" as never) as unknown;
      if (typeof prebuiltBinaryPath !== "string" || !prebuiltBinaryPath) {
        throw new Error("Vitest did not provide a prebuilt Rust evaluation binary path");
      }
      rust = createRustStdioParityClient(process.cwd(), { prebuiltBinaryPath });
    } finally {
      console.info(`[nuinuicad] vscodeGraphForwarding beforeAll: ${(performance.now() - startedAt).toFixed(1)} ms`);
    }
  }, 30000);
  afterAll(() => { rust?.dispose(); });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vscodeHost.documents = [];
    vscodeHost.files.clear();
    vscodeHost.openListeners = [];
    vscodeHost.changeListeners = [];
    vscodeHost.saveListeners = [];
    vscodeHost.closeListeners = [];
    vscodeHost.watcherChangeListeners = [];
    vscodeHost.watcherCreateListeners = [];
    vscodeHost.watcherDeleteListeners = [];
    drawingSurface.props = null;
    canvas.props = null;
  });

  it("reopens Stage 8 with current Source diagnostics and a coherent graph-backed Canvas frame", async () => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    canvas.evaluation = null;

    const fixtureDirectory = join(process.cwd(), "test/fixtures/issue-1710");
    const miniLibrary = readFileSync(join(fixtureDirectory, "mini_lib.nui"), "utf8");
    const validSource = readFileSync(join(fixtureDirectory, "stage8.nui"), "utf8");
    const emptyLibrary = readFileSync(join(fixtureDirectory, "empty_lib.nui"), "utf8");
    const stage9Source = readFileSync(join(fixtureDirectory, "stage9.nui"), "utf8");
    const invalidSource = validSource.replace(
      "line Probe = segment(start: Visible.start, end: (120, 0))",
      "line Probe = segment(start: Missing.start, end: (120, 0))"
    );
    expect(invalidSource).not.toBe(validSource);
    const rootPath = "/tmp/issue-1710/stage8.nui";
    const libraryPath = "/tmp/issue-1710/mini_lib.nui";
    const emptyLibraryPath = "/tmp/issue-1710/empty_lib.nui";
    let sourceText = validSource;
    const uri = vscode.Uri.file(rootPath) as unknown as HostTestUri;
    const document: HostTestDocument = {
      uri,
      fileName: rootPath,
      version: 1,
      isDirty: false,
      getText: () => sourceText,
      offsetAt: ({ line, character }) => {
        const lines = sourceText.split("\n");
        return lines.slice(0, line).reduce((total, value) => total + value.length + 1, 0) + character;
      },
      positionAt: (offset) => {
        const prefix = sourceText.slice(0, offset).split("\n");
        return { line: prefix.length - 1, character: prefix.at(-1)!.length };
      }
    };
    vscodeHost.documents = [document];
    vscodeHost.files.set(libraryPath, new TextEncoder().encode(miniLibrary));

    const registry = new VscodeWebviewSessionRegistry();
    const publications: VscodeMultiDocumentGraphPublication[] = [];
    registry.set({
      documentUri: uri.toString(),
      surfaceKind: "canvas",
      receiveMultiDocumentGraphPublication: publication => {
        publications.push(publication);
        act(() => window.dispatchEvent(new MessageEvent("message", { data: publication })));
      }
    });

    const requests: Array<{ id: number; input: EvaluateDocumentInput }> = [];
    const completions = new Set<number>();
    const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
      if (message.type !== "rustEvaluationRequest") return;
      requests.push({ id: message.id, input: message.input });
      void rust.evaluateInput(message.input).then(
        payload => {
          completions.add(message.id);
          act(() => window.dispatchEvent(new MessageEvent("message", {
            data: { type: "rustEvaluationResponse", id: message.id, payload }
          })));
        },
        error => act(() => window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationError", id: message.id, error: String(error) }
        })))
      );
    }) };
    const app = render(<VSCodeApp api={api} />);
    const host = createVscodeModuleMultiDocumentHost();
    try {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "replaceTextDocument", sourceText: validSource, documentVersion: 1, hostDocumentUri: uri.toString()
        } }));
      });
      host.start();
      await waitFor(() => expect(publications.at(-1)?.status).toBe("current"));
      await waitFor(() => {
        expect(canvas.evaluation?.errors).toEqual([]);
        expect([...canvas.evaluation!.computedGeometry.values()].filter(g => g.name === "Visible" || g.name === "Probe")).toHaveLength(2);
      });
      const initialPublication = publications.at(-1);
      expect(initialPublication).toMatchObject({ status: "current", documentVersion: 1, graph: { rootSource: { normalizedSource: validSource } } });
      if (initialPublication?.status !== "current") throw new Error("Stage 8 Host did not publish its initial graph");
      expect(initialPublication.canvasRuntime?.graphRevision).toBe(initialPublication.graph.revision);
      expect(requests.at(-1)?.input.elements.map(element => element.name)).toEqual(
        initialPublication.canvasRuntime?.preparedRustEvaluation.input.elements.map(element => element.name)
      );
      expect(requests.some(request => completions.has(request.id))).toBe(true);
      const initialCanvasProps = canvas.props;
      expect(initialCanvasProps).not.toBeNull();
      const realCanvasModule = await vi.importActual<typeof import("../src/vscode/VSCodeDrawingCanvas")>("../src/vscode/VSCodeDrawingCanvas");
      const canvasView = render(<realCanvasModule.VSCodeDrawingCanvas {...initialCanvasProps as never} />);
      const initialSurface = drawingSurface.props;
      expect(initialSurface?.hostAdapter.elements.map(element => element.name)).toContain("Visible");
      expect(initialSurface?.hostAdapter.elements.map(element => element.name)).toContain("Probe");
      expect(initialSurface?.evaluation.errors).toEqual([]);
      const initialGeometry = new Map([...initialSurface!.evaluation.computedGeometry.values()].map(element => [element.name, element]));
      expect(initialGeometry.get("Visible")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 80, y: 0 }
      });
      expect(initialGeometry.get("Probe")).toMatchObject({
        kind: "line", start: { x: 0, y: 0 }, end: { x: 120, y: 0 }
      });
      canvasView.unmount();

      sourceText = invalidSource;
      document.version = 2;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document, contentChanges: [{ text: invalidSource }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: invalidSource, documentVersion: 2, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 2 }));
      const invalidPublication = publications.at(-1);
      if (invalidPublication?.status !== "current") throw new Error("Stage 8 Host did not publish the invalid current graph");
      const sourceDiagnostics = host.diagnosticsStateFor(document as unknown as vscode.TextDocument);
      expect(sourceDiagnostics.status).toBe("current");
      const graphDiagnostics = sourceDiagnostics.status === "current" && sourceDiagnostics.owner === "multi-document"
        ? sourceDiagnostics.snapshot.diagnostics
        : [];
      if (sourceDiagnostics.status === "current" && sourceDiagnostics.owner === "multi-document") {
        expect(sourceDiagnostics.snapshot.documentVersion).toBe(invalidPublication.documentVersion);
        expect(sourceDiagnostics.snapshot.graphRevision).toBe(invalidPublication.graph.revision);
        expect(sourceDiagnostics.snapshot.graph.rootSource).toMatchObject(invalidPublication.graph.rootSource);
        expect(sourceDiagnostics.snapshot.compiled?.spans.sourceMap.source).toBe(invalidSource);
        expect(sourceDiagnostics.snapshot.compiled?.spans.sourceMap.sourceRevision)
          .toBe(invalidPublication.graph.rootSource.sourceRevision);
        expect(sourceDiagnostics.snapshot.compiled?.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({
            severity: "warning",
            code: "undefined-geometry-reference",
            message: expect.stringContaining("Missing"),
            exactSpanOnly: true,
            line: 8,
            column: 1
          })
        ]));
      }
      expect(graphDiagnostics, JSON.stringify({
        publication: {
          documentVersion: invalidPublication.documentVersion,
          graphRevision: invalidPublication.graph.revision,
          sourceRevision: invalidPublication.graph.rootSource.sourceRevision,
          graphValid: invalidPublication.graph.valid,
          runtimeGraphRevision: invalidPublication.canvasRuntime?.graphRevision ?? null
        },
        compiledRootDiagnostics: sourceDiagnostics.status === "current" && sourceDiagnostics.owner === "multi-document"
          ? sourceDiagnostics.snapshot.compiled?.diagnostics
          : [],
        projectedDiagnostics: graphDiagnostics
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Missing") })
      ]));
      const referenceDiagnostic = graphDiagnostics.find(diagnostic => diagnostic.message.includes("Missing"))!;
      const expectedRange = { from: invalidSource.indexOf("Missing"), to: invalidSource.indexOf("Missing") + "Missing".length };
      expect(referenceDiagnostic.location.range).toEqual(expectedRange);
      expect(invalidPublication.graph.rootSource.normalizedSource).toBe(invalidSource);

      await waitFor(() => expect(canvas.props?.staleCanvasPresentation).toMatchObject({
        status: "ready",
        currentGraphRevision: invalidPublication.graph.revision,
        currentSourceRevision: invalidPublication.graph.rootSource.sourceRevision
      }));
      expect(invalidPublication.canvasRuntime?.staleForCurrent).toEqual({
        status: "stale",
        graphRevision: invalidPublication.graph.revision,
        sourceRevision: invalidPublication.graph.rootSource.sourceRevision
      });
      expect(invalidPublication.canvasRuntime?.graphRevision).toBeLessThan(invalidPublication.graph.revision);
      expect(invalidPublication.canvasRuntime?.rootSourceRevision)
        .toBeLessThan(invalidPublication.graph.rootSource.sourceRevision);
      const reopenedCanvas = render(<realCanvasModule.VSCodeDrawingCanvas {...canvas.props as never} />);
      const reopenedSurface = drawingSurface.props;
      const presentedNames = reopenedSurface?.hostAdapter.elements.map(element => element.name) ?? [];
      expect({
        graphRevision: invalidPublication.graph.revision,
        sourceRevision: invalidPublication.graph.rootSource.sourceRevision,
        runtimeGraphRevision: invalidPublication.canvasRuntime?.graphRevision ?? null,
        presentedNames,
        evaluationRevision: reopenedSurface?.evaluationState?.evaluationRevision,
        evaluationIsStale: reopenedSurface?.evaluationState?.isStale
      }).toMatchObject({
        graphRevision: invalidPublication.graph.revision,
        sourceRevision: invalidPublication.graph.rootSource.sourceRevision,
        runtimeGraphRevision: initialPublication.graph.revision,
        presentedNames: expect.arrayContaining(["Visible", "Probe"]),
        evaluationRevision: initialPublication.graph.revision,
        evaluationIsStale: true
      });
      expect(reopenedSurface?.hostAdapter.elements.some(element => element.name === "Visible")).toBe(true);
      expect(reopenedCanvas.getByTestId("stale-canvas-status").textContent).toContain("display only");
      expect(reopenedCanvas.getByTestId("stale-canvas-status").textContent).toContain("Review Source diagnostics");
      const staleVisible = reopenedSurface?.hostAdapter.elements.find(element => element.name === "Visible");
      expect(staleVisible).toBeDefined();
      if (staleVisible) {
        expect(reopenedSurface?.hostAdapter.selectElement(staleVisible.id, "replace", false)).toBe(false);
        expect(reopenedSurface?.hostAdapter.movePointElementByDelta({
          elementId: staleVisible.id,
          dx: 1,
          dy: 0,
          angleLocked: false,
          distanceLocked: false,
          commitMode: "commit",
          baseElements: reopenedSurface.hostAdapter.elements
        })).toBe(false);
      }
      reopenedCanvas.unmount();

      // Closing/reopening the Host root must publish a new exact graph revision and
      // leave the Source error observable instead of relying on session-local state.
      for (const listener of vscodeHost.closeListeners) listener(document);
      const reopenedDocument = { ...document, getText: () => sourceText, version: 2 };
      vscodeHost.documents = [reopenedDocument];
      for (const listener of vscodeHost.openListeners) listener(reopenedDocument);
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 2 }));
      const freshPublication = publications.at(-1);
      if (freshPublication?.status !== "current") throw new Error("Stage 8 Host did not republish after reopen");
      expect(freshPublication.graph.revision).toBeGreaterThan(invalidPublication.graph.revision);
      expect(freshPublication.graph.rootSource.normalizedSource).toBe(invalidSource);
      const reopenedSourceDiagnostics = host.diagnosticsStateFor(reopenedDocument as unknown as vscode.TextDocument);
      expect(reopenedSourceDiagnostics.status).toBe("current");
      if (reopenedSourceDiagnostics.status === "current" && reopenedSourceDiagnostics.owner === "multi-document") {
        expect(reopenedSourceDiagnostics.snapshot.graphRevision).toBe(freshPublication.graph.revision);
        expect(reopenedSourceDiagnostics.snapshot.compiled?.spans.sourceMap.sourceRevision)
          .toBe(freshPublication.graph.rootSource.sourceRevision);
        expect(reopenedSourceDiagnostics.snapshot.diagnostics.find(diagnostic => diagnostic.message.includes("Missing"))?.location.range)
          .toEqual(expectedRange);
      }

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "replaceTextDocument", sourceText: invalidSource, documentVersion: 2, hostDocumentUri: uri.toString()
        } }));
        window.dispatchEvent(new MessageEvent("message", { data: freshPublication }));
      });
      await waitFor(() => expect(canvas.props?.staleCanvasPresentation).toMatchObject({
        status: "ready",
        currentGraphRevision: freshPublication.graph.revision,
        currentSourceRevision: freshPublication.graph.rootSource.sourceRevision
      }));
      const freshlyReopenedCanvas = render(<realCanvasModule.VSCodeDrawingCanvas {...canvas.props as never} />);
      const freshSurface = drawingSurface.props;
      expect(freshSurface?.hostAdapter.elements.map(element => element.name)).toEqual(expect.arrayContaining(["Visible", "Probe"]));
      expect(freshSurface?.evaluationState?.isStale).toBe(true);
      expect(freshlyReopenedCanvas.getByTestId("stale-canvas-status").textContent).toContain(
        `Current graph revision ${freshPublication.graph.revision}`
      );
      freshlyReopenedCanvas.unmount();

      sourceText = validSource;
      reopenedDocument.version = 3;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document: reopenedDocument, contentChanges: [{ text: validSource }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: validSource, documentVersion: 3, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 3 }));
      await waitFor(() => {
        expect(canvas.evaluation?.errors).toEqual([]);
        expect([...canvas.evaluation?.computedGeometry.values() ?? []].filter(g => g.name === "Visible" || g.name === "Probe"))
          .toHaveLength(2);
      });
      const recoveredPublication = publications.at(-1);
      expect(recoveredPublication?.status).toBe("current");
      if (recoveredPublication?.status !== "current") throw new Error("Stage 8 Host did not recover");
      expect(recoveredPublication.canvasRuntime?.graphRevision).toBe(recoveredPublication.graph.revision);
      expect(recoveredPublication.canvasRuntime?.staleForCurrent).toBeUndefined();
      expect([...canvas.evaluation!.computedGeometry.values()].filter(g => g.name === "Visible" || g.name === "Probe")).toHaveLength(2);
      await waitFor(() => expect(canvas.props?.multiDocumentRuntimePresentation).toMatchObject({
        graphRevision: recoveredPublication.graph.revision,
        rootSourceRevision: recoveredPublication.graph.rootSource.sourceRevision
      }));
      const recoveredCanvas = render(<realCanvasModule.VSCodeDrawingCanvas {...canvas.props as never} />);
      expect(drawingSurface.props?.hostAdapter.elements.map(element => element.name)).toEqual(expect.arrayContaining(["Visible", "Probe"]));
      expect(drawingSurface.props?.evaluationState?.isStale).not.toBe(true);
      expect(recoveredCanvas.queryByTestId("stale-canvas-status")).toBeNull();
      recoveredCanvas.unmount();
      const reopenedRecoveredCanvas = render(<realCanvasModule.VSCodeDrawingCanvas {...canvas.props as never} />);
      expect(drawingSurface.props?.hostAdapter.elements.map(element => element.name)).toEqual(expect.arrayContaining(["Visible", "Probe"]));
      expect(drawingSurface.props?.evaluationState?.isStale).not.toBe(true);
      reopenedRecoveredCanvas.unmount();

      // Stage 9's empty imported Module remains a normal current graph, while
      // a no-import/no-instance control must not inherit the Issue 1710 stale path.
      vscodeHost.files.set(emptyLibraryPath, new TextEncoder().encode(emptyLibrary));
      sourceText = stage9Source;
      reopenedDocument.version = 4;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document: reopenedDocument, contentChanges: [{ text: stage9Source }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: stage9Source, documentVersion: 4, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 4 }));
      const stage9Publication = publications.at(-1);
      if (stage9Publication?.status !== "current") throw new Error("Stage 9 Host did not publish its graph");
      await waitFor(() => {
        expect(canvas.evaluation?.errors).toEqual([]);
        expect([...canvas.evaluation?.computedGeometry.values() ?? []].filter(g => g.name === "Visible" || g.name === "Probe"))
          .toHaveLength(2);
      });
      expect(stage9Publication.graph.valid).toBe(true);
      expect(stage9Publication.canvasRuntime?.graphRevision).toBe(stage9Publication.graph.revision);
      expect(stage9Publication.canvasRuntime?.staleForCurrent).toBeUndefined();
      expect([...canvas.evaluation!.computedGeometry.values()].filter(g => g.name === "Visible" || g.name === "Probe"))
        .toHaveLength(2);
      expect(canvas.props?.staleCanvasPresentation).toBeNull();
      await waitFor(() => expect(canvas.props?.multiDocumentRuntimePresentation).toMatchObject({
        graphRevision: stage9Publication.graph.revision,
        rootSourceRevision: stage9Publication.graph.rootSource.sourceRevision
      }));
      const stage9Canvas = render(<realCanvasModule.VSCodeDrawingCanvas {...canvas.props as never} />);
      expect(drawingSurface.props?.hostAdapter.elements.map(element => element.name)).toEqual(expect.arrayContaining(["Visible", "Probe"]));
      expect(stage9Canvas.queryByTestId("stale-canvas-status")).toBeNull();
      stage9Canvas.unmount();

      const noImportSource = [
        "nui 1",
        "",
        "point Base = coordinate(x: 0, y: 0)",
        "line Visible = segment(start: Base, end: (80, 0))",
        "line Probe = segment(start: Visible.start, end: (120, 0))"
      ].join("\n");
      sourceText = noImportSource;
      reopenedDocument.version = 5;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document: reopenedDocument, contentChanges: [{ text: noImportSource }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: noImportSource, documentVersion: 5, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 5 }));
      const noImportPublication = publications.at(-1);
      if (noImportPublication?.status !== "current") throw new Error("No-import Host did not publish its graph");
      await waitFor(() => {
        expect(canvas.evaluation?.errors).toEqual([]);
        expect([...canvas.evaluation?.computedGeometry.values() ?? []].filter(g => g.name === "Visible" || g.name === "Probe"))
          .toHaveLength(2);
      });
      expect(noImportPublication.graph.nodes.flatMap(node => node.publicEntries)).toEqual([]);
      expect(noImportPublication.canvasRuntime?.staleForCurrent).toBeUndefined();
      expect(canvas.props?.staleCanvasPresentation).toBeNull();

      const invalidNoImportSource = noImportSource.replace(
        "line Probe = segment(start: Visible.start, end: (120, 0))",
        "line Probe = segment(start: Missing.start, end: (120, 0))"
      );
      sourceText = invalidNoImportSource;
      reopenedDocument.version = 6;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document: reopenedDocument, contentChanges: [{ text: invalidNoImportSource }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: invalidNoImportSource, documentVersion: 6, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 6 }));
      const invalidNoImportPublication = publications.at(-1);
      if (invalidNoImportPublication?.status !== "current") throw new Error("No-import invalid Host did not publish its graph");
      expect(invalidNoImportPublication.canvasRuntime?.staleForCurrent).toBeUndefined();
      expect(canvas.props?.staleCanvasPresentation).toBeNull();
      const invalidNoImportDiagnostics = host.diagnosticsStateFor(reopenedDocument as unknown as vscode.TextDocument);
      expect(invalidNoImportDiagnostics.status).toBe("current");
      if (invalidNoImportDiagnostics.status === "current" && invalidNoImportDiagnostics.owner === "multi-document") {
        const missingRange = {
          from: invalidNoImportSource.indexOf("Missing"),
          to: invalidNoImportSource.indexOf("Missing") + "Missing".length
        };
        expect(invalidNoImportDiagnostics.snapshot.diagnostics.find(diagnostic => diagnostic.message.includes("Missing"))?.location.range)
          .toEqual(missingRange);
      }

      sourceText = noImportSource;
      reopenedDocument.version = 7;
      await act(async () => {
        for (const listener of vscodeHost.changeListeners) listener({ document: reopenedDocument, contentChanges: [{ text: noImportSource }] });
        window.dispatchEvent(new MessageEvent("message", { data: {
          type: "commitText", sourceText: noImportSource, documentVersion: 7, reason: "edit", hostDocumentUri: uri.toString()
        } }));
      });
      await waitFor(() => expect(publications.at(-1)).toMatchObject({ status: "current", documentVersion: 7 }));
      const noImportRecovered = publications.at(-1);
      if (noImportRecovered?.status !== "current") throw new Error("No-import Host did not recover");
      await waitFor(() => {
        expect(canvas.evaluation?.errors).toEqual([]);
        expect([...canvas.evaluation?.computedGeometry.values() ?? []].filter(g => g.name === "Visible" || g.name === "Probe"))
          .toHaveLength(2);
      });
      expect(noImportRecovered.canvasRuntime?.staleForCurrent).toBeUndefined();
      expect(canvas.props?.staleCanvasPresentation).toBeNull();
    } finally {
      host.dispose();
      registry.clear();
      app.unmount();
    }
  }, 30000);

  it("evaluates the exact Human fixture through the actual hook projection", async () => {
    const compiled = await compileRoot(source);
    const elements = compiled.document.elements;
    const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
    expect(analyzeDslLintDiagnostics(compiled)).toEqual([]);
    const producer = compiled.geometryValueProgram!.find(e => e.construction.kind === "polarPoint")!;
    expect(producer).toBeDefined();
    const key = geometryValueOccurrenceKey(producer.occurrence);
    expect(elements.map(e => e.name)).toEqual(["E", "ProbeLine", "Probe"]);
    const line = elements.find(e => e.name === "ProbeLine")!;
    expect(options.geometryInputTargetsByElementId?.get(line.id)?.get("endPoint")).toMatchObject({
      kind: "geometryValue", occurrence: producer.occurrence
    });
    expect(options.typedDependencyGraph?.edges).toContainEqual(expect.objectContaining({
      from: expect.objectContaining({ kind: "element", id: line.id }),
      to: expect.objectContaining({ kind: "geometry-value", id: key })
    }));
    const dart = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "dart_width")!;
    expect(options.typedDependencyGraph?.edges).toContainEqual(expect.objectContaining({
      from: expect.objectContaining({ kind: "geometry-value", id: key }),
      to: expect.objectContaining({ kind: "binding", id: dart.id })
    }));
    const fullInput = buildRustEvaluationInput(elements, options);
    const direct = await rust.evaluateInput(fullInput);
    const reference = evaluateElementsReferencePayload(elements, options);
    expect(normalizeParityPayload(direct)).toEqual(normalizeParityPayload(reference));
    expectGeometry(evaluationPayloadToResult(direct));
    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.source).toBe("rust");
    const projected = requests.at(-1)!;
    if (result.current.evaluation.errors.length) console.info("#1541 boundary evidence", JSON.stringify({
      fullEdges: fullInput.scalarExpressionPayload?.conditionalDependencyGraph?.edges.length,
      projectedEdges: projected.scalarExpressionPayload?.conditionalDependencyGraph?.edges ?? null,
      fullOrder: fullInput.evaluationOrder, projectedOrder: projected.evaluationOrder ?? null,
      errors: result.current.evaluation.errors
    }));
    expectGeometry(result.current.evaluation);
    expect(projected.scalarExpressionPayload?.conditionalDependencyGraph?.edges)
      .toBe(options.typedDependencyGraph!.edges);
    expect(projected.evaluationOrder).toBe(options.evaluationOrder);
    expect(normalizeParityPayload(await rust.evaluateInput(projected))).toEqual(normalizeParityPayload(direct));
    const value = result.current.evaluation.computedGeometryValues?.get(key)?.value;
    expect(value).toMatchObject({ kind: "point", x: 27.9375, y: 20 });
    expect(value).not.toHaveProperty("elementId");
  }, 30000);

  it.each([
    ["drawable P", source.replace("const P: point", "point P")],
    ["fixed-distance pure point", source.replace("distance: dart_width", "distance: 17.9375")]
  ])("keeps the %s control successful through the hook", async (_, text) => {
    const compiled = await compileRoot(text);
    const elements = compiled.document.elements;
    const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
    const reference = evaluateElementsReferencePayload(elements, options);
    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expectGeometry(result.current.evaluation);
    expect(normalizeParityPayload(await rust.evaluateInput(requests.at(-1)!))).toEqual(normalizeParityPayload(reference));
    const dartWarnings = analyzeDslLintDiagnostics(compiled).filter(d => d.presentation?.parameters?.name === "dart_width");
    expect(dartWarnings).toHaveLength(text.includes("distance: dart_width") ? 0 : 1);
  });

  it("publishes current Canvas geometry and recovers from invalid Source evaluation", async () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    canvas.evaluation = null;
    const requests: EvaluateDocumentInput[] = [];
    const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
      if (message.type !== "rustEvaluationRequest") return;
      requests.push(message.input);
      void rust.evaluateInput(message.input).then(
        payload => window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationResponse", id: message.id, payload }
        })),
        error => window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationError", id: message.id, error: String(error) }
        }))
      );
    }) };
    render(<VSCodeApp api={api} />);
    let occurrences: string[] | undefined;
    const edits = [
      { bust: 830 },
      { sourceText: source.replace("M.bust / 32 - 8", "M.bust / 0"), invalid: true },
      { bust: 990 },
      { bust: 830 }
    ];
    for (const [index, edit] of edits.entries()) {
      const documentVersion = index + 1;
      const bust = edit.bust;
      const text = edit.sourceText ?? source.replace("bust: 830", `bust: ${bust}`);
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: index === 0
            ? { type: "replaceTextDocument", sourceText: text, documentVersion }
            : { type: "commitText", sourceText: text, documentVersion, reason: "edit" }
        }));
      });
      await waitFor(() => {
        const publication = api.postMessage.mock.calls.map(([m]) => m).filter(m =>
          m.type === "runtimeDiagnosticsPublication" && m.documentVersion === documentVersion).at(-1);
        expect(publication).toMatchObject({ type: "runtimeDiagnosticsPublication", documentVersion });
        if (edit.invalid) expect(publication?.diagnostics.length).toBeGreaterThan(0);
        else expect(publication).toEqual({ type: "runtimeDiagnosticsPublication", documentVersion, diagnostics: [] });
        expect(canvas.evaluation).not.toBeNull();
        if (edit.invalid) expect(canvas.evaluation!.errors.length).toBeGreaterThan(0);
        else expectGeometry(canvas.evaluation!, bust === 990 ? 32.9375 : 27.9375);
      });
      const compiled = useCadDocumentStore.getState().doc;
      expect(analyzeDslLintDiagnostics(compiled)).toEqual([]);
      expect(compiled.document.elements.some(e => e.name === "P")).toBe(false);
      const currentOccurrences = compiled.geometryValueProgram!.map(e => geometryValueOccurrenceKey(e.occurrence));
      if (occurrences) expect(currentOccurrences).toEqual(occurrences);
      occurrences = currentOccurrences;
      const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
      const input = requests.at(-1)!;
      expect(input.scalarExpressionPayload?.conditionalDependencyGraph?.edges).toEqual(options.typedDependencyGraph!.edges);
      expect(input.evaluationOrder).toEqual(options.evaluationOrder);
      if (!edit.invalid) {
        const expected = evaluateElementsReferencePayload(compiled.document.elements, options);
        expect(normalizeParityPayload(await rust.evaluateInput(input))).toEqual(normalizeParityPayload(expected));
        const dart = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "dart_width")!;
        expect(canvas.evaluation!.computedScalarBindings?.get(dart.id)).toMatchObject({
          status: "ok", value: { kind: "number", value: bust === 990 ? 22.9375 : 17.9375 }
        });
      }
    }
  }, 30000);

  it("evaluates the current imported Module graph through automatic Source transport", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    canvas.evaluation = null;
    const requests: Array<{ id: number; input: EvaluateDocumentInput }> = [];
    const completedRequests: number[] = [];
    const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
      if (message.type !== "rustEvaluationRequest") return;
      requests.push({ id: message.id, input: message.input });
      void rust.evaluateInput(message.input).then(
        payload => {
          completedRequests.push(message.id);
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "rustEvaluationResponse", id: message.id, payload }
          }));
        },
        error => window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationError", id: message.id, error: String(error) }
        }))
      );
    }) };
    const view = render(<VSCodeApp api={api} />);
    try {
      await waitFor(() => expect(requests).toHaveLength(1));
      await waitFor(() => expect(completedRequests).toContain(requests[0].id));
      await new Promise(resolve => setTimeout(resolve, 210));
      requests.length = 0;
      completedRequests.length = 0;

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "replaceTextDocument",
            sourceText: fixture.source,
            documentVersion: issue1651DocumentVersion,
            hostDocumentUri: issue1651RootDocumentUri
          }
        }));
        window.dispatchEvent(new MessageEvent("message", { data: fixture.publication }));
      });

      await waitFor(() => expect(completedRequests).toContain(requests[0]?.id), { timeout: 5000 });
      const imported = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
        .find(geometry => geometry.name === "Imported");
      expect(imported).toMatchObject({ kind: "point", x: 50, y: 0 });
      expect(canvas.evaluation?.errors).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requests[0].input.elements.map(element => element.name)).toEqual(
        fixture.runtimePresentation.elements.map(element => element.name)
      );
      expect(api.postMessage.mock.calls.map(([message]) => message).filter(message =>
        message.type === "webviewAuthoritativeDocumentReady"
      )).toContainEqual({ type: "webviewAuthoritativeDocumentReady", documentVersion: issue1651DocumentVersion });
      await new Promise(resolve => setTimeout(resolve, 210));
      expect(requests).toHaveLength(1);
    } finally {
      view.unmount();
    }
  }, 30000);

  it.each(["single-document", "imported-Module"] as const)(
    "publishes latest %s Source evaluation after an immediate Reference Pick candidate",
    async route => {
      vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
      useCadDocumentStore.setState(initialCadDocumentState());
      useCadUiStore.setState(initialCadUiState());
      canvas.evaluation = null;
      const requests: Array<{ id: number; input: EvaluateDocumentInput }> = [];
      const completedRequests = new Set<number>();
      const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
        if (message.type === "rustEvaluationRequest") requests.push({ id: message.id, input: message.input });
      }) };
      const respondWithRust = async (request: { id: number; input: EvaluateDocumentInput }) => {
        const payload = await rust.evaluateInput(request.input);
        completedRequests.add(request.id);
        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "rustEvaluationResponse", id: request.id, payload }
          }));
        });
      };
      const view = render(<VSCodeApp api={api} />);
      try {
        await waitFor(() => expect(requests).toHaveLength(1));
        await respondWithRust(requests[0]);
        await waitFor(() => expect(completedRequests.has(requests[0].id)).toBe(true));
        await new Promise(resolve => setTimeout(resolve, 210));
        requests.length = 0;

        let sourceA: string;
        let sourceB: string;
        let candidateCompiledDocument: LastGoodDslDocument;
        let importedPublicationA: Extract<VscodeMultiDocumentGraphPublication, { status: "current" }> | undefined;
        let importedPublicationB: typeof importedPublicationA;
        let importedElementNamesB: string[] | undefined;
        if (route === "single-document") {
          sourceA = "nui 1\npoint Probe = coordinate(x: 1, y: 0)";
          sourceB = "nui 1\npoint Probe = coordinate(x: 2, y: 0)";
          const compiledA = compileFreshCanonicalText(sourceA);
          expect(compiledA.status).toBe("valid");
          candidateCompiledDocument = compiledA.doc;
        } else {
          const fixtureA = await buildIssue1651ImportedModuleCanvasEditFixture(false);
          const fixtureB = await buildIssue1651ImportedModuleCanvasEditFixture(true);
          sourceA = fixtureA.source;
          sourceB = fixtureB.source;
          candidateCompiledDocument = fixtureA.compiled;
          importedPublicationA = fixtureA.publication;
          importedPublicationB = structuredClone(fixtureB.publication);
          importedPublicationB.documentVersion = issue1651DocumentVersion + 1;
          importedElementNamesB = fixtureB.runtimePresentation.elements.map(element => element.name);
        }

        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "replaceTextDocument",
              sourceText: sourceA,
              documentVersion: issue1651DocumentVersion,
              ...(route === "imported-Module" ? { hostDocumentUri: issue1651RootDocumentUri } : {})
            }
          }));
          if (importedPublicationA) {
            window.dispatchEvent(new MessageEvent("message", { data: importedPublicationA }));
          }
        });
        await waitFor(() => expect(requests).toHaveLength(1));

        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", {
            data: route === "single-document"
              ? { type: "commitText", sourceText: sourceB, documentVersion: issue1651DocumentVersion + 1, reason: "edit" }
              : {
                type: "replaceTextDocument",
                sourceText: sourceB,
                documentVersion: issue1651DocumentVersion + 1,
                hostDocumentUri: issue1651RootDocumentUri
              }
          }));
          if (importedPublicationB) {
            window.dispatchEvent(new MessageEvent("message", { data: importedPublicationB }));
          }
        });
        expect(requests).toHaveLength(1);
        expect(canvas.evaluateReferencePickCandidate).toBeTypeOf("function");
        const candidatePromise = canvas.evaluateReferencePickCandidate!(candidateCompiledDocument);
        void candidatePromise.catch(() => undefined);
        expect(requests).toHaveLength(1);

        await respondWithRust(requests[0]);
        await waitFor(() => expect(requests).toHaveLength(2));
        const directCandidateRequest = requests[1];
        expect(route === "single-document"
          ? directCandidateRequest.input.elements.find(element => element.name === "Probe")
          : directCandidateRequest.input.elements.some(element => element.name === "Imported")
        ).toEqual(route === "single-document"
          ? expect.objectContaining({ x: 1 })
          : false);
        await respondWithRust(directCandidateRequest);
        await expect(candidatePromise).resolves.toBeDefined();

        if (route === "single-document") {
          const probeBeforeLatest = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
            .find(geometry => geometry.name === "Probe");
          expect(probeBeforeLatest).not.toMatchObject({ kind: "point", x: 1, y: 0 });
        } else {
          expect([...(canvas.evaluation?.computedGeometry.values() ?? [])]
            .some(geometry => geometry.name === "Imported")).toBe(false);
        }

        await new Promise(resolve => setTimeout(resolve, 210));
        await waitFor(() => expect(requests).toHaveLength(3), { timeout: 5000 });
        if (route === "imported-Module") {
          expect(requests[2].input.elements.map(element => element.name))
            .toEqual(importedElementNamesB);
        }
        await respondWithRust(requests[2]);
        await waitFor(() => {
          if (route === "single-document") {
            const probe = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
              .find(geometry => geometry.name === "Probe");
            expect(probe).toMatchObject({ kind: "point", x: 2, y: 0 });
            expect(api.postMessage.mock.calls.map(([message]) => message).filter(message =>
              message.type === "runtimeDiagnosticsPublication" &&
              message.documentVersion === issue1651DocumentVersion + 1
            ).at(-1)).toEqual({
              type: "runtimeDiagnosticsPublication",
              documentVersion: issue1651DocumentVersion + 1,
              diagnostics: []
            });
          } else {
            const imported = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
              .find(geometry => geometry.name === "Imported");
            expect(imported).toMatchObject({ kind: "point", x: 50, y: 0 });
          }
        });
      } finally {
        view.unmount();
      }
    },
    30000
  );

  it("measures single-edit current Canvas publication for small and 1500-line legal Source", async () => {
    const fixtures = [
      {
        label: "small",
        lineCount: 2,
        sourceText: "nui 1\npoint Probe = coordinate(x: 27, y: 0)",
        expectedX: 27
      },
      {
        label: "1500-line",
        lineCount: 1500,
        sourceText: [
          "nui 1",
          ...Array.from({ length: 1498 }, (_, index) => `const v${index}: number = ${index}`),
          "point Probe = coordinate(x: 27, y: 0)"
        ].join("\n"),
        expectedX: 27
      }
    ];

    for (const [index, fixture] of fixtures.entries()) {
      useCadDocumentStore.setState(initialCadDocumentState());
      useCadUiStore.setState(initialCadUiState());
      canvas.evaluation = null;
      const requests: Array<{ id: number; sentAt: number }> = [];
      const completedRequests: number[] = [];
      const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
        if (message.type !== "rustEvaluationRequest") return;
        requests.push({ id: message.id, sentAt: performance.now() });
        void rust.evaluateInput(message.input).then(
          payload => {
            completedRequests.push(message.id);
            window.dispatchEvent(new MessageEvent("message", {
              data: { type: "rustEvaluationResponse", id: message.id, payload }
            }));
          },
          error => window.dispatchEvent(new MessageEvent("message", {
            data: { type: "rustEvaluationError", id: message.id, error: String(error) }
          }))
        );
      }) };
      const view = render(<VSCodeApp api={api} />);
      await waitFor(() => expect(requests).toHaveLength(1));
      await waitFor(() => expect(completedRequests).toContain(requests[0].id));
      await new Promise(resolve => setTimeout(resolve, 210));
      requests.length = 0;
      const startedAt = performance.now();
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "replaceTextDocument", sourceText: fixture.sourceText, documentVersion: index + 1 }
        }));
      });
      expect(requests).toHaveLength(1);
      await waitFor(() => {
        const probe = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
          .find(geometry => geometry.name === "Probe");
        expect(probe).toMatchObject({ kind: "point", x: fixture.expectedX, y: 0 });
      });
      const canvasPublicationMs = performance.now() - startedAt;
      expect(requests).toHaveLength(1);
      process.stdout.write(
        `[nuinuicad] Issue #1687 fixed single-edit ${fixture.label}: lines=${fixture.lineCount}, rustEvaluationRequest=${requests.length}, first-send=${(requests[0].sentAt - startedAt).toFixed(3)}ms, current-Canvas-publication=${canvasPublicationMs.toFixed(3)}ms\n`
      );
      view.unmount();
    }
  }, 30000);

  it("publishes the latest Canvas result after a ten-update burst and an early first response", async () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    canvas.evaluation = null;
    const requests: Array<{ id: number; input: EvaluateDocumentInput; sentAt: number }> = [];
    const completedRequests: number[] = [];
    const api = { postMessage: vi.fn((message: VscodeToExtensionMessage) => {
      if (message.type !== "rustEvaluationRequest") return;
      requests.push({ id: message.id, input: message.input, sentAt: performance.now() });
      void rust.evaluateInput(message.input).then(
        payload => {
          completedRequests.push(message.id);
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "rustEvaluationResponse", id: message.id, payload }
          }));
        },
        error => window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationError", id: message.id, error: String(error) }
        }))
      );
    }) };
    const view = render(<VSCodeApp api={api} />);
    try {
      await waitFor(() => expect(requests).toHaveLength(1));
      await waitFor(() => expect(completedRequests).toContain(requests[0].id));
      await new Promise(resolve => setTimeout(resolve, 210));
      requests.length = 0;
      completedRequests.length = 0;

      for (let revision = 0; revision < 10; revision += 1) {
        const sourceText = `nui 1\npoint Probe = coordinate(x: ${revision}, y: 0)`;
        const documentVersion = revision + 2;
        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", {
            data: revision === 0
              ? { type: "replaceTextDocument", sourceText, documentVersion }
              : { type: "commitText", sourceText, documentVersion, reason: "edit" }
          }));
        });
        if (revision === 1) {
          await waitFor(() => expect(completedRequests).toContain(requests[0].id), { interval: 5, timeout: 150 });
          expect(requests).toHaveLength(1);
        }
      }

      const stoppedAt = performance.now();
      expect(requests).toHaveLength(1);
      await waitFor(() => {
        const probe = [...(canvas.evaluation?.computedGeometry.values() ?? [])]
          .find(geometry => geometry.name === "Probe");
        expect(probe).toMatchObject({ kind: "point", x: 9, y: 0 });
        expect(api.postMessage.mock.calls.map(([message]) => message).filter(message =>
          message.type === "runtimeDiagnosticsPublication" && message.documentVersion === 11
        ).at(-1)).toEqual({ type: "runtimeDiagnosticsPublication", documentVersion: 11, diagnostics: [] });
      }, { interval: 5, timeout: 5000 });
      const inputStopToCanvasPublicationMs = performance.now() - stoppedAt;
      expect(requests).toHaveLength(2);
      expect(requests[1].input).toEqual(expect.objectContaining({ elements: expect.arrayContaining([
        expect.objectContaining({ name: "Probe" })
      ]) }));
      process.stdout.write(
        `[nuinuicad] Issue #1687 fixed burst small: updates=10, rustEvaluationRequest=${requests.length}, first-response=early, input-stop-to-current-Canvas-publication=${inputStopToCanvasPublicationMs.toFixed(3)}ms\n`
      );
    } finally {
      view.unmount();
    }
  }, 30000);

  it("keeps failed scalar prerequisites as real dependency errors through the hook", async () => {
    const compiled = await compileRoot(source.replace("M.bust / 32 - 8", "M.bust / 0"));
    const elements = compiled.document.elements;
    const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
    const transport = (input: EvaluateDocumentInput) => rust.evaluateInput(input);
    const { result } = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.evaluation.errors.length).toBeGreaterThan(0);
    expect([...result.current.evaluation.computedGeometry.values()].map(g => g.name)).toEqual(["E"]);
    expect(result.current.evaluation.computedGeometryValues?.size ?? 0).toBe(0);
    const input = buildRustEvaluationInput(elements, options);
    expect(normalizeParityPayload(await rust.evaluateInput(input)))
      .toEqual(normalizeParityPayload(evaluateElementsReferencePayload(elements, options)));
  });

  it("preserves dependency facts for Module Preview through the same hook", async () => {
    const text = `${source}\nmodule Marker(width: number = 12) {\n  point PreviewPoint = coordinate(x: width, y: 0)\n}`;
    const compiled = await compileRoot(text);
    const snapshot = { normalizedSource: text, sourceRevision: 1 };
    const semantic = { sourceRevision: 1, compiled };
    const target = queryModulePreviewTarget({ source: snapshot, position: text.indexOf("PreviewPoint"), semantic });
    expect(target).not.toBeNull();
    const preview = compileModulePreviewRoot({ source: snapshot, semantic, target: target!, arguments: [] });
    expect(preview).not.toBeNull();
    const elements = preview!.compileResult.elements;
    const options = buildModulePreviewEvaluationOptions(preview!);
    const requests: EvaluateDocumentInput[] = [];
    const transport = async (input: EvaluateDocumentInput) => {
      requests.push(input);
      return rust.evaluateInput(input);
    };
    const { result } = renderHook(() => useEvaluationEngine(elements, options, 1, transport));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expectGeometry(result.current.evaluation);
    const point = elements.find(e => e.name === "PreviewPoint" && preview!.targetRuntimeElementIds.includes(e.id))!;
    expect(result.current.evaluation.computedGeometry.get(point.id)).toMatchObject({ kind: "point", x: 12, y: 0 });
    expect(requests.at(-1)!.scalarExpressionPayload?.conditionalDependencyGraph?.edges).toBe(options.typedDependencyGraph!.edges);
    expect(normalizeParityPayload(await rust.evaluateInput(requests.at(-1)!)))
      .toEqual(normalizeParityPayload(evaluateElementsReferencePayload(elements, options)));
  });
});
