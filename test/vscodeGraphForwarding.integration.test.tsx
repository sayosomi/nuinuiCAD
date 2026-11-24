import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
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
  evaluateReferencePickCandidate: null as ((compiled: LastGoodDslDocument) => Promise<EvaluationResult>) | null
}));
vi.mock("../src/vscode/VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: (props: {
    evaluationState: { evaluation: EvaluationResult };
    evaluateReferencePickCandidate: (compiled: LastGoodDslDocument) => Promise<EvaluationResult>;
  }) => {
    canvas.evaluation = props.evaluationState.evaluation;
    canvas.evaluateReferencePickCandidate = props.evaluateReferencePickCandidate;
    return <div data-testid="canvas" />;
  }
}));
vi.mock("../src/vscode/VSCodeBenchmarkCaptureRunner", () => ({ VSCodeBenchmarkCaptureRunner: () => null }));

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
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

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
