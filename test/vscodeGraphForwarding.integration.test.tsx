import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  analyzeDslLintDiagnostics, compileDslDocument, createModuleRuntimeContext,
  geometryValueOccurrenceKey
} from "@nuinuicad/nui-language";
import type { LastGoodDslDocument } from "@nuinuicad/nui-language/document";
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
import { projectVscodeMultiDocumentCanvasRuntime } from "../src/vscode/multiDocumentRuntimeTransport";
import type { VscodeToExtensionMessage } from "../src/vscode/protocol";
import { createRustStdioParityClient, normalizeParityPayload } from "./evaluationParitySupport";

const canvas = vi.hoisted(() => ({ evaluation: null as EvaluationResult | null }));
vi.mock("../src/vscode/VSCodeDrawingCanvas", () => ({
  VSCodeDrawingCanvas: (props: { evaluationState: { evaluation: EvaluationResult } }) => {
    canvas.evaluation = props.evaluationState.evaluation;
    return <div data-testid="canvas" />;
  }
}));
vi.mock("../src/vscode/VSCodeBenchmarkCaptureRunner", () => ({ VSCodeBenchmarkCaptureRunner: () => null }));

const source = `nui 1

record Measurements(bust: number)
const M: Measurements = Measurements(bust: 830)

point E = coordinate(x: 10, y: 20)
const dart_width: number = @M.bust / 32 - 8

const P: point = polar(
  from: @E,
  angle: 0,
  distance: @dart_width
)

line ProbeLine = segment(
  start: @E,
  end: @P
)

point Probe = coordinate(
  x: @P.x,
  y: @P.y + 10
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
  let targetDirectory: string;
  beforeAll(() => {
    targetDirectory = mkdtempSync(join(tmpdir(), "nuinuicad-1541-hook-rust-"));
    rust = createRustStdioParityClient(process.cwd(), { targetDirectory });
  }, 30000);
  afterAll(() => {
    rust?.dispose();
    if (targetDirectory) rmSync(targetDirectory, { recursive: true, force: true });
  });
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
    ["fixed-distance pure point", source.replace("distance: @dart_width", "distance: 17.9375")]
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
    expect(dartWarnings).toHaveLength(text.includes("distance: @dart_width") ? 0 : 1);
  });

  it("publishes correct Canvas geometry and Problems after source changes 830 → 990 → 830", async () => {
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
    for (const [index, bust] of [830, 990, 830].entries()) {
      const documentVersion = index + 1;
      const text = source.replace("bust: 830", `bust: ${bust}`);
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
        expect(publication).toEqual({ type: "runtimeDiagnosticsPublication", documentVersion, diagnostics: [] });
        expect(canvas.evaluation).not.toBeNull();
        expectGeometry(canvas.evaluation!, bust === 990 ? 32.9375 : 27.9375);
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
      const expected = evaluateElementsReferencePayload(compiled.document.elements, options);
      expect(normalizeParityPayload(await rust.evaluateInput(input))).toEqual(normalizeParityPayload(expected));
      const dart = compiled.bindingAnalysis!.catalog.bindings.find(b => b.name === "dart_width")!;
      expect(canvas.evaluation!.computedScalarBindings?.get(dart.id)).toMatchObject({
        status: "ok", value: { kind: "number", value: bust === 990 ? 22.9375 : 17.9375 }
      });
    }
  }, 30000);

  it("keeps failed scalar prerequisites as real dependency errors through the hook", async () => {
    const compiled = await compileRoot(source.replace("@M.bust / 32 - 8", "@M.bust / 0"));
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
    const text = `${source}\nmodule Marker(width: number = 12) {\n  point PreviewPoint = coordinate(x: @width, y: 0)\n}`;
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
