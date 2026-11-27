import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";
import { panViewportByScreenDelta, VIEWPORT_ZOOM_STEP } from "../geometry/viewport";
import { CanvasLayerPanel } from "../components/CanvasLayerPanel";
import type { OutputPlan } from "../output/outputCore";
import { evaluateElementsReferencePayload } from "../geometry/evaluationEngine";
import { OutputPreviewApp } from "./OutputPreviewApp";
import { outputPreviewDiagnosticSourceRangeFor } from "./outputPreviewDiagnostics";
import { outputPreviewPathDataFor } from "./outputPreviewRendering";
import {
  fitOutputPreviewViewport,
  outputPreviewFitBoundsFor,
  outputPreviewScreenToWorld,
  outputPreviewWorldToScreen,
  zoomOutputPreviewViewportAt
} from "./outputPreviewViewport";
import type { DslDiagnostic } from "@nuinuicad/nui-language";
import { compileDslDocument, createModuleRuntimeContext } from "@nuinuicad/nui-language";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import { vscodeMultiDocumentGraphSnapshot, type VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import { projectVscodeMultiDocumentCanvasRuntime, serializeSourceEditingDocument } from "./multiDocumentRuntimeTransport";
import { createRustStdioParityClient } from "../../test/evaluationParitySupport";
import { evaluatePreparedRust } from "../geometry/rustEvaluationRunner";
import { compileFreshCanonicalText, isLastGoodDslDocument, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import * as documentCompiler from "@nuinuicad/nui-language/document";
import type { VscodeToExtensionMessage, VscodeWebviewApi } from "./protocol";
import { outputPreviewManualE2eSource } from "./outputPreviewManualFixture";
import * as vscodeCanvasRibbonIcons from "./vscodeCanvasRibbonIcons";

const mocks = vi.hoisted(() => ({
  evaluateOutputPlan: vi.fn()
}));

vi.mock("../output/outputCore", async () => {
  const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
  return { ...actual, evaluateOutputPlan: mocks.evaluateOutputPlan };
});

const api: VscodeWebviewApi = { postMessage: vi.fn() };

const source = [
  "nui 1",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "}",
  "print A(",
  "  layout: L,",
  "  layers: [default],",
  "  paper: a4,",
  "  overlap: 5,",
  ")",
  "svg B(",
  "  layout: L,",
  "  layers: [default],",
  "  margin: 1,",
  ")"
].join("\n");

const printSourceWithoutB = source.slice(0, source.indexOf("svg B("));
const sourceWithThreeOutputs = `${source}\nsvg C(\n  layout: L,\n  layers: [default],\n  margin: 2,\n)`;
const coldRevealSource = [
  "nui 1",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "group Other {",
  "  line CD = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout First {",
  "  place Other(at: (0, 0))",
  "}",
  "layout Target {",
  "  place G(at: (0, 0))",
  "}",
  "print A(",
  "  layout: First,",
  "  layers: [default],",
  "  paper: a4,",
  "  overlap: 5,",
  ")",
  "svg B(",
  "  layout: Target,",
  "  layers: [default],",
  "  margin: 1,",
  ")"
].join("\n");
const repairedSource = source.replace("overlap: 5", "overlap: 20");
const invalidOverlapSource = source.replace("overlap: 5", "overlap: 200");

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20, width: 20, height: 20 };

type TestOutput = {
  id: string;
  name: string;
  layoutId: string;
  margin?: number | { kind: "expression"; expression: string };
  paper?: "a4" | "a3";
  overlap?: number | { kind: "expression"; expression: string };
};

const planFor = (output: TestOutput, fill?: { colorHex: string; opacity: number }): OutputPlan => {
  const isPrint = output.paper !== undefined;
  const overlap = isPrint && typeof output.overlap === "number" ? output.overlap : 0;
  const paperWidthMm = 60;
  const paperHeightMm = 60;
  const strideXmm = paperWidthMm - 2 * overlap;
  const strideYmm = paperHeightMm - 2 * overlap;

  const joiningLabel = (centerX: number) => ({
    text: "1",
    fontSizeMm: 3,
    rotationDeg: 90,
    center: { x: centerX, y: paperHeightMm / 2 },
    widthMm: 1.86,
    advancesMm: [1.86]
  });
  const drawable = {
    kind: "line" as const,
    elementId: "AB",
    name: "AB",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    stroke: { widthMm: 1, style: "solid" as const, colorHex: "#123456" },
    ...(fill ? { fill } : {})
  };
  const pages = [
    {
      index: 0,
      column: 0,
      row: 0,
      origin: { x: -overlap, y: -overlap },
      guides: overlap > 0 ? [
        { axis: "vertical" as const, positionMm: overlap },
        {
          axis: "vertical" as const,
          positionMm: paperWidthMm - overlap,
          label: joiningLabel(paperWidthMm - overlap / 2)
        },
        { axis: "horizontal" as const, positionMm: overlap },
        { axis: "horizontal" as const, positionMm: paperHeightMm - overlap }
      ] : []
    },
    {
      index: 1,
      column: 1,
      row: 0,
      origin: { x: -overlap + strideXmm, y: -overlap },
      guides: overlap > 0 ? [
        {
          axis: "vertical" as const,
          positionMm: overlap,
          label: joiningLabel(overlap / 2)
        },
        { axis: "vertical" as const, positionMm: paperWidthMm - overlap },
        { axis: "horizontal" as const, positionMm: overlap },
        { axis: "horizontal" as const, positionMm: paperHeightMm - overlap }
      ] : []
    }
  ];
  return {
    kind: isPrint ? "print" : "svg",
    outputId: output.id,
    outputName: output.name,
    layoutId: output.layoutId,
    empty: false,
    placements: [],
    drawables: [drawable],
    renderedBounds: bounds,
    bounds,
    rustPayload: isPrint
      ? {
          version: 1,
          kind: "print",
          bounds,
          drawables: [drawable],
          paper: { widthMm: paperWidthMm, heightMm: paperHeightMm },
          overlapMm: overlap,
          stride: { x: strideXmm, y: strideYmm },
          pages
        }
      : {
          version: 1,
          kind: "svg",
          bounds,
          drawables: [drawable],
          widthMm: bounds.width,
          heightMm: bounds.height,
          contentOrigin: { x: bounds.minX, y: bounds.minY }
        },
    ...(isPrint
      ? {
          print: {
            paper: "a4" as const,
            orientation: "portrait" as const,
            paperWidthMm,
            paperHeightMm,
            overlapMm: overlap,
            strideXmm,
            strideYmm,
            columns: 2,
            rows: 1,
            pages
          }
        }
      : {
          marginMm: typeof output.margin === "number" ? output.margin : 0,
          svg: { widthMm: bounds.width, heightMm: bounds.height, viewBox: { x: 0, y: 0, width: bounds.width, height: bounds.height } }
        })
  } as OutputPlan;
};

const emptyPlanFor = (output: TestOutput): OutputPlan => {
  const plan = planFor(output);
  const emptyBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const rustPayload = plan.rustPayload.kind === "print"
    ? { ...plan.rustPayload, bounds: emptyBounds, drawables: [], pages: [] }
    : {
        ...plan.rustPayload,
        bounds: emptyBounds,
        drawables: [],
        widthMm: 0,
        heightMm: 0,
        contentOrigin: { x: 0, y: 0 }
      };
  return {
    ...plan,
    empty: true,
    placements: [],
    drawables: [],
    renderedBounds: emptyBounds,
    bounds: emptyBounds,
    rustPayload,
    ...(plan.print ? { print: { ...plan.print, columns: 0, rows: 0, pages: [] } } : {}),
    ...(plan.svg ? { svg: { widthMm: 0, heightMm: 0, viewBox: { x: 0, y: 0, width: 0, height: 0 } } } : {})
  };
};

const planWithRepeatedDrawables = (output: TestOutput): OutputPlan => {
  const plan = planFor(output);
  const drawable = plan.drawables[0];
  if (!drawable) throw new Error("missing test drawable");
  return {
    ...plan,
    drawables: [drawable, { ...drawable }]
  };
};

const viewportRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
  toJSON: () => ({})
} as DOMRect;

const renderFixture = (sourceText = source) => {
  useCadDocumentStore.getState().commitText(sourceText, "test");
  return render(<OutputPreviewApp api={api} />);
};

const outputKeyFor = (kind: "print" | "svg", name: string): string => {
  const state = useCadDocumentStore.getState();
  const output = kind === "print"
    ? state.printOutputs.find((candidate) => candidate.name === name)
    : state.svgOutputs.find((candidate) => candidate.name === name);
  if (!output) throw new Error(`missing ${kind} output ${name}`);
  return `${kind}:${output.id}`;
};

const pageFill = () => screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="page-fill"]') as SVGRectElement;

type RevealResultMessage = Extract<VscodeToExtensionMessage, { type: "outputPreviewRevealResult" }>;
const revealResultMessages = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is RevealResultMessage =>
    typeof message === "object" && message !== null && (message as { type?: string }).type === "outputPreviewRevealResult"
  );

const postWindowMessage = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

const importedRootUri = "file:///workspace/probe.nui";
const importedDependency = [
  "nui 1",
  "export module DartCenter() {",
  "  export line center = segment(start: (3, 7), end: (13, 7))",
  "}"
].join("\n");
const importedRoot = [
  "nui 1",
  'import "./dart_seam.nui" as dart_seam',
  "instance dart_center = dart_seam::DartCenter()",
  "line local_base = segment(start: (0, 2), end: (20, 2))",
  "line copied = mirrorCopy(axis1: (0, 0), axis2: (20, 0), baseLines: [dart_center::center])"
].join("\n");

const importedOutputRoot = [
  ...importedRoot.split("\n").slice(0, 2),
  "group G {",
  ...importedRoot.split("\n").slice(2).map(line => `  ${line}`),
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "}",
  "svg Probe(layout: L, layers: [default], margin: 1)"
].join("\n");

const importedTwoPlaceOutputRoot = [
  "nui 1",
  'import "./dart_seam.nui" as dart_seam',
  "group G {",
  "  instance dart_center = dart_seam::DartCenter()",
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "  place G(at: (40, 0))",
  "}",
  "svg Preview(layout: L, layers: [default], margin: 1)"
].join("\n");

const importedTwoPlacePrintOutputRoot = [
  "nui 1",
  'import "./dart_seam.nui" as dart_seam',
  "group G {",
  "  instance dart_center = dart_seam::DartCenter()",
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "  place G(at: (40, 0))",
  "}",
  "print Pages(layout: L, layers: [default], paper: a4, orientation: portrait, overlap: 10)"
].join("\n");
const importedTwoPlaceTwoSvgOutputRoot = importedTwoPlaceOutputRoot + "\nsvg Backup(layout: L, layers: [default], margin: 2)";

const drawableIdentityDependency = [
  "nui 1",
  "export module DartCenter() {",
  "  export line centerline = segment(start: (0, 0), end: (0, 10))",
  "  export line segmented = polyline(points: [(5, 0), (5, 10), (10, 10)])",
  "  export text notch = label(text: \"notch\", anchor: (0, 5), size: 3)",
  "}"
].join("\n");

const overlappingOutputRoot = [
  "nui 1",
  'import "./dart_seam.nui" as dart_seam',
  "group G {",
  "  instance center = dart_seam::DartCenter()",
  "}",
  "layout L {",
  "  place G(at: (20, 30), mirror: false)",
  "  place G(at: (20, 30), mirror: false)",
  "  place G(at: (20, 30), mirror: true)",
  "}",
  "print Pages(layout: L, layers: [default], paper: a4, orientation: portrait, overlap: 10)",
  "svg Preview(layout: L, layers: [default], margin: 1)"
].join("\n");

const standaloneTwoPlaceOutputSource = [
  "nui 1",
  "group G {",
  "  line AB = segment(start: (0, 0), end: (10, 0))",
  "}",
  "layout L {",
  "  place G(at: (0, 0))",
  "  place G(at: (40, 0))",
  "}",
  "svg Preview(layout: L, layers: [default], margin: 1)"
].join("\n");

const printPageBoundarySource = (endX: number, placeX = 0) => [
  "nui 1",
  'import "./dart_seam.nui" as dart_seam',
  "style WideStroke {",
  "  width: 100px,",
  "}",
  "group G {",
  `  line Edge [WideStroke] = segment(start: (0, 20), end: (${endX}, 20))`,
  "}",
  "layout L {",
  `  place G(at: (${placeX}, 0))`,
  "}",
  "print Pages(layout: L, layers: [default], paper: a4, orientation: portrait, overlap: 10)"
].join("\n");

const importedGraphPublication = async (
  normalizedSource: string,
  documentVersion = 1,
  graphRevision = 1,
  savedDependency = importedDependency,
  uri = importedRootUri,
  assignedStatementIds?: ReadonlyMap<number, string>
) => {
  const root = {
    kind: "root-current" as const,
    documentId: documentIdFromHost(uri),
    normalizedSource,
    sourceRevision: documentVersion
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    ...(assignedStatementIds ? { rootStatementIdByStatementIndex: assignedStatementIds } : {}),
    declarationContributors: [moduleDeclarationContributor],
    loader: {
      loadSavedDependency: async () => ({
        status: "loaded",
        snapshot: {
          kind: "dependency-saved",
          documentId: documentIdFromHost("file:///workspace/dart_seam.nui"),
          normalizedSource: savedDependency,
          savedSourceFingerprint: savedSourceFingerprintFromHost(`saved:${savedDependency}`)
        }
      })
    }
  });
  const artifact = graph.nodes.get(root.documentId)!.artifact;
  const context = createModuleRuntimeContext(graph, analyzeMultiDocumentModuleSemantics(graph));
  const compiled = compileDslDocument(normalizedSource, {
    preparsed: artifact.parsed,
    assignedStatementIds: artifact.statementIdByStatementIndex,
    sourceRevision: root.sourceRevision,
    moduleRuntimeContext: context
  });
  return {
    compiled,
    publication: {
      type: "multiDocumentGraphPublication" as const,
      status: "current" as const,
      hostDocumentUri: uri,
      documentVersion,
      graph: vscodeMultiDocumentGraphSnapshot(graph, graphRevision),
      canvasRuntime: projectVscodeMultiDocumentCanvasRuntime({ graph, compiled, graphRevision }),
      outputPreview: { sequence: graphRevision, sourceEditing: serializeSourceEditingDocument(compiled) }
    }
  };
};

const sendImportedSource = (text: string, documentVersion = 1, hostDocumentUri = importedRootUri) => {
  postWindowMessage({ type: "replaceTextDocument", sourceText: text, documentVersion, hostDocumentUri });
};

const sendGraphPublication = (publication: VscodeMultiDocumentGraphPublication) => {
  postWindowMessage(JSON.parse(JSON.stringify(publication)));
};

const outputExportAvailabilityMessages = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is Extract<VscodeToExtensionMessage, { type: "outputPreviewExportAvailability" }> =>
    message.type === "outputPreviewExportAvailability"
  );

const outputExportRequestMessages = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is Extract<VscodeToExtensionMessage, { type: "outputPreviewExportRequest" }> =>
    message.type === "outputPreviewExportRequest"
  );

const outputPreviewPlanRequests = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is Extract<VscodeToExtensionMessage, { type: "outputPreviewPlanRequest" }> =>
    message.type === "outputPreviewPlanRequest"
  );

const planForImportedTwoPlaceRoot = async (rootSource: string, outputKind: "svg" | "print" = "svg") => {
  const { compiled, publication } = await importedGraphPublication(rootSource);
  if (!isLastGoodDslDocument(compiled)) throw new Error("missing current imported graph compile");
  const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
  const plan = await actual.evaluateOutputPlan({
    compiledDocument: compiled,
    output: outputKind === "svg" ? compiled.document.svgOutputs[0]! : compiled.document.printOutputs[0]!
  });
  return { compiled, publication, plan };
};

const planForOverlappingPlacements = async (outputKind: "svg" | "print") => {
  const { compiled, publication } = await importedGraphPublication(
    overlappingOutputRoot,
    1,
    1,
    drawableIdentityDependency
  );
  if (!isLastGoodDslDocument(compiled)) throw new Error("missing current overlapping-placement graph compile");
  const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
  const output = outputKind === "svg"
    ? compiled.document.svgOutputs[0]
    : compiled.document.printOutputs[0];
  if (!output) throw new Error(`missing ${outputKind} overlapping-placement output`);
  const plan = await actual.evaluateOutputPlan({ compiledDocument: compiled, output });
  return { compiled, publication, plan };
};

const renderPublishedOutputPlan = async (
  rootSource: string,
  publication: VscodeMultiDocumentGraphPublication,
  plan: OutputPlan
) => {
  render(<OutputPreviewApp api={api} />);
  sendImportedSource(rootSource);
  sendGraphPublication(publication);
  await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
  const request = outputPreviewPlanRequests()[0]!;
  postWindowMessage({
    type: "outputPreviewPlanResult",
    requestId: request.requestId,
    graphAuthority: request.graphAuthority,
    plan
  });
  expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
  return screen.getByLabelText("Output preview");
};

const renderImportedPlan = async (rootSource: string, outputKind: "svg" | "print" = "svg") => {
  const accepted = await planForImportedTwoPlaceRoot(rootSource, outputKind);
  render(<OutputPreviewApp api={api} />);
  sendImportedSource(rootSource);
  sendGraphPublication(accepted.publication);
  await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
  const request = outputPreviewPlanRequests()[0]!;
  postWindowMessage({
    type: "outputPreviewPlanResult",
    requestId: request.requestId,
    graphAuthority: request.graphAuthority,
    plan: accepted.plan
  });
  expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
  return accepted;
};

const placeCommitMessages = () => vi.mocked(api.postMessage).mock.calls
  .map(([message]) => message)
  .filter((message): message is Extract<VscodeToExtensionMessage, { type: "outputPreviewPlaceCommit" }> =>
    message.type === "outputPreviewPlaceCommit"
  );

const sourceAfterPlaceCommit = (
  sourceText: string,
  commit: Extract<VscodeToExtensionMessage, { type: "outputPreviewPlaceCommit" }>
): string => [...commit.patches]
  .sort((left, right) => right.range.from - left.range.from)
  .reduce((text, patch) => text.slice(0, patch.range.from) + patch.replacement + text.slice(patch.range.to), sourceText);

const geometryPathData = () => [...screen.getByLabelText("Output preview").querySelectorAll<SVGPathElement>(
  'path[data-output-preview-layer="geometry"]'
)].map((path) => path.getAttribute("d"));

const visibleGeometryPathData = () => [...document.querySelectorAll<SVGPathElement>(
  '[data-output-preview-layer="geometry"]'
)].map((path) => path.getAttribute("d"));

const lineScreenPoints = (path: string | null) => {
  const match = path?.match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+L\s+(-?[\d.]+)\s+(-?[\d.]+)$/);
  if (!match) throw new Error(`unexpected line path: ${path}`);
  return [
    { x: Number(match[1]), y: Number(match[2]) },
    { x: Number(match[3]), y: Number(match[4]) }
  ] as const;
};

const createControlledRustApi = () => {
  const requests: Array<{ id: number; input: unknown; responded: boolean }> = [];
  const postMessage = vi.fn((message: VscodeToExtensionMessage) => {
    if (message.type === "rustEvaluationRequest") {
      requests.push({ id: message.id, input: message.input, responded: false });
    }
  });
  const api = { postMessage } satisfies VscodeWebviewApi;
  const respondNext = async () => {
    const request = requests.find((candidate) => !candidate.responded);
    if (!request) throw new Error("missing pending Rust evaluation request");
    request.responded = true;
    const input = request.input as { elements: Parameters<typeof evaluateElementsReferencePayload>[0] };
    const payload = evaluateElementsReferencePayload(input.elements);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "rustEvaluationResponse", id: request.id, payload }
      }));
      await Promise.resolve();
    });
  };
  return { api, requests, respondNext };
};

describe("Output Preview application", () => {
  it("keeps canonical overlapping geometry identity stable across pan and zoom updates", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { compiled, publication, plan } = await planForOverlappingPlacements("print");
    expect(compiled.diagnostics).toEqual([]);
    expect(publication.graph.valid).toBe(true);
    expect(plan.placements).toHaveLength(3);
    expect(plan.placements.map(({ mirror }) => mirror)).toEqual([false, false, true]);
    expect(plan.placements.map(({ drawables }) => drawables.length)).toEqual([3, 3, 3]);
    expect(plan.drawables.map(({ kind }) => kind)).toEqual([
      "line", "polyline", "text",
      "line", "polyline", "text",
      "line", "polyline", "text"
    ]);
    expect(plan.rustPayload.drawables).toEqual(plan.drawables);

    const centerlines = plan.drawables.filter((drawable) => drawable.kind === "line");
    expect(centerlines).toHaveLength(3);
    expect(new Set(centerlines.map(({ elementId }) => elementId)).size).toBe(1);
    expect(centerlines.map(({ start, end }) => [start, end])).toEqual([
      [{ x: 20, y: 30 }, { x: 20, y: 40 }],
      [{ x: 20, y: 30 }, { x: 20, y: 40 }],
      [{ x: 20, y: 30 }, { x: 20, y: 40 }]
    ]);
    const segmentedPaths = plan.drawables.filter((drawable) => drawable.kind === "polyline");
    expect(segmentedPaths).toHaveLength(3);
    expect(segmentedPaths.map(({ elementId }) => elementId)).toEqual([
      segmentedPaths[0]!.elementId,
      segmentedPaths[0]!.elementId,
      segmentedPaths[0]!.elementId
    ]);
    expect(segmentedPaths.map(({ segments }) => segments)).toEqual([
      expect.arrayContaining([expect.objectContaining({ kind: "line" }), expect.objectContaining({ kind: "line" })]),
      expect.arrayContaining([expect.objectContaining({ kind: "line" }), expect.objectContaining({ kind: "line" })]),
      expect.arrayContaining([expect.objectContaining({ kind: "line" }), expect.objectContaining({ kind: "line" })])
    ]);
    const labels = plan.drawables.filter((drawable) => drawable.kind === "text");
    expect(labels).toHaveLength(3);
    expect(new Set(labels.map(({ elementId }) => elementId)).size).toBe(1);
    expect(labels.map(({ anchor }) => anchor)).toEqual([
      { x: 20, y: 35 },
      { x: 20, y: 35 },
      { x: 20, y: 35 }
    ]);

    const svg = await renderPublishedOutputPlan(overlappingOutputRoot, publication, plan);
    const currentPreviewSvg = () => screen.getByLabelText("Output preview");
    const initialGeometryNodes = [...svg.querySelectorAll('[data-output-preview-layer="geometry"]')];
    const initialPathNodes = [...svg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
    const initialTextNodes = [...svg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
    const fitBounds = outputPreviewFitBoundsFor(plan);
    if (!fitBounds) throw new Error("missing SVG fit bounds for identity fixture");
    postWindowMessage({ type: "outputPreviewFit" });
    const fitViewport = fitOutputPreviewViewport(fitBounds, {
      width: viewportRect.width,
      height: viewportRect.height
    });
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const deltaY = -100;
    fireEvent.wheel(viewport, { deltaY, clientX: 250, clientY: 150 });
    const afterZoomViewport = zoomOutputPreviewViewportAt(
      fitViewport,
      Math.pow(VIEWPORT_ZOOM_STEP, -deltaY / 100),
      { x: 250, y: 150, width: viewportRect.width, height: viewportRect.height }
    );
    const size = { width: viewportRect.width, height: viewportRect.height };
    const expectedPathData = plan.drawables
      .filter((drawable) => drawable.kind !== "text")
      .map((drawable) => outputPreviewPathDataFor(drawable, size, afterZoomViewport));
    const expectedCenterlinePathData = centerlines.map((drawable) => outputPreviewPathDataFor(drawable, size, afterZoomViewport));
    const expectedGeometryTagOrder = plan.drawables.map((drawable) => drawable.kind === "text" ? "text" : "path");
    const expectedScreenPoints = expectedCenterlinePathData.map((path) => lineScreenPoints(path));
    const afterGeometryNodes = [...svg.querySelectorAll('[data-output-preview-layer="geometry"]')];
    const afterPathNodes = [...svg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
    const afterTextNodes = [...svg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
    const afterPathData = afterPathNodes.map((path) => path.getAttribute("d"));
    const duplicateKeyWarnings = consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((message) => /same key/i.test(message));
    const stalePathCount = afterPathData.filter((path) => !expectedPathData.includes(path)).length;
    const observedCenterlineScreenPoints = afterPathNodes
      .filter((_, index) => index % 2 === 0)
      .map((path) => lineScreenPoints(path.getAttribute("d")));

    expect({
      duplicateKeyWarnings,
      initialGeometryCount: initialGeometryNodes.length,
      afterGeometryCount: afterGeometryNodes.length,
      initialPathCount: initialPathNodes.length,
      afterPathCount: afterPathNodes.length,
      initialTextCount: initialTextNodes.length,
      afterTextCount: afterTextNodes.length,
      geometryTagOrder: afterGeometryNodes.map((node) => node.tagName.toLowerCase()),
      pathNodeIdentityPreserved: afterPathNodes.every((path, index) => path === initialPathNodes[index]),
      textNodeIdentityPreserved: afterTextNodes.every((text, index) => text === initialTextNodes[index]),
      stalePathCount,
      afterPathData,
      expectedPathData,
      centerlineScreenPoints: observedCenterlineScreenPoints,
      expectedCenterlineScreenPoints: expectedScreenPoints
    }).toEqual({
      duplicateKeyWarnings: [],
      initialGeometryCount: plan.drawables.length,
      afterGeometryCount: plan.drawables.length,
      initialPathCount: 6,
      afterPathCount: 6,
      initialTextCount: 3,
      afterTextCount: 3,
      geometryTagOrder: expectedGeometryTagOrder,
      pathNodeIdentityPreserved: true,
      textNodeIdentityPreserved: true,
      stalePathCount: 0,
      afterPathData: expectedPathData,
      expectedPathData,
      centerlineScreenPoints: expectedScreenPoints,
      expectedCenterlineScreenPoints: expectedScreenPoints
    });

    const assertViewportProjection = (
      activePlan: OutputPlan,
      expectedViewport: ReturnType<typeof fitOutputPreviewViewport>,
      stablePaths: readonly SVGPathElement[],
      stableTexts: readonly SVGTextElement[]
    ) => {
      const previewSvg = currentPreviewSvg();
      const currentGeometryNodes = [...previewSvg.querySelectorAll('[data-output-preview-layer="geometry"]')];
      const currentPaths = [...previewSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
      const currentTexts = [...previewSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
      const expectedPaths = activePlan.drawables
        .filter((drawable) => drawable.kind !== "text")
        .map((drawable) => outputPreviewPathDataFor(drawable, size, expectedViewport));
      const pathCenterlineOccurrences = activePlan.drawables.filter((drawable) => drawable.kind === "line");
      const currentCenterlinePaths: SVGPathElement[] = [];
      let pathIndex = 0;
      for (const drawable of activePlan.drawables) {
        if (drawable.kind === "text") continue;
        if (drawable.kind === "line") currentCenterlinePaths.push(currentPaths[pathIndex]!);
        pathIndex += 1;
      }
      const expectedTextTransforms = activePlan.drawables
        .filter((drawable) => drawable.kind === "text")
        .map((drawable) => {
          if (drawable.kind !== "text") throw new Error("expected text drawable");
          const anchor = outputPreviewWorldToScreen(drawable.anchor, size, expectedViewport);
          const scaleX = drawable.mirrorX ? -expectedViewport.zoom : expectedViewport.zoom;
          return `translate(${anchor.x} ${anchor.y}) rotate(${-drawable.rotationDeg}) scale(${scaleX} ${expectedViewport.zoom})`;
        });
      const centerlineScreenPoints = currentCenterlinePaths.map((path) => lineScreenPoints(path.getAttribute("d")));
      const expectedCenterlineScreenPoints = pathCenterlineOccurrences.map((drawable) => {
        if (drawable.kind !== "line") throw new Error("expected centerline occurrence");
        return [
          outputPreviewWorldToScreen(drawable.start, size, expectedViewport),
          outputPreviewWorldToScreen(drawable.end, size, expectedViewport)
        ];
      });

      expect(currentGeometryNodes).toHaveLength(activePlan.drawables.length);
      expect(currentGeometryNodes.map((node) => node.tagName.toLowerCase())).toEqual(
        activePlan.drawables.map((drawable) => drawable.kind === "text" ? "text" : "path")
      );
      expect(currentPaths.map((path) => path.getAttribute("d"))).toEqual(expectedPaths);
      expect(geometryPathData()).toEqual(expectedPaths);
      expect(currentPaths).toEqual(stablePaths);
      expect(currentTexts).toEqual(stableTexts);
      expect(currentTexts.map((text) => text.getAttribute("transform"))).toEqual(expectedTextTransforms);
      expect(centerlineScreenPoints).toEqual(expectedCenterlineScreenPoints);
      expect(consoleError.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((message) => /same key/i.test(message))).toEqual([]);
    };

    const planSnapshot = structuredClone(plan);
    const payloadSnapshot = structuredClone(plan.rustPayload);
    const sourceBeforeViewportUpdates = useCadDocumentStore.getState().sourceText;
    const compileCountBeforeViewportUpdates = vi.spyOn(documentCompiler, "compileCanonicalText").mock.calls.length;
    const localPlanCountBeforeViewportUpdates = mocks.evaluateOutputPlan.mock.calls.length;
    const rustRequestCountBeforeViewportUpdates = vi.mocked(api.postMessage).mock.calls
      .filter(([message]) => message.type === "rustEvaluationRequest").length;
    const sourceCommitCountBeforeViewportUpdates = placeCommitMessages().length;
    let viewportUpdateCount = 1;
    let expectedViewport = afterZoomViewport;
    let pointerX = 300;
    let pointerY = 250;
    let pointerId = 17640;

    const runViewportUpdates = (
      activePlan: OutputPlan,
      stablePaths: readonly SVGPathElement[],
      stableTexts: readonly SVGTextElement[],
      count: number,
      firstUpdateIndex: number
    ) => {
      for (let index = 0; index < count; index += 1) {
        const updateIndex = firstUpdateIndex + index;
        if (updateIndex % 2 === 0) {
          const deltaY = updateIndex % 4 === 0 ? -100 : 100;
          const clientX = 300 + updateIndex % 7;
          const clientY = 250 + updateIndex % 5;
          fireEvent.wheel(viewport, { deltaY, clientX, clientY });
          expectedViewport = zoomOutputPreviewViewportAt(
            expectedViewport,
            Math.pow(VIEWPORT_ZOOM_STEP, -deltaY / 100),
            { x: clientX, y: clientY, width: size.width, height: size.height }
          );
        } else {
          const deltaX = 1;
          const deltaY = -1;
          fireEvent.pointerDown(viewport, {
            button: 1,
            buttons: 4,
            pointerId,
            clientX: pointerX,
            clientY: pointerY
          });
          fireEvent.pointerMove(viewport, {
            button: 1,
            buttons: 4,
            pointerId,
            clientX: pointerX + deltaX,
            clientY: pointerY + deltaY
          });
          fireEvent.pointerUp(viewport, {
            button: 1,
            buttons: 0,
            pointerId,
            clientX: pointerX + deltaX,
            clientY: pointerY + deltaY
          });
          expectedViewport = panViewportByScreenDelta(expectedViewport, deltaX, deltaY);
          pointerX += deltaX;
          pointerY += deltaY;
          pointerId += 1;
        }
        viewportUpdateCount += 1;
        assertViewportProjection(activePlan, expectedViewport, stablePaths, stableTexts);
      }
    };

    const printExportCount = outputExportRequestMessages().length;
    runViewportUpdates(plan, initialPathNodes, initialTextNodes, 49, 1);
    expect(viewportUpdateCount).toBe(50);
    expect(outputPreviewPlanRequests()).toHaveLength(1);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(localPlanCountBeforeViewportUpdates);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCountBeforeViewportUpdates);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest"))
      .toHaveLength(rustRequestCountBeforeViewportUpdates);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBeforeViewportUpdates);
    expect(placeCommitMessages()).toHaveLength(sourceCommitCountBeforeViewportUpdates);
    expect(plan).toEqual(planSnapshot);
    expect(plan.rustPayload).toEqual(payloadSnapshot);
    expect(outputExportRequestMessages()).toHaveLength(printExportCount);
    postWindowMessage({ type: "outputPreviewExport" });
    await waitFor(() => expect(outputExportRequestMessages()).toHaveLength(printExportCount + 1));
    expect(outputExportRequestMessages().at(-1)?.payload).toEqual(payloadSnapshot);
    postWindowMessage({
      type: "outputPreviewExportResult",
      requestId: outputExportRequestMessages().at(-1)!.requestId,
      status: "saved"
    });

    const actualOutputCore = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const svgOutput = compiled.document.svgOutputs[0];
    if (!svgOutput) throw new Error("missing SVG output for the published overlapping-placement graph");
    const svgAcceptedPlan = await actualOutputCore.evaluateOutputPlan({ compiledDocument: compiled, output: svgOutput });
    const selector = screen.getByRole("combobox");
    const svgOutputKey = [...(selector as HTMLSelectElement).options]
      .find((option) => option.textContent?.includes("Preview"))?.value;
    if (!svgOutputKey) throw new Error("missing SVG output option");
    fireEvent.change(selector, { target: { value: svgOutputKey } });
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    const svgRequest = outputPreviewPlanRequests().at(-1)!;
    expect(svgRequest.outputKey).toBe(svgOutputKey);
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: svgRequest.requestId,
      graphAuthority: svgRequest.graphAuthority,
      plan: svgAcceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(svgOutputKey));
    const activePreviewSvg = currentPreviewSvg();
    const svgStablePaths = [...activePreviewSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
    const svgStableTexts = [...activePreviewSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
    const svgFitBounds = outputPreviewFitBoundsFor(svgAcceptedPlan);
    if (!svgFitBounds) throw new Error("missing SVG fit bounds for the accepted overlapping-placement plan");
    const svgFitViewport = fitOutputPreviewViewport(svgFitBounds, size);
    await waitFor(() => assertViewportProjection(svgAcceptedPlan, svgFitViewport, svgStablePaths, svgStableTexts));
    expectedViewport = svgFitViewport;
    const svgPlanSnapshot = structuredClone(svgAcceptedPlan);
    const svgPayloadSnapshot = structuredClone(svgAcceptedPlan.rustPayload);
    const svgSourceBeforeViewportUpdates = useCadDocumentStore.getState().sourceText;
    const compileCountBeforeSvgUpdates = vi.mocked(documentCompiler.compileCanonicalText).mock.calls.length;
    const localPlanCountBeforeSvgUpdates = mocks.evaluateOutputPlan.mock.calls.length;
    const rustRequestCountBeforeSvgUpdates = vi.mocked(api.postMessage).mock.calls
      .filter(([message]) => message.type === "rustEvaluationRequest").length;
    const svgPlanRequestCountBeforeViewportUpdates = outputPreviewPlanRequests().length;
    const svgSourceCommitCountBeforeViewportUpdates = placeCommitMessages().length;
    const svgExportCount = outputExportRequestMessages().length;

    runViewportUpdates(svgAcceptedPlan, svgStablePaths, svgStableTexts, 50, 50);
    expect(viewportUpdateCount).toBe(100);
    expect(outputPreviewPlanRequests()).toHaveLength(svgPlanRequestCountBeforeViewportUpdates);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(localPlanCountBeforeSvgUpdates);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCountBeforeSvgUpdates);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest"))
      .toHaveLength(rustRequestCountBeforeSvgUpdates);
    expect(useCadDocumentStore.getState().sourceText).toBe(svgSourceBeforeViewportUpdates);
    expect(placeCommitMessages()).toHaveLength(svgSourceCommitCountBeforeViewportUpdates);
    expect(svgAcceptedPlan).toEqual(svgPlanSnapshot);
    expect(svgAcceptedPlan.rustPayload).toEqual(svgPayloadSnapshot);
    expect(outputExportRequestMessages()).toHaveLength(svgExportCount);
    postWindowMessage({ type: "outputPreviewExport" });
    await waitFor(() => expect(outputExportRequestMessages()).toHaveLength(svgExportCount + 1));
    expect(outputExportRequestMessages().at(-1)?.payload).toEqual(svgPayloadSnapshot);

    const highlightedElementIds = [...new Set(plan.placements[0]!.drawables.map(({ elementId }) => elementId))];
    expect(highlightedElementIds).toHaveLength(3);
    const planRequestCountBeforeReveal = outputPreviewPlanRequests().length;
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 17640,
      documentVersion: publication.documentVersion,
      graphAuthority: svgRequest.graphAuthority,
      normalizedSourceOffset: 0,
      runtimeTarget: {
        kind: "geometry",
        sourceStatementIndex: 0,
        runtimeElementIds: highlightedElementIds
      }
    });
    const answerRevealPlanRequest = async (expectedCount: number) => {
      await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(expectedCount));
      const request = outputPreviewPlanRequests().at(-1)!;
      const requestPlan = request.outputKey === svgOutputKey ? svgAcceptedPlan : plan;
      postWindowMessage({
        type: "outputPreviewPlanResult",
        requestId: request.requestId,
        graphAuthority: request.graphAuthority,
        plan: requestPlan
      });
    };
    await answerRevealPlanRequest(planRequestCountBeforeReveal + 1);
    await answerRevealPlanRequest(planRequestCountBeforeReveal + 2);
    await waitFor(() => expect(revealResultMessages()).toContainEqual(expect.objectContaining({
      requestId: 17640,
      status: "resolved",
      outputKey: svgOutputKey
    })));
    const revealSvg = currentPreviewSvg();
    const revealGeometryPaths = [...revealSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
    const revealGeometryTexts = [...revealSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
    const revealHighlightPaths = [...revealSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="reveal-highlight"]')];
    const revealHighlightTexts = [...revealSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="reveal-highlight"]')];
    expect(revealHighlightPaths).toHaveLength(6);
    expect(revealHighlightTexts).toHaveLength(3);
    expect(revealHighlightPaths.map((path) => path.getAttribute("d"))).toEqual(
      revealGeometryPaths.map((path) => path.getAttribute("d"))
    );
    const revealSourceSnapshot = useCadDocumentStore.getState().sourceText;
    const revealPlanRequestCount = outputPreviewPlanRequests().length;
    const revealLocalPlanCount = mocks.evaluateOutputPlan.mock.calls.length;
    const revealCompileCount = vi.mocked(documentCompiler.compileCanonicalText).mock.calls.length;
    const revealRustRequestCount = vi.mocked(api.postMessage).mock.calls
      .filter(([message]) => message.type === "rustEvaluationRequest").length;
    const revealViewport = document.querySelector(".output-preview-viewport");
    if (!(revealViewport instanceof HTMLElement)) throw new Error("missing Output Preview viewport during Reveal highlight test");
    fireEvent.wheel(revealViewport, { deltaY: -100, clientX: 250, clientY: 150 });
    fireEvent.pointerDown(revealViewport, { button: 1, buttons: 4, pointerId: 17641, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(revealViewport, { button: 1, buttons: 4, pointerId: 17641, clientX: 301, clientY: 249 });
    fireEvent.pointerUp(revealViewport, { button: 1, buttons: 0, pointerId: 17641, clientX: 301, clientY: 249 });
    const currentRevealSvg = currentPreviewSvg();
    expect(currentRevealSvg.querySelectorAll('[data-output-preview-layer="geometry"]')).toHaveLength(9);
    expect(currentRevealSvg.querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(9);
    expect([...currentRevealSvg.querySelectorAll('path[data-output-preview-layer="geometry"]')]).toEqual(revealGeometryPaths);
    expect([...currentRevealSvg.querySelectorAll('text[data-output-preview-layer="geometry"]')]).toEqual(revealGeometryTexts);
    expect([...currentRevealSvg.querySelectorAll('path[data-output-preview-layer="reveal-highlight"]')]).toEqual(revealHighlightPaths);
    expect([...currentRevealSvg.querySelectorAll('text[data-output-preview-layer="reveal-highlight"]')]).toEqual(revealHighlightTexts);
    expect([...currentRevealSvg.querySelectorAll('path[data-output-preview-layer="reveal-highlight"]')]
      .map((path) => path.getAttribute("d"))).toEqual(
      [...currentRevealSvg.querySelectorAll('path[data-output-preview-layer="geometry"]')]
        .map((path) => path.getAttribute("d"))
    );
    expect(useCadDocumentStore.getState().sourceText).toBe(revealSourceSnapshot);
    expect(outputPreviewPlanRequests()).toHaveLength(revealPlanRequestCount);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(revealLocalPlanCount);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(revealCompileCount);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest"))
      .toHaveLength(revealRustRequestCount);
    expect(consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((message) => /same key/i.test(message))).toEqual([]);

    postWindowMessage({ type: "outputPreviewClearFocus" });
    await waitFor(() => expect(currentPreviewSvg().querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(0));
    const placeHandles = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")];
    expect(placeHandles).toHaveLength(3);
    fireEvent.pointerEnter(placeHandles[0]!);
    await waitFor(() => expect(currentPreviewSvg().querySelectorAll('[data-output-preview-layer="place-highlight"]')).toHaveLength(3));
    const placeHighlightSvg = currentPreviewSvg();
    const placeGeometryPaths = [...placeHighlightSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')];
    const placeGeometryTexts = [...placeHighlightSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')];
    const placeHighlightPaths = [...placeHighlightSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="place-highlight"]')];
    const placeHighlightTexts = [...placeHighlightSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="place-highlight"]')];
    expect(placeHighlightPaths).toHaveLength(2);
    expect(placeHighlightTexts).toHaveLength(1);
    const placeHighlightPathData = placeHighlightPaths.map((path) => path.getAttribute("d"));
    const placeViewport = document.querySelector(".output-preview-viewport");
    if (!(placeViewport instanceof HTMLElement)) throw new Error("missing Output Preview viewport during place highlight test");
    fireEvent.wheel(placeViewport, { deltaY: 100, clientX: 250, clientY: 150 });
    fireEvent.pointerDown(placeViewport, { button: 1, buttons: 4, pointerId: 17642, clientX: 301, clientY: 249 });
    fireEvent.pointerMove(placeViewport, { button: 1, buttons: 4, pointerId: 17642, clientX: 302, clientY: 248 });
    fireEvent.pointerUp(placeViewport, { button: 1, buttons: 0, pointerId: 17642, clientX: 302, clientY: 248 });
    const currentPlaceHighlightSvg = currentPreviewSvg();
    const currentPlaceHighlightPaths = [...currentPlaceHighlightSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="place-highlight"]')];
    expect(currentPlaceHighlightSvg.querySelectorAll('[data-output-preview-layer="geometry"]')).toHaveLength(9);
    expect(currentPlaceHighlightSvg.querySelectorAll('[data-output-preview-layer="place-highlight"]')).toHaveLength(3);
    expect([...currentPlaceHighlightSvg.querySelectorAll<SVGPathElement>('path[data-output-preview-layer="geometry"]')])
      .toEqual(placeGeometryPaths);
    expect([...currentPlaceHighlightSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="geometry"]')])
      .toEqual(placeGeometryTexts);
    expect(currentPlaceHighlightPaths).toEqual(placeHighlightPaths);
    expect([...currentPlaceHighlightSvg.querySelectorAll<SVGTextElement>('text[data-output-preview-layer="place-highlight"]')])
      .toEqual(placeHighlightTexts);
    expect(currentPlaceHighlightPaths.map((path) => path.getAttribute("d"))).not.toEqual(placeHighlightPathData);
    expect(consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((message) => /same key/i.test(message))).toEqual([]);
  });

  it("projects standalone placement while dragging without compiling or evaluating", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    let acceptedStandalonePlan: OutputPlan | null = null;
    mocks.evaluateOutputPlan.mockImplementation(async ({ compiledDocument, output }: { compiledDocument: LastGoodDslDocument; output: TestOutput }) => {
      const base = planFor(output as TestOutput);
      const template = base.drawables[0];
      const layout = compiledDocument.document.layouts.find((candidate) => candidate.id === output.layoutId);
      if (!template || !layout) throw new Error("missing standalone output placement fixture");
      const placements = layout.placements.map((placement) => {
        const at = placement.at as { x: number; y: number };
        const drawable = {
          ...template,
          start: { x: at.x, y: at.y },
          end: { x: at.x + 10, y: at.y }
        };
        return {
          id: placement.id,
          groupId: placement.groupId,
          origin: { x: 0, y: 0 },
          at,
          scale: 1,
          angleDeg: 0,
          mirror: false,
          drawables: [drawable]
        };
      });
      const drawables = placements.flatMap((placement) => placement.drawables);
      acceptedStandalonePlan = {
        ...base,
        placements,
        drawables,
        rustPayload: { ...base.rustPayload, drawables }
      };
      return acceptedStandalonePlan;
    });
    renderFixture(standaloneTwoPlaceOutputSource);
    sendImportedSource(standaloneTwoPlaceOutputSource);
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing standalone output viewport");
    if (!acceptedStandalonePlan) throw new Error("missing accepted standalone output plan");
    const fitBounds = outputPreviewFitBoundsFor(acceptedStandalonePlan);
    if (!fitBounds) throw new Error("missing standalone output fit bounds");
    const fittedViewport = fitOutputPreviewViewport(fitBounds, { width: viewportRect.width, height: viewportRect.height });
    const expectedBefore = [
      [
        outputPreviewWorldToScreen({ x: 0, y: 0 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport),
        outputPreviewWorldToScreen({ x: 10, y: 0 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport)
      ],
      [
        outputPreviewWorldToScreen({ x: 40, y: 0 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport),
        outputPreviewWorldToScreen({ x: 50, y: 0 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport)
      ]
    ] as const;
    const compileCount = vi.spyOn(documentCompiler, "compileCanonicalText").mock.calls.length;
    const evaluationCount = mocks.evaluateOutputPlan.mock.calls.length;
    const rustRequestCount = vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest").length;
    const firstPlaceId = useCadDocumentStore.getState().layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing first standalone place handle");
    const before = geometryPathData();
    expect(before).toHaveLength(2);
    const beforePoints = before.map(lineScreenPoints);
    expect(beforePoints).toEqual(expectedBefore);

    await act(async () => fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1745, clientX: 100, clientY: 100 }));
    const admittedHandle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    expect(admittedHandle?.dataset.dragging).toBe("true");
    expect(geometryPathData()).toEqual(before);
    await act(async () => {
      fireEvent.pointerMove(admittedHandle ?? handle, { buttons: 1, pointerId: 1745, clientX: 120, clientY: 100 });
    });
    const after = geometryPathData();
    const afterPoints = after.map(lineScreenPoints);
    expect(afterPoints[0]![0].x).toBeCloseTo(expectedBefore[0][0].x + 20, 6);
    expect(afterPoints[0]![1].x).toBeCloseTo(expectedBefore[0][1].x + 20, 6);
    expect(afterPoints[0]![0].y).toBeCloseTo(expectedBefore[0][0].y, 6);
    expect(afterPoints[0]![1].y).toBeCloseTo(expectedBefore[0][1].y, 6);
    expect(afterPoints[1]).toEqual(expectedBefore[1]);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(evaluationCount);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCount);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(rustRequestCount);
    expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(false);
  });

  it("keeps a standalone projection through the guarded release and delayed canonical plan promotion", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    let holdNextResult = false;
    let completeDelayedEvaluation: (() => void) | null = null;
    let delayedAcceptedPlan: OutputPlan | null = null;
    let delayedCompiledDocument: LastGoodDslDocument | null = null;
    mocks.evaluateOutputPlan.mockImplementation(async (request: Parameters<typeof actual.evaluateOutputPlan>[0]) => {
      const plan = await actual.evaluateOutputPlan({
        compiledDocument: request.compiledDocument,
        output: request.output
      });
      if (holdNextResult) {
        holdNextResult = false;
        delayedAcceptedPlan = plan;
        delayedCompiledDocument = request.compiledDocument;
        return new Promise<OutputPlan>((resolve) => {
          completeDelayedEvaluation = () => resolve(plan);
        });
      }
      return plan;
    });
    renderFixture(standaloneTwoPlaceOutputSource);
    sendImportedSource(standaloneTwoPlaceOutputSource);
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
    await waitFor(() => expect(visibleGeometryPathData()).toHaveLength(2));
    const acceptedPaths = geometryPathData();
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing standalone output viewport");
    const initialCompiled = compileFreshCanonicalText(standaloneTwoPlaceOutputSource);
    if (initialCompiled.status === "fatal") throw new Error("invalid standalone fixture");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: initialCompiled.doc,
      output: initialCompiled.doc.document.svgOutputs[0]!
    });
    const fitBounds = outputPreviewFitBoundsFor(acceptedPlan);
    if (!fitBounds) throw new Error("missing standalone fit bounds");
    const fittedViewport = fitOutputPreviewViewport(fitBounds, { width: viewportRect.width, height: viewportRect.height });
    const deltaClientX = 20;
    const worldStart = outputPreviewScreenToWorld(
      { x: 100, y: 100 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport
    );
    const worldEnd = outputPreviewScreenToWorld(
      { x: 100 + deltaClientX, y: 100 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport
    );
    const expectedDelta = { x: worldEnd.x - worldStart.x, y: worldEnd.y - worldStart.y };
    const firstPlacement = useCadDocumentStore.getState().layouts[0]!.placements[0]!;
    const firstPlaceId = firstPlacement.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing standalone place handle");
    fireEvent.pointerMove(viewport, { pointerId: 0, buttons: 0, clientX: 1, clientY: 1 });
    const compileCount = vi.spyOn(documentCompiler, "compileCanonicalText").mock.calls.length;
    const evaluationCount = mocks.evaluateOutputPlan.mock.calls.length;
    const rustRequestCount = vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest").length;
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1763, clientX: 100, clientY: 100 });
    });
    expect(handle.dataset.dragging).toBe("true");
    await act(async () => {
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1763, clientX: 120, clientY: 100 });
    });
    const projectedPaths = geometryPathData();
    const projectedPoints = projectedPaths.map(lineScreenPoints);
    const acceptedPoints = acceptedPaths.map(lineScreenPoints);
    expect(projectedPoints[0]![0].x).toBeCloseTo(acceptedPoints[0]![0].x + deltaClientX, 6);
    expect(projectedPoints[1]).toEqual(acceptedPoints[1]);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCount);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(evaluationCount);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(rustRequestCount);
    expect(placeCommitMessages()).toHaveLength(0);
    expect(useCadDocumentStore.getState().sourceText).toBe(standaloneTwoPlaceOutputSource);

    await act(async () => {
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1763, clientX: 120, clientY: 100 });
    });
    expect(placeCommitMessages()).toHaveLength(1);
    const commit = placeCommitMessages()[0]!;
    expect(commit).toMatchObject({
      documentVersion: 1,
      normalizedSourceSnapshot: standaloneTwoPlaceOutputSource
    });
    const committedSource = sourceAfterPlaceCommit(standaloneTwoPlaceOutputSource, commit);
    const committed = compileFreshCanonicalText(committedSource);
    if (committed.status === "fatal") throw new Error("invalid standalone committed Source");
    holdNextResult = true;
    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });
    await waitFor(() => expect(completeDelayedEvaluation).not.toBeNull());
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
    const promotedPlan = delayedAcceptedPlan;
    const delayedCompiledForOracle = delayedCompiledDocument as LastGoodDslDocument | null;
    if (!promotedPlan || !delayedCompiledForOracle) throw new Error("missing delayed canonical standalone plan");
    const canonicalPlan = await actual.evaluateOutputPlan({
      compiledDocument: delayedCompiledForOracle,
      output: delayedCompiledForOracle.document.svgOutputs[0]!
    });
    expect(canonicalPlan.placements[0]!.at.x).toBeCloseTo(acceptedPlan.placements[0]!.at.x + expectedDelta.x, 9);
    expect(canonicalPlan.placements[0]!.at.y).toBeCloseTo(acceptedPlan.placements[0]!.at.y + expectedDelta.y, 9);
    expect(canonicalPlan.placements[1]!.at).toEqual(acceptedPlan.placements[1]!.at);
    expect(promotedPlan).toEqual(canonicalPlan);
    await act(async () => completeDelayedEvaluation?.());
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(outputKeyFor("svg", "Preview")));
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(geometryPathData().map(lineScreenPoints)[1]).toEqual(acceptedPoints[1]);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
      outputKey: outputKeyFor("svg", "Preview"),
      payload: canonicalPlan.rustPayload
    }));
  });

  it("projects imported place geometry under a held pointer while the second occurrence stays still", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled, publication, plan } = await planForImportedTwoPlaceRoot(importedTwoPlaceOutputRoot);
    expect(compiled.diagnostics).toEqual([]);
    expect(publication.graph.valid).toBe(true);
    expect(plan.placements).toHaveLength(2);
    expect(plan.placements[0]?.groupId).toBe(plan.placements[1]?.groupId);
    expect(plan.placements[0]?.id).not.toBe(plan.placements[1]?.id);
    expect(plan.placements.map((placement) => placement.drawables.length)).toEqual([1, 1]);

    render(<OutputPreviewApp api={api} />);
    sendImportedSource(importedTwoPlaceOutputRoot);
    sendGraphPublication(publication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
    const request = outputPreviewPlanRequests()[0]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: request.requestId,
      graphAuthority: request.graphAuthority,
      plan
    });
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerMove(viewport, { pointerId: 0, buttons: 0, clientX: 1, clientY: 1 });

    const placeIds = compiled.document.layouts[0]!.placements.map((placement) => placement.id);
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === placeIds[0]);
    if (!handle) throw new Error("missing first imported place handle");
    const before = geometryPathData();
    expect(before).toHaveLength(2);
    const evaluationCount = mocks.evaluateOutputPlan.mock.calls.length;
    const compileCount = vi.spyOn(documentCompiler, "compileCanonicalText").mock.calls.length;
    const rustRequestCount = vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest").length;
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1746, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1746, clientX: 120, clientY: 100 });
    });
    const firstProjection = geometryPathData();
    await act(async () => {
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1746, clientX: 110, clientY: 100 });
    });
    const reversedProjection = geometryPathData();
    await act(async () => {
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1746, clientX: 120, clientY: 100 });
    });

    const after = geometryPathData();
    expect(firstProjection[0]).not.toBe(before[0]);
    expect(reversedProjection[0]).not.toBe(firstProjection[0]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]).toBe(firstProjection[0]);
    expect(after[1]).toBe(before[1]);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCount);
    expect(outputPreviewPlanRequests()).toHaveLength(1);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(evaluationCount);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(rustRequestCount);
    expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(false);
  });

  it("keeps the projected plane through a matching commit and promotes its accepted reevaluation", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled, publication, plan } = await planForImportedTwoPlaceRoot(importedTwoPlaceOutputRoot);
    render(<OutputPreviewApp api={api} />);
    sendImportedSource(importedTwoPlaceOutputRoot);
    sendGraphPublication(publication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
    const request = outputPreviewPlanRequests()[0]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: request.requestId,
      graphAuthority: request.graphAuthority,
      plan
    });
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();

    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing first imported place handle");
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1747, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1747, clientX: 120, clientY: 100 });
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1747, clientX: 120, clientY: 100 });
    });
    const projectedPaths = geometryPathData();
    expect(projectedPaths[0]).not.toEqual(projectedPaths[1]);

    const commit = vi.mocked(api.postMessage).mock.calls
      .map(([message]) => message)
      .find((message): message is Extract<VscodeToExtensionMessage, { type: "outputPreviewPlaceCommit" }> =>
        message.type === "outputPreviewPlaceCommit"
      );
    if (!commit) throw new Error("missing guarded place commit request");
    let committedSource = importedTwoPlaceOutputRoot;
    for (const patch of [...commit.patches].sort((left, right) => right.range.from - left.range.from)) {
      committedSource = `${committedSource.slice(0, patch.range.from)}${patch.replacement}${committedSource.slice(patch.range.to)}`;
    }
    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });

    postWindowMessage({
      type: "replaceTextDocument",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri
    });
    expect(geometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    expect(screen.getByText("Evaluating…")).toBeInTheDocument();
    expect(screen.getByLabelText("Output preview")).toBeInTheDocument();
    expect(geometryPathData()).toEqual(projectedPaths);
    expect(outputPreviewPlanRequests()).toHaveLength(1);

    sendGraphPublication({
      type: "multiDocumentGraphPublication",
      status: "building",
      graph: null,
      hostDocumentUri: importedRootUri,
      documentVersion: 2,
      outputPreview: { sequence: 2 }
    });
    expect(screen.getByLabelText("Output preview")).toBeInTheDocument();
    expect(geometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    const { compiled: acceptedCompiled, publication: acceptedPublication } = await importedGraphPublication(
      committedSource,
      2,
      2,
      importedDependency,
      importedRootUri,
      new Map([...(compiled.statementMap?.statementIdByStatementIndex ?? [])]
        .filter(([statementIndex]) => [5, 6, 7, 9].includes(statementIndex)))
    );
    if (!isLastGoodDslDocument(acceptedCompiled)) throw new Error(`missing accepted imported commit compile: ${JSON.stringify(acceptedCompiled.diagnostics)}`);
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: acceptedCompiled,
      output: acceptedCompiled.document.svgOutputs[0]!
    });
    const matchingPublication = {
      ...acceptedPublication,
      outputPreview: { ...acceptedPublication.outputPreview!, sequence: 3 }
    };
    sendGraphPublication(matchingPublication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    expect(screen.getByLabelText("Output preview")).toBeInTheDocument();
    expect(geometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({
      type: "replaceTextDocument",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri
    });
    expect(geometryPathData()).toEqual(projectedPaths);
    expect(outputPreviewPlanRequests()).toHaveLength(2);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
    const acceptedRequest = outputPreviewPlanRequests().at(-1)!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: acceptedRequest.requestId,
      graphAuthority: acceptedRequest.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(geometryPathData()).toEqual(projectedPaths));
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(acceptedRequest.outputKey));
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({ payload: acceptedPlan.rustPayload }));
  });

  it.each(["Escape", "pointercancel", "lostpointercapture", "no movement", "return to origin"] as const)(
    "restores the accepted App display after %s without a Source commit",
    async (ending) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
      const { compiled, plan } = await renderImportedPlan(importedTwoPlaceOutputRoot);
      const originalPaths = geometryPathData();
      const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
      const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
        .find((candidate) => candidate.dataset.placeId === firstPlaceId);
      if (!handle) throw new Error("missing first imported place handle");
      const pointerId = 1764;
      await act(async () => {
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId, clientX: 100, clientY: 100 });
      });
      if (ending !== "no movement") {
        await act(async () => {
          fireEvent.pointerMove(handle, { buttons: 1, pointerId, clientX: 120, clientY: 100 });
        });
        expect(visibleGeometryPathData()).not.toEqual(originalPaths);
      }
      if (ending === "Escape") {
        fireEvent.keyDown(window, { key: "Escape" });
      } else if (ending === "pointercancel") {
        fireEvent.pointerCancel(handle, { pointerId });
      } else if (ending === "lostpointercapture") {
        fireEvent.lostPointerCapture(handle, { pointerId });
      } else if (ending === "return to origin") {
        await act(async () => {
          fireEvent.pointerMove(handle, { buttons: 1, pointerId, clientX: 100, clientY: 100 });
          fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId, clientX: 100, clientY: 100 });
        });
      } else {
        await act(async () => {
          fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId, clientX: 100, clientY: 100 });
        });
      }

      await waitFor(() => expect(visibleGeometryPathData()).toEqual(originalPaths));
      expect(placeCommitMessages()).toHaveLength(0);
      expect(outputPreviewPlanRequests()).toHaveLength(1);
      expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe("svg:" + plan.outputId);
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages()).toHaveLength(1);
      expect(outputExportRequestMessages()[0]?.payload).toEqual(plan.rustPayload);
    }
  );

  it.each(["undo", "redo", "inconsistent precommit Source", "inconsistent duplicate Source", "unrelated Source update", "root replacement"] as const)(
    "withdraws a pending App projection on %s and ignores its older plan result",
    async (change) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
      const { compiled, plan } = await renderImportedPlan(importedTwoPlaceOutputRoot);
      const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
      const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
        .find((candidate) => candidate.dataset.placeId === firstPlaceId);
      if (!handle) throw new Error("missing first imported place handle");
      await act(async () => {
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1765, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1765, clientX: 120, clientY: 100 });
        fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1765, clientX: 120, clientY: 100 });
      });
      const projectedPaths = visibleGeometryPathData();
      expect(projectedPaths).toHaveLength(2);
      expect(placeCommitMessages()).toHaveLength(1);
      const commit = placeCommitMessages()[0]!;
      const committedSource = sourceAfterPlaceCommit(importedTwoPlaceOutputRoot, commit);
      const initialPlanRequest = outputPreviewPlanRequests()[0]!;

      if (change === "inconsistent precommit Source") {
        postWindowMessage({
          type: "replaceTextDocument",
          sourceText: importedTwoPlaceOutputRoot + "\n",
          documentVersion: 1,
          hostDocumentUri: importedRootUri
        });
      } else if (change === "undo") {
        postWindowMessage({
          type: "commitText",
          sourceText: importedTwoPlaceOutputRoot,
          documentVersion: 2,
          hostDocumentUri: importedRootUri,
          reason: "undo"
        });
      } else if (change === "redo") {
        postWindowMessage({
          type: "commitText",
          sourceText: committedSource,
          documentVersion: 2,
          hostDocumentUri: importedRootUri,
          reason: "redo"
        });
      } else if (change === "inconsistent duplicate Source") {
        postWindowMessage({
          type: "commitText",
          sourceText: committedSource,
          documentVersion: 2,
          hostDocumentUri: importedRootUri,
          reason: "edit"
        });
        expect(visibleGeometryPathData()).toEqual(projectedPaths);
        postWindowMessage({
          type: "replaceTextDocument",
          sourceText: committedSource + "\n",
          documentVersion: 2,
          hostDocumentUri: importedRootUri
        });
      } else if (change === "unrelated Source update") {
        postWindowMessage({
          type: "replaceTextDocument",
          sourceText: committedSource + "\n",
          documentVersion: 2,
          hostDocumentUri: importedRootUri
        });
      } else {
        postWindowMessage({
          type: "replaceTextDocument",
          sourceText: importedOutputRoot,
          documentVersion: 1,
          hostDocumentUri: "file:///workspace/replacement.nui"
        });
      }

      expect(visibleGeometryPathData()).toEqual([]);
      expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
      postWindowMessage({
        type: "outputPreviewPlanResult",
        requestId: initialPlanRequest.requestId,
        graphAuthority: initialPlanRequest.graphAuthority,
        plan
      });
      expect(visibleGeometryPathData()).not.toEqual(projectedPaths);
      expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages()).toEqual([]);
    }
  );

  it("withdraws the active projection when Output selection changes and exports only the accepted new plan", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled } = await renderImportedPlan(importedTwoPlaceTwoSvgOutputRoot);
    const firstOutputKey = "svg:" + compiled.document.svgOutputs[0]!.id;
    const secondOutputKey = "svg:" + compiled.document.svgOutputs[1]!.id;
    const selector = screen.getByRole("combobox");
    expect(selector).toHaveValue(firstOutputKey);
    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing first imported place handle");
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1766, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1766, clientX: 120, clientY: 100 });
    });
    expect(visibleGeometryPathData()).toHaveLength(2);
    fireEvent.change(selector, { target: { value: secondOutputKey } });
    expect(selector).toHaveValue(secondOutputKey);
    expect(visibleGeometryPathData()).toEqual([]);
    expect(placeCommitMessages()).toHaveLength(0);
    expect(outputPreviewPlanRequests()).toHaveLength(2);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: compiled,
      output: compiled.document.svgOutputs[1]!
    });
    const request = outputPreviewPlanRequests()[1]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: request.requestId,
      graphAuthority: request.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(secondOutputKey));
    expect(visibleGeometryPathData()).toHaveLength(2);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
      outputKey: secondOutputKey,
      payload: acceptedPlan.rustPayload
    }));
  });

  it("retains a verified matching current graph delivered before its committed Source", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled, plan } = await renderImportedPlan(importedTwoPlaceOutputRoot);
    const originalPaths = geometryPathData();
    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing first imported place handle");
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1760, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1760, clientX: 120, clientY: 100 });
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1760, clientX: 120, clientY: 100 });
    });
    const projectedPaths = geometryPathData();
    expect(projectedPaths).not.toEqual(originalPaths);
    expect(placeCommitMessages()).toHaveLength(1);
    const committedSource = sourceAfterPlaceCommit(importedTwoPlaceOutputRoot, placeCommitMessages()[0]!);
    const assignedIds = new Map([...(compiled.statementMap?.statementIdByStatementIndex ?? [])]
      .filter(([statementIndex]) => [5, 6, 7, 9].includes(statementIndex)));
    const { compiled: committedCompiled, publication } = await importedGraphPublication(
      committedSource, 2, 2, importedDependency, importedRootUri, assignedIds
    );
    if (!isLastGoodDslDocument(committedCompiled)) throw new Error("missing matching committed graph compile");
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: committedCompiled,
      output: committedCompiled.document.svgOutputs[0]!
    });

    sendGraphPublication(publication);
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(outputPreviewPlanRequests()).toHaveLength(1);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();

    const acceptedRequest = outputPreviewPlanRequests()[1]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: acceptedRequest.requestId,
      graphAuthority: acceptedRequest.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(acceptedRequest.outputKey));
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(acceptedPlan.placements[0]?.at).toEqual(committedCompiled.document.layouts[0]!.placements[0]!.at);
    expect(acceptedPlan.placements[1]?.at).toEqual(plan.placements[1]?.at);
  });

  it("keeps an imported A4 print layout visible through a held cross-page drag and accepted promotion", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled, publication, plan } = await renderImportedPlan(importedTwoPlacePrintOutputRoot, "print");
    expect(compiled.diagnostics).toEqual([]);
    expect(publication.graph.valid).toBe(true);
    expect(plan.print).toMatchObject({
      paper: "a4",
      orientation: "portrait",
      paperWidthMm: 210,
      paperHeightMm: 297,
      overlapMm: 10
    });
    expect(plan.placements).toHaveLength(2);
    expect(plan.placements[0]?.groupId).toBe(plan.placements[1]?.groupId);
    expect(plan.placements[0]?.id).not.toBe(plan.placements[1]?.id);
    expect(plan.print?.pages).toHaveLength(1);
    const selector = screen.getByRole("combobox");
    const outputKey = "print:" + compiled.document.printOutputs[0]!.id;
    expect(selector).toHaveValue(outputKey);
    expect(document.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(1);
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing imported print viewport");
    const fitBounds = outputPreviewFitBoundsFor(plan);
    if (!fitBounds) throw new Error("missing imported print fit bounds");
    const fittedViewport = fitOutputPreviewViewport(fitBounds, { width: viewportRect.width, height: viewportRect.height });
    const beforePaths = geometryPathData();
    expect(beforePaths).toHaveLength(2);
    const beforePoints = beforePaths.map(lineScreenPoints);
    const zoomStatusBefore = screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent;
    const sourceTextBeforeDrag = useCadDocumentStore.getState().sourceText;
    const deltaClientX = 240 * fittedViewport.zoom;
    const expectedWorldStart = outputPreviewScreenToWorld(
      { x: 100, y: 100 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport
    );
    const expectedWorldEnd = outputPreviewScreenToWorld(
      { x: 100 + deltaClientX, y: 100 }, { width: viewportRect.width, height: viewportRect.height }, fittedViewport
    );
    const expectedWorldDeltaX = expectedWorldEnd.x - expectedWorldStart.x;
    expect(expectedWorldDeltaX).toBeCloseTo(240, 9);
    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing imported print place handle");
    fireEvent.pointerMove(viewport, { pointerId: 0, buttons: 0, clientX: 1, clientY: 1 });
    const compileCount = vi.spyOn(documentCompiler, "compileCanonicalText").mock.calls.length;
    const evaluationCount = mocks.evaluateOutputPlan.mock.calls.length;
    const rustRequestCount = vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest").length;
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1762, clientX: 100, clientY: 100 });
    });
    expect(handle.dataset.dragging).toBe("true");
    await act(async () => {
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1762, clientX: 100 + deltaClientX, clientY: 100 });
    });
    const projectedPaths = geometryPathData();
    const projectedPoints = projectedPaths.map(lineScreenPoints);
    expect(projectedPoints[0]![0].x).toBeCloseTo(beforePoints[0]![0].x + deltaClientX, 5);
    expect(projectedPoints[0]![1].x).toBeCloseTo(beforePoints[0]![1].x + deltaClientX, 5);
    expect(projectedPoints[0]![0].y).toBeCloseTo(beforePoints[0]![0].y, 5);
    expect(projectedPoints[1]).toEqual(beforePoints[1]);
    expect(document.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-output-preview-layer="overlap-guide"]').length).toBeGreaterThan(0);
    expect(selector).toHaveValue(outputKey);
    expect(screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent).toBe(zoomStatusBefore);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceTextBeforeDrag);
    expect(placeCommitMessages()).toHaveLength(0);
    expect(vi.mocked(documentCompiler.compileCanonicalText)).toHaveBeenCalledTimes(compileCount);
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(evaluationCount);
    expect(outputPreviewPlanRequests()).toHaveLength(1);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(rustRequestCount);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    await act(async () => {
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1762, clientX: 100 + deltaClientX, clientY: 100 });
    });
    expect(placeCommitMessages()).toHaveLength(1);
    const commit = placeCommitMessages()[0]!;
    expect(commit).toMatchObject({
      type: "outputPreviewPlaceCommit",
      documentVersion: 1,
      normalizedSourceSnapshot: importedTwoPlacePrintOutputRoot
    });
    const committedSource = sourceAfterPlaceCommit(importedTwoPlacePrintOutputRoot, commit);
    const assignedIds = new Map([...(compiled.statementMap?.statementIdByStatementIndex ?? [])]);
    const { compiled: committedCompiled, publication: acceptedPublication } = await importedGraphPublication(
      committedSource, 2, 2, importedDependency, importedRootUri, assignedIds
    );
    if (!isLastGoodDslDocument(committedCompiled)) throw new Error("missing committed print graph compile");
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: committedCompiled,
      output: committedCompiled.document.printOutputs[0]!
    });
    expect(acceptedPlan.placements[0]?.at).toEqual(committedCompiled.document.layouts[0]!.placements[0]!.at);
    expect(acceptedPlan.placements[0]!.at.x).toBeCloseTo(plan.placements[0]!.at.x + expectedWorldDeltaX, 8);
    expect(acceptedPlan.placements[1]?.at).toEqual(plan.placements[1]?.at);
    const expectedColumns = 2;
    const expectedRows = 1;
    expect(acceptedPlan.print).toMatchObject({ columns: expectedColumns, rows: expectedRows });
    expect(expectedColumns).toBe(2);
    expect(expectedRows).toBe(1);
    expect(acceptedPlan.print?.pages.map((page) => page.origin)).toEqual([
      { x: -10, y: -10 },
      { x: 180, y: -10 }
    ]);
    expect(acceptedPlan.print?.pages[0]?.guides.find((guide) =>
      guide.axis === "vertical" && guide.positionMm === 200
    )?.label).toMatchObject({ text: "1", center: { x: 205, y: 148.5 } });
    expect(acceptedPlan.print?.pages[1]?.guides.find((guide) =>
      guide.axis === "vertical" && guide.positionMm === 10
    )?.label).toMatchObject({ text: "1", center: { x: 5, y: 148.5 } });
    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    sendGraphPublication({
      type: "multiDocumentGraphPublication",
      status: "building",
      graph: null,
      hostDocumentUri: importedRootUri,
      documentVersion: 2,
      outputPreview: { sequence: 2 }
    });
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(document.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(2);
    const promotedPublication = {
      ...acceptedPublication,
      outputPreview: { ...acceptedPublication.outputPreview!, sequence: 3 }
    };
    sendGraphPublication(promotedPublication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: outputPreviewPlanRequests()[1]!.requestId,
      graphAuthority: outputPreviewPlanRequests()[1]!.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(outputKey));
    expect(visibleGeometryPathData()).toEqual(projectedPaths);
    expect(document.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(2);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
      outputKey,
      payload: acceptedPlan.rustPayload
    }));
  });

  it("keeps the exact A4 usable-width edge on one page and promotes the live just-over edge to two", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const exactEdgeSource = printPageBoundarySource(190);
    const { compiled: exactCompiled, publication: exactPublication, plan: exactPlan } =
      await planForImportedTwoPlaceRoot(exactEdgeSource, "print");
    expect(exactCompiled.diagnostics).toEqual([]);
    expect(exactPlan.drawables[0]).toMatchObject({
      kind: "line",
      start: { x: 0, y: 20 },
      end: { x: 190, y: 20 },
      stroke: { widthMm: 100 * 25.4 / 96 }
    });
    expect(exactPlan.renderedBounds.maxX).toBeGreaterThan(200);
    expect(exactPlan.print?.warning).toEqual({ kind: "physical-paper-overflow" });
    expect(exactPlan.print).toMatchObject({
      paperWidthMm: 210,
      paperHeightMm: 297,
      overlapMm: 10,
      strideXmm: 190,
      columns: 1,
      rows: 1,
      pages: [{ origin: { x: -10, y: -10 } }]
    });
    const exactSvg = await renderPublishedOutputPlan(exactEdgeSource, exactPublication, exactPlan);
    const exactFitBounds = outputPreviewFitBoundsFor(exactPlan);
    if (!exactFitBounds) throw new Error("missing exact-edge print fit bounds");
    const fittedViewport = fitOutputPreviewViewport(exactFitBounds, {
      width: viewportRect.width,
      height: viewportRect.height
    });
    const size = { width: viewportRect.width, height: viewportRect.height };
    const pageOrigins = (svg: Element) => [...svg.querySelectorAll<SVGRectElement>(
      '[data-output-preview-layer="page-fill"]'
    )].map((rect) => {
      const topLeft = outputPreviewScreenToWorld(
        { x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")) }, size, fittedViewport
      );
      return { x: Number(topLeft.x.toFixed(6)), y: Number((topLeft.y - 297).toFixed(6)) };
    });
    const guideWorldStarts = (svg: Element) => [...svg.querySelectorAll<SVGLineElement>(
      '[data-output-preview-layer="overlap-guide"]'
    )].map((line) => {
      const start = outputPreviewScreenToWorld(
        { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) }, size, fittedViewport
      );
      const end = outputPreviewScreenToWorld(
        { x: Number(line.getAttribute("x2")), y: Number(line.getAttribute("y2")) }, size, fittedViewport
      );
      const axis = Math.abs(start.x - end.x) < 1e-6 ? "vertical" as const : "horizontal" as const;
      return { axis, position: axis === "vertical" ? start.x : start.y };
    });

    expect(exactSvg.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(1);
    expect(exactSvg.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(1);
    expect(exactSvg.querySelectorAll('[data-output-preview-layer="overlap-guide"]')).toHaveLength(4);
    expect(pageOrigins(exactSvg)).toEqual([{ x: -10, y: -10 }]);
    const exactGuides = guideWorldStarts(exactSvg);
    expect(exactGuides.filter(({ axis }) => axis === "vertical").map(({ position }) => Number(position.toFixed(6))).sort((a, b) => a - b))
      .toEqual([0, 190]);
    expect(exactGuides.filter(({ axis }) => axis === "horizontal").map(({ position }) => Number(position.toFixed(6))).sort((a, b) => a - b))
      .toEqual([0, 277]);
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey)
      .toBe(`print:${exactCompiled.document.printOutputs[0]!.id}`));
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({ payload: exactPlan.rustPayload }));
  });

  it("promotes the live just-over A4 usable-width edge to a two-page canonical plan", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const justOverSource = printPageBoundarySource(190.001, -4.001);
    const { compiled, publication, plan } = await planForImportedTwoPlaceRoot(justOverSource, "print");
    expect(compiled.diagnostics).toEqual([]);
    expect(plan.print).toMatchObject({ columns: 1, rows: 1, pages: [{ origin: { x: -10, y: -10 } }] });
    const svg = await renderPublishedOutputPlan(justOverSource, publication, plan);
    const size = { width: viewportRect.width, height: viewportRect.height };
    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing boundary fixture placement handle");
    const fitBounds = outputPreviewFitBoundsFor(plan);
    if (!fitBounds) throw new Error("missing just-over print fit bounds");
    const dragViewport = fitOutputPreviewViewport(fitBounds, size);
    const pageOrigins = (preview: Element) => [...preview.querySelectorAll<SVGRectElement>(
      '[data-output-preview-layer="page-fill"]'
    )].map((rect) => {
      const topLeft = outputPreviewScreenToWorld(
        { x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")) }, size, dragViewport
      );
      return { x: Number(topLeft.x.toFixed(6)), y: Number((topLeft.y - 297).toFixed(6)) };
    });
    const origins = () => pageOrigins(svg);
    const guideXs = () => [...svg.querySelectorAll<SVGLineElement>(
      '[data-output-preview-layer="overlap-guide"]'
    )].filter((line) => Math.abs(Number(line.getAttribute("x1")) - Number(line.getAttribute("x2"))) < 1e-6)
      .map((line) => outputPreviewScreenToWorld(
        { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) }, size, dragViewport
      ).x);
    const displayedEndpointX = () => {
      const path = geometryPathData()[0];
      if (!path) throw new Error("missing displayed boundary line");
      return outputPreviewScreenToWorld(lineScreenPoints(path)[1], size, dragViewport).x;
    };
    const placeHandle = () => [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId) ?? handle;

    expect(svg.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-output-preview-layer="overlap-guide"]')).toHaveLength(4);
    expect(origins()).toEqual([{ x: -10, y: -10 }]);
    await act(async () => {
      fireEvent.pointerDown(placeHandle(), { button: 0, buttons: 1, pointerId: 1763, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(placeHandle(), {
        buttons: 1,
        pointerId: 1763,
        clientX: 100 + 4 * dragViewport.zoom,
        clientY: 100
      });
    });
    expect(displayedEndpointX()).toBeCloseTo(190, 7);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-output-preview-layer="overlap-guide"]')).toHaveLength(4);
    expect(origins()).toEqual([{ x: -10, y: -10 }]);

    await act(async () => {
      fireEvent.pointerMove(placeHandle(), {
        buttons: 1,
        pointerId: 1763,
        clientX: 100 + 4.001 * dragViewport.zoom,
        clientY: 100
      });
    });
    expect(displayedEndpointX()).toBeCloseTo(190.001, 7);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(2);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(2);
    expect(svg.querySelectorAll('[data-output-preview-layer="overlap-guide"]')).toHaveLength(8);
    expect(origins()).toEqual([{ x: -10, y: -10 }, { x: 180, y: -10 }]);
    expect(guideXs().filter((x) => Math.abs(x - 190) < 1e-6)).toHaveLength(2);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    await act(async () => {
      fireEvent.pointerUp(placeHandle(), {
        button: 0,
        buttons: 0,
        pointerId: 1763,
        clientX: 100 + 4.001 * dragViewport.zoom,
        clientY: 100
      });
    });
    const commit = placeCommitMessages().at(-1);
    if (!commit) throw new Error("missing accepted boundary placement commit");
    const committedSource = sourceAfterPlaceCommit(justOverSource, commit);
    expect(committedSource).not.toBe(justOverSource);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });
    const assignedIds = new Map([...(compiled.statementMap?.statementIdByStatementIndex ?? [])]);
    const { compiled: acceptedCompiled, publication: acceptedPublication } = await importedGraphPublication(
      committedSource, 2, 2, importedDependency, importedRootUri, assignedIds
    );
    if (!isLastGoodDslDocument(acceptedCompiled)) throw new Error("missing committed boundary graph compile");
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: acceptedCompiled,
      output: acceptedCompiled.document.printOutputs[0]!
    });
    expect(acceptedPlan.placements[0]?.at.x).toBeCloseTo(0, 7);
    expect(acceptedPlan.placements[0]?.at.y).toBeCloseTo(0, 7);
    expect(acceptedPlan.print).toMatchObject({
      columns: 2,
      rows: 1,
      pages: [{ origin: { x: -10, y: -10 } }, { origin: { x: 180, y: -10 } }]
    });
    expect(acceptedPlan.drawables[0]).toMatchObject({
      kind: "line",
      end: { x: expect.closeTo(190.001, 7), y: 20 }
    });
    expect(acceptedPlan.print?.pages[0]?.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 200)?.label)
      .toMatchObject({ text: "1" });
    expect(acceptedPlan.print?.pages[1]?.guides.find((guide) => guide.axis === "vertical" && guide.positionMm === 10)?.label)
      .toMatchObject({ text: "1" });
    sendGraphPublication({
      type: "multiDocumentGraphPublication",
      status: "building",
      graph: null,
      hostDocumentUri: importedRootUri,
      documentVersion: 2,
      outputPreview: { sequence: 2 }
    });
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    sendGraphPublication({ ...acceptedPublication, outputPreview: { ...acceptedPublication.outputPreview!, sequence: 3 } });
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    const acceptedRequest = outputPreviewPlanRequests()[1]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: acceptedRequest.requestId,
      graphAuthority: acceptedRequest.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(acceptedRequest.outputKey));
    expect(svg.querySelectorAll('[data-output-preview-layer="page-fill"]')).toHaveLength(2);
    expect(svg.querySelectorAll('[data-output-preview-layer="page-boundary"]')).toHaveLength(2);
    expect(svg.querySelectorAll('[data-output-preview-layer="overlap-guide"]')).toHaveLength(8);
    expect(origins()).toEqual([{ x: -10, y: -10 }, { x: 180, y: -10 }]);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
      outputKey: acceptedRequest.outputKey,
      payload: acceptedPlan.rustPayload
    }));
  });

  it.each(["invalid graph", "changed saved dependency", "root Source mismatch", "mismatched document version", "root URI mismatch"] as const)(
    "withdraws a speculative plane immediately for a graph-first %s",
    async (mismatch) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
      const { compiled } = await renderImportedPlan(importedTwoPlaceOutputRoot);
      const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
      const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
        .find((candidate) => candidate.dataset.placeId === firstPlaceId);
      if (!handle) throw new Error("missing first imported place handle");
      await act(async () => {
        fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1761, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1761, clientX: 120, clientY: 100 });
        fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1761, clientX: 120, clientY: 100 });
      });
      const projectedPaths = visibleGeometryPathData();
      expect(projectedPaths).toHaveLength(2);
      const committedSource = sourceAfterPlaceCommit(importedTwoPlaceOutputRoot, placeCommitMessages()[0]!);
      const { publication: matching } = await importedGraphPublication(committedSource, 2, 2);
      let future: VscodeMultiDocumentGraphPublication;
      if (mismatch === "invalid graph") {
        future = { ...matching, graph: { ...matching.graph, valid: false } };
      } else if (mismatch === "changed saved dependency") {
        future = (await importedGraphPublication(
          committedSource, 2, 2, importedDependency.replace("(3, 7)", "(4, 7)")
        )).publication;
      } else if (mismatch === "root Source mismatch") {
        future = (await importedGraphPublication(committedSource + "\n", 2, 2)).publication;
      } else if (mismatch === "mismatched document version") {
        future = (await importedGraphPublication(committedSource, 3, 2)).publication;
      } else {
        future = (await importedGraphPublication(
          committedSource, 2, 2, importedDependency, "file:///workspace/replacement.nui"
        )).publication;
      }

      sendGraphPublication(future);
      expect(visibleGeometryPathData()).toEqual([]);
      expect(outputPreviewPlanRequests()).toHaveLength(1);
      expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages()).toEqual([]);

      postWindowMessage({
        type: "commitText",
        sourceText: committedSource,
        documentVersion: 2,
        hostDocumentUri: importedRootUri,
        reason: "edit"
      });
      expect(visibleGeometryPathData()).not.toEqual(projectedPaths);
      if (mismatch === "changed saved dependency") {
        await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
      }
      postWindowMessage({
        type: "outputPreviewPlanResult",
        requestId: outputPreviewPlanRequests()[0]!.requestId,
        graphAuthority: outputPreviewPlanRequests()[0]!.graphAuthority,
        plan: planFor({ id: "stale", name: "stale", layoutId: "L", margin: 1 })
      });
      expect(visibleGeometryPathData()).not.toEqual(projectedPaths);
      expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages()).toEqual([]);
    }
  );

  it("restores the accepted plane when the guarded place commit is rejected and Host resyncs the same source", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const { compiled, publication, plan } = await planForImportedTwoPlaceRoot(importedTwoPlaceOutputRoot);
    render(<OutputPreviewApp api={api} />);
    sendImportedSource(importedTwoPlaceOutputRoot);
    sendGraphPublication(publication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
    const request = outputPreviewPlanRequests()[0]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: request.requestId,
      graphAuthority: request.graphAuthority,
      plan
    });
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
    const acceptedPaths = geometryPathData();
    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handle = [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    if (!handle) throw new Error("missing first imported place handle");
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1748, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1748, clientX: 120, clientY: 100 });
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 1748, clientX: 120, clientY: 100 });
    });
    expect(geometryPathData()[0]).not.toBe(acceptedPaths[0]);
    expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(true);

    sendImportedSource(importedTwoPlaceOutputRoot, 1, importedRootUri);
    await waitFor(() => expect(geometryPathData()).toEqual(acceptedPaths));
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(request.outputKey));
    expect(screen.queryByText("Evaluating…")).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)?.outputKey).toBe(request.outputKey);
  });

  it.each([
    ["en", "Geometry extends beyond the physical paper. Portions outside the paper may be omitted from PDF output."],
    ["ja", "図形が物理用紙からはみ出しています。用紙の外側にある部分はPDF出力から欠落する場合があります。"]
  ] as const)("tracks the localized print warning through drag, cancellation, pending commit, and canonical rejoin (%s)", async (language, warningText) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const warningSource = importedTwoPlacePrintOutputRoot.replace(
      "place G(at: (0, 0))",
      "place G(at: (-20, 0))"
    );
    const { compiled, publication, plan } = await planForImportedTwoPlaceRoot(warningSource, "print");
    expect(plan.print?.warning).toEqual({ kind: "physical-paper-overflow" });

    render(<OutputPreviewApp api={api} />);
    postWindowMessage({
      type: "webviewPresentation",
      presentation: {
        locale: language,
        strings: { "output.print.physicalPaperOverflowWarning": warningText },
        diagnosticTemplates: {}
      }
    });
    sendImportedSource(warningSource);
    sendGraphPublication(publication);
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(1));
    const request = outputPreviewPlanRequests()[0]!;
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: request.requestId,
      graphAuthority: request.graphAuthority,
      plan
    });
    const currentSurfaceDiagnostics = () => vi.mocked(api.postMessage).mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "surfaceDiagnosticsPublication" && message.surface === "outputPreview")
      .at(-1);
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({
      diagnostics: [expect.objectContaining({
        id: `physical-paper-overflow:${plan.outputId}:${plan.layoutId}`,
        severity: "warning",
        message: warningText
      })]
    }));
    expect(screen.queryByText(warningText)).toBeNull();

    const firstPlaceId = compiled.document.layouts[0]!.placements[0]!.id;
    const handleForFirstPlace = () => [...document.querySelectorAll<HTMLButtonElement>("button[data-place-id]")]
      .find((candidate) => candidate.dataset.placeId === firstPlaceId);
    const handle = handleForFirstPlace();
    if (!handle) throw new Error("missing negative-coordinate place handle");

    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 1749, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1749, clientX: 160, clientY: 100 });
    });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    expect(outputPreviewPlanRequests()).toHaveLength(1);
    fireEvent.pointerCancel(handleForFirstPlace() ?? handle, { pointerId: 1749 });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({
      diagnostics: [expect.objectContaining({ severity: "warning", message: warningText })]
    }));

    const currentHandle = handleForFirstPlace();
    if (!currentHandle) throw new Error("missing place handle after drag cancellation");
    await act(async () => {
      fireEvent.pointerDown(currentHandle, { button: 0, buttons: 1, pointerId: 1750, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(currentHandle, { buttons: 1, pointerId: 1750, clientX: 160, clientY: 100 });
    });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    await act(async () => {
      fireEvent.pointerUp(handleForFirstPlace() ?? currentHandle, {
        button: 0, buttons: 0, pointerId: 1750, clientX: 160, clientY: 100
      });
    });
    expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(true);
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    sendImportedSource(warningSource, 1, importedRootUri);
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({
      diagnostics: [expect.objectContaining({ severity: "warning", message: warningText })]
    }));
    expect(screen.queryByText(warningText)).toBeNull();
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(request.outputKey));
    postWindowMessage({ type: "outputPreviewExport" });
    const settledExport = outputExportRequestMessages().at(-1);
    expect(settledExport).toEqual(expect.objectContaining({
      outputKey: request.outputKey,
      format: "pdf",
      payload: expect.objectContaining({ kind: "print" })
    }));
    expect(settledExport?.payload).not.toHaveProperty("warning");

    const exportsBeforeAcceptedCorrection = outputExportRequestMessages().length;
    const correctionHandle = handleForFirstPlace();
    if (!correctionHandle) throw new Error("missing place handle after rejected correction rejoin");
    await act(async () => {
      fireEvent.pointerDown(correctionHandle, { button: 0, buttons: 1, pointerId: 1751, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(correctionHandle, { buttons: 1, pointerId: 1751, clientX: 160, clientY: 100 });
    });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    await act(async () => {
      fireEvent.pointerUp(handleForFirstPlace() ?? correctionHandle, {
        button: 0, buttons: 0, pointerId: 1751, clientX: 160, clientY: 100
      });
    });
    const acceptedCommit = placeCommitMessages().at(-1);
    if (!acceptedCommit) throw new Error("missing successful corrected-source place commit");
    const committedSource = sourceAfterPlaceCommit(warningSource, acceptedCommit);
    expect(committedSource).not.toBe(warningSource);
    expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toHaveLength(exportsBeforeAcceptedCorrection);
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));

    postWindowMessage({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: 2,
      hostDocumentUri: importedRootUri,
      reason: "edit"
    });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    const assignedIds = new Map([...(compiled.statementMap?.statementIdByStatementIndex ?? [])]);
    const { compiled: acceptedCompiled, publication: acceptedPublication } = await importedGraphPublication(
      committedSource, 2, 2, importedDependency, importedRootUri, assignedIds
    );
    if (!isLastGoodDslDocument(acceptedCompiled)) throw new Error("missing accepted corrected-source graph compile");
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    const acceptedPlan = await actual.evaluateOutputPlan({
      compiledDocument: acceptedCompiled,
      output: acceptedCompiled.document.printOutputs[0]!
    });
    expect(acceptedPlan.print?.warning).toBeNull();
    sendGraphPublication({
      type: "multiDocumentGraphPublication",
      status: "building",
      graph: null,
      hostDocumentUri: importedRootUri,
      documentVersion: 2,
      outputPreview: { sequence: 2 }
    });
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    sendGraphPublication({
      ...acceptedPublication,
      outputPreview: { ...acceptedPublication.outputPreview!, sequence: 3 }
    });
    await waitFor(() => expect(outputPreviewPlanRequests()).toHaveLength(2));
    const acceptedRequest = outputPreviewPlanRequests()[1]!;
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    postWindowMessage({
      type: "outputPreviewPlanResult",
      requestId: acceptedRequest.requestId,
      graphAuthority: acceptedRequest.graphAuthority,
      plan: acceptedPlan
    });
    await waitFor(() => expect(outputExportAvailabilityMessages().at(-1)?.outputKey).toBe(request.outputKey));
    await waitFor(() => expect(currentSurfaceDiagnostics()).toMatchObject({ diagnostics: [] }));
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
      outputKey: request.outputKey,
      format: "pdf",
      payload: acceptedPlan.rustPayload
    }));
    expect(outputExportRequestMessages()).toHaveLength(exportsBeforeAcceptedCorrection + 1);
  });

  it("renders and exports the populated plan evaluated from the exact Host compiler and Rust input", async () => {
    const { compiled, publication } = await importedGraphPublication(importedOutputRoot);
    expect(compiled.diagnostics).toEqual([]);
    const prepared = publication.canvasRuntime?.preparedRustEvaluation;
    if (!isLastGoodDslDocument(compiled) || !prepared) throw new Error("missing exact Host compile");
    const binary = inject("rustStdioParityBinaryPath" as never) as unknown as string;
    const rust = createRustStdioParityClient(process.cwd(), { prebuiltBinaryPath: binary });
    try {
      const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
      const plan = await actual.evaluateOutputPlan({
        compiledDocument: compiled,
        output: compiled.document.svgOutputs[0]!,
        evaluate: () => evaluatePreparedRust(prepared, rust.evaluateInput)
      });
      expect(plan.drawables).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "line", start: { x: 3, y: 7 }, end: { x: 13, y: 7 } }),
        expect.objectContaining({
          kind: "joinedPath",
          segments: [{ kind: "line", start: { x: 3, y: -7 }, end: { x: 13, y: -7 } }]
        })
      ]));
      expect(plan.rustPayload.drawables).toEqual(plan.drawables);
      render(<OutputPreviewApp api={api} />);
      sendImportedSource(importedOutputRoot);
      expect(screen.queryByRole("button", { name: "Insert Template…" })).toBeNull();
      sendGraphPublication(publication);
      await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "outputPreviewPlanRequest",
        graphAuthority: {
          hostDocumentUri: importedRootUri, documentVersion: 1, graphRevision: 1, rootSourceRevision: 1
        }
      })));
      const request = vi.mocked(api.postMessage).mock.calls.map(([message]) => message)
        .find(message => message.type === "outputPreviewPlanRequest")!;
      postWindowMessage({ type: "outputPreviewPlanResult", requestId: request.requestId, graphAuthority: request.graphAuthority, plan });
      expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
      const initialRenderedPaths = [...document.querySelectorAll('path[data-output-preview-layer="geometry"]')].map(path => path.getAttribute("d"));
      expect(initialRenderedPaths).toHaveLength(3);
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages()).toEqual([expect.objectContaining({
        graphAuthority: request.graphAuthority, payload: plan.rustPayload
      })]);

      const updated = await importedGraphPublication(
        importedOutputRoot,
        1,
        2,
        importedDependency.replaceAll(", 7)", ", 9)")
      );
      const updatedCompiled = updated.compiled;
      if (!isLastGoodDslDocument(updatedCompiled) || !updated.publication.canvasRuntime?.preparedRustEvaluation) {
        throw new Error("missing updated imported graph compile");
      }
      const updatedPlan = await actual.evaluateOutputPlan({
        compiledDocument: updatedCompiled,
        output: updatedCompiled.document.svgOutputs[0]!,
        evaluate: () => evaluatePreparedRust(updated.publication.canvasRuntime!.preparedRustEvaluation, rust.evaluateInput)
      });
      expect(updatedPlan.drawables).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "line", start: { x: 3, y: 9 }, end: { x: 13, y: 9 } }),
        expect.objectContaining({
          kind: "joinedPath",
          segments: [{ kind: "line", start: { x: 3, y: -9 }, end: { x: 13, y: -9 } }]
        })
      ]));
      sendGraphPublication(updated.publication);
      await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "outputPreviewPlanRequest",
        graphAuthority: expect.objectContaining({ graphRevision: 2, documentVersion: 1 })
      })));
      const updatedRequest = vi.mocked(api.postMessage).mock.calls.map(([message]) => message)
        .filter(message => message.type === "outputPreviewPlanRequest").at(-1)!;
      postWindowMessage({
        type: "outputPreviewPlanResult",
        requestId: updatedRequest.requestId,
        graphAuthority: updatedRequest.graphAuthority,
        plan: updatedPlan
      });
      await waitFor(() => expect([...document.querySelectorAll('path[data-output-preview-layer="geometry"]')].map(path => path.getAttribute("d")))
        .not.toEqual(initialRenderedPaths));
      postWindowMessage({ type: "outputPreviewExport" });
      expect(outputExportRequestMessages().at(-1)).toEqual(expect.objectContaining({
        graphAuthority: updatedRequest.graphAuthority,
        payload: updatedPlan.rustPayload
      }));
    } finally {
      rust.dispose();
    }
  }, 30_000);

  it("selects an imported mirrorCopy owner by its caller instance layer identity", async () => {
    const dependency = [
      "nui 1",
      "export module Pattern() {",
      "  layer seam",
      "  point AxisA = coordinate(x: 0, y: 0)",
      "  point AxisB = coordinate(x: 10, y: 0)",
      "  point Start = coordinate(x: 0, y: 3)",
      "  point End = coordinate(x: 10, y: 3)",
      "  export line Base in seam = segment(start: Start, end: End)",
      "  export line Preview = mirrorCopy(axis1: AxisA, axis2: AxisB, baseLines: [Base])",
      "}"
    ].join("\n");
    const root = [
      "nui 1",
      "layer seam",
      'import "./dart_seam.nui" as dart_seam',
      "group Placed {",
      "  instance One in seam = dart_seam::Pattern()",
      "}",
      "layout L {",
      "  place Placed(at: (0, 0))",
      "}",
      "svg Caller(layout: L, layers: [seam], margin: 0)",
      "svg Default(layout: L, layers: [default], margin: 0)"
    ].join("\n");
    const { compiled, publication } = await importedGraphPublication(root, 1, 1, dependency);
    expect(compiled.diagnostics).toEqual([]);
    if (!isLastGoodDslDocument(compiled) || !publication.canvasRuntime?.preparedRustEvaluation) {
      throw new Error("missing imported Module compile or prepared Rust evaluation");
    }
    const binary = inject("rustStdioParityBinaryPath" as never) as unknown as string;
    const rust = createRustStdioParityClient(process.cwd(), { prebuiltBinaryPath: binary });
    try {
      const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
      const evaluate = () => evaluatePreparedRust(publication.canvasRuntime!.preparedRustEvaluation, rust.evaluateInput);
      const caller = await actual.evaluateOutputPlan({
        compiledDocument: compiled,
        output: compiled.document.svgOutputs[0]!,
        evaluate
      });
      const defaultLayer = await actual.evaluateOutputPlan({
        compiledDocument: compiled,
        output: compiled.document.svgOutputs[1]!,
        evaluate
      });
      expect(caller.drawables.map(drawable => drawable.name)).toEqual([expect.stringMatching(/Preview/)]);
      expect(caller.drawables[0]).toMatchObject({
        kind: "joinedPath",
        segments: [{ kind: "line", start: { x: 0, y: -3 }, end: { x: 10, y: -3 } }]
      });
      expect(defaultLayer.drawables).toEqual([]);
    } finally {
      rust.dispose();
    }
  });

  it.each([
    ["A", importedRoot, "source-reference-invalid-traversal"],
    ["B", importedRoot.replace("[dart_center::center]", "[local_base]"), "module-unresolved-callee"]
  ] as const)("uses the current saved Module graph in case %s", async (_case, rootSource, baseDiagnostic) => {
    const { compiled, publication } = await importedGraphPublication(rootSource);
    expect(publication.graph.valid).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
    expect(publication.canvasRuntime?.preparedRustEvaluation.rustEligible).toBe(true);
    expect(compileFreshCanonicalText(rootSource).diagnostics[0]?.code).toBe(baseDiagnostic);
    render(<OutputPreviewApp api={api} />);
    postWindowMessage({
      type: "webviewPresentation",
      presentation: {
        locale: "ja",
        strings: {
          "output.noOutputs": "印刷またはSVGの出力がありません",
          "output.insertTemplate": "テンプレートを挿入…"
        },
        diagnosticTemplates: {}
      }
    });
    sendImportedSource(rootSource);
    sendGraphPublication(publication);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("印刷またはSVGの出力がありません")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "テンプレートを挿入…" }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewInsertTemplate",
      documentVersion: 1,
      graphAuthority: { hostDocumentUri: importedRootUri, documentVersion: 1, graphRevision: 1, rootSourceRevision: 1 }
    });
  });

  it("opens the saved Module dependency by itself through standalone Output Preview", () => {
    render(<OutputPreviewApp api={api} />);
    sendImportedSource(importedDependency, 1, "file:///workspace/dart_seam.nui");
    expect(screen.getByText("No print or SVG outputs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insert Template…" }));
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewInsertTemplate", documentVersion: 1 });
  });

  it("clears the old standalone plan when an import edit's graph message precedes its Source", async () => {
    render(<OutputPreviewApp api={api} />);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    sendImportedSource(source);
    expect(await screen.findByLabelText("Output preview")).toBeInTheDocument();
    sendGraphPublication({
      type: "multiDocumentGraphPublication", status: "building", graph: null,
      hostDocumentUri: importedRootUri, documentVersion: 2, outputPreview: { sequence: 1 }
    });
    expect(screen.queryByLabelText("Output preview")).toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
    sendImportedSource(importedRoot, 2);
    const { publication } = await importedGraphPublication(importedRoot, 2, 2);
    sendGraphPublication(publication);
    expect(screen.getByRole("button", { name: "Insert Template…" })).toBeInTheDocument();
  });

  it("invalidates a pending plan through dependency builds and only accepts matching newer authorities", async () => {
    const [{ publication: initial }, { publication: invalid }, { publication: updated }, { publication: obsolete },
      { publication: undo },
      { publication: redo }, { publication: other }] = await Promise.all([
      importedGraphPublication(importedOutputRoot),
      importedGraphPublication(importedOutputRoot, 1, 4, "nui 1\nexport module DartCenter( {"),
      importedGraphPublication(importedOutputRoot, 1, 5, importedDependency.replaceAll(", 7)", ", 9)")),
      importedGraphPublication(importedOutputRoot, 1, 10),
      importedGraphPublication(importedRoot, 2, 6),
      importedGraphPublication(importedOutputRoot, 3, 7),
      importedGraphPublication(importedRoot, 1, 8, importedDependency, "file:///workspace/other.nui")
    ]);
    const currentPlanRequests = () => vi.mocked(api.postMessage).mock.calls.map(([message]) => message)
      .filter(message => message.type === "outputPreviewPlanRequest");
    const commit = (sourceText: string, documentVersion: number, reason: "undo" | "redo") => postWindowMessage({
      type: "commitText", sourceText, documentVersion, hostDocumentUri: importedRootUri, reason
    });
    render(<OutputPreviewApp api={api} />);
    sendGraphPublication(initial);
    sendImportedSource(importedOutputRoot);
    await waitFor(() => expect(currentPlanRequests()).toHaveLength(1));
    const first = currentPlanRequests()[0]!;
    const building = {
      type: "multiDocumentGraphPublication", status: "building", graph: null,
      hostDocumentUri: importedRootUri, documentVersion: 1, outputPreview: { sequence: 3 }
    } as const;
    sendGraphPublication(building);
    postWindowMessage({ ...first, type: "outputPreviewPlanResult", plan: planFor({ id: "stale", name: "stale", layoutId: "L", margin: 1 }) });
    expect(screen.queryByLabelText("Output preview")).toBeNull();
    expect(screen.getByRole("combobox")).toBeDisabled();

    sendGraphPublication(invalid);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    sendGraphPublication({ ...initial, outputPreview: { ...initial.outputPreview, sequence: 99 } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    sendGraphPublication(updated);
    await waitFor(() => expect(currentPlanRequests()).toHaveLength(2));
    sendGraphPublication(building);
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();

    sendGraphPublication({ ...updated, graph: { ...updated.graph, revision: 60, rootDocumentId: "file:///wrong.nui" },
      outputPreview: { ...updated.outputPreview, sequence: 99 } });
    sendGraphPublication({ ...updated, hostDocumentUri: "file:///wrong.nui", outputPreview: { ...updated.outputPreview, sequence: 99 } });
    expect(screen.getByRole("combobox")).toBeEnabled();

    sendGraphPublication({ ...building, documentVersion: 2, outputPreview: { sequence: 6 } });
    sendGraphPublication({ ...obsolete, outputPreview: { ...obsolete.outputPreview, sequence: 98 } });
    expect(screen.getByRole("combobox")).toBeDisabled();
    commit(importedRoot, 2, "undo");
    sendGraphPublication({ ...updated, outputPreview: { ...updated.outputPreview, sequence: 99 } });
    expect(screen.queryByRole("button", { name: "Insert Template…" })).toBeNull();
    sendGraphPublication({ ...undo, outputPreview: { ...undo.outputPreview, sequence: 7 } });
    expect(screen.getByRole("button", { name: "Insert Template…" })).toBeInTheDocument();
    sendGraphPublication({ ...redo, outputPreview: { ...redo.outputPreview, sequence: 8 } });
    commit(importedOutputRoot, 3, "redo");
    await waitFor(() => expect(currentPlanRequests()).toHaveLength(3));
    sendImportedSource(importedRoot, 1, "file:///workspace/other.nui");
    sendGraphPublication({ ...other, outputPreview: { ...other.outputPreview, sequence: 9 } });
    expect(screen.getByRole("button", { name: "Insert Template…" })).toBeInTheDocument();
  });

  it.each(["dependency fingerprint", "source map revision", "runtime identity"] as const)(
    "rejects a current-looking publication whose %s disagrees",
    async (mismatch) => {
      const { publication } = await importedGraphPublication(importedRoot);
      const broken = structuredClone(publication);
      if (mismatch === "dependency fingerprint") {
        const fingerprint = broken.graph.dependencyFingerprints[0]!;
        broken.graph.dependencyFingerprints = [{ ...fingerprint, savedSourceFingerprint: "other-saved-source" }];
      } else if (mismatch === "source map revision") {
        broken.outputPreview.sourceEditing!.statementMap.sourceRevision += 1;
      } else {
        const input = broken.canvasRuntime!.preparedRustEvaluation.input;
        input.elements = input.elements.map((element, index) => index === 0 ? { ...element, id: "wrong-runtime-id" } : element);
      }
      render(<OutputPreviewApp api={api} />);
      sendImportedSource(importedRoot);
      sendGraphPublication(broken);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Insert Template…" })).toBeNull();
      sendGraphPublication((await importedGraphPublication(importedRoot, 1, 2)).publication);
      expect(screen.getByRole("button", { name: "Insert Template…" })).toBeInTheDocument();
    }
  );

  it("renders host-published Japanese empty-state presentation", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={api} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "webviewPresentation",
          presentation: {
            locale: "ja",
            strings: {
              "output.selector.label": "出力",
              "output.selector.noOutputs": "出力なし",
              "output.noOutputs": "印刷またはSVGの出力がありません",
              "output.addDeclaration": "Source Editorにprintまたはsvg宣言を追加してください。",
              "output.insertTemplate": "テンプレートを挿入…"
            },
            diagnosticTemplates: {}
          }
        }
      }));
    });

    expect(screen.getByRole("combobox", { name: "出力" })).toBeInTheDocument();
    expect(screen.getByText("印刷またはSVGの出力がありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "テンプレートを挿入…" })).toBeInTheDocument();
  });

  it("posts the authoritative document version when the no-output template affordance is activated", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: "nui 1", documentVersion: 17 }
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Insert Template…" }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewInsertTemplate",
      documentVersion: 17
    });
  });

  it("does not show the no-output template affordance when output candidates exist", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    renderFixture();

    expect(screen.queryByRole("button", { name: "Insert Template…" })).toBeNull();
  });

  it("keeps the selected print output independent of Canvas layer visibility toggles", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.getState().resetCanvasLayerVisibility();
    useCadDocumentStore.getState().commitText(source, "test");
    const layer = {
      id: "source-layer:[\"test-document\",\"statement:seams\"]",
      identity: "statement:seams",
      documentId: "test-document",
      name: "seams",
      label: "seams",
      ownerPath: [],
      isDefault: false
    };
    render(
      <>
        <OutputPreviewApp api={api} />
        <CanvasLayerPanel
          layers={[layer]}
          hiddenLayerIds={useCadUiStore.getState().hiddenCanvasLayerIds}
          onToggle={useCadUiStore.getState().toggleCanvasLayerVisibility}
        />
      </>
    );

    const outputSelector = screen.getByRole("combobox", { name: "Output" });
    const printOutputKey = outputKeyFor("print", "A");
    fireEvent.change(outputSelector, { target: { value: printOutputKey } });
    expect(outputSelector).toHaveValue(printOutputKey);

    fireEvent.click(screen.getByRole("checkbox", { name: "Show layer seams" }));
    expect(outputSelector).toHaveValue(printOutputKey);
  });

  it.each([
    ["ja", "現在のSourceから有効な出力プランを作成できません。"],
    ["en", "The current source cannot produce a valid output plan."]
  ] as const)("renders the host-localized no-valid-plan fallback (%s)", (language, message) => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText(source, "test");
    useCadDocumentStore.setState((state) => ({
      sourceText: `${state.sourceText}\n// pending source`,
      diagnostics: [],
      bindingIssueDiagnostics: []
    }));
    render(<OutputPreviewApp api={api} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "webviewPresentation",
          presentation: {
            locale: language,
            strings: {
              "output.unavailable": language === "ja" ? "出力プレビューを利用できません" : "Output Preview unavailable",
              "output.noValidPlan": message
            },
            diagnosticTemplates: {}
          }
        }
      }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it.each([
    ["ja", "出力対象がありません"],
    ["en", "There are no output targets."]
  ] as const)("renders the host-localized empty-selection status (%s)", async (language, message) => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => emptyPlanFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 41 });
    postWindowMessage({
      type: "webviewPresentation",
      presentation: { locale: language, strings: { "output.emptySelection": message }, diagnosticTemplates: {} }
    });

    const emptyStatus = await screen.findByText(message);
    expect(emptyStatus.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("No print or SVG outputs")).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert Template…" })).toBeNull();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useCadDocumentStore.setState(initialCadDocumentState());
    vi.mocked(api.postMessage).mockReset();
    mocks.evaluateOutputPlan.mockReset();
    vi.restoreAllMocks();
  });

  it("shows one explicit zoom percentage and tracks Y-up pointer coordinates in the adjacent X/Y status", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    renderFixture("nui 1");

    const zoom = screen.getByRole("status", { name: "Output Preview zoom: 100%" });
    const status = screen.getByRole("status", { name: "Output Preview status: X: —, Y: —" });
    expect(zoom).toBeVisible();
    expect(status).not.toHaveTextContent("%");
    expect(screen.getAllByText("100%", { exact: true })).toHaveLength(1);
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

    fireEvent.pointerMove(viewport, { clientX: 250, clientY: 150 });
    expect(status).toHaveTextContent("X-150.0Y150.0");
    expect(status).not.toHaveTextContent("%");

    fireEvent.pointerMove(viewport, { clientX: 270, clientY: 130 });
    expect(status).toHaveTextContent("X-130.0Y170.0");

    fireEvent.pointerLeave(viewport);
    expect(status).toHaveTextContent("X—Y—");
  });

  it("pans with Space-primary drag and keeps ordinary primary drag unchanged", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

    const beforeOrdinary = Number(pageFill().getAttribute("x"));
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 0, buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeOrdinary);

    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 2, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 0, buttons: 0, pointerId: 2, clientX: 120, clientY: 100 });
    fireEvent.keyUp(viewport, { key: " " });

    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeOrdinary + 20);
  });

  it("lets a Space-primary press on a place handle pan the viewport without starting place drag", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => {
      const plan = planFor(output);
      const layout = useCadDocumentStore.getState().layouts.find((candidate) => candidate.id === output.layoutId);
      const placement = layout?.placements[0];
      if (!placement) return plan;
      return {
        ...plan,
        placements: [{
          id: placement.id,
          groupId: placement.groupId,
          origin: { x: 0, y: 0 },
          at: { x: 0, y: 0 },
          scale: 1,
          angleDeg: 0,
          mirror: false,
          drawables: []
        }]
      };
    });
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");
    const handle = screen.getByRole("button", { name: "Place G" });
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

    const before = Number(pageFill().getAttribute("x"));
    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 16, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 16, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 16, clientX: 120, clientY: 100 });
    fireEvent.keyUp(viewport, { key: " " });

    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20);
    expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(false);
  });

  it("keeps Space ownership across the native handle focus boundary", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ compiledDocument, output }: { compiledDocument: LastGoodDslDocument; output: TestOutput }) => {
      const base = planFor(output);
      const template = base.drawables[0];
      const layout = compiledDocument.document.layouts.find((candidate) => candidate.id === output.layoutId);
      if (!template || !layout) throw new Error("missing place preview plan fixture");
      const placements = layout.placements.map((placement) => {
        const at = placement.at as { x: number; y: number };
        return {
          id: placement.id,
          groupId: placement.groupId,
          origin: { x: 0, y: 0 },
          at,
          scale: 1,
          angleDeg: 0,
          mirror: false,
          drawables: [{ ...template, start: { ...at }, end: { x: at.x + 10, y: at.y } }]
        };
      });
      const drawables = placements.flatMap((placement) => placement.drawables);
      return { ...base, placements, drawables, rustPayload: { ...base.rustPayload, drawables } };
    });
    const container = document.createElement("div");
    document.body.append(container);
    const blockReactPointerBoundary = (event: Event) => event.stopImmediatePropagation();
    const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"];
    pointerEvents.forEach((eventName) => container.addEventListener(eventName, blockReactPointerBoundary));

    try {
      useCadDocumentStore.getState().commitText(source, "test");
      render(<OutputPreviewApp api={api} />, { container });
      postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 1 });
      await waitFor(() => expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("width"))).toBeGreaterThan(400));
      const viewport = container.querySelector(".output-preview-viewport");
      const handle = within(container).getByRole("button", { name: "Place G" });
      if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

      const before = Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"));
      viewport.focus();
      fireEvent.keyDown(viewport, { key: " ", code: "Space" });
      handle.addEventListener("pointerdown", () => handle.focus(), { once: true });
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 61, clientX: 100, clientY: 100 });
      await act(async () => { await Promise.resolve(); });
      expect(document.activeElement).toBe(handle);

      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 61, clientX: 120, clientY: 100 });
      await act(async () => { await Promise.resolve(); });
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 61, clientX: 120, clientY: 100 });
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(handle);

      expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"))).toBeCloseTo(before + 20);
      expect(handle).toHaveAttribute("data-dragging", "false");
      expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(false);

      fireEvent.keyUp(window, { key: " ", code: "Space" });
      handle.focus();
      fireEvent.keyDown(handle, { key: " ", code: "Space" });
      expect(document.activeElement).toBe(handle);
      fireEvent.keyUp(handle, { key: " ", code: "Space" });

      pointerEvents.forEach((eventName) => container.removeEventListener(eventName, blockReactPointerBoundary));
      fireEvent.pointerDown(handle, { button: 0, buttons: 1, pointerId: 62, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 62, clientX: 120, clientY: 100 });
      await act(async () => { await Promise.resolve(); });
      fireEvent.pointerUp(handle, { button: 0, buttons: 0, pointerId: 62, clientX: 120, clientY: 100 });
      await act(async () => { await Promise.resolve(); });
      expect(handle).toHaveAttribute("data-dragging", "false");
      expect(vi.mocked(api.postMessage).mock.calls.some(([message]) => message.type === "outputPreviewPlaceCommit")).toBe(true);
    } finally {
      pointerEvents.forEach((eventName) => container.removeEventListener(eventName, blockReactPointerBoundary));
      cleanup();
      container.remove();
    }
  });

  it("terminates Space-primary pan on release, cancel, lost capture, and viewport blur", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");

    const beforeRelease = Number(pageFill().getAttribute("x"));
    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 11, clientX: 100, clientY: 100 });
    fireEvent.keyUp(viewport, { key: " " });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 11, clientX: 120, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeRelease);

    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 12, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 12, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeRelease + 10));
    fireEvent.pointerCancel(viewport, { pointerId: 12, clientX: 110, clientY: 100 });
    const afterCancel = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 12, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterCancel);
    fireEvent.keyUp(viewport, { key: " " });

    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 13, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 13, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterCancel + 10));
    fireEvent.lostPointerCapture(viewport, { pointerId: 13, clientX: 110, clientY: 100 });
    const afterLostCapture = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 13, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterLostCapture);
    fireEvent.keyUp(viewport, { key: " " });

    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.blur(viewport);
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 14, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 14, clientX: 120, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterLostCapture);

    viewport.focus();
    fireEvent.keyDown(viewport, { key: " " });
    fireEvent.pointerDown(viewport, { button: 0, buttons: 1, pointerId: 15, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 1, pointerId: 15, clientX: 120, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterLostCapture + 20));
    fireEvent.pointerUp(viewport, { button: 0, buttons: 0, pointerId: 15, clientX: 120, clientY: 100 });
    fireEvent.keyUp(viewport, { key: " " });
  });

  it("keeps the compact zoom percentage synchronized with center-anchored button zoom", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    renderFixture("nui 1");

    const zoom = screen.getByRole("status", { name: "Output Preview zoom: 100%" });
    expect(zoom).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("status", { name: "Output Preview zoom: 110%" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByRole("status", { name: "Output Preview zoom: 100%" })).toBeInTheDocument();
  });

  it("updates the stored pointer anchor for wheel zoom and recomputes status after reset", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    renderFixture("nui 1");
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(status).toHaveTextContent("X-150.0Y150.0");
    expect(screen.getByRole("status", { name: "Output Preview zoom: 110%" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewResetView" } }));
    });
    expect(status).toHaveTextContent("X-150.0Y150.0");
    expect(screen.getByRole("status", { name: "Output Preview zoom: 100%" })).toBeInTheDocument();
  });

  it("recomputes a stationary pointer after viewport pan and viewport-size changes", () => {
    let currentRect = {
      ...viewportRect,
      left: 100,
      top: 50,
      right: 900,
      bottom: 650
    } as DOMRect;
    let resize: (() => void) | null = null;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this as unknown as ResizeObserver);
      }

      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => currentRect);
    renderFixture("nui 1");
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });

    fireEvent.pointerMove(viewport, { clientX: 350, clientY: 250 });
    expect(status).toHaveTextContent("X-150.0Y100.0");

    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 350, clientY: 250 });
    fireEvent.pointerMove(viewport, { button: 1, buttons: 4, pointerId: 1, clientX: 370, clientY: 230 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 370, clientY: 230 });
    expect(status).toHaveTextContent("X-150.0Y100.0");

    currentRect = {
      ...viewportRect,
      left: 150,
      top: 100,
      right: 1150,
      bottom: 900,
      width: 1000,
      height: 800
    } as DOMRect;
    act(() => resize?.());
    expect(status).toHaveTextContent("X-300.0Y250.0");
  });

  it("keeps Reset available without a plan while Fit remains plan-dependent", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const iconResolver = vi.spyOn(vscodeCanvasRibbonIcons, "resolveVscodeLucideIcon");
    renderFixture("nui 1");

    const reset = screen.getByRole("button", { name: "Reset Output Preview Pan and Zoom" });
    const fit = screen.getByRole("button", { name: "Fit Output Preview" });
    expect(iconResolver).toHaveBeenCalledWith("rotate-ccw");
    expect(iconResolver).toHaveBeenCalledWith("maximize");
    expect(reset).not.toBeDisabled();
    expect(fit).toBeDisabled();

    fireEvent.click(reset);
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewResetView" });
  });

  it("resets the viewport without changing the selected output or triggering Fit", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: svgKey } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument());
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(screen.getByRole("combobox")).toHaveValue(svgKey);

    fireEvent.click(screen.getByRole("button", { name: "Reset Output Preview Pan and Zoom" }));
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewResetView" } }));
    });

    expect(screen.getByRole("combobox")).toHaveValue(svgKey);
    expect(screen.getByRole("button", { name: "Fit Output Preview" })).not.toBeDisabled();
    expect(screen.getByRole("status", { name: "Output Preview zoom: 100%" })).toBeInTheDocument();
    expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBe(20);
  });

  it("opens with an explicit empty state when there are no current outputs", () => {
    useCadDocumentStore.setState(initialCadDocumentState());

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByText("No print or SVG outputs")).toBeInTheDocument();
    expect(api.postMessage).toHaveBeenCalledWith({ type: "webviewReady" });
  });

  it("shows current-source errors and publishes actual Output Preview unavailability", async () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText("nui 1\npoint A = coordinate(", "test");

    render(<OutputPreviewApp api={api} />);
    sendImportedSource("nui 1\npoint A = coordinate(", 1);

    expect(screen.getByRole("alert")).toHaveTextContent("Output Preview unavailable");
    expect(screen.getByRole("button", { name: "Go to Source" })).toBeInTheDocument();
    await waitFor(() => {
      const publication = vi.mocked(api.postMessage).mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "surfaceDiagnosticsPublication" && message.surface === "outputPreview")
        .at(-1);
      expect(publication).toMatchObject({
        diagnostics: [expect.objectContaining({ severity: "error", id: "output-preview-unavailable" })]
      });
    });
  });

  it.each([
    ["print", "A", "Export PDF"],
    ["svg", "B", "Export SVG"]
  ] as const)("keeps a valid empty %s output informational and non-exportable", async (kind, name, exportLabel) => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => emptyPlanFor(output));
    renderFixture();
    const outputKey = outputKeyFor(kind, name);
    if (kind === "svg") fireEvent.change(screen.getByRole("combobox"), { target: { value: outputKey } });
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 42 });

    expect(await screen.findByText("There are no output targets.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: exportLabel })).toBeNull();
    await waitFor(() => {
      expect(outputExportAvailabilityMessages().at(-1)).toEqual(expect.objectContaining({
        outputKey: null,
        format: null
      }));
    });

    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
  });

  it("withdraws export for an empty plan and restores it when the current source becomes populated", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) =>
      useCadDocumentStore.getState().sourceText.includes("// empty selection") ? emptyPlanFor(output) : planFor(output)
    );
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 43 });
    await screen.findByRole("button", { name: "Export PDF" });

    act(() => useCadDocumentStore.getState().commitText(`${source}\n// empty selection`, "test"));
    expect(await screen.findByText("There are no output targets.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
    await waitFor(() => {
      expect(outputExportAvailabilityMessages().at(-1)).toEqual(expect.objectContaining({ outputKey: null, format: null }));
    });
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await screen.findByRole("button", { name: "Export PDF" });
    expect(screen.queryByText("There are no output targets.")).toBeNull();
  });

  it("switches between populated SVG and empty print plans without stale status or export actions", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) =>
      output.name === "A" ? emptyPlanFor(output) : planFor(output)
    );
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 44 });
    expect(await screen.findByText("There are no output targets.")).toBeInTheDocument();

    const selector = screen.getByRole("combobox");
    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(selector, { target: { value: svgKey } });
    expect(screen.queryByText("There are no output targets.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
    await screen.findByRole("button", { name: "Export SVG" });
    await waitFor(() => {
      expect(outputExportAvailabilityMessages().at(-1)).toEqual(expect.objectContaining({ outputKey: svgKey, format: "svg" }));
    });

    const printKey = outputKeyFor("print", "A");
    fireEvent.change(selector, { target: { value: printKey } });
    expect(screen.queryByRole("button", { name: "Export SVG" })).toBeNull();
    expect(screen.queryByText("There are no output targets.")).toBeNull();
    expect(await screen.findByText("There are no output targets.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
    await waitFor(() => {
      expect(outputExportAvailabilityMessages().at(-1)).toEqual(expect.objectContaining({ outputKey: null, format: null }));
    });
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
  });

  it("keeps an evaluation failure in the error state instead of showing the empty-selection status", async () => {
    mocks.evaluateOutputPlan.mockRejectedValue(new Error("output evaluation failed"));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 45 });

    expect(await screen.findByRole("alert")).toHaveTextContent("output evaluation failed");
    expect(screen.queryByText("There are no output targets.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
    postWindowMessage({ type: "outputPreviewExport" });
    expect(outputExportRequestMessages()).toEqual([]);
  });

  it("offers fatal-source diagnostic navigation when the physical span is safe", async () => {
    const brokenSource = "nui 1\npoint A = coordinate(";
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText(brokenSource, "test");
    render(<OutputPreviewApp api={api} />);
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: brokenSource, documentVersion: 1 }
      }));
    });

    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) })
    }));
  });

  it("navigates from the real invalid-overlap compiler diagnostic to the overlap value", async () => {
    mocks.evaluateOutputPlan.mockRejectedValue(new Error("not relevant to this diagnostic"));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: invalidOverlapSource, documentVersion: 1 }
      }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("A4 portrait では overlap を 105mm 未満にしてください。");
    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    const from = invalidOverlapSource.indexOf("200");
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: { from, to: from + "200".length }
    });
  });

  it("uses the selector as the output label and exposes crosshair and maximize ribbon actions", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    expect(document.querySelector(".output-preview-title-button")).toBeNull();
    const selector = screen.getByRole("combobox");
    expect((selector as HTMLSelectElement).selectedOptions[0]).toHaveTextContent("Print · A");
    const sourceNavigation = screen.getByRole("button", { name: "Go to Source" });
    const maximize = screen.getByRole("button", { name: "Fit Output Preview" });
    expect(sourceNavigation).toBeInTheDocument();
    expect(maximize).toBeInTheDocument();
    const outputGroup = document.querySelector(".output-preview-output-group");
    if (!outputGroup) throw new Error("missing output preview output group");
    expect(outputGroup).toContainElement(selector);
    expect(outputGroup).toContainElement(sourceNavigation);
    expect(outputGroup).not.toContainElement(maximize);
    expect(sourceNavigation.closest(".command-ribbon")).toHaveAttribute("data-ribbon-id", "output-preview-ribbon");
    expect(maximize.closest(".command-ribbon")).toHaveAttribute("data-ribbon-id", "output-preview-fit-ribbon");
    expect(sourceNavigation.closest(".command-ribbon")).not.toBe(maximize.closest(".command-ribbon"));
    expect(sourceNavigation).not.toHaveAttribute("title");
    expect(document.getElementById(sourceNavigation.getAttribute("aria-describedby")!)?.textContent).toBe("Go to Source");
    expect(maximize).not.toHaveAttribute("title");
    expect(document.getElementById(maximize.getAttribute("aria-describedby")!)?.textContent).toBe("Fit Output Preview");

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    fireEvent.click(sourceNavigation);
    const printStart = source.indexOf("print A(");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: expect.objectContaining({ from: printStart, to: expect.any(Number) })
    }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Fit Output Preview" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Fit Output Preview" }));
    expect(api.postMessage).toHaveBeenCalledWith({ type: "outputPreviewFit" });
  });

  it("exports the exact current print plan once and re-enables after the host result", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const exportButton = await screen.findByRole("button", { name: "Export PDF" });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportAvailability",
      documentVersion: 7,
      outputKey: outputKeyFor("print", "A"),
      format: "pdf"
    })));
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "webviewReady")).toHaveLength(1);

    fireEvent.click(exportButton);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportRequest",
      requestId: 1,
      documentVersion: 7,
      outputKey: outputKeyFor("print", "A"),
      outputName: "A",
      format: "pdf",
      payload: expect.objectContaining({ kind: "print" })
    }));
    expect(exportButton).toBeDisabled();
    fireEvent.click(exportButton);
    expect(vi.mocked(api.postMessage).mock.calls.filter(([message]) => message.type === "outputPreviewExportRequest")).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "outputPreviewExportResult", requestId: 1, status: "saved" }
      }));
    });
    await waitFor(() => expect(exportButton).not.toBeDisabled());
  });

  it("uses the same current export request for Palette dispatch and switches to SVG", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 3 }
      }));
    });
    const svgKey = outputKeyFor("svg", "B");
    const selector = await screen.findByRole("combobox");
    let exportButtonObserved: HTMLButtonElement | null = null;
    const exportButtonObservedPromise = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const button = screen.queryByRole("button", { name: "Export SVG" });
        if (!(button instanceof HTMLButtonElement)) return;
        exportButtonObserved = button;
        observer.disconnect();
        act(() => {
          window.dispatchEvent(new MessageEvent("message", { data: { type: "outputPreviewExport" } }));
        });
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    fireEvent.change(selector, { target: { value: svgKey } });
    await exportButtonObservedPromise;

    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportRequest",
      documentVersion: 3,
      outputKey: svgKey,
      outputName: "B",
      format: "svg",
      payload: expect.objectContaining({ kind: "svg" })
    }));
    expect(exportButtonObserved).not.toBeNull();
    expect(exportButtonObserved).toBeDisabled();
  });

  it("withdraws export availability while the current source is invalid", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    expect(await screen.findByRole("button", { name: "Export PDF" })).toBeInTheDocument();

    act(() => useCadDocumentStore.getState().commitText("nui 1\npoint Broken = coordinate(", "test"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull());
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "outputPreviewExportAvailability",
      outputKey: null,
      format: null
    }));
  });

  it("positions Output Preview ribbon tooltips relative to the workspace boundary", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const workspace = document.querySelector<HTMLElement>(".output-preview-workspace");
    if (!workspace) throw new Error("missing output preview workspace");
    const trigger = screen.getByRole("button", { name: "Go to Source" });
    const tooltip = document.getElementById(trigger.getAttribute("aria-describedby") ?? "");
    if (!(tooltip instanceof HTMLElement)) throw new Error("missing output preview tooltip");

    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 100,
      top: 50,
      right: 500,
      bottom: 350,
      width: 400,
      height: 300
    });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 200,
      top: 100,
      right: 240,
      bottom: 124,
      width: 40,
      height: 24
    });
    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      ...viewportRect,
      left: 0,
      top: 0,
      right: 180,
      bottom: 30,
      width: 180,
      height: 30
    });

    expect(document.querySelector(".output-preview-command-ribbon")).toHaveClass("has-viewport-aware-tooltips");
    fireEvent.focus(trigger);
    expect(tooltip).toHaveStyle({ position: "fixed", left: "130px", top: "130px", transform: "none" });
  });

  it("publishes a VS Code blank context without native Cut, Copy, and Paste items", () => {
    renderFixture("nui 1");
    const viewport = document.querySelector(".output-preview-viewport");
    expect(viewport).not.toBeNull();
    expect(JSON.parse(viewport?.getAttribute("data-vscode-context") ?? "{}")).toEqual({
      webviewSection: "blank",
      preventDefaultContextMenuItems: true
    });
  });

  it("uses an exact current diagnostic range for a current-source output error", async () => {
    mocks.evaluateOutputPlan.mockRejectedValue(new Error("output evaluation failed"));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const from = source.indexOf("overlap: 5");
    const to = from + "overlap: 5".length;
    useCadDocumentStore.setState({
      diagnostics: [{
        severity: "error",
        line: 10,
        column: 3,
        message: "output value failed",
        physicalSpan: { segments: [{ from, to }], sourceRevision: state.currentSourceRevision },
        navigationTarget: { kind: "property", occurrenceKey: "output:overlap" }
      }]
    });

    const navigate = await screen.findByRole("button", { name: "Go to source" });
    fireEvent.click(navigate);

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewSourceNavigation",
      documentVersion: 1,
      range: { from, to }
    });
  });

  it("auto-fits the initial selected output", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
  });

  it("auto-fits after a selector change", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    fireEvent.change(screen.getByRole("combobox"), { target: { value: outputKeyFor("svg", "B") } });

    await waitFor(() => expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBeGreaterThan(100));
  });

  it("preserves the viewport across a normal valid source edit", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const before = pageFill().getAttribute("x");

    act(() => useCadDocumentStore.getState().commitText(repairedSource, "test"));

    await waitFor(() => expect(pageFill().getAttribute("x")).not.toBe(before));
  });

  it("pans with the middle mouse button after capture even when pointermove buttons are unavailable", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const before = Number(pageFill().getAttribute("x"));
    const viewport = document.querySelector(".output-preview-viewport");
    const status = screen.getByRole("status", { name: /Output Preview status:/ });
    const zoomBeforePan = screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent;

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 120, clientY: 100 });

    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20));
    expect(zoomBeforePan).toBeDefined();
    expect(screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent).toBe(zoomBeforePan);
    expect(status).toHaveTextContent(/X-?\d+\.\d+Y-?\d+\.\d+/);
  });

  it("keeps the viewport owner reachable when the React root pointer boundary is interrupted", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    const container = document.createElement("div");
    document.body.append(container);
    const blockReactPointerBoundary = (event: Event) => event.stopImmediatePropagation();
    const pointerEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"];
    pointerEvents.forEach((eventName) => container.addEventListener(eventName, blockReactPointerBoundary));

    try {
      useCadDocumentStore.getState().commitText(source, "test");
      render(<OutputPreviewApp api={api} />, { container });
      await waitFor(() => expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("width"))).toBeGreaterThan(400));
      const viewport = container.querySelector(".output-preview-viewport");
      if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
      const before = Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"));

      await act(async () => {
        fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
        await Promise.resolve();
      });

      expect(Number(container.querySelector('[data-output-preview-layer="page-fill"]')?.getAttribute("x"))).toBeCloseTo(before + 20);
    } finally {
      pointerEvents.forEach((eventName) => container.removeEventListener(eventName, blockReactPointerBoundary));
      cleanup();
      container.remove();
    }
  });

  it("ends a captured middle-button pan on pointerup and keeps wheel zoom available", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const before = Number(pageFill().getAttribute("x"));
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 120, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 20));
    const afterPan = Number(pageFill().getAttribute("x"));
    const zoomBeforeWheel = screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent;

    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 120, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 160, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterPan);

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    expect(zoomBeforeWheel).toBeDefined();
    expect(screen.getByRole("status", { name: /Output Preview zoom:/ }).textContent).not.toBe(zoomBeforeWheel);
  });

  it("keeps the middle-button pan session bound to its pointer and cancels it safely", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    const beforeDifferentPointer = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 2, clientX: 140, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeDifferentPointer);
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(beforeDifferentPointer + 10));

    fireEvent.pointerCancel(viewport, { pointerId: 1, clientX: 110, clientY: 100 });
    const afterCancel = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterCancel);
  });

  it("ends a middle-button pan when pointer capture is lost", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const viewport = document.querySelector(".output-preview-viewport");

    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    const before = Number(pageFill().getAttribute("x"));
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 110, clientY: 100 });
    await waitFor(() => expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(before + 10));
    fireEvent.lostPointerCapture(viewport, { pointerId: 1, clientX: 110, clientY: 100 });
    const afterLostCapture = Number(pageFill().getAttribute("x"));
    fireEvent.pointerMove(viewport, { buttons: 0, pointerId: 1, clientX: 130, clientY: 100 });
    expect(Number(pageFill().getAttribute("x"))).toBeCloseTo(afterLostCapture);
  });

  it("falls back to A, fits once, and keeps A selected when B is re-added", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const initialA = pageFill().getAttribute("x");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: outputKeyFor("svg", "B") } });
    await waitFor(() => expect(Number(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="output-fill"]')?.getAttribute("width"))).toBeGreaterThan(100));
    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.pointerDown(viewport, { button: 1, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { button: 1, buttons: 4, pointerId: 1, clientX: 180, clientY: 100 });
    fireEvent.pointerUp(viewport, { button: 1, pointerId: 1, clientX: 180, clientY: 100 });

    act(() => useCadDocumentStore.getState().commitText(printSourceWithoutB, "test"));
    await waitFor(() => expect(pageFill().getAttribute("x")).toBe(initialA));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
    const fallbackA = pageFill().getAttribute("x");

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await waitFor(() => expect(pageFill().getAttribute("x")).toBe(fallbackA));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
  });

  it("recovers the selected output after a current-source error is repaired", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    const svgKey = outputKeyFor("svg", "B");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: svgKey } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument());

    act(() => useCadDocumentStore.getState().commitText("nui 1\npoint Broken = coordinate(", "test"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    act(() => useCadDocumentStore.getState().commitText(source, "test"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("combobox")).toHaveValue(svgKey);
    expect(screen.getByRole("button", { name: "Export SVG" })).toBeInTheDocument();
  });

  it("hydrates both Manual E2E outputs and opens the output at a cursor offset", async () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    render(<OutputPreviewApp api={api} />);

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: outputPreviewManualE2eSource, documentVersion: 1 }
      }));
    });

    await waitFor(() => expect(screen.getByRole("combobox").querySelectorAll("option")).toHaveLength(2));
    expect([...screen.getByRole("combobox").querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Print · 家庭用A4",
      "SVG · 型紙SVG"
    ]);
    expect(useCadDocumentStore.getState().printOutputs.map((output) => output.name)).toEqual(["家庭用A4"]);
    expect(useCadDocumentStore.getState().svgOutputs.map((output) => output.name)).toEqual(["型紙SVG"]);

    const printKey = outputKeyFor("print", "家庭用A4");
    const svgKey = outputKeyFor("svg", "型紙SVG");
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: outputPreviewManualE2eSource.indexOf("layers: [finished]")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(printKey));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: outputPreviewManualE2eSource.lastIndexOf("layers: [finished]")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(svgKey));
  });

  it("keeps the current output selection when opened without a source cursor", async () => {
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const svgKey = outputKeyFor("svg", "B");
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "outputPreviewOpen",
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("svg B(")
        }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(svgKey));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "outputPreviewOpen", documentVersion: 1, normalizedSourceOffset: null }
      }));
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(svgKey));
  });

  it("renders overlapping page fills, geometry, boundaries, and guides in contract order", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    const layers = [...screen.getByLabelText("Output preview").querySelectorAll("[data-output-preview-layer]")]
      .map((element) => element.getAttribute("data-output-preview-layer"));

    expect(layers).toEqual([
      "page-fill",
      "page-fill",
      "geometry",
      "page-boundary",
      "page-boundary",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide",
      "overlap-guide"
    ]);
  });

  it("renders OutputFill below the stroke without moving the interaction overlay above geometry", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) =>
      planFor(output, { colorHex: "#abcdef", opacity: 0.25 })
    );
    renderFixture();

    await waitFor(() => expect(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]')).not.toBeNull());
    const geometry = screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]');
    expect(geometry).toHaveAttribute("fill", "#abcdef");
    expect(geometry).toHaveAttribute("fill-opacity", "0.25");
    expect(geometry).toHaveAttribute("stroke", "#123456");
    const plane = screen.getByLabelText("Output preview");
    expect(plane.querySelector('[data-output-preview-layer="geometry"]')).toBeTruthy();
    expect(document.querySelector('[data-output-preview-layer="place-overlay"]')).toBeTruthy();
    expect(plane.compareDocumentPosition(document.querySelector('[data-output-preview-layer="place-overlay"]')!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("accepts exact physical spans for semantic diagnostic targets and fails closed otherwise", () => {
    const diagnostic = (physicalSpan: DslDiagnostic["physicalSpan"], navigationTarget?: DslDiagnostic["navigationTarget"]): DslDiagnostic => ({
      severity: "error",
      line: 1,
      column: 1,
      message: "error",
      physicalSpan,
      ...(navigationTarget ? { navigationTarget } : {})
    });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 2 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: -1, to: 2 }], sourceRevision: 3 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }, { from: 4, to: 5 }], sourceRevision: 3 }))).toBeNull();
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }, { kind: "binding", bindingId: "binding" }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 1, to: 2 }], sourceRevision: 3 }, { kind: "property", occurrenceKey: "property" }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic({ segments: [{ from: 0, to: 1 }], sourceRevision: 3 }, { kind: "sourceSpan", physicalSpan: { segments: [{ from: 1, to: 2 }], sourceRevision: 3 } }))).toEqual({ from: 1, to: 2 });
    expect(outputPreviewDiagnosticSourceRangeFor("abc\ndef", 3, diagnostic(undefined, { kind: "binding", bindingId: "binding" }))).toBeNull();
  });

  it("keeps a selected containing Output selected, installs its highlight, and refits visible geometry", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 11 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 7,
      documentVersion: 11,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 7,
      documentVersion: 11,
      status: "resolved",
      outputKey: outputKeyFor("print", "A")
    }));
    expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A"));
    expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Output Preview zoom: 2000%" })).toBeInTheDocument();
  });

  it("keeps a no-containing target distinct from stale and evaluation failures", async () => {
    const sourceWithUnused = source.replace(
      "layout L {",
      "point Unused = coordinate(x: 40, y: 40)\nlayout L {"
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture(sourceWithUnused);
    postWindowMessage({ type: "replaceTextDocument", sourceText: sourceWithUnused, documentVersion: 12 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 8,
      documentVersion: 12,
      normalizedSourceOffset: sourceWithUnused.indexOf("point Unused") + 2
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 8,
      documentVersion: 12,
      status: "failed",
      reason: "no-containing-output"
    }));
  });

  it("keeps the explicit target fit through cross-output Reveal and delayed ordinary evaluation", async () => {
    const crossOutputSource = [
      "nui 1",
      "group G {",
      "  line AB = segment(start: (0, 0), end: (10, 0))",
      "}",
      "layout Empty {",
      "}",
      "layout Target {",
      "  place G(at: (0, 0))",
      "}",
      "print A(",
      "  layout: Empty,",
      "  layers: [default],",
      "  paper: a4,",
      "  overlap: 5,",
      ")",
      "svg B(",
      "  layout: Target,",
      "  layers: [default],",
      "  margin: 1,",
      ")"
    ].join("\n");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture(crossOutputSource);
    postWindowMessage({ type: "replaceTextDocument", sourceText: crossOutputSource, documentVersion: 13 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    await waitFor(() => expect(Number(pageFill().getAttribute("width"))).toBeGreaterThan(400));

    const viewport = document.querySelector(".output-preview-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing output preview viewport");
    fireEvent.wheel(viewport, { deltaY: -100, clientX: 250, clientY: 150 });
    const initialEvaluationCallCount = mocks.evaluateOutputPlan.mock.calls.length;

    const pending: Array<{
      output: TestOutput;
      promise: Promise<OutputPlan>;
      resolve: (plan: OutputPlan) => void;
    }> = [];
    mocks.evaluateOutputPlan.mockImplementation(({ output }: { output: TestOutput }) => {
      let resolve!: (plan: OutputPlan) => void;
      const promise = new Promise<OutputPlan>((resolvePromise) => { resolve = resolvePromise; });
      pending.push({ output, promise, resolve });
      return promise;
    });
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 9,
      documentVersion: 13,
      normalizedSourceOffset: crossOutputSource.indexOf("layout Target") + 2
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstRevealEvaluation = pending[0];
    if (!firstRevealEvaluation) throw new Error("missing first Reveal evaluation");
    await act(async () => {
      firstRevealEvaluation.resolve(planFor(firstRevealEvaluation.output));
      await firstRevealEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const secondRevealEvaluation = pending[1];
    if (!secondRevealEvaluation) throw new Error("missing second Reveal evaluation");
    await act(async () => {
      secondRevealEvaluation.resolve(planFor(secondRevealEvaluation.output));
      await secondRevealEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 9,
      documentVersion: 13,
      status: "resolved",
      outputKey: outputKeyFor("svg", "B")
    }));
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("svg", "B")));
    await waitFor(() => expect(pending).toHaveLength(3));

    const revealStatus = screen.getByRole("status", { name: /Output Preview status:/ }).textContent;
    const revealGeometryPath = screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]')?.getAttribute("d");
    expect(screen.getByRole("status", { name: "Output Preview zoom: 2000%" })).toBeInTheDocument();

    const ordinaryEvaluation = pending[2];
    if (!ordinaryEvaluation) throw new Error("missing delayed selected-output evaluation");
    await act(async () => {
      ordinaryEvaluation.resolve(planFor(ordinaryEvaluation.output));
      await ordinaryEvaluation.promise;
      await Promise.resolve();
    });
    expect(mocks.evaluateOutputPlan).toHaveBeenCalledTimes(initialEvaluationCallCount + pending.length);
    expect(screen.getByRole("status", { name: /Output Preview status:/ }).textContent).toBe(revealStatus);
    expect(screen.getByLabelText("Output preview").querySelector('[data-output-preview-layer="geometry"]')?.getAttribute("d")).toBe(revealGeometryPath);
  });

  it("removes explicit Reveal highlights when Open Output Preview selects another Output", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 14 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 10,
      documentVersion: 14,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(1));

    postWindowMessage({
      type: "outputPreviewOpen",
      documentVersion: 14,
      normalizedSourceOffset: source.indexOf("svg B(") + 2
    });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("svg", "B")));
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("removes explicit Reveal highlights when Output Preview focus is cleared", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 15 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 11,
      documentVersion: 15,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull());

    postWindowMessage({ type: "outputPreviewClearFocus" });
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("ignores a replacement Reveal result and only resolves the current request", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 16 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    const pending: Array<{
      output: TestOutput;
      promise: Promise<OutputPlan>;
      resolve: (plan: OutputPlan) => void;
    }> = [];
    mocks.evaluateOutputPlan.mockImplementation(({ output }: { output: TestOutput }) => {
      let resolve!: (plan: OutputPlan) => void;
      const promise = new Promise<OutputPlan>((resolvePromise) => { resolve = resolvePromise; });
      pending.push({ output, promise, resolve });
      return promise;
    });
    const revealOffset = source.indexOf("print A(") + 2;
    postWindowMessage({ type: "outputPreviewReveal", requestId: 20, documentVersion: 16, normalizedSourceOffset: revealOffset });
    postWindowMessage({ type: "outputPreviewReveal", requestId: 21, documentVersion: 16, normalizedSourceOffset: revealOffset });
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstRequestFirstEvaluation = pending[0];
    if (!firstRequestFirstEvaluation) throw new Error("missing first request evaluation");
    await act(async () => {
      firstRequestFirstEvaluation.resolve(planFor(firstRequestFirstEvaluation.output));
      await firstRequestFirstEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    const firstRequestSecondEvaluation = pending[1];
    if (!firstRequestSecondEvaluation) throw new Error("missing second request evaluation");
    await act(async () => {
      firstRequestSecondEvaluation.resolve(planFor(firstRequestSecondEvaluation.output));
      await firstRequestSecondEvaluation.promise;
      await Promise.resolve();
    });
    expect(revealResultMessages().some(({ requestId, status }) => requestId === 20 && status === "resolved")).toBe(false);
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();

    await waitFor(() => expect(pending).toHaveLength(3));
    const secondRequestFirstEvaluation = pending[2];
    if (!secondRequestFirstEvaluation) throw new Error("missing current request evaluation");
    await act(async () => {
      secondRequestFirstEvaluation.resolve(planFor(secondRequestFirstEvaluation.output));
      await secondRequestFirstEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(pending).toHaveLength(4));
    const secondRequestSecondEvaluation = pending[3];
    if (!secondRequestSecondEvaluation) throw new Error("missing final current request evaluation");
    await act(async () => {
      secondRequestSecondEvaluation.resolve(planFor(secondRequestSecondEvaluation.output));
      await secondRequestSecondEvaluation.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(revealResultMessages()).toContainEqual(expect.objectContaining({ requestId: 21, status: "resolved" })));
    expect(revealResultMessages().some(({ requestId, status }) => requestId === 20 && status === "resolved")).toBe(false);
  });

  it("removes explicit Reveal highlights when the authoritative document changes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planFor(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 17 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 22,
      documentVersion: 17,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull());

    postWindowMessage({
      type: "replaceTextDocument",
      sourceText: repairedSource,
      documentVersion: 18
    });
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).toBeNull();
  });

  it("renders repeated Reveal drawable occurrences with distinct React identity", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    mocks.evaluateOutputPlan.mockImplementation(async ({ output }: { output: TestOutput }) => planWithRepeatedDrawables(output));
    renderFixture();
    postWindowMessage({ type: "replaceTextDocument", sourceText: source, documentVersion: 19 });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 23,
      documentVersion: 19,
      normalizedSourceOffset: source.indexOf("print A(") + 2
    });
    await waitFor(() => expect(screen.getByLabelText("Output preview").querySelectorAll('[data-output-preview-layer="reveal-highlight"]')).toHaveLength(2));
  });
});

describe("Output Preview production Rust transport lifecycle", () => {
  afterEach(() => {
    cleanup();
    useCadDocumentStore.setState(initialCadDocumentState());
  });

  const useProductionOutputEvaluation = async () => {
    const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
    mocks.evaluateOutputPlan.mockImplementation(actual.evaluateOutputPlan);
  };

  it("resolves cold Reveal alongside ordinary Preview evaluation without transport supersession", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    await useProductionOutputEvaluation();
    const controlled = createControlledRustApi();
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={controlled.api} />);

    postWindowMessage({ type: "replaceTextDocument", sourceText: coldRevealSource, documentVersion: 1 });
    await waitFor(() => expect(controlled.requests).toHaveLength(1));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 1,
      documentVersion: 1,
      normalizedSourceOffset: coldRevealSource.indexOf("group G") + 2
    });
    expect(controlled.requests).toHaveLength(1);

    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(2));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(3));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 1,
      documentVersion: 1,
      status: "resolved",
      outputKey: outputKeyFor("svg", "B")
    }));
  }, 30_000);

  it("keeps the cold Reveal highlight after the authoritative snapshot is replayed", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    await useProductionOutputEvaluation();
    const controlled = createControlledRustApi();
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={controlled.api} />);

    expect(controlled.api.postMessage).toHaveBeenCalledWith({ type: "webviewReady" });
    postWindowMessage({ type: "replaceTextDocument", sourceText: coldRevealSource, documentVersion: 3 });
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "webviewAuthoritativeDocumentReady",
      documentVersion: 3
    }));
    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 3,
      documentVersion: 3,
      normalizedSourceOffset: coldRevealSource.indexOf("group G") + 2
    });

    await waitFor(() => expect(controlled.requests).toHaveLength(1));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(2));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(3));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 3,
      documentVersion: 3,
      status: "resolved",
      outputKey: outputKeyFor("svg", "B")
    }));
    await waitFor(() => expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull());

    postWindowMessage({ type: "replaceTextDocument", sourceText: coldRevealSource, documentVersion: 3 });
    expect(document.querySelector('[data-output-preview-layer="reveal-highlight"]')).not.toBeNull();
  }, 30_000);

  it("completes warm Reveal with three Outputs through the ordered production transport path", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    await useProductionOutputEvaluation();
    const controlled = createControlledRustApi();
    useCadDocumentStore.setState(initialCadDocumentState());
    render(<OutputPreviewApp api={controlled.api} />);

    postWindowMessage({ type: "replaceTextDocument", sourceText: sourceWithThreeOutputs, documentVersion: 2 });
    await waitFor(() => expect(controlled.requests).toHaveLength(1));
    await controlled.respondNext();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(outputKeyFor("print", "A")));

    postWindowMessage({
      type: "outputPreviewReveal",
      requestId: 2,
      documentVersion: 2,
      normalizedSourceOffset: sourceWithThreeOutputs.indexOf("group G") + 2
    });
    await waitFor(() => expect(controlled.requests).toHaveLength(2));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(3));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.requests).toHaveLength(4));
    await controlled.respondNext();
    await waitFor(() => expect(controlled.api.postMessage).toHaveBeenCalledWith({
      type: "outputPreviewRevealResult",
      requestId: 2,
      documentVersion: 2,
      status: "resolved",
      outputKey: outputKeyFor("print", "A")
    }));
  }, 30_000);
});
