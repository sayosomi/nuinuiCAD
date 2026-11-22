import type { VscodeCanvasImageResources } from "./protocol";
import { act, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectDslRevealRuntimeStatementOwner } from "@nuinuicad/nui-language";
import { compileDslDocument, createModuleRuntimeContext } from "@nuinuicad/nui-language";
import { replaceCanvasSelection, selectElement } from "../commands/selectionCommands";
import * as commandRegistry from "../commands/commands";
import * as evaluationEngineRouting from "../geometry/evaluationEngineRouting";
import { planInlineModule } from "@nuinuicad/nui-language/document";
import { applyLineSplices } from "@nuinuicad/nui-language/document";
import { dslTextForElements } from "@nuinuicad/nui-language";
import { materializedRuntimeElementId } from "@nuinuicad/nui-language";
import { queryDslCanvasSourceDefinition, sourceOwnerByRuntimeElementId, sourceOwnerForRuntimeElementId } from "@nuinuicad/nui-language";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import {
  analyzeMultiDocumentModuleSemantics,
  buildMultiDocumentImportGraph,
  documentIdFromHost,
  moduleDeclarationContributor,
  savedSourceFingerprintFromHost
} from "@nuinuicad/nui-language/workspace";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../types/geometry";
import type { CanvasGridSettings } from "../components/canvasGrid";
import { effectiveCompiledDocument, initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import {
  coordinatePointCreationOffDocumentVersionFor,
  VSCodeApp as VSCodeAppForTest
} from "./VSCodeApp";
import type { VscodeMultiDocumentGraphPublication } from "./multiDocumentGraphTransport";
import { vscodeMultiDocumentGraphSnapshot } from "./multiDocumentGraphTransport";
import type {
  VscodeMultiDocumentCanvasRuntimePresentation,
  VscodeMultiDocumentRevealMaterialization
} from "./multiDocumentRuntimeTransport";
import {
  projectVscodeMultiDocumentCanvasIdentity,
  projectVscodeMultiDocumentCanvasRuntime
} from "./multiDocumentRuntimeTransport";
import type { VscodeReferencePickAuthorityFor } from "./useVSCodeReferencePickSession";
import type { VscodeWebviewApi } from "./protocol";
import { VscodeRustTransport } from "./vscodeRustTransport";
import { webviewPresentationFor } from "../../vscode-extension/src/webviewPresentationLocalization";
import {
  buildImportedRevealFreshnessFixture,
  importedRevealDocumentVersion,
  importedRevealGraphRevision,
  importedRevealGraphRootSourceRevision,
  importedRevealRootSource
} from "./testSupport/importedRevealFreshnessFixture";
import { canvasNavigationFreshnessFor } from "./canvasNavigationFreshness";
import { canvasLayerVisibleElementIds, projectCanvasLayerPresentation } from "../model/canvasLayerPresentation";
import {
  buildIssue1651ImportedModuleCanvasEditFixture,
  issue1651DocumentVersion,
  issue1651RootDocumentUri,
  issue1651RootSourceFor
} from "./testSupport/issue1651ImportedModuleCanvasEditFixture";
import { issue1664CoordinatePointCreationCases } from "./testSupport/issue1664CoordinatePointCreationFixture";

const drawingCanvasProps = vi.hoisted(() => ({
  imageResources: {} as VscodeCanvasImageResources,
  postCanvasCommit: null as ((operationId?: number, coordinatePointConversionRequestId?: number, sourceText?: string, graphAuthority?: { rootDocumentId: string; graphRevision: number }) => void) | null,
  postCanonicalSourceText: null as ((sourceText: string, operationId?: number, graphAuthority?: { rootDocumentId: string; graphRevision: number }) => void) | null,
  postCoordinatePointCreationClick: null as ((pointer: { x: number; y: number }) => void) | null,
  evaluateReferencePickCandidate: null as ((compiled: unknown) => Promise<EvaluationResult>) | null,
  onFinishCoordinatePointCreation: null as (() => void) | null,
  fitDrawingOperation: vi.fn(),
  currentReferencePickAuthorityFor: null as VscodeReferencePickAuthorityFor | null,
  bakeSandboxTargetIds: null as string[] | null,
  bakeSandboxPromise: null as Promise<unknown> | null,
  multiDocumentRuntimePresentation: null as VscodeMultiDocumentCanvasRuntimePresentation | null,
  hostRootDocumentId: null as string | null,
  hostDocumentEpoch: 0,
  awaitingHostGraph: false,
  canvasGridSettings: null as CanvasGridSettings | null,
  onToggleCanvasGrid: null as (() => void) | null,
  onConfigureCanvasGrid: null as (() => void) | null,
  onToggleCanvasGridSnap: null as (() => void) | null,
  evaluation: { computedGeometry: new Map(), errors: [], warnings: [] } as EvaluationResult
}));

const evaluationStateControl = vi.hoisted(() => ({ isCurrent: true }));
const evaluationRevisionCapture = vi.hoisted(() => ({ revisions: [] as number[] }));
const buildEvaluationOptionsMock = vi.hoisted(() => vi.fn(() => ({})));
const evaluationTransportCapture = vi.hoisted(() => ({
  local: null as unknown,
  multiDocument: null as unknown,
  bake: null as unknown
}));

const completeGraphSnapshotEvaluationFor = (elements: readonly CadElement[]): EvaluationResult => ({
  computedGeometry: new Map(elements
    .filter((element) => element.type === "freePoint")
    .map((element) => [element.id, {
      kind: "point" as const,
      elementId: element.id,
      name: element.name,
      x: element.name === "Imported" ? 50 : 0,
      y: 0
    }])),
  errors: [],
  warnings: [],
  evaluatedElementIds: new Set(elements.map(({ id }) => id)),
  effectiveEnabledElementIds: new Set(elements.map(({ id }) => id)),
  effectiveVisibleElementIds: new Set(elements.map(({ id }) => id))
});

vi.mock("../geometry/productionEvaluationContext", () => ({
  buildEvaluationOptions: buildEvaluationOptionsMock
}));

vi.mock("../geometry/evaluationEngine", () => ({
  evaluateElementsWithRust: vi.fn(async (_elements: unknown, options: { allowDisabledElementIds?: ReadonlySet<string> }, transport: unknown) => {
    drawingCanvasProps.bakeSandboxTargetIds = [...(options.allowDisabledElementIds ?? [])];
    evaluationTransportCapture.bake = transport;
    if (drawingCanvasProps.bakeSandboxPromise) return drawingCanvasProps.bakeSandboxPromise;
    return {};
  })
}));

vi.mock("../geometry/useEvaluationEngine", () => ({
  evaluationStateIsCurrentFor: (_state: unknown, revision: number) => {
    evaluationRevisionCapture.revisions.push(revision);
    return evaluationStateControl.isCurrent;
  },
  useEvaluationEngine: (_elements: unknown, _options: unknown, _revision: unknown, transport: unknown) => {
    evaluationTransportCapture.local = transport ?? null;
    return { evaluation: drawingCanvasProps.evaluation };
  }
}));

vi.mock("./VSCodeDrawingCanvas", async () => {
  const React = await import("react");
  type TestCanvasHandle = {
    clearPendingCanvasPointerIntent: () => void;
    clearEditorFocusReservation: () => void;
    finalizeCanvasInteraction: () => void;
    isReferencePickActive: () => boolean;
    fitDrawing: () => void;
  };
  type TestCanvasProps = {
    imageResources?: VscodeCanvasImageResources;
    canvasFocusRef: RefObject<HTMLDivElement | null>;
    postCanvasCommit: (operationId?: number, coordinatePointConversionRequestId?: number, sourceText?: string, graphAuthority?: { rootDocumentId: string; graphRevision: number }) => void;
    postCanonicalSourceText: (sourceText: string, operationId?: number, graphAuthority?: { rootDocumentId: string; graphRevision: number }) => void;
    currentReferencePickAuthorityFor: VscodeReferencePickAuthorityFor;
    multiDocumentRuntimePresentation?: VscodeMultiDocumentCanvasRuntimePresentation | null;
    hostRootDocumentId: string | null;
    hostDocumentEpoch: number;
    awaitingHostGraph: boolean;
    canvasGridSettings?: CanvasGridSettings;
    onToggleCanvasGrid?: () => void;
    onConfigureCanvasGrid?: () => void;
    onToggleCanvasGridSnap?: () => void;
    postCoordinatePointCreationClick: (pointer: { x: number; y: number }) => void;
    evaluateReferencePickCandidate: (compiled: unknown) => Promise<EvaluationResult>;
    onFinishCoordinatePointCreation?: () => void;
  };
  return {
  VSCodeDrawingCanvas: React.forwardRef<TestCanvasHandle, TestCanvasProps>(({
    imageResources,
    canvasFocusRef,
    postCanvasCommit,
    postCanonicalSourceText,
    currentReferencePickAuthorityFor,
    multiDocumentRuntimePresentation,
    hostRootDocumentId,
    hostDocumentEpoch,
    awaitingHostGraph,
    canvasGridSettings,
    onToggleCanvasGrid,
    onConfigureCanvasGrid,
    onToggleCanvasGridSnap,
    postCoordinatePointCreationClick,
    evaluateReferencePickCandidate,
    onFinishCoordinatePointCreation
  }, ref) => {
    React.useImperativeHandle(ref, () => ({
      clearPendingCanvasPointerIntent: () => undefined,
      clearEditorFocusReservation: () => undefined,
      finalizeCanvasInteraction: () => undefined,
      isReferencePickActive: () => false,
      fitDrawing: drawingCanvasProps.fitDrawingOperation
    }), []);
    drawingCanvasProps.imageResources = imageResources ?? {};
    drawingCanvasProps.postCanvasCommit = postCanvasCommit;
    drawingCanvasProps.postCanonicalSourceText = postCanonicalSourceText;
    drawingCanvasProps.currentReferencePickAuthorityFor = currentReferencePickAuthorityFor;
    drawingCanvasProps.multiDocumentRuntimePresentation = multiDocumentRuntimePresentation ?? null;
    drawingCanvasProps.hostRootDocumentId = hostRootDocumentId;
    drawingCanvasProps.hostDocumentEpoch = hostDocumentEpoch;
    drawingCanvasProps.awaitingHostGraph = awaitingHostGraph;
    drawingCanvasProps.canvasGridSettings = canvasGridSettings ?? null;
    drawingCanvasProps.onToggleCanvasGrid = onToggleCanvasGrid ?? null;
    drawingCanvasProps.onConfigureCanvasGrid = onConfigureCanvasGrid ?? null;
    drawingCanvasProps.onToggleCanvasGridSnap = onToggleCanvasGridSnap ?? null;
    drawingCanvasProps.postCoordinatePointCreationClick = postCoordinatePointCreationClick;
    drawingCanvasProps.evaluateReferencePickCandidate = evaluateReferencePickCandidate;
    drawingCanvasProps.onFinishCoordinatePointCreation = onFinishCoordinatePointCreation ?? null;
    return <div ref={canvasFocusRef} data-testid="canvas" tabIndex={-1} />;
  })
  };
});

vi.mock("./VSCodeBenchmarkCaptureRunner", () => ({
  VSCodeBenchmarkCaptureRunner: () => null
}));

vi.mock("./useVscodeMultiDocumentRuntimeEvaluation", () => ({
  useVscodeMultiDocumentRuntimeEvaluation: (snapshot: { graphRevision: number } | null, transport: unknown) => {
    evaluationTransportCapture.multiDocument = transport;
    return {
      evaluation: drawingCanvasProps.evaluation,
      evaluationRevision: snapshot?.graphRevision ?? 0,
      evaluationRequestRevision: snapshot?.graphRevision ?? 0,
      mode: "rust",
      source: "rust",
      status: "ready",
      rustEligible: true,
      isStale: false,
      error: null
    };
  }
}));

const sourceForSelectionChronology = (x: number) => dslTextForElements([
  { id: "a", name: "A", type: "freePoint", activity: "visible", x, y: 0 },
  { id: "b", name: "B", type: "freePoint", activity: "visible", x: x + 10, y: 0 }
]);

const coordinateOffsetSourceForSelectionChronology = (target: "coordinate" | "offset") => [
  "nui 1",
  "point A = coordinate(x: 0, y: 0)",
  target === "coordinate"
    ? "point B = coordinate(x: 10, y: 0)"
    : "point B = offset(from: @A, dx: 10, dy: 0)"
].join("\n");

const h3Source = [
  "nui 1",
  "point Left = coordinate(x: -50, y: 0)",
  "point Right = coordinate(x: 50, y: 0)",
  "line Guide = segment(start: @Left, end: @Right)"
].join("\n");

const h3GuideSourcePosition = { line: 3, character: "line ".length };

const multiDocumentRuntimePublicationFor = (
  source: string,
  documentVersion: number,
  graphSourceRevision: number,
  runtimeRootSourceRevision: number,
  elements: CadElement[]
): VscodeMultiDocumentGraphPublication => ({
  type: "multiDocumentGraphPublication",
  documentVersion,
  status: "current",
  hostDocumentUri: "file:///workspace/root.nui",
  graph: {
    revision: 12,
    rootDocumentId: "file:///workspace/root.nui",
    rootSource: {
      kind: "root-current",
      documentId: "file:///workspace/root.nui",
      normalizedSource: source,
      sourceRevision: graphSourceRevision
    },
    valid: true,
    nodes: [],
    edges: [],
    dependencyFingerprints: [],
    diagnostics: []
  },
  canvasRuntime: {
    graphRevision: 12,
    rootDocumentId: "file:///workspace/root.nui",
    rootSourceRevision: runtimeRootSourceRevision,
    preparedRustEvaluation: {
      rustEligible: true,
      input: {
        elements,
        evaluationLimitIndex: elements.length
      }
    },
    visibilityProfiles: [],
    activeVisibilityProfileId: "",
    modulePresentation: {
      instanceBaseGeometrySnapshots: [],
      layerSourceDocuments: [],
      origins: []
    }
  }
});

const issue1609LibrarySource = [
  "nui 1",
  "export record SeamSettings(width: number, cornerAngle: number)"
].join("\n");

const issue1609RootSourceFor = (testCase: "A" | "B" | "C" | "D" | "E" | "F") => {
  if (testCase === "A") return [
      "nui 1",
      'import "./record-settings-lib.nui" as lib',
      "const settings: lib::SeamSettings = lib::SeamSettings(width: 5, cornerAngle: 45)",
      "const seam_width: number = @settings.width",
      "line Seam = segment(start: (0, 0), end: (@seam_width, 0))",
      'text = label(text: "seam width = ${@seam_width}", anchor: (0, 20), size: 6)'
    ].join("\n");
  if (testCase === "B") return [
      "nui 1",
      'import "./record-settings-lib.nui" as lib',
      "const seam_width: number = 5",
      "line Seam = segment(start: (0, 0), end: (@seam_width, 0))",
      'text = label(text: "seam width = ${@seam_width}", anchor: (0, 20), size: 6)'
    ].join("\n");
  if (testCase === "C") return [
      "nui 1",
      "record SeamSettings(width: number)",
      "const settings: SeamSettings = SeamSettings(width: 5)",
      "line Seam = segment(start: (0, 0), end: (@settings.width, 0))",
      'text = label(text: "seam width = ${@settings.width}", anchor: (0, 20), size: 6)'
    ].join("\n");
  if (testCase === "D") return [
      "nui 1",
      'import "./record-settings-lib.nui" as lib',
      "const settings: lib::SeamSettings = lib::SeamSettings(width: 5, cornerAngle: 45)",
      "const seam_width: number = @settings.width",
      "line Control = segment(start: (0, 0), end: (50, 0))",
      'text = label(text: "control = 50", anchor: (0, 20), size: 6)'
    ].join("\n");
  if (testCase === "E") return [
      "nui 1",
      'import "./record-settings-lib.nui" as lib',
      "const settings: lib::SeamSettings = lib::SeamSettings(width: 5, cornerAngle: 45)",
      "line Control = segment(start: (0, 0), end: (50, 0))",
      'text = label(text: "control = 50", anchor: (0, 20), size: 6)'
    ].join("\n");
  return [
      "nui 1",
      'import "./record-settings-lib.nui" as lib',
      "const settings: lib::SeamSettings? = none",
      "line Control = segment(start: (0, 0), end: (50, 0))",
      'text = label(text: "control = 50", anchor: (0, 20), size: 6)'
    ].join("\n");
};

const issue1609HostPublicationFor = async (
  source: string,
  revisions: { documentVersion?: number; graphRevision?: number; sourceRevision?: number } = {}
) => {
  const rootDocumentUri = "file:///workspace/issue-1609-root.nui";
  const dependencyDocumentUri = "file:///workspace/record-settings-lib.nui";
  const rootDocumentId = documentIdFromHost(rootDocumentUri);
  const dependencyDocumentId = documentIdFromHost(dependencyDocumentUri);
  const sourceRevision = revisions.sourceRevision ?? 1;
  const graphRevision = revisions.graphRevision ?? 42;
  const documentVersion = revisions.documentVersion ?? 17;
  const root = {
    kind: "root-current" as const,
    documentId: rootDocumentId,
    normalizedSource: source,
    sourceRevision
  };
  const dependency = {
    kind: "dependency-saved" as const,
    documentId: dependencyDocumentId,
    savedSourceFingerprint: savedSourceFingerprintFromHost("sha256:issue-1609-record-settings-lib"),
    normalizedSource: issue1609LibrarySource
  };
  const graph = await buildMultiDocumentImportGraph({
    root,
    declarationContributors: [moduleDeclarationContributor],
    loader: {
      async loadSavedDependency(importerDocumentId, relativePath) {
        return importerDocumentId === rootDocumentId && relativePath === "./record-settings-lib.nui"
          ? { status: "loaded" as const, snapshot: dependency }
          : { status: "failed" as const, reason: "missing" as const };
      }
    }
  });
  const semanticAnalysis = analyzeMultiDocumentModuleSemantics(graph);
  const moduleRuntimeContext = createModuleRuntimeContext(graph, semanticAnalysis);
  const rootNode = graph.nodes.get(rootDocumentId);
  if (!graph.valid || !semanticAnalysis.valid || !moduleRuntimeContext.valid || !rootNode) {
    throw new Error("Issue 1609 Host graph could not be compiled from the saved dependency");
  }
  const compiled = compileDslDocument(source, {
    preparsed: rootNode.artifact.parsed,
    sourceRevision,
    assignedStatementIds: rootNode.artifact.statementIdByStatementIndex,
    moduleRuntimeContext
  });
  const canvasRuntime = projectVscodeMultiDocumentCanvasRuntime({ graph, compiled, graphRevision }) ??
    projectVscodeMultiDocumentCanvasIdentity({ graph, compiled, graphRevision });
  if (!canvasRuntime) throw new Error("Issue 1609 Host did not publish a Canvas runtime");
  const publication: VscodeMultiDocumentGraphPublication = {
    type: "multiDocumentGraphPublication",
    documentVersion,
    status: "current",
    hostDocumentUri: String(rootDocumentId),
    graph: vscodeMultiDocumentGraphSnapshot(graph, graphRevision),
    canvasRuntime
  };
  return { compiled, canvasRuntime, documentVersion, graphRevision, publication, rootDocumentUri, sourceRevision };
};

const publishAllCurrentElementsAsPresented = () => {
  const elements = useCadDocumentStore.getState().elements;
  useCadUiStore.getState().setCanvasSelectionEligibility(
    elements,
    new Set(elements.map((element) => element.id))
  );
};

const establishPendingCoordinateOffsetHistoryRestore = async (api: VscodeWebviewApi) => {
  const oldSource = coordinateOffsetSourceForSelectionChronology("coordinate");
  const newSource = coordinateOffsetSourceForSelectionChronology("offset");
  render(<VSCodeAppForTest api={api} />);

  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "replaceTextDocument", sourceText: oldSource, documentVersion: 1 }
    }));
    publishAllCurrentElementsAsPresented();
  });
  const oldB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
  selectElement(oldB.id, "replace", true);
  useCadDocumentStore.getState().commitText(newSource, "command");
  publishAllCurrentElementsAsPresented();
  const newB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
  expect(newB.id).not.toBe(oldB.id);
  replaceCanvasSelection([newB.id], newB.id, false);
  drawingCanvasProps.postCanvasCommit!(315);

  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "canvasCommitResult", operationId: 315, status: "accepted", documentVersion: 2 }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "commitText", sourceText: newSource, documentVersion: 2, reason: "edit" }
    }));
  });
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "canvasCommand", commandId: "undo" }
    }));
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "commitText", sourceText: oldSource, documentVersion: 3, reason: "undo" }
    }));
  });
  expect(useCadUiStore.getState().canvasSelectionEligibleElementIds).toBeNull();
  expect(useCadUiStore.getState().selectedElementId).toBeNull();
  return { oldSource, newSource, oldB, newB };
};

const revealMaterializationFor = (
  instanceId: string,
  sourceStatementIndex: number
): VscodeMultiDocumentRevealMaterialization => ({
  executionStatements: [{
    statement: {} as never,
    sourceStatementId: "imported-instance",
    sourceStatementIndex,
    runtimeElementId: instanceId,
    type: "moduleInstance",
    sourceBlockChild: false,
    executionUnitStatementIndex: sourceStatementIndex,
    instancePath: ["imported-instance"]
  }],
  sourceExecutionUnits: [],
  elementIdBySourceStatementIndex: [],
  sourceExecutionPositionByRuntimeElementId: [],
  originByRuntimeElementId: [],
  runtimeIdentityByElementId: [],
  instanceBaseGeometrySnapshots: [],
  evaluationLimitIndex: 2
});

describe("VSCodeApp Canvas history coordinator", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    drawingCanvasProps.postCanvasCommit = null;
    drawingCanvasProps.postCanonicalSourceText = null;
    drawingCanvasProps.currentReferencePickAuthorityFor = null;
    drawingCanvasProps.bakeSandboxTargetIds = null;
    drawingCanvasProps.bakeSandboxPromise = null;
    drawingCanvasProps.multiDocumentRuntimePresentation = null;
    drawingCanvasProps.canvasGridSettings = null;
    drawingCanvasProps.onToggleCanvasGrid = null;
    drawingCanvasProps.onConfigureCanvasGrid = null;
    drawingCanvasProps.onToggleCanvasGridSnap = null;
    drawingCanvasProps.onFinishCoordinatePointCreation = null;
    drawingCanvasProps.evaluateReferencePickCandidate = null;
    drawingCanvasProps.fitDrawingOperation.mockReset();
    drawingCanvasProps.evaluation = { computedGeometry: new Map(), errors: [], warnings: [] };
    evaluationStateControl.isCurrent = true;
    evaluationRevisionCapture.revisions = [];
    evaluationTransportCapture.local = null;
    evaluationTransportCapture.multiDocument = null;
    evaluationTransportCapture.bake = null;
  });

  afterEach(() => vi.restoreAllMocks());

  it("delivers host image resources to Canvas with their accepted source revision", async () => {
    render(<VSCodeAppForTest api={{ postMessage: vi.fn() }} />);
    const sourceText = 'nui 1\nimage Ref = image(source: "a.png", origin: (0, 0))';
    const publish = async (data: unknown) => {
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { data })); });
    };
    const first = { "a.png": "https://resource/first/a.png" };
    await publish({ type: "replaceTextDocument", documentVersion: 1, sourceText, imageResources: first });
    expect(drawingCanvasProps.imageResources).toEqual(first);
    const next = { "a.png": "https://resource/next/a.png" };
    await publish({ type: "commitText", documentVersion: 3, sourceText: sourceText + "\n// edit", reason: "edit", imageResources: next });
    await publish({ type: "commitText", documentVersion: 2, sourceText, reason: "edit", imageResources: first });
    expect(drawingCanvasProps.imageResources).toEqual(next);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText + "\n// edit");
    const revision = useCadDocumentStore.getState().sourceRevision;
    const resolved = { "a.png": "https://resource/evaluated/a.png" };
    await publish({ type: "replaceTextDocument", documentVersion: 3, sourceText: sourceText + "\n// edit", imageResources: resolved });
    expect(drawingCanvasProps.imageResources).toEqual(resolved);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(revision);
    await publish({ type: "replaceTextDocument", documentVersion: 4, sourceText: "nui 1" });
    expect(drawingCanvasProps.imageResources).toEqual({});
  });

  it("uses shared Canvas grid defaults and applies received configuration without source mutation", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    expect(drawingCanvasProps.canvasGridSettings).toEqual({ enabled: true, spacingMm: 10, majorEvery: 5, snapEnabled: false });
    const sourceBefore = useCadDocumentStore.getState().sourceText;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasGridConfiguration",
          settings: { enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true }
        }
      }));
    });

    expect(drawingCanvasProps.canvasGridSettings).toEqual({ enabled: false, spacingMm: 2.5, majorEvery: 1, snapEnabled: true });
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
  });

  it("keeps exact-name layer visibility through source edit, Undo and Redo, and resets on document replacement", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    const source = "nui 1\nlayer seam\npoint P in @seam = coordinate(x: 0, y: 0)";
    const editedSource = `${source}\n// harmless edit`;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    expect(useCadUiStore.getState().hiddenCanvasLayerIds).toEqual(new Set());

    const projectedDraft = () => {
      const documentState = useCadDocumentStore.getState();
      const presentation = projectCanvasLayerPresentation({
        compiledDocument: documentState.doc,
        moduleMaterialization: documentState.doc.moduleMaterialization,
        elements: documentState.elements,
        evaluation: { computedGeometry: new Map(), errors: [], warnings: [] },
        hiddenLayerIds: useCadUiStore.getState().hiddenCanvasLayerIds
      });
      const layer = presentation.layers.find((candidate) => candidate.name === "seam");
      const drawable = documentState.elements.find((element) => element.name === "P");
      if (!layer || !drawable) throw new Error("Expected projected seam layer and P drawable");
      return {
        layerId: layer.id,
        sourceIdentity: documentState.doc.document.sourceLayerDeclarations?.find((declaration) => declaration.name === "seam")?.identity,
        visibleElementIds: canvasLayerVisibleElementIds(new Set([drawable.id]), presentation)
      };
    };
    const initialProjection = projectedDraft();
    expect(initialProjection.visibleElementIds).toEqual(new Set([useCadDocumentStore.getState().elements.find((element) => element.name === "P")!.id]));
    useCadUiStore.getState().toggleCanvasLayerVisibility(initialProjection.layerId);
    expect(projectedDraft().visibleElementIds).toEqual(new Set());

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: editedSource, documentVersion: 2, reason: "edit" }
      }));
    });
    expect(useCadUiStore.getState().hiddenCanvasLayerIds).toEqual(new Set([initialProjection.layerId]));
    expect(projectedDraft().layerId).toBe(initialProjection.layerId);
    expect(projectedDraft().visibleElementIds).toEqual(new Set());

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 3, reason: "undo" }
      }));
    });
    const undoProjection = projectedDraft();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadUiStore.getState().hiddenCanvasLayerIds).toEqual(new Set([initialProjection.layerId]));
    expect(undoProjection.sourceIdentity).toBe(initialProjection.sourceIdentity);
    expect(undoProjection.layerId).toBe(initialProjection.layerId);
    expect(undoProjection.visibleElementIds).toEqual(new Set());

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: editedSource, documentVersion: 4, reason: "redo" }
      }));
    });
    const redoProjection = projectedDraft();
    expect(useCadDocumentStore.getState().sourceText).toBe(editedSource);
    expect(useCadUiStore.getState().hiddenCanvasLayerIds).toEqual(new Set([initialProjection.layerId]));
    expect(redoProjection.layerId).toBe(initialProjection.layerId);
    expect(redoProjection.visibleElementIds).toEqual(new Set());

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 5 }
      }));
    });
    expect(useCadUiStore.getState().hiddenCanvasLayerIds).toEqual(new Set());
    expect(projectedDraft().visibleElementIds).toHaveLength(1);
  });

  it("routes Canvas Ribbon Grid Snap through the typed Extension Host message", () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    drawingCanvasProps.onToggleCanvasGridSnap?.();

    expect(api.postMessage).toHaveBeenCalledWith({ type: "toggleCanvasGridSnap" });
  });

  it("routes Canvas Grid Ribbon actions through typed Extension Host messages", () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    api.postMessage.mockClear();

    drawingCanvasProps.onToggleCanvasGrid?.();
    drawingCanvasProps.onConfigureCanvasGrid?.();

    expect(api.postMessage).toHaveBeenNthCalledWith(1, { type: "toggleCanvasGrid" });
    expect(api.postMessage).toHaveBeenNthCalledWith(2, { type: "configureCanvasGrid" });
  });

  it.each([
    ["ja", "Canvas上にポインターを置いてから実行してください。"],
    ["en", "Place the pointer on the Canvas before running this command."]
  ] as const)("localizes invalid Canvas pointer errors for the %s host without changing rejection behavior", async (language, expectedError) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewPresentation", presentation: webviewPresentationFor(language) }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 601,
          documentVersion: 7,
          pointer: { x: Number.NaN, y: 2 },
          sourcePosition: { line: 0, character: 0 }
        }
      }));
    });

    expect(useCadUiStore.getState().commandErrorMessage).toBe(expectedError);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasFreePointAtPointerResult",
      requestId: 601,
      status: "rejected",
      documentVersion: 7
    });
  });

  it("acknowledges duplicate coordinate-creation starts as ignored with their exact request identity", async () => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: "nui 1\npoint A = coordinate(x: 0, y: 0)",
          documentVersion: 4,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCoordinatePointCreationStart",
          requestId: 16531,
          documentVersion: 4,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCoordinatePointCreationStart",
          requestId: 16532,
          documentVersion: 4,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: 16531,
      documentVersion: 4,
      status: "started"
    }));
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: 16532,
      documentVersion: 4,
      status: "ignored"
    });
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
  });

  it("accepts a graph/runtime source revision that differs from the Webview compiler revision", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7, hostDocumentUri: "file:///workspace/root.nui" }
      }));
    });

    const webviewSourceRevision = useCadDocumentStore.getState().currentSourceRevision;
    expect(webviewSourceRevision).not.toBe(37);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: multiDocumentRuntimePublicationFor(
          source,
          7,
          37,
          37,
          useCadDocumentStore.getState().elements
        )
      }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation).not.toBeNull();
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootSourceRevision).toBe(37);
  });

  it.each(["A", "D", "E", "F"] as const)("selects the current Host root runtime for imported record case %s", async (testCase) => {
    const source = issue1609RootSourceFor(testCase);
    const actualEvaluationContext = await vi.importActual<typeof import("../geometry/productionEvaluationContext")>(
      "../geometry/productionEvaluationContext"
    );
    let fixture: Awaited<ReturnType<typeof issue1609HostPublicationFor>>;
    buildEvaluationOptionsMock.mockImplementation(actualEvaluationContext.buildEvaluationOptions as never);
    try {
      fixture = await issue1609HostPublicationFor(source);
    } finally {
      buildEvaluationOptionsMock.mockImplementation(() => ({}));
    }
    const recordAnalysis = fixture.compiled.sourceLexicalNamespace?.recordSemanticAnalysis;
    const settings = [...(recordAnalysis?.valuesByStatementId.values() ?? [])]
      .find((value) => value.name === "settings");
    const importedDefinitionIds = new Set(
      [...fixture.compiled.moduleRuntimeContext!.graph.nodes.values()]
        .filter((node) => node.documentId !== fixture.compiled.moduleRuntimeContext!.rootDocumentId)
        .flatMap((node) => [...(node.artifact.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId.keys() ?? [])])
    );
    expect(settings?.typeReference.typeIdentity).toBeTruthy();
    expect(importedDefinitionIds.has(settings?.typeReference.typeIdentity ?? "")).toBe(true);

    const hostElements = fixture.canvasRuntime.preparedRustEvaluation.input.elements;
    const expectedElementName = testCase === "A" ? "Seam" : "Control";
    const expectedLabel = testCase === "A" ? "seam width = ${@seam_width}" : "control = 50";
    expect(fixture.canvasRuntime.preparedRustEvaluation.rustEligible).toBe(true);
    expect(hostElements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "line", name: expectedElementName }),
      expect.objectContaining({ type: "text", text: expectedLabel })
    ]));

    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: source,
          documentVersion: fixture.documentVersion,
          hostDocumentUri: fixture.rootDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: fixture.publication }));
    });

    expect(evaluationTransportCapture.local).toBeNull();
    expect(fixture.canvasRuntime.rootOnly).toBe(true);
    expect(fixture.canvasRuntime.identityOnly).not.toBe(true);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.elements).toEqual(hostElements);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.sourceEditing?.sourceText).toBe(source);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.sourceEditing?.sourceRevision).toBe(fixture.sourceRevision);
    expect(fixture.canvasRuntime.modulePresentation.revealMaterialization).toBeUndefined();
    expect(fixture.canvasRuntime.modulePresentation.origins).toEqual([]);
    expect(fixture.canvasRuntime.modulePresentation.instanceBaseGeometrySnapshots).toEqual([]);

    const selectedHostElement = hostElements.find((element) => element.name === expectedElementName);
    expect(selectedHostElement).toBeDefined();
    if (!selectedHostElement) return;
    const sourceEditing = drawingCanvasProps.multiDocumentRuntimePresentation?.sourceEditing;
    expect(sourceEditing).toBeDefined();
    if (!sourceEditing) return;
    expect(queryDslCanvasSourceDefinition({
      source: {
        normalizedSource: source,
        sourceRevision: fixture.sourceRevision
      },
      compiled: sourceEditing.compiled,
      runtimeElementId: selectedHostElement.id
    })).toEqual({
      from: source.indexOf(`${expectedElementName} =`),
      to: source.indexOf(`${expectedElementName} =`) + expectedElementName.length
    });
    useCadUiStore.setState({
      selectedElementId: selectedHostElement.id,
      selectedElementIds: [selectedHostElement.id],
      selectionAnchorElementId: selectedHostElement.id
    });
    api.postMessage.mockClear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasSourceDefinitionRequest", requestId: 16090 + (testCase === "F" ? 1 : 0) }
      }));
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasSourceDefinitionResult",
      requestId: 16090 + (testCase === "F" ? 1 : 0),
      documentVersion: fixture.documentVersion,
      runtimeElementId: selectedHostElement.id,
      range: {
        from: source.indexOf(`${expectedElementName} =`),
        to: source.indexOf(`${expectedElementName} =`) + expectedElementName.length
      }
    });
  });

  it("keeps an unused import on local Canvas evaluation", async () => {
    const source = issue1609RootSourceFor("B");
    const actualEvaluationContext = await vi.importActual<typeof import("../geometry/productionEvaluationContext")>(
      "../geometry/productionEvaluationContext"
    );
    let fixture: Awaited<ReturnType<typeof issue1609HostPublicationFor>>;
    buildEvaluationOptionsMock.mockImplementation(actualEvaluationContext.buildEvaluationOptions as never);
    try {
      fixture = await issue1609HostPublicationFor(source);
    } finally {
      buildEvaluationOptionsMock.mockImplementation(() => ({}));
    }
    expect(fixture.canvasRuntime.identityOnly).toBe(true);
    expect(fixture.canvasRuntime.rootOnly).not.toBe(true);
    const importedDefinitionIds = new Set(
      [...fixture.compiled.moduleRuntimeContext!.graph.nodes.values()]
        .filter((node) => node.documentId !== fixture.compiled.moduleRuntimeContext!.rootDocumentId)
        .flatMap((node) => [...(node.artifact.sourceLexicalNamespace?.recordSemanticAnalysis?.definitionsByStatementId.keys() ?? [])])
    );
    expect([...fixture.compiled.sourceLexicalNamespace!.recordSemanticAnalysis!.valuesByStatementId.values()]
      .some((value) => value.typeReference.typeIdentity !== null && importedDefinitionIds.has(value.typeReference.typeIdentity)))
      .toBe(false);

    render(<VSCodeAppForTest api={{ postMessage: vi.fn() }} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: source,
          documentVersion: fixture.documentVersion,
          hostDocumentUri: fixture.rootDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: fixture.publication }));
    });
    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
    expect(evaluationTransportCapture.local).toBeTypeOf("function");
  });

  it("keeps a same-file nominal record on ordinary local evaluation", async () => {
    const source = issue1609RootSourceFor("C");
    const compiled = compileFreshCanonicalText(source).doc;
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(compiled.document.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "line", name: "Seam" })
    ]));

    render(<VSCodeAppForTest api={{ postMessage: vi.fn() }} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 18 }
      }));
    });
    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
    expect(evaluationTransportCapture.local).toBeTypeOf("function");
  });

  it("drops a root-only runtime across source switch and reopen until a fresh graph matches", async () => {
    const source = issue1609RootSourceFor("A");
    const actualEvaluationContext = await vi.importActual<typeof import("../geometry/productionEvaluationContext")>(
      "../geometry/productionEvaluationContext"
    );
    let initial: Awaited<ReturnType<typeof issue1609HostPublicationFor>>;
    buildEvaluationOptionsMock.mockImplementation(actualEvaluationContext.buildEvaluationOptions as never);
    try {
      initial = await issue1609HostPublicationFor(source);
    } finally {
      buildEvaluationOptionsMock.mockImplementation(() => ({}));
    }
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => window.dispatchEvent(new MessageEvent("message", { data })));
    };

    await send({
      type: "replaceTextDocument",
      sourceText: source,
      documentVersion: initial.documentVersion,
      hostDocumentUri: initial.rootDocumentUri
    });
    await send(initial.publication);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootOnly).toBe(true);

    const selectedHostElement = initial.canvasRuntime.preparedRustEvaluation.input.elements
      .find((element) => element.name === "Seam");
    expect(selectedHostElement).toBeDefined();
    if (!selectedHostElement) return;
    act(() => {
      useCadUiStore.setState({
        selectedElementId: selectedHostElement.id,
        selectedElementIds: [selectedHostElement.id],
        selectionAnchorElementId: selectedHostElement.id
      });
      useCadDocumentStore.getState().commitText(`${source}\n// newer local Source`, "test");
    });
    api.postMessage.mockClear();
    await send({ type: "canvasSourceDefinitionRequest", requestId: 16092 });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasSourceDefinitionResult",
      requestId: 16092,
      documentVersion: initial.documentVersion,
      runtimeElementId: null,
      range: null
    });

    await send({
      type: "replaceTextDocument",
      sourceText: "nui 1\nline Local = segment(start: (0, 0), end: (10, 0))",
      documentVersion: 18,
      hostDocumentUri: "file:///workspace/other-root.nui"
    });
    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();

    await send({
      type: "replaceTextDocument",
      sourceText: source,
      documentVersion: 19,
      hostDocumentUri: initial.rootDocumentUri
    });
    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();

    let reopened: Awaited<ReturnType<typeof issue1609HostPublicationFor>>;
    buildEvaluationOptionsMock.mockImplementation(actualEvaluationContext.buildEvaluationOptions as never);
    try {
      reopened = await issue1609HostPublicationFor(source, {
        documentVersion: 19,
        graphRevision: 43,
        sourceRevision: 2
      });
    } finally {
      buildEvaluationOptionsMock.mockImplementation(() => ({}));
    }
    await send(reopened.publication);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootOnly).toBe(true);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.graphRevision).toBe(43);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootSourceRevision).toBe(2);
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.sourceEditing?.compiled.spans.sourceMap.sourceRevision)
      .toBe(2);
    expect(evaluationTransportCapture.local).toBeNull();
  });

  it.each([
    ["A", true],
    ["B", true],
    ["C", true],
    ["D", true]
  ] as const)("#1651 exact-Base reproduction case %s coordinate creation start", async (testCase, starts) => {
    const api = { postMessage: vi.fn() };
    const source = issue1651RootSourceFor(testCase);
    const importedFixture = testCase === "D"
      ? await buildIssue1651ImportedModuleCanvasEditFixture(false)
      : null;
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: source,
          documentVersion: issue1651DocumentVersion,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
      if (importedFixture) {
        window.dispatchEvent(new MessageEvent("message", {
          data: importedFixture.publication
        }));
      }
    });

    const localState = useCadDocumentStore.getState();
    expect(localState.sourceText).toBe(source);
    expect(localState.currentCompiled.spans.sourceMap.source).toBe(source);
    expect(localState.currentCompiled.spans.sourceMap.sourceRevision).toBe(localState.currentSourceRevision);
    if (testCase === "D") {
      expect(evaluationTransportCapture.multiDocument).toBeTypeOf("function");
      expect(evaluationTransportCapture.local).toBeNull();
      expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootDocumentId).toBe(issue1651RootDocumentUri);
      const graphPoint = importedFixture!.runtimePresentation.elements.find(element => element.name === "A");
      expect(graphPoint).toBeDefined();
      if (!graphPoint) return;
      const graphOwner = sourceOwnerForRuntimeElementId(importedFixture!.compiled, graphPoint.id);
      expect(graphOwner?.kind).toBe("ordinary");
      expect(graphOwner).not.toHaveProperty("sourceDocumentId");
      expect(graphOwner?.sourceStatementIndex).toBe(importedFixture!.compiled.statements.findIndex(statement =>
        statement.kind === "element" && statement.name === "A"
      ));
      const localPoint = localState.currentCompiled.sourceElementsByStatementIndex.get(graphOwner!.sourceStatementIndex);
      expect(localPoint?.id).not.toBe(graphPoint.id);
      expect(localState.docText).not.toBe(source);
      expect(effectiveCompiledDocument(localState).spans.sourceMap.source).toBe(localState.docText);
      expect(effectiveCompiledDocument(localState).spans.sourceMap.source).not.toBe(source);
    }

    api.postMessage.mockClear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCoordinatePointCreationStart", requestId: 16510, documentVersion: issue1651DocumentVersion, hostDocumentUri: issue1651RootDocumentUri }
      }));
    });

    const creationStates = api.postMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message?.type === "canvasCoordinatePointCreationState");
    expect(creationStates.some(message => message.active === true)).toBe(starts);
    if (!starts) {
      expect(creationStates).toEqual([]);
      expect(localState.docText).not.toBe(source);
      expect(drawingCanvasProps.multiDocumentRuntimePresentation?.elements.map(element => element.id))
        .toContain(importedFixture!.runtimePresentation.elements.find(element => element.name === "A")?.id);
    }
  });

  it("uses the Host start version when the latest document version is unavailable for mode OFF", () => {
    expect(coordinatePointCreationOffDocumentVersionFor(null, 27)).toBe(27);
    expect(coordinatePointCreationOffDocumentVersionFor(28, 27)).toBe(28);
  });

  it("sends ON and Finish/Esc OFF for the accepted Host mode run and accepts a fresh run afterward", async () => {
    const api = { postMessage: vi.fn() };
    const source = "nui 1\n";
    const hostDocumentUri = "file:///workspace/coordinate-point-run.nui";
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion: 23, hostDocumentUri });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16670,
      documentVersion: 23,
      hostDocumentUri
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: 16670,
      documentVersion: 23
    });
    expect(drawingCanvasProps.onFinishCoordinatePointCreation).not.toBeNull();

    await send({
      type: "commitText",
      sourceText: `${source}// newer Host Source\n`,
      documentVersion: 24,
      hostDocumentUri,
      reason: "edit"
    });
    api.postMessage.mockClear();
    await act(async () => drawingCanvasProps.onFinishCoordinatePointCreation?.());
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasCoordinatePointCreationState",
      active: false,
      modeRunId: 16670,
      documentVersion: 24
    });

    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16671,
      documentVersion: 24,
      hostDocumentUri
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasCoordinatePointCreationState",
      active: true,
      modeRunId: 16671,
      documentVersion: 24
    });
  });

  it("inserts at the current imported-document Source anchor through an exact text insertion", async () => {
    const api = { postMessage: vi.fn() };
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    render(<VSCodeAppForTest api={api} />);
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

    const before = useCadDocumentStore.getState();
    expect(before.currentCompiled.document).toBeNull();
    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.sourceEditing?.sourceText).toBe(fixture.source);
    api.postMessage.mockClear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 1651,
          documentVersion: issue1651DocumentVersion,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 6, character: fixture.source.split("\n")[6]?.length ?? 0 }
        }
      }));
    });

    const after = useCadDocumentStore.getState();
    expect(after.sourceText).toContain("point A = coordinate(x: 0, y: 0)");
    expect(after.sourceText).toContain([
      "point = coordinate(",
      "  x: 12.5,",
      "  y: -8,",
      ")"
    ].join("\n"));
    expect(after.sourceText.slice(0, fixture.source.length)).toBe(fixture.source);
    expect(after.sourceUpdate.kind).toBe("text-insertion");
    if (after.sourceUpdate.kind !== "text-insertion") throw new Error("missing text-insertion Source update");
    expect(after.currentCompiled.spans.sourceMap.source).toBe(after.sourceText);
    expect(after.currentCompiled.document).toBeNull();
    expect(after.docText).not.toBe(after.sourceText);
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      operationId: 1651,
      expectedDocumentVersion: issue1651DocumentVersion,
      graphAuthority: {
        rootDocumentId: fixture.publication.graph.rootDocumentId,
        graphRevision: fixture.publication.graph.revision
      },
      mutationKind: "text-insertion",
      sourceText: after.sourceText,
      textInsertion: {
        originalSourceText: after.sourceUpdate.originalSourceText,
        offset: after.sourceUpdate.offset,
        insertedText: after.sourceUpdate.insertedText
      }
    }));
    act(() => useCadDocumentStore.getState().undo());
    expect(useCadDocumentStore.getState().sourceText).toBe(fixture.source);
    act(() => useCadDocumentStore.getState().redo());
    expect(useCadDocumentStore.getState().sourceText).toBe(after.sourceText);
  });

  it.each(["A", "C"] as const)("inserts one #1664 Case %s coordinate point at its explicit Source anchor", async (caseName) => {
    const fixture = issue1664CoordinatePointCreationCases[caseName];
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };
    const messagesOfType = (type: string) => api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === type);
    const requestId = caseName === "A" ? 16641 : 16643;

    await send({
      type: "replaceTextDocument",
      sourceText: fixture.source,
      documentVersion: fixture.documentVersion,
      hostDocumentUri: fixture.rootUri
    });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId,
      documentVersion: fixture.documentVersion,
      hostDocumentUri: fixture.rootUri
    });
    expect(messagesOfType("canvasCoordinatePointCreationStartResult")).toContainEqual(expect.objectContaining({
      type: "canvasCoordinatePointCreationStartResult",
      requestId,
      status: "started"
    }));

    await act(async () => {
      drawingCanvasProps.postCoordinatePointCreationClick?.({ x: -124.3125, y: -207.3125 });
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasCoordinatePointCreationClick",
      modeRunId: requestId,
      documentVersion: fixture.documentVersion,
      pointer: { x: -124.3125, y: -207.3125 }
    });

    await send({
      type: "canvasFreePointAtPointer",
      requestId: requestId + 1,
      documentVersion: fixture.documentVersion,
      pointer: { x: -124.3125, y: -207.3125 },
      sourcePosition: { documentVersion: fixture.documentVersion, ...fixture.sourceAnchor }
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource).not.toBe(fixture.source);
    expect(committedSource).toContain("point A = coordinate(x: 0, y: 0)");
    expect(committedSource.match(/point = coordinate\(/g)).toHaveLength(1);
    expect(committedSource.indexOf("point = coordinate(")).toBeGreaterThan(
      committedSource.indexOf("point A = coordinate(x: 0, y: 0)")
    );
    expect(committedSource.indexOf("point = coordinate(")).toBeLessThan(
      committedSource.indexOf("point B = coordinate(x: 1, y: 1)")
    );
    const commit = messagesOfType("canvasCommit").find((message) => message?.operationId === requestId + 1);
    expect(commit).toMatchObject({
      type: "canvasCommit",
      expectedDocumentVersion: fixture.documentVersion,
      hostDocumentUri: fixture.rootUri,
      sourceText: committedSource
    });
    expect(commit).not.toHaveProperty("graphAuthority");

    await send({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: fixture.documentVersion + 1,
      hostDocumentUri: fixture.rootUri,
      reason: "edit"
    });
    await send({
      type: "canvasCommitResult",
      operationId: requestId + 1,
      status: "accepted",
      documentVersion: fixture.documentVersion + 1
    });
    expect(messagesOfType("canvasFreePointAtPointerResult")).toContainEqual(expect.objectContaining({
      type: "canvasFreePointAtPointerResult",
      requestId: requestId + 1,
      status: "applied",
      documentVersion: fixture.documentVersion + 1
    }));
  });

  it("inserts a #1664 coordinate point at the explicit physical Source line boundary", async () => {
    const api = { postMessage: vi.fn() };
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 1, y: 1)";
    const documentVersion = 17;
    const hostDocumentUri = "file:///workspace/explicit-caret.nui";
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16655,
      documentVersion,
      hostDocumentUri
    });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16656,
      documentVersion,
      pointer: { x: 4, y: 7 },
      sourcePosition: { documentVersion, line: 1, character: 0 }
    });

    expect(useCadDocumentStore.getState().sourceText).toBe([
      "nui 1",
      "point = coordinate(",
      "  x: 4,",
      "  y: 7,",
      ")",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n"));
  });

  it("preserves an exact UTF-16 mid-line caret insertion in #1664 Source", async () => {
    const api = { postMessage: vi.fn() };
    const declarationLine = "point A = coordinate(x: 0, y: 0) // 🧵tail";
    const source = `nui 1\n${declarationLine}\npoint B = coordinate(x: 1, y: 1)`;
    const documentVersion = 19;
    const hostDocumentUri = "file:///workspace/mid-line-caret.nui";
    const character = declarationLine.indexOf("tail");
    const offset = "nui 1\n".length + character;
    const declaration = [
      "point = coordinate(",
      "  x: 6,",
      "  y: -3,",
      ")"
    ].join("\n");
    const expectedSource = `${source.slice(0, offset)}\n${declaration}\n${source.slice(offset)}`;
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16659,
      documentVersion,
      hostDocumentUri
    });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16660,
      documentVersion,
      pointer: { x: 6, y: -3 },
      sourcePosition: { documentVersion, line: 1, character }
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(expectedSource);
    const insertedText = `\n${declaration}\n`;
    expect(expectedSource.slice(0, offset) + expectedSource.slice(offset + insertedText.length)).toBe(source);
    expect(useCadDocumentStore.getState().docText).not.toBe(expectedSource);
  });

  it("inserts at an explicit #1664 caret at the physical line end", async () => {
    const api = { postMessage: vi.fn() };
    const line = "point A = coordinate(x: 0, y: 0)";
    const source = `nui 1\n${line}\npoint B = coordinate(x: 1, y: 1)`;
    const documentVersion = 20;
    const hostDocumentUri = "file:///workspace/line-end-caret.nui";
    const offset = "nui 1\n".length + line.length;
    const declaration = "point = coordinate(\n  x: 2,\n  y: 3,\n)";
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16661,
      documentVersion,
      pointer: { x: 2, y: 3 },
      sourcePosition: { documentVersion, line: 1, character: line.length }
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(`${source.slice(0, offset)}\n${declaration}${source.slice(offset)}`);
  });

  it.each([
    ["without trailing newline", "nui 1\npoint A = coordinate(x: 0, y: 0)"],
    ["with trailing newline", "nui 1\npoint A = coordinate(x: 0, y: 0)\n"]
  ])("appends a #1664 coordinate point to root EOF %s", async (_label, source) => {
    const api = { postMessage: vi.fn() };
    const documentVersion = 21;
    const hostDocumentUri = "file:///workspace/eof-caret.nui";
    const declaration = "point = coordinate(\n  x: -5,\n  y: 11,\n)";
    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 16662,
          documentVersion,
          pointer: { x: -5, y: 11 },
          sourcePosition: {
            documentVersion,
            line: source.split("\n").length - 1,
            character: source.split("\n").at(-1)!.length
          }
        }
      }));
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource.startsWith(source)).toBe(true);
    expect(committedSource.slice(source.length)).toContain(declaration);
  });

  it("preserves mixed LF and CRLF characters around an explicit #1664 caret", async () => {
    const api = { postMessage: vi.fn() };
    const line = "point A = coordinate(x: 0, y: 0)";
    const source = `nui 1\r\n${line}\npoint B = coordinate(x: 1, y: 1)\r\n`;
    const documentVersion = 22;
    const hostDocumentUri = "file:///workspace/mixed-lines.nui";
    const character = line.indexOf("y: 0");
    const offset = source.indexOf(line) + character;
    const declaration = "point = coordinate(\n  x: 8,\n  y: 13,\n)";
    const expectedSource = `${source.slice(0, offset)}\n${declaration}\n${source.slice(offset)}`;
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16663,
      documentVersion,
      pointer: { x: 8, y: 13 },
      sourcePosition: { documentVersion, line: 1, character }
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(expectedSource);
  });

  it("falls back to current root EOF for a stale #1664 Source caret version", async () => {
    const api = { postMessage: vi.fn() };
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 1, y: 1)";
    const documentVersion = 18;
    const hostDocumentUri = "file:///workspace/stale-caret.nui";
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16657,
      documentVersion,
      hostDocumentUri
    });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16658,
      documentVersion,
      pointer: { x: 9, y: -2 },
      sourcePosition: { documentVersion: documentVersion - 1, line: 1, character: 0 }
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource.startsWith(source)).toBe(true);
    expect(committedSource.slice(source.length)).toContain("point = coordinate(");
    expect(committedSource.indexOf("point = coordinate(")).toBeGreaterThan(
      committedSource.indexOf("point B = coordinate(x: 1, y: 1)")
    );
  });

  it("appends a coordinate point to exact current root text while Source is mid-syntax-edit", async () => {
    const api = { postMessage: vi.fn() };
    const hostDocumentUri = "file:///workspace/in-progress.nui";
    const source = "nui 1\npoint Broken = coordinate(x: )";
    const documentVersion = 5;
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };

    await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: 16645,
      documentVersion,
      hostDocumentUri
    });
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCoordinatePointCreationStartResult",
      requestId: 16645,
      status: "started"
    }));

    await send({
      type: "canvasFreePointAtPointer",
      requestId: 16646,
      documentVersion,
      pointer: { x: 12.5, y: -8 },
      sourcePosition: { documentVersion, line: 1, character: source.split("\n")[1]!.length }
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource.startsWith(source)).toBe(true);
    expect(committedSource.slice(source.length)).toContain("point = coordinate(");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      operationId: 16646,
      expectedDocumentVersion: documentVersion,
      hostDocumentUri,
      sourceText: committedSource
    }));
    await send({
      type: "commitText",
      sourceText: committedSource,
      documentVersion: documentVersion + 1,
      hostDocumentUri,
      reason: "edit"
    });
    await send({
      type: "canvasCommitResult",
      operationId: 16646,
      status: "accepted",
      documentVersion: documentVersion + 1
    });
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasFreePointAtPointerResult",
      requestId: 16646,
      status: "applied"
    }));
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
  });

  it.each(["B", "D"] as const)("keeps #1664 imported Module Case %s edits on the Host root Source", async (caseName) => {
    const api = { postMessage: vi.fn() };
    const importedFixture = caseName === "D"
      ? await buildIssue1651ImportedModuleCanvasEditFixture(false)
      : null;
    const source = importedFixture?.source ?? issue1651RootSourceFor("B");
    const sourcePosition = caseName === "D"
      ? { line: 5, character: 0 }
      : { line: 3, character: 0 };
    render(<VSCodeAppForTest api={api} />);
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };
    await send({
      type: "replaceTextDocument",
      sourceText: source,
      documentVersion: issue1651DocumentVersion,
      hostDocumentUri: issue1651RootDocumentUri
    });
    if (importedFixture) await send(importedFixture.publication);
    await send({
      type: "canvasCoordinatePointCreationStart",
      requestId: caseName === "B" ? 16647 : 16649,
      documentVersion: issue1651DocumentVersion,
      hostDocumentUri: issue1651RootDocumentUri
    });
    await send({
      type: "canvasFreePointAtPointer",
      requestId: caseName === "B" ? 16648 : 16650,
      documentVersion: issue1651DocumentVersion,
      pointer: { x: 25, y: -12 },
      sourcePosition: { documentVersion: issue1651DocumentVersion, ...sourcePosition }
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource).toContain("point = coordinate(");
    expect(committedSource).toContain("point A = coordinate(x: 0, y: 0)");
    expect(committedSource).toContain("import \"./module_test_lib.nui\" as lib");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      expectedDocumentVersion: issue1651DocumentVersion,
      hostDocumentUri: issue1651RootDocumentUri,
      sourceText: committedSource
    }));
    if (caseName === "D") {
      expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "canvasCommit",
        graphAuthority: {
          rootDocumentId: importedFixture!.publication.graph.rootDocumentId,
          graphRevision: importedFixture!.publication.graph.revision
        }
      }));
      expect(committedSource).not.toContain(importedFixture!.librarySource);
    } else {
      expect(api.postMessage.mock.calls.map(([message]) => message)
        .filter((message) => message?.type === "canvasCommit")
        .every((message) => !Object.hasOwn(message, "graphAuthority"))).toBe(true);
    }
  });

  it.each(["foreign Host URI", "foreign graph root", "document version conflict"] as const)(
    "rejects #1664 %s conflicts with visible feedback and unchanged root Source",
    async (failure) => {
      const api = { postMessage: vi.fn() };
      const importedFixture = failure === "foreign graph root"
        ? await buildIssue1651ImportedModuleCanvasEditFixture(false)
        : null;
      const source = importedFixture?.source ?? "nui 1\npoint A = coordinate(x: 0, y: 0)\n";
      const hostDocumentUri = importedFixture ? issue1651RootDocumentUri : "file:///workspace/root.nui";
      const documentVersion = importedFixture ? issue1651DocumentVersion : 1;
      render(<VSCodeAppForTest api={api} />);
      const send = async (data: unknown) => {
        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", { data }));
        });
      };
      await send({ type: "replaceTextDocument", sourceText: source, documentVersion, hostDocumentUri });
      if (importedFixture) {
        const foreignPublication = structuredClone(importedFixture.publication);
        const foreignRootUri = "file:///workspace/other-root.nui";
        foreignPublication.hostDocumentUri = foreignRootUri;
        foreignPublication.graph.rootDocumentId = foreignRootUri;
        foreignPublication.graph.rootSource.documentId = foreignRootUri;
        await send(foreignPublication);
      }

      if (failure === "document version conflict") {
        await send({
          type: "canvasFreePointAtPointer",
          requestId: 16652,
          documentVersion: documentVersion + 1,
          pointer: { x: 5, y: -3 },
          sourcePosition: { documentVersion: documentVersion + 1, line: 1, character: 0 }
        });
        expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
          type: "canvasFreePointAtPointerResult",
          requestId: 16652,
          status: "rejected"
        }));
      } else {
        await send({
          type: "canvasCoordinatePointCreationStart",
          requestId: 16653,
          documentVersion,
          hostDocumentUri: failure === "foreign Host URI" ? "file:///workspace/other.nui" : hostDocumentUri
        });
        expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
          type: "canvasCoordinatePointCreationStartResult",
          requestId: 16653,
          status: "rejected"
        }));
      }

      expect(useCadDocumentStore.getState().sourceText).toBe(source);
      expect(api.postMessage.mock.calls.map(([message]) => message).filter((message) => message?.type === "canvasCommit"))
        .toEqual([]);
      expect(useCadUiStore.getState().commandErrorMessage).not.toBeNull();
    }
  );

  it("rejects stale document versions and patches from exact Host Source when the graph Source projection drifts", async () => {
    const api = { postMessage: vi.fn() };
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    const stalePublication = structuredClone(fixture.publication);
    const sourceEditing = stalePublication.canvasRuntime?.modulePresentation.sourceEditing;
    if (!sourceEditing) throw new Error("missing Issue 1651 source-editing projection");
    sourceEditing.sourceText = `${fixture.source}\n// stale graph Source`;
    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: fixture.source,
          documentVersion: issue1651DocumentVersion,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: stalePublication }));
    });
    api.postMessage.mockClear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCoordinatePointCreationStart", requestId: 16511, documentVersion: issue1651DocumentVersion, hostDocumentUri: issue1651RootDocumentUri }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCoordinatePointCreationStart", requestId: 16512, documentVersion: issue1651DocumentVersion + 1, hostDocumentUri: issue1651RootDocumentUri }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 1652,
          documentVersion: issue1651DocumentVersion + 1,
          pointer: { x: 1, y: 2 },
          sourcePosition: { line: 6, character: fixture.source.split("\n")[6]?.length ?? 0 }
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 1653,
          documentVersion: issue1651DocumentVersion,
          pointer: { x: 1, y: 2 },
          sourcePosition: { line: 6, character: fixture.source.split("\n")[6]?.length ?? 0 }
        }
      }));
    });

    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource).not.toBe(fixture.source);
    expect(committedSource.startsWith(fixture.source)).toBe(true);
    const commits = api.postMessage.mock.calls.map(([message]) => message).filter(message => message?.type === "canvasCommit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      hostDocumentUri: issue1651RootDocumentUri,
      expectedDocumentVersion: issue1651DocumentVersion,
      sourceText: committedSource
    });
    expect(commits[0]).not.toHaveProperty("graphAuthority");
    expect(api.postMessage.mock.calls.map(([message]) => message).filter(message => message?.type === "canvasFreePointAtPointerResult"))
      .toEqual([expect.objectContaining({ requestId: 1652, status: "rejected", documentVersion: issue1651DocumentVersion })]);
  });

  it.each(["different URI", "stale documentVersion"] as const)(
    "#1651 rejects coordinate creation for %s with visible feedback and unchanged Source",
    async (failure) => {
      const api = { postMessage: vi.fn() };
      const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
      const hostSource = fixture.source;
      let requestedVersion = issue1651DocumentVersion;
      let publication: VscodeMultiDocumentGraphPublication = fixture.publication;
      if (failure === "different URI") {
        const otherDocumentGraph = await buildIssue1651ImportedModuleCanvasEditFixture(false, "file:///workspace/other-root.nui");
        publication = otherDocumentGraph.publication;
      } else if (failure === "stale documentVersion") {
        requestedVersion += 1;
      }

      render(<VSCodeAppForTest api={api} />);
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "replaceTextDocument",
            sourceText: hostSource,
            documentVersion: issue1651DocumentVersion,
            hostDocumentUri: issue1651RootDocumentUri
          }
        }));
        window.dispatchEvent(new MessageEvent("message", { data: publication }));
      });
      api.postMessage.mockClear();
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "canvasCoordinatePointCreationStart",
            requestId: 16520,
            documentVersion: requestedVersion,
            hostDocumentUri: issue1651RootDocumentUri
          }
        }));
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "canvasFreePointAtPointer",
            requestId: 16521,
            documentVersion: requestedVersion,
            pointer: { x: 4, y: 5 },
            sourcePosition: { line: 6, character: 0 }
          }
        }));
      });

      expect(useCadDocumentStore.getState().sourceText).toBe(hostSource);
      expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "canvasCoordinatePointCreationStartResult",
        requestId: 16520,
        status: "rejected",
        errorMessage: expect.any(String)
      }));
      expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: "canvasFreePointAtPointerResult",
        requestId: 16521,
        status: "rejected"
      }));
      expect(useCadUiStore.getState().commandErrorMessage).toEqual(expect.any(String));
      if (failure !== "stale documentVersion") {
        expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
      }
    }
  );

  it.each(["stale graph", "missing dependency", "invalid Source"] as const)(
    "inserts an independent point from current root Source with a %s",
    async (failure) => {
      const api = { postMessage: vi.fn() };
      const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
      const hostSource = failure === "invalid Source" ? `${fixture.source}\npoint Broken =` : fixture.source;
      let publication: VscodeMultiDocumentGraphPublication = fixture.publication;
      if (failure === "stale graph") {
        publication = {
          type: "multiDocumentGraphPublication",
          documentVersion: issue1651DocumentVersion,
          status: "invalidated",
          hostDocumentUri: issue1651RootDocumentUri,
          graph: null
        };
      } else if (failure === "missing dependency") {
        const invalid = structuredClone(fixture.publication);
        invalid.graph.valid = false;
        invalid.canvasRuntime = null;
        invalid.graph.diagnostics = [{
          code: "import-missing",
          message: "Missing imported Module dependency",
          location: { source: { kind: "root-current", documentId: issue1651RootDocumentUri, sourceRevision: 37 }, range: { from: 0, to: 1 } },
          relatedLocations: []
        }];
        publication = invalid;
      }

      render(<VSCodeAppForTest api={api} />);
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "replaceTextDocument",
            sourceText: hostSource,
            documentVersion: issue1651DocumentVersion,
            hostDocumentUri: issue1651RootDocumentUri
          }
        }));
        window.dispatchEvent(new MessageEvent("message", { data: publication }));
      });
      api.postMessage.mockClear();
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "canvasFreePointAtPointer",
            requestId: 16522,
            documentVersion: issue1651DocumentVersion,
            pointer: { x: 4, y: 5 },
            sourcePosition: { documentVersion: issue1651DocumentVersion, line: 999, character: 0 }
          }
        }));
      });

      const committedSource = useCadDocumentStore.getState().sourceText;
      expect(committedSource).not.toBe(hostSource);
      expect(committedSource.startsWith(hostSource)).toBe(true);
      expect(committedSource.slice(hostSource.length)).toContain("point = coordinate(");
      const commits = api.postMessage.mock.calls.map(([message]) => message)
        .filter((message) => message?.type === "canvasCommit");
      expect(commits).toHaveLength(1);
      expect(commits[0]).toMatchObject({
        hostDocumentUri: issue1651RootDocumentUri,
        expectedDocumentVersion: issue1651DocumentVersion,
        sourceText: committedSource
      });
      expect(commits[0]).not.toHaveProperty("graphAuthority");
      expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
    }
  );

  it("#1651 reports a rejected graph-backed Canvas commit without changing current Source", async () => {
    const api = { postMessage: vi.fn() };
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(false);
    render(<VSCodeAppForTest api={api} />);
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
    api.postMessage.mockClear();

    act(() => drawingCanvasProps.postCanvasCommit?.(-16519));
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommitResult",
          operationId: -16519,
          status: "rejected",
          documentVersion: issue1651DocumentVersion
        }
      }));
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(fixture.source);
    expect(useCadUiStore.getState().commandErrorMessage).toEqual(expect.any(String));
  });

  it("transfers the selected root runtime identity with its current Source range", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 20, y: 10)";
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    publishAllCurrentElementsAsPresented();
    const root = useCadDocumentStore.getState().elements.find((element) => element.name === "Root");
    expect(root).toBeDefined();
    if (!root) return;
    useCadUiStore.getState().setSelectedElementId(root.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasSourceDefinitionRequest", requestId: 9043 }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasSourceDefinitionResult",
      requestId: 9043,
      documentVersion: 7,
      runtimeElementId: root.id,
      range: {
        from: source.indexOf("Root"),
        to: source.indexOf("Root") + "Root".length
      }
    });
  });

  it("sends graph-projected Canvas IDs for imported roots even when local compile IDs differ", async () => {
    const source = [
      "nui 1",
      'import "./scalar-knot-probe.nui" as probe',
      "group test {",
      "  point A = coordinate(x: 0, y: 0)",
      "  point B = coordinate(x: 20, y: 0)",
      "  point M = coordinate(x: 10, y: 5)",
      "  const bulge: number(step: 0.1) = 4",
      "  curve C = bezier(",
      "    start: @A,",
      "    end: @B,",
      "    startAngle: 30,",
      "    startLength: @bulge,",
      "    endAngle: 150,",
      "    endLength: @bulge,",
      "    intermediates: [",
      "      knot(point: @M, angle: 0, incoming: @bulge, outgoing: @bulge),",
      "    ],",
      "  )",
      "}"
    ].join("\n");
    const graphCompiled = compileFreshCanonicalText(source).doc;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const localElements = useCadDocumentStore.getState().elements;
    const graphElements = graphCompiled.document.elements;
    const localPoint = localElements.find((element) => element.name === "A");
    const localCurve = localElements.find((element) => element.name === "C");
    const graphPoint = graphElements.find((element) => element.name === "A");
    const graphCurve = graphElements.find((element) => element.name === "C");
    expect(localPoint).toBeDefined();
    expect(localCurve).toBeDefined();
    expect(graphPoint).toBeDefined();
    expect(graphCurve).toBeDefined();
    if (!localPoint || !localCurve || !graphPoint || !graphCurve) return;
    expect(localPoint.id).not.toBe(graphPoint.id);
    expect(localCurve.id).not.toBe(graphCurve.id);

    const identityPublication = multiDocumentRuntimePublicationFor(
      source,
      7,
      37,
      37,
      graphElements
    );
    if (identityPublication.status !== "current" || !identityPublication.canvasRuntime) {
      throw new Error("missing graph identity publication fixture");
    }
    identityPublication.canvasRuntime.identityOnly = true;
    identityPublication.canvasRuntime.sourceElementRuntimeIdsByStatementIndex = [
      ...(graphCompiled.statementMap?.elementIdByStatementIndex ?? [])
    ];

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: identityPublication
      }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
    for (const [requestId, localElement, graphElement] of [
      [9044, localPoint, graphPoint],
      [9045, localCurve, graphCurve]
    ] as const) {
      useCadUiStore.setState({
        selectedElementId: localElement.id,
        selectedElementIds: [localElement.id],
        selectionAnchorElementId: localElement.id,
        selectionSubject: { kind: "elements" },
        canvasSelectionEligibleElementIds: new Set([localElement.id])
      });
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "canvasSourceDefinitionRequest", requestId }
        }));
      });
      expect(api.postMessage).toHaveBeenCalledWith({
        type: "canvasSourceDefinitionResult",
        requestId,
        documentVersion: 7,
        runtimeElementId: graphElement.id,
        range: {
          from: source.indexOf(`${localElement.name} =`),
          to: source.indexOf(`${localElement.name} =`) + localElement.name.length
        }
      });
    }

    useCadUiStore.setState({
      selectedElementId: "wrong-local-runtime-id",
      selectedElementIds: ["wrong-local-runtime-id"],
      selectionAnchorElementId: "wrong-local-runtime-id",
      selectionSubject: { kind: "elements" },
      canvasSelectionEligibleElementIds: new Set(["wrong-local-runtime-id"])
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasSourceDefinitionRequest", requestId: 9046 }
      }));
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasSourceDefinitionResult",
      requestId: 9046,
      documentVersion: 7,
      runtimeElementId: null,
      range: null
    });

    identityPublication.canvasRuntime.rootSourceRevision = 38;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: identityPublication }));
    });
    useCadUiStore.setState({
      selectedElementId: localPoint.id,
      selectedElementIds: [localPoint.id],
      selectionAnchorElementId: localPoint.id,
      selectionSubject: { kind: "elements" },
      canvasSelectionEligibleElementIds: new Set([localPoint.id])
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasSourceDefinitionRequest", requestId: 9047 }
      }));
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasSourceDefinitionResult",
      requestId: 9047,
      documentVersion: 7,
      runtimeElementId: null,
      range: {
        from: source.indexOf("A ="),
        to: source.indexOf("A =") + 1
      }
    });
  });

  it("reveals a genuine imported caller from graph runtime authority without local compiled-document currentness", async () => {
    const fixture = await buildImportedRevealFreshnessFixture();
    const publication = { ...fixture.publication, hostDocumentUri: fixture.publication.graph.rootDocumentId };
    const api = { postMessage: vi.fn() };
    const runtimeElements = fixture.runtimePresentation.elements;
    const runtimeGeometry = new Map(
      runtimeElements
        .filter((element) => element.type === "freePoint")
        .map((element, index) => [element.id, {
          kind: "point" as const,
          elementId: element.id,
          name: element.name,
          x: index,
          y: 0
        }])
    );
    drawingCanvasProps.evaluation = {
      computedGeometry: runtimeGeometry,
      preMutationGeometry: new Map(),
      instanceBaseGeometry: new Map(),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set(runtimeElements.map((element) => element.id)),
      effectiveEnabledElementIds: new Set(runtimeElements.map((element) => element.id)),
      effectiveVisibleElementIds: new Set(runtimeElements.map((element) => element.id))
    };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: importedRevealRootSource,
          documentVersion: importedRevealDocumentVersion,
          hostDocumentUri: publication.hostDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: publication
      }));
    });

    const webviewCompilerRevision = useCadDocumentStore.getState().currentSourceRevision;
    expect(webviewCompilerRevision).not.toBe(importedRevealGraphRootSourceRevision);
    const diagnosticState = useCadDocumentStore.getState();
    expect(diagnosticState.sourceText).toBe(importedRevealRootSource);
    expect(diagnosticState.doc.spans.sourceMap.source).not.toBe(importedRevealRootSource);
    expect(diagnosticState.currentSourceRevision).not.toBe(importedRevealGraphRootSourceRevision);
    const statementOwnerTarget = fixture.target;
    if (statementOwnerTarget.kind !== "statement-owner") throw new Error("expected imported statement-owner target");
    const rootDirect = fixture.compiled.moduleMaterialization!.executionStatements.find((entry) =>
      entry.type === "moduleInstance" &&
      entry.sourceStatementIndex === statementOwnerTarget.sourceStatementIndex &&
      String(entry.origin?.sourceDocumentId) === fixture.publication.graph.rootDocumentId
    );
    expect(rootDirect).toBeDefined();
    const runtimeProjection = projectDslRevealRuntimeStatementOwner(
      fixture.compiled,
      statementOwnerTarget.sourceStatementIndex,
      fixture.publication.graph.rootDocumentId
    );
    expect(runtimeProjection).toEqual({ candidates: [rootDirect!.runtimeElementId] });
    const expectedRuntimeElementId = rootDirect!.runtimeElementId;
    expect(canvasNavigationFreshnessFor({
      authoritativeDocumentAvailable: true,
      graphBackedRequest: true,
      documentVersion: importedRevealDocumentVersion,
      normalizedSource: importedRevealRootSource,
      sourceRevision: importedRevealGraphRootSourceRevision,
      graphRevision: importedRevealGraphRevision,
      publication,
      runtimePresentation: fixture.runtimePresentation
    })).toEqual({ status: "ready" });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 9041,
          documentVersion: importedRevealDocumentVersion,
          normalizedSourceOffset: importedRevealRootSource.indexOf("Direct"),
          sourceTarget: fixture.target,
          sourceRevision: importedRevealGraphRootSourceRevision,
          graphRevision: importedRevealGraphRevision,
          runtimeProjection
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(expectedRuntimeElementId);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([expectedRuntimeElementId]);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 9041,
      status: "resolved",
      degradations: []
    });
  });

  it("fails closed for an imported statement-owner request without its graph runtime projection", async () => {
    const fixture = await buildImportedRevealFreshnessFixture();
    const publication = { ...fixture.publication, hostDocumentUri: fixture.publication.graph.rootDocumentId };
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: importedRevealRootSource,
          documentVersion: importedRevealDocumentVersion,
          hostDocumentUri: publication.hostDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: publication }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 9042,
          documentVersion: importedRevealDocumentVersion,
          normalizedSourceOffset: importedRevealRootSource.indexOf("Direct"),
          sourceTarget: fixture.target,
          sourceRevision: importedRevealGraphRootSourceRevision,
          graphRevision: importedRevealGraphRevision
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 9042,
      status: "failed",
      reason: "source-mismatch"
    });
  });

  it("fails closed when the host runtime source revision disagrees with the graph root", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7, hostDocumentUri: "file:///workspace/root.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "webviewAuthoritativeDocumentReady", documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: multiDocumentRuntimePublicationFor(
          source,
          7,
          37,
          38,
          useCadDocumentStore.getState().elements
        )
      }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
  });

  it("keeps the Rust transport alive across benchmark configuration and disposes it on unmount", async () => {
    const dispose = vi.spyOn(VscodeRustTransport.prototype, "dispose");
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: {} }
      }));
    });

    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("signals Webview readiness once without recompiling the authoritative document for benchmark configuration", async () => {
    const source = sourceForSelectionChronology(0);
    let readyCount = 0;
    const api = {
      postMessage: vi.fn((message: { type?: string }) => {
        if (message.type !== "webviewReady") return;
        readyCount += 1;
        if (readyCount > 2) return;
        queueMicrotask(() => {
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
          }));
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "benchmarkConfig", config: { runId: `run-${readyCount}` } }
          }));
        });
      })
    };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const documentAfterInitialSync = useCadDocumentStore.getState();
    const readinessMessages = api.postMessage.mock.calls.filter(([message]) => message.type === "webviewReady");
    expect(readinessMessages).toHaveLength(1);
    expect(readyCount).toBe(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: { runId: "repeated-1" } }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "benchmarkConfig", config: { runId: "repeated-2" } }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message.type === "webviewReady")).toHaveLength(1);
    expect(useCadDocumentStore.getState().sourceRevision).toBe(documentAfterInitialSync.sourceRevision);
    expect(useCadDocumentStore.getState().compiledDocumentRevision).toBe(documentAfterInitialSync.compiledDocumentRevision);
  });

  it("passes the VSCodeApp-owned Reference Pick authority through the Canvas boundary", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const currentReferencePickAuthorityFor = drawingCanvasProps.currentReferencePickAuthorityFor;
    expect(currentReferencePickAuthorityFor).not.toBeNull();
    expect(currentReferencePickAuthorityFor!(7)).toEqual({
      documentVersion: 7,
      normalizedSource: source
    });
    expect(currentReferencePickAuthorityFor!(6)).toBeNull();
  });

  it("passes coalesced Source transport to both automatic hooks and keeps Reference Pick immediate", async () => {
    const source = "nui 1\npoint P = coordinate(x: 0, y: 0)";
    const api = { postMessage: vi.fn() };
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const automaticSourceEvaluate = vi.spyOn(VscodeRustTransport.prototype, "evaluateSource");
    const immediateEvaluate = vi.spyOn(VscodeRustTransport.prototype, "evaluate");
    const referencePickEvaluation = vi.spyOn(evaluationEngineRouting, "evaluateElementsWithEngine");
    const view = render(<VSCodeAppForTest api={api} />);
    try {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
        }));
      });

      expect(evaluationTransportCapture.local).toBeTypeOf("function");
      expect(evaluationTransportCapture.multiDocument).toBe(evaluationTransportCapture.local);
      const automaticTransport = evaluationTransportCapture.local as (input: { elements: [] }) => Promise<unknown>;
      const automaticPromise = automaticTransport({ elements: [] });
      void automaticPromise.catch(() => undefined);
      expect(automaticSourceEvaluate).toHaveBeenCalledTimes(1);
      expect(immediateEvaluate).not.toHaveBeenCalled();
      expect(api.postMessage.mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toEqual([
        [expect.objectContaining({ type: "rustEvaluationRequest", id: 1 })]
      ]);

      const compiled = effectiveCompiledDocument(useCadDocumentStore.getState());
      expect(compiled).not.toBeNull();
      const pickPromise = drawingCanvasProps.evaluateReferencePickCandidate!(compiled!);
      void pickPromise.catch(() => undefined);
      expect(referencePickEvaluation).toHaveBeenCalledTimes(1);
      expect(automaticSourceEvaluate).toHaveBeenCalledTimes(1);
      const immediateTransport = referencePickEvaluation.mock.calls[0][2];
      expect(immediateTransport).toBeTypeOf("function");
      expect(immediateTransport).not.toBe(automaticTransport);
      const directPromise = immediateTransport!({ elements: [] });
      void directPromise.catch(() => undefined);
      expect(immediateEvaluate).toHaveBeenCalledTimes(1);

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "rustEvaluationResponse", id: 1, payload: { source: "resolved" } }
        }));
      });
      const requests = api.postMessage.mock.calls
        .map(([message]) => message)
        .filter(message => message.type === "rustEvaluationRequest");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ type: "rustEvaluationRequest", id: 1 });
      expect(requests[1]).toMatchObject({ type: "rustEvaluationRequest", id: expect.any(Number) });
      await expect(automaticPromise).resolves.toEqual({ source: "resolved" });
      view.unmount();
      await expect(directPromise).rejects.toThrow("disposed");
    } finally {
      view.unmount();
      vi.unstubAllEnvs();
    }
  });

  it("keeps Reference Pick authority on exact current Source text while the compiled document is last-good", async () => {
    const valid = sourceForSelectionChronology(0);
    const fatal = `${valid}\nconst X: number = `;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: valid, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: fatal, documentVersion: 8, reason: "edit" }
      }));
    });

    expect(useCadDocumentStore.getState().docText).toBe(valid);
    expect(drawingCanvasProps.currentReferencePickAuthorityFor!(8)).toEqual({
      documentVersion: 8,
      normalizedSource: fatal
    });
  });

  it("applies native conversion success to exactly the reported Canvas targets", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const elements = useCadDocumentStore.getState().elements;
    const first = elements.find((element) => element.name === "A")!;
    const second = elements.find((element) => element.name === "B")!;
    const sourceOwners = sourceOwnerByRuntimeElementId(useCadDocumentStore.getState().doc);
    const secondSourceStatementIndex = sourceOwners.get(second.id)!.sourceStatementIndex;
    useCadUiStore.getState().setCanvasSelectionEligibility(elements, new Set(elements.map((element) => element.id)));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 3,
          documentVersion: 7,
          successfulTargetSourceStatementIndexes: [secondSourceStatementIndex]
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([second.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(second.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(first.id);
  });

  it("defers native conversion selection until the matching authoritative Source version", async () => {
    const source = sourceForSelectionChronology(0);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });

    const elements = useCadDocumentStore.getState().elements;
    const first = elements.find((element) => element.name === "A")!;
    const second = elements.find((element) => element.name === "B")!;
    const sourceOwners = sourceOwnerByRuntimeElementId(useCadDocumentStore.getState().doc);
    const secondSourceStatementIndex = sourceOwners.get(second.id)!.sourceStatementIndex;
    const firstSourceStatementIndex = sourceOwners.get(first.id)!.sourceStatementIndex;
    useCadUiStore.getState().setCanvasSelectionEligibility(elements, new Set(elements.map((element) => element.id)));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 4,
          documentVersion: 8,
          successfulTargetSourceStatementIndexes: [secondSourceStatementIndex]
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 8, reason: "edit" }
      }));
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([second.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(second.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 5,
          documentVersion: 7,
          successfulTargetSourceStatementIndexes: [firstSourceStatementIndex]
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([second.id]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 6,
          documentVersion: 9,
          successfulTargetSourceStatementIndexes: [firstSourceStatementIndex]
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 10, reason: "edit" }
      }));
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([second.id]);
  });

  it("repairs Canvas selection to the post-edit runtime ID after coordinate conversion", async () => {
    const preEditSource = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const postEditSource = preEditSource.replace(
      "point Target = coordinate(x: 10, y: 5)",
      "point Target = offset(from: @Base, dx: 10, dy: 5)"
    );
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: preEditSource, documentVersion: 1 }
      }));
    });
    const preEditState = useCadDocumentStore.getState();
    const preEditTarget = preEditState.elements.find((element) => element.name === "Target")!;
    const preEditOwner = sourceOwnerByRuntimeElementId(preEditState.doc).get(preEditTarget.id)!;
    useCadUiStore.getState().setCanvasSelectionEligibility(
      preEditState.elements,
      new Set(preEditState.elements.map((element) => element.id))
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 701,
          documentVersion: 2,
          successfulTargetSourceStatementIndexes: [preEditOwner.sourceStatementIndex]
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: postEditSource, documentVersion: 2, reason: "edit" }
      }));
    });

    const postEditState = useCadDocumentStore.getState();
    const postEditTarget = postEditState.elements.find((element) => element.name === "Target")!;
    expect(postEditTarget.type).toBe("offsetPoint");
    expect(postEditTarget.id).not.toBe(preEditTarget.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([postEditTarget.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(postEditTarget.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(preEditTarget.id);
  });

  it("preserves successful Canvas target order while excluding skipped members", async () => {
    const preEditSource = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point First = coordinate(x: 10, y: 5)",
      "point Skipped = coordinate(x: 20, y: 5)",
      "point Last = coordinate(x: 30, y: 5)"
    ].join("\n");
    const postEditSource = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point First = offset(from: @Base, dx: 10, dy: 5)",
      "point Skipped = coordinate(x: 20, y: 5)",
      "point Last = polar(from: @Base, angle: 45, distance: 30)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: preEditSource, documentVersion: 1 }
      }));
    });
    const preEditState = useCadDocumentStore.getState();
    const preEditOwners = sourceOwnerByRuntimeElementId(preEditState.doc);
    const firstSourceStatementIndex = preEditOwners.get(
      preEditState.elements.find((element) => element.name === "First")!.id
    )!.sourceStatementIndex;
    const lastSourceStatementIndex = preEditOwners.get(
      preEditState.elements.find((element) => element.name === "Last")!.id
    )!.sourceStatementIndex;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 702,
          documentVersion: 2,
          successfulTargetSourceStatementIndexes: [lastSourceStatementIndex, firstSourceStatementIndex]
        }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: postEditSource, documentVersion: 2, reason: "edit" }
      }));
    });

    const postEditElements = useCadDocumentStore.getState().elements;
    const postEditFirst = postEditElements.find((element) => element.name === "First")!;
    const postEditSkipped = postEditElements.find((element) => element.name === "Skipped")!;
    const postEditLast = postEditElements.find((element) => element.name === "Last")!;
    expect(useCadUiStore.getState().selectedElementIds).toEqual([postEditLast.id, postEditFirst.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(postEditFirst.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(postEditSkipped.id);
  });

  it("fails closed without partial Canvas selection when a Source owner is missing", async () => {
    const preEditSource = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)",
      "point Target = coordinate(x: 10, y: 5)"
    ].join("\n");
    const postEditSource = [
      "nui 1",
      "point Base = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: preEditSource, documentVersion: 1 }
      }));
    });
    const preEditState = useCadDocumentStore.getState();
    const base = preEditState.elements.find((element) => element.name === "Base")!;
    const target = preEditState.elements.find((element) => element.name === "Target")!;
    const targetSourceStatementIndex = sourceOwnerByRuntimeElementId(preEditState.doc).get(target.id)!.sourceStatementIndex;
    useCadUiStore.getState().setCanvasSelectionEligibility(
      preEditState.elements,
      new Set(preEditState.elements.map((element) => element.id))
    );
    selectElement(base.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "coordinatePointConversionSelection",
          requestId: 703,
          documentVersion: 2,
          successfulTargetSourceStatementIndexes: [targetSourceStatementIndex, 99]
        }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: postEditSource, documentVersion: 2, reason: "edit" }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([base.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(base.id);
  });

  it("dispatches Select Instance Canvas messages through the shared command registry", async () => {
    const dispatchCommand = vi.spyOn(commandRegistry, "dispatchCommand").mockReturnValue(false);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "selectInstance" }
      }));
    });

    expect(dispatchCommand).toHaveBeenCalledWith("selectInstance", expect.objectContaining({
      recordSelectionHistory: true
    }));
  });

  it("routes host Fit Drawing messages through the Canvas-owned Fit operation", async () => {
    const dispatchCommand = vi.spyOn(commandRegistry, "dispatchCommand").mockReturnValue(false);
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "fitDrawing" }
      }));
    });

    expect(dispatchCommand).not.toHaveBeenCalledWith("fitDrawing", expect.anything());
    expect(drawingCanvasProps.fitDrawingOperation).toHaveBeenCalledTimes(1);
  });

  it("selects the owning imported Module instance through the normal Canvas relay", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7, hostDocumentUri: "file:///workspace/root.nui" }
      }));
    });

    const rootState = useCadDocumentStore.getState();
    const rootElement = rootState.elements.find((element) => element.type === "freePoint");
    expect(rootElement).toBeDefined();
    if (!rootElement) return;

    const importedInstancePath = ["module-document:file:///workspace/library.nui:live:Panel"];
    const importedInstanceId = materializedRuntimeElementId("moduleInstance", importedInstancePath);
    const importedChildId = materializedRuntimeElementId("moduleBody", [
      ...importedInstancePath,
      "module-document:file:///workspace/library.nui:live:P"
    ]);
    const runtimeElements: CadElement[] = [
      {
        id: importedInstanceId,
        name: "ImportedPanel",
        type: "moduleInstance",
        activity: "visible"
      },
      {
        ...rootElement,
        id: importedChildId,
        name: "ImportedP",
        parentGroupId: importedInstanceId,
        x: 40,
        y: 0
      }
    ];
    const publication = multiDocumentRuntimePublicationFor(
      source,
      7,
      rootState.currentSourceRevision,
      rootState.currentSourceRevision,
      runtimeElements
    );
    if (publication.status !== "current" || !publication.canvasRuntime) return;
    publication.canvasRuntime.modulePresentation = {
      instanceBaseGeometrySnapshots: [{
        instanceId: importedInstanceId,
        endRuntimeIndex: runtimeElements.length,
        descendantIds: [importedChildId]
      }],
      origins: [{
        runtimeElementId: importedChildId,
        kind: "moduleBody",
        instancePath: importedInstancePath,
        runtimeInstancePath: importedInstancePath
      }],
      layerSourceDocuments: []
    };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: publication }));
    });

    expect(drawingCanvasProps.multiDocumentRuntimePresentation?.elements).toEqual(runtimeElements);
    expect(rootState.elements.some((element) => element.id === importedChildId)).toBe(false);
    useCadUiStore.setState({
      selectedElementId: importedChildId,
      selectedElementIds: [importedChildId],
      selectionAnchorElementId: importedChildId,
      selectionSubject: { kind: "elements" },
      canvasSelectionEligibleElementIds: new Set(runtimeElements.map((element) => element.id))
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "selectInstance" }
      }));
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: importedInstanceId,
      selectedElementIds: [importedInstanceId],
      selectionAnchorElementId: importedInstanceId
    });
  });

  it("rolls back a rejected Canvas free-point commit to the exact Source and selection snapshot", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0, id: a)",
      "point B = coordinate(x: 20, y: 0, id: b)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    const beforeElements = useCadDocumentStore.getState().elements;
    const beforeElementIds = beforeElements.map((element) => element.id);
    const beforeSelection = {
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: [...useCadUiStore.getState().selectedElementIds],
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 42,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });

    const locallyInsertedState = useCadDocumentStore.getState();
    const locallyInsertedIds = locallyInsertedState.elements
      .map((element) => element.id)
      .filter((id) => !beforeElementIds.includes(id));
    const locallyInsertedName = locallyInsertedState.elements.find((element) => locallyInsertedIds.includes(element.id))?.name;
    expect(locallyInsertedState.sourceText).not.toBe(source);
    expect(locallyInsertedState.elements).toHaveLength(beforeElements.length + 1);
    expect(locallyInsertedIds).toHaveLength(1);
    expect(locallyInsertedName).toBeTypeOf("string");
    expect(locallyInsertedState.elements.find((element) => element.id === locallyInsertedIds[0])?.type).toBe("freePoint");
    expect(api.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "canvasCommit",
      operationId: 42,
      expectedDocumentVersion: 7,
      sourceText: locallyInsertedState.sourceText
    }));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommitResult",
          operationId: 42,
          status: "rejected",
          documentVersion: 7
        }
      }));
    });

    const rolledBackState = useCadDocumentStore.getState();
    expect(rolledBackState.sourceText).toBe(source);
    expect(rolledBackState.elements.some((element) => element.name === locallyInsertedName)).toBe(false);
    expect({
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: useCadUiStore.getState().selectedElementIds,
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId
    }).toEqual(beforeSelection);

    const freePointResults = api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasFreePointAtPointerResult");
    expect(freePointResults).toEqual([{
      type: "canvasFreePointAtPointerResult",
      requestId: 42,
      status: "rejected",
      documentVersion: 7
    }]);
    expect(freePointResults.some((message) => message.status === "applied")).toBe(false);
    expect(freePointResults[0]).not.toHaveProperty("nextSourcePosition");
    publishAllCurrentElementsAsPresented();
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
  });

  it("materializes an unnamed freePoint and defers selection until Canvas presents it", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 43,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });

    const originalElementIds = new Set([...
      useCadDocumentStore.getState().elements
        .filter((element) => element.name === "A" || element.name === "B")
        .map((element) => element.id)
    ]);
    const locallyInserted = useCadDocumentStore.getState().elements.find(
      (element) => !originalElementIds.has(element.id) && element.type === "freePoint"
    )!;
    expect(locallyInserted.name).toBe("");
    expect(useCadDocumentStore.getState().sourceText).toContain("point = coordinate(");
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    const createdSource = useCadDocumentStore.getState().sourceText;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "commitText",
          sourceText: createdSource,
          documentVersion: 8,
          reason: "edit"
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasFreePointAtPointerResult")).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommitResult",
          operationId: 43,
          status: "accepted",
          documentVersion: 8
        }
      }));
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    await act(async () => {
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(locallyInserted.id);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([locallyInserted.id]);
  });

  it.each([
    ["commitText -> commitResult", "commitText-first"],
    ["commitResult -> commitText", "commitResult-first"]
  ] as const)("creates two consecutive unnamed free points through the real H3 source path (%s)", async (_label, ordering) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    const requestedPointers: Array<{ x: number; y: number }> = [];
    const send = async (data: unknown) => {
      if (typeof data === "object" && data !== null && (data as { type?: string }).type === "canvasFreePointAtPointer") {
        requestedPointers.push((data as { pointer: { x: number; y: number } }).pointer);
      }
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };
    const messagesOfType = (type: string) => api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === type);
    const presentCanvasElements = async () => {
      await act(async () => {
        publishAllCurrentElementsAsPresented();
      });
    };
    const canvasCommitFor = (requestId: number) => messagesOfType("canvasCommit")
      .find((message) => message.operationId === requestId) as {
        sourceText: string;
        expectedDocumentVersion: number;
      } | undefined;
    const completeCommit = async (commit: {
      sourceText: string;
      expectedDocumentVersion: number;
    }, requestId: number, documentVersion: number) => {
      const commitText = {
        type: "commitText" as const,
        sourceText: commit.sourceText,
        documentVersion,
        reason: "edit" as const
      };
      const commitResult = {
        type: "canvasCommitResult" as const,
        operationId: requestId,
        status: "accepted" as const,
        documentVersion
      };
      if (ordering === "commitText-first") {
        await send(commitText);
        await send(commitResult);
      } else {
        await send(commitResult);
        await send(commitText);
      }
    };

    await send({ type: "replaceTextDocument", sourceText: h3Source, documentVersion: 1 });
    await presentCanvasElements();

    await send({
      type: "canvasFreePointAtPointer",
      requestId: 221,
      documentVersion: 1,
      pointer: { x: 12.5, y: -8 },
      sourcePosition: h3GuideSourcePosition
    });
    const firstCommit = canvasCommitFor(221);
    expect(firstCommit).toBeDefined();
    expect(firstCommit).not.toHaveProperty("graphAuthority");
    expect(firstCommit?.sourceText).toContain("line Guide = segment(start: @Left, end: @Right)");
    expect(firstCommit?.sourceText).toContain("point = coordinate(\n  x: 12.5,\n  y: -8,\n)");
    expect(firstCommit?.sourceText.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")).toBeGreaterThan(
      firstCommit?.sourceText.indexOf("line Guide = segment(start: @Left, end: @Right)") ?? -1
    );

    await completeCommit(firstCommit!, 221, 2);
    const firstResult = messagesOfType("canvasFreePointAtPointerResult")
      .find((message) => message.requestId === 221) as {
        status: string;
        documentVersion: number;
        nextSourcePosition?: { line: number; character: number };
      } | undefined;
    expect(firstResult).toMatchObject({ status: "applied", documentVersion: 2 });
    expect(firstResult?.nextSourcePosition).toBeDefined();

    await send({
      type: "canvasFreePointAtPointer",
      requestId: 222,
      documentVersion: 2,
      pointer: { x: 91, y: -37 },
      sourcePosition: firstResult!.nextSourcePosition!
    });
    const secondCommit = canvasCommitFor(222);
    expect(secondCommit).toBeDefined();
    expect(secondCommit?.sourceText).toContain("point = coordinate(\n  x: 91,\n  y: -37,\n)");
    expect(secondCommit?.sourceText.indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")).toBeGreaterThan(
      secondCommit?.sourceText.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)") ?? -1
    );

    await completeCommit(secondCommit!, 222, 3);
    await presentCanvasElements();

    const finalSource = useCadDocumentStore.getState().sourceText;
    const pointDeclarations = finalSource.match(/^point(?: [A-Za-z_][A-Za-z0-9_]*)? = coordinate\(/gm) ?? [];
    expect(pointDeclarations).toHaveLength(4);
    expect(finalSource.indexOf("line Guide = segment(start: @Left, end: @Right)")).toBeLessThan(
      finalSource.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")
    );
    expect(finalSource.indexOf("point = coordinate(\n  x: 12.5,\n  y: -8,\n)")).toBeLessThan(
      finalSource.indexOf("point = coordinate(\n  x: 91,\n  y: -37,\n)")
    );
    expect(requestedPointers).toEqual([
      { x: 12.5, y: -8 },
      { x: 91, y: -37 }
    ]);
    expect(messagesOfType("canvasCommit").map((message) => message.sourceText)).toEqual([
      firstCommit!.sourceText,
      secondCommit!.sourceText
    ]);
    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) =>
        element.type === "freePoint" && element.name === "" && element.x === 91 && element.y === -37
      )?.id
    );
    expect(messagesOfType("canvasFreePointAtPointerResult")).toEqual([
      expect.objectContaining({ requestId: 221, status: "applied" }),
      expect.objectContaining({ requestId: 222, status: "applied" })
    ]);
  });

  it("keeps the creation selection contract through host Undo and Redo", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasFreePointAtPointer",
          requestId: 44,
          documentVersion: 7,
          pointer: { x: 12.5, y: -8 },
          sourcePosition: { line: 1, character: 0 }
        }
      }));
    });
    const createdSource = useCadDocumentStore.getState().sourceText;
    const createdPoint = useCadDocumentStore.getState().elements.find((element) => element.name === "")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommitResult", operationId: 44, status: "accepted", documentVersion: 8 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(createdPoint.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 9, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadDocumentStore.getState().elements.some((element) => element.id === createdPoint.id)).toBe(false);
    expect(useCadUiStore.getState().selectedElementId).toBeNull();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: createdSource, documentVersion: 10, reason: "redo" }
      }));
      publishAllCurrentElementsAsPresented();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(createdSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(createdPoint.id);
  });

  it("queues Canvas history until the authoritative result and restores focus after completion", async () => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(
      <>
        <VSCodeAppForTest api={api} />
        <input data-testid="focus-sink" />
      </>
    );
    const canvas = screen.getByTestId("canvas");
    const focusSink = screen.getByTestId("focus-sink");
    focusSink.focus();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(canvasHistoryRequests()[0]?.[0]).toEqual({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(oldSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(document.activeElement).toBe(focusSink);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasHistoryResult",
          direction: "undo",
          status: "completed",
          documentVersion: 2
        }
      }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(canvas);
    expect(useCadUiStore.getState().selectedElementId).toBe(a);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(canvasHistoryRequests()).toHaveLength(1);
  });

  it("restores an identity-changing Coordinate-to-Offset Source history selection after fresh Canvas presentation", async () => {
    const oldSource = coordinateOffsetSourceForSelectionChronology("coordinate");
    const newSource = coordinateOffsetSourceForSelectionChronology("offset");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: oldSource, documentVersion: 1 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    const preConversionState = useCadDocumentStore.getState();
    const preConversionB = preConversionState.elements.find((element) => element.name === "B")!;
    selectElement(preConversionB.id, "replace", true);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    useCadDocumentStore.getState().commitText(newSource, "command");
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    publishAllCurrentElementsAsPresented();
    const postConversionState = useCadDocumentStore.getState();
    const postConversionB = postConversionState.elements.find((element) => element.name === "B")!;
    expect(postConversionB.type).toBe("offsetPoint");
    expect(postConversionB.id).not.toBe(preConversionB.id);
    replaceCanvasSelection([postConversionB.id], postConversionB.id, false);
    expect(useCadDocumentStore.getState().past.at(-1)?.selection).toMatchObject({
      selectedElementId: preConversionB.id,
      selectedElementIds: [preConversionB.id],
      selectionAnchorElementId: preConversionB.id
    });
    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: postConversionB.id,
      selectedElementIds: [postConversionB.id],
      selectionAnchorElementId: postConversionB.id
    });
    drawingCanvasProps.postCanvasCommit!(315);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommitResult", operationId: 315, status: "accepted", documentVersion: 2 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 2, reason: "edit" }
      }));
    });

    expect(useCadDocumentStore.getState().past.at(-1)?.selection).toMatchObject({
      selectedElementId: preConversionB.id,
      selectedElementIds: [preConversionB.id],
      selectionAnchorElementId: preConversionB.id
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(postConversionB.id);

    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );
    const requestCanvasCommand = async (commandId: "undo" | "redo") => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "canvasCommand", commandId }
        }));
      });
    };

    await requestCanvasCommand("undo");
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(canvasHistoryRequests()[0]?.[0]).toEqual({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 2
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(newSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(postConversionB.id);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 3, reason: "undo" }
      }));
      expect(useCadUiStore.getState().canvasSelectionEligibleElementIds).toBeNull();
      expect(useCadUiStore.getState().selectedElementId).toBeNull();
    });
    const undoB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    expect(undoB.type).toBe("freePoint");
    expect(undoB.id).toBe(preConversionB.id);
    await act(async () => {
      publishAllCurrentElementsAsPresented();
      await Promise.resolve();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(oldSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(undoB.id);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await requestCanvasCommand("undo");
    expect(useCadUiStore.getState().selectedElementId).toBe(undoB.id);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasHistoryResult", direction: "undo", status: "completed", documentVersion: 3 }
      }));
      await Promise.resolve();
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await requestCanvasCommand("redo");
    expect(useCadUiStore.getState().selectedElementId).toBe(undoB.id);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await requestCanvasCommand("redo");
    expect(canvasHistoryRequests()).toHaveLength(2);
    expect(canvasHistoryRequests()[1]?.[0]).toMatchObject({
      type: "canvasHistoryRequest",
      direction: "redo",
      expectedDocumentVersion: 3
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 4, reason: "redo" }
      }));
      expect(useCadUiStore.getState().canvasSelectionEligibleElementIds).toBeNull();
      expect(useCadUiStore.getState().selectedElementId).toBeNull();
    });
    const redoB = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    expect(redoB.type).toBe("offsetPoint");
    expect(redoB.id).toBe(postConversionB.id);
    await act(async () => {
      publishAllCurrentElementsAsPresented();
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasHistoryResult", direction: "redo", status: "completed", documentVersion: 4 }
      }));
      await Promise.resolve();
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(newSource);
    expect(useCadUiStore.getState().selectedElementId).toBe(redoB.id);
  });

  it.each(["edit", "undo"] as const)(
    "releases stale Canvas Source history before current Source confirmation for free-point creation (%s)",
    async (invalidationReason) => {
      const source = h3Source;
      const canvasSource = `${source}\n// Canvas Source mutation`;
      const sourceEdit = `${canvasSource}\n// ordinary Source edit`;
      const api = { postMessage: vi.fn() };
      render(<VSCodeAppForTest api={api} />);

      const messagesOfType = (type: string) => api.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.type === type);
      const send = async (data: unknown) => {
        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", { data }));
        });
      };

      await send({ type: "replaceTextDocument", sourceText: source, documentVersion: 1 });
      useCadDocumentStore.getState().commitText(canvasSource, "command");
      drawingCanvasProps.postCanvasCommit!(315);
      await send({ type: "canvasCommitResult", operationId: 315, status: "accepted", documentVersion: 2 });
      await send({ type: "commitText", sourceText: canvasSource, documentVersion: 2, reason: "edit" });

      await send({ type: "canvasCommand", commandId: "undo" });
      expect(messagesOfType("canvasHistoryRequest")).toEqual([expect.objectContaining({
        direction: "undo",
        expectedDocumentVersion: 2
      })]);
      await send({ type: "commitText", sourceText: sourceEdit, documentVersion: 3, reason: invalidationReason });
      publishAllCurrentElementsAsPresented();
      const guide = useCadDocumentStore.getState().elements.find((element) => element.name === "Guide")!;
      selectElement(guide.id, "replace", true);
      await send({ type: "canvasHistoryResult", direction: "undo", status: "completed", documentVersion: 3 });

      await send({
        type: "canvasSourceDefinitionRequest",
        requestId: 316
      });

      expect(messagesOfType("canvasSourceDefinitionResult")).toEqual([expect.objectContaining({
        requestId: 316,
        documentVersion: 3,
        runtimeElementId: guide.id,
        range: expect.anything()
      })]);

      await send({
        type: "canvasFreePointAtPointer",
        requestId: 317,
        documentVersion: 3,
        pointer: { x: 24, y: -13 },
        sourcePosition: h3GuideSourcePosition
      });
      expect(messagesOfType("canvasCommit")).toEqual([expect.objectContaining({
        operationId: 315,
        expectedDocumentVersion: 1
      }), expect.objectContaining({
        operationId: 317,
        expectedDocumentVersion: 3,
        sourceText: expect.stringContaining("point = coordinate(")
      })]);
      const freePointCommit = messagesOfType("canvasCommit").find((message) => message.operationId === 317)!;
      expect(freePointCommit.sourceText.indexOf("point = coordinate(")).toBeGreaterThan(
        freePointCommit.sourceText.indexOf("line Guide = segment(start: @Left, end: @Right)")
      );
    }
  );

  it.each(["source drift", "document replacement"] as const)(
    "invalidates a pending history selection restore after %s",
    async (invalidatingChange) => {
      const api = { postMessage: vi.fn() };
      const { oldSource } = await establishPendingCoordinateOffsetHistoryRestore(api);

      if (invalidatingChange === "source drift") {
        const driftSource = oldSource.replace("x: 10", "x: 11");
        await act(async () => {
          useCadDocumentStore.getState().commitText(driftSource, "test");
          publishAllCurrentElementsAsPresented();
          await Promise.resolve();
        });
      } else {
        await act(async () => {
          window.dispatchEvent(new MessageEvent("message", {
            data: { type: "replaceTextDocument", sourceText: oldSource, documentVersion: 4 }
          }));
          publishAllCurrentElementsAsPresented();
          await Promise.resolve();
        });
      }

      expect(useCadUiStore.getState().selectedElementId).toBeNull();
      expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    }
  );

  it("normalizes a pending history restore away when fresh Canvas presentation excludes its target", async () => {
    const api = { postMessage: vi.fn() };
    const { oldSource, oldB } = await establishPendingCoordinateOffsetHistoryRestore(api);
    expect(useCadDocumentStore.getState().sourceText).toBe(oldSource);

    await act(async () => {
      const elements = useCadDocumentStore.getState().elements;
      useCadUiStore.getState().setCanvasSelectionEligibility(
        elements,
        new Set(elements.filter((element) => element.id !== oldB.id).map((element) => element.id))
      );
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
  });

  it("does not create a phantom Source entry when a Canvas commit is rejected", async () => {
    const oldSource = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0, id: a)",
      "point B = coordinate(x: 20, y: 0, id: b)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: oldSource, documentVersion: 1 }
      }));
      publishAllCurrentElementsAsPresented();
    });
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    publishAllCurrentElementsAsPresented();
    drawingCanvasProps.postCanvasCommit!(316);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommitResult", operationId: 316, status: "rejected", documentVersion: 1 }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });
    expect(useCadUiStore.getState().selectedElementId).toBe(a);
    expect(api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    )).toHaveLength(0);
  });

  it.each(["resynced", "failed"] as const)("discards queued Canvas history after a %s result", async (status) => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementId).toBe(b);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasHistoryResult", direction: "undo", status, documentVersion: 2 }
      }));
      await Promise.resolve();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(a).not.toBe(useCadUiStore.getState().selectedElementId);
  });

  it("uses the second Undo for local selection history after authoritative source Undo", async () => {
    const oldSource = sourceForSelectionChronology(0);
    const newSource = sourceForSelectionChronology(40);
    useCadDocumentStore.getState().replaceTextDocument(oldSource, {
      currentFilePath: null,
      dirtySinceSave: false
    });
    publishAllCurrentElementsAsPresented();
    const [a, b] = useCadDocumentStore.getState().elements.map((element) => element.id);
    useCadUiStore.getState().setSelectedElementId(a!);
    selectElement(b!, "replace", true);
    useCadDocumentStore.getState().commitText(newSource, "editor");
    const api = { postMessage: vi.fn() };

    render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newSource, documentVersion: 1, reason: "edit" }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: oldSource, documentVersion: 2, reason: "undo" }
      }));
      publishAllCurrentElementsAsPresented();
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(b);
    const historyRequestsBeforeLocalUndo = api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    ).length;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(a);
    expect(api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    )).toHaveLength(historyRequestsBeforeLocalUndo);
  });

  it("revalidates an Editor target, replaces selection through history, and focuses the viewport", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)",
      "point B = coordinate(x: 20, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });
    const editorTarget = useCadDocumentStore.getState().elements.find((element) => element.name === "B")!;
    drawingCanvasProps.evaluation.computedGeometry.set(editorTarget.id, {
      kind: "point",
      elementId: editorTarget.id,
      name: editorTarget.name,
      x: 20,
      y: 0
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 12, documentVersion: 7, normalizedSourceOffset: source.indexOf("B") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) => element.name === "B")?.id
    );
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 12,
      status: "resolved",
      degradations: []
    });

    const canvas = screen.getByTestId("canvas");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 12 }
      }));
    });
    expect(document.activeElement).toBe(canvas);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 12,
      status: "focused"
    });
    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("selects a graph-resolved imported Module instance from the published runtime universe", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7, hostDocumentUri: "file:///workspace/root.nui" }
      }));
    });
    const rootState = useCadDocumentStore.getState();
    const importedInstanceId = "module-runtime:imported-instance";
    const importedChildId = "module-runtime:imported-child";
    const runtimeElements: CadElement[] = [
      { id: importedInstanceId, name: "Direct", type: "moduleInstance", activity: "visible" },
      {
        ...rootState.elements.find((element) => element.type === "freePoint")!,
        id: importedChildId,
        name: "ImportedP",
        parentGroupId: importedInstanceId,
        x: 40,
        y: 0
      }
    ];
    drawingCanvasProps.evaluation = {
      computedGeometry: new Map([[
        importedChildId,
        { kind: "point", elementId: importedChildId, name: "ImportedP", x: 40, y: 0 }
      ]]),
      preMutationGeometry: new Map(),
      instanceBaseGeometry: new Map(),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set([importedInstanceId, importedChildId]),
      effectiveEnabledElementIds: new Set([importedInstanceId, importedChildId]),
      effectiveVisibleElementIds: new Set([importedInstanceId, importedChildId])
    };
    const publication = multiDocumentRuntimePublicationFor(
      source,
      7,
      rootState.currentSourceRevision,
      rootState.currentSourceRevision,
      runtimeElements
    );
    if (publication.status !== "current" || !publication.canvasRuntime) return;
    publication.canvasRuntime.modulePresentation = {
      instanceBaseGeometrySnapshots: [{
        instanceId: importedInstanceId,
        endRuntimeIndex: runtimeElements.length,
        descendantIds: [importedChildId]
      }],
      origins: [],
      layerSourceDocuments: [],
      revealMaterialization: {
        ...revealMaterializationFor(importedInstanceId, 1),
        instanceBaseGeometrySnapshots: [{
          instanceId: importedInstanceId,
          endRuntimeIndex: runtimeElements.length,
          descendantIds: [importedChildId]
        }]
      }
    };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: publication }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 501,
          documentVersion: 7,
          normalizedSourceOffset: source.indexOf("Root"),
          sourceTarget: { kind: "statement-owner", sourceStatementIndex: 1 },
          sourceRevision: rootState.currentSourceRevision,
          graphRevision: 12,
          runtimeProjection: { candidates: [importedInstanceId] }
        }
      }));
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: importedInstanceId,
      selectedElementIds: [importedInstanceId]
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 501,
      status: "resolved",
      degradations: []
    });
  });

  it("fails closed when a graph-aware navigation request is superseded", async () => {
    const source = "nui 1\npoint Root = coordinate(x: 0, y: 0)";
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7, hostDocumentUri: "file:///workspace/root.nui" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: multiDocumentRuntimePublicationFor(
          source,
          7,
          useCadDocumentStore.getState().currentSourceRevision,
          useCadDocumentStore.getState().currentSourceRevision,
          useCadDocumentStore.getState().elements
        )
      }));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 502,
          documentVersion: 7,
          normalizedSourceOffset: source.indexOf("Root"),
          sourceTarget: { kind: "statement-owner", sourceStatementIndex: 1 },
          sourceRevision: useCadDocumentStore.getState().currentSourceRevision,
          graphRevision: 11
        }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 502,
      status: "failed",
      reason: "source-mismatch"
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
  });

  it("does not acknowledge Canvas focus while the Webview document is unfocused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 21, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 21 }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("acknowledges pending Canvas focus on the Webview window focus event", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 22, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 22 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(document.activeElement).toBe(screen.getByTestId("canvas"));
    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("does not duplicate the Canvas focus acknowledgement on repeated window focus events", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 23, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 23 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(1);
  });

  it("does not duplicate the Canvas focus acknowledgement when focus re-enters synchronously", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 231, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    const canvas = screen.getByTestId("canvas");
    const originalFocus = canvas.focus.bind(canvas);
    let focusEventDispatched = false;
    vi.spyOn(canvas, "focus").mockImplementation(() => {
      originalFocus();
      if (focusEventDispatched) return;
      focusEventDispatched = true;
      window.dispatchEvent(new Event("focus"));
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 231 }
      }));
    });

    expect(api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasNavigationResult" && message.status === "focused"
    )).toHaveLength(1);
  });

  it("does not complete pending focus after a newer Canvas navigation request", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 24, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 24 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 25, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("does not complete pending focus after an authoritative document change", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const changedSource = `${source}\n// authoritative change`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 26, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 26 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: changedSource, documentVersion: 2 }
      }));
    });

    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("does not complete pending focus after Canvas history handoff starts", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 27, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "focusCanvas", requestId: 27 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasHistoryRequest")).toHaveLength(1);
    hasFocus.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(api.postMessage.mock.calls.filter(([message]) => message?.type === "canvasNavigationResult" && message.status === "focused")).toHaveLength(0);
  });

  it("fails closed for stale host navigation without changing selection", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const newerSource = `${source}\n// newer authoritative text`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: newerSource, documentVersion: 6 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 13, documentVersion: 6, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 13,
      status: "failed",
      reason: "source-mismatch"
    });
  });

  it("rejects a Canvas-local source ahead of the host until its acknowledgement arrives", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const localSource = `${source}\n// Canvas-local edit`;
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 7 }
      }));
    });
    expect(drawingCanvasProps.postCanonicalSourceText).not.toBeNull();

    await act(async () => {
      useCadDocumentStore.getState().commitText(localSource, "test");
      drawingCanvasProps.postCanonicalSourceText!(localSource);
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 14, documentVersion: 7, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 14,
      status: "failed",
      reason: "source-mismatch"
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: localSource, documentVersion: 8, reason: "edit" }
      }));
    });
    const localTarget = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    drawingCanvasProps.evaluation.computedGeometry.set(localTarget.id, {
      kind: "point",
      elementId: localTarget.id,
      name: localTarget.name,
      x: 0,
      y: 0
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 15, documentVersion: 8, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementId).toBe(
      useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id
    );
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 15,
      status: "resolved",
      degradations: []
    });
  });

  it("blocks navigation while Canvas history is in flight", async () => {
    const source = [
      "nui 1",
      "point A = coordinate(x: 0, y: 0)"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "undo" }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 16, documentVersion: 1, normalizedSourceOffset: source.indexOf("A") }
      }));
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 1
    });
    expect(useCadUiStore.getState().selectedElementId).toBeNull();
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 16,
      status: "failed",
      reason: "source-mismatch"
    });
  });

  it("reveals every runtime materialization of one module-body statement once", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 10, y: 20)",
      "}",
      "instance A = M()",
      "instance B = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const statementIndex = state.doc.statements.findIndex((statement) => statement.name === "P");
    const owners = sourceOwnerByRuntimeElementId(state.doc);
    const runtimeIds = state.elements
      .filter((element) => owners.get(element.id)?.sourceStatementIndex === statementIndex)
      .map((element) => element.id);
    expect(runtimeIds.length).toBeGreaterThan(1);
    for (const runtimeId of runtimeIds) {
      drawingCanvasProps.evaluation.computedGeometry.set(runtimeId, {
        kind: "point",
        elementId: runtimeId,
        name: runtimeId,
        x: 10,
        y: 20
      });
    }

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 17, documentVersion: 1, normalizedSourceOffset: source.indexOf("P") }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual(runtimeIds);
    expect(useCadUiStore.getState().selectedElementId).toBe(runtimeIds[0]);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 18, documentVersion: 1, normalizedSourceOffset: source.indexOf("P") }
      }));
    });

    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(runtimeIds);
  });

  it.each([
    ["hidden", "nui 1\npoint A = coordinate(x: 0, y: 0, visible: false)", "A", false],
    ["disabled", "nui 1\npoint A = coordinate(x: 0, y: 0, enabled: false)", "A", false],
    ["non-renderable", "nui 1\nmodule M() {\n  point P = coordinate(x: 0, y: 0)\n}\ninstance A = M()", "A", false]
  ] as const)("handles a %s primary without changing activity or viewport", async (_label, source, token, shouldSelect) => {
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    useCadUiStore.getState().setCanvasViewport({ panX: 17, panY: -9, zoom: 2 });
    const beforeViewport = useCadUiStore.getState().canvasViewport;
    const beforeElements = useCadDocumentStore.getState().elements.map((element) => ({
      id: element.id,
      activity: element.activity
    }));
    const beforeModifiers = useCadDocumentStore.getState().modifiers;
    const beforeVisibilityProfiles = useCadDocumentStore.getState().visibilityProfiles;
    const beforeActiveVisibilityProfileId = useCadDocumentStore.getState().activeVisibilityProfileId;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasNavigationRequest", requestId: 19, documentVersion: 1, normalizedSourceOffset: source.indexOf(token) }
      }));
    });

    const targetId = useCadDocumentStore.getState().elements.find((element) => element.name === "A")?.id;
    if (shouldSelect) {
      expect(useCadUiStore.getState().selectedElementId).toBe(targetId);
    } else {
      expect(useCadUiStore.getState()).toMatchObject({
        selectedElementId: null,
        selectedElementIds: [],
        selectionAnchorElementId: null
      });
    }
    expect(useCadDocumentStore.getState().elements.map((element) => ({ id: element.id, activity: element.activity }))).toEqual(beforeElements);
    expect(useCadDocumentStore.getState().modifiers).toEqual(beforeModifiers);
    expect(useCadDocumentStore.getState().visibilityProfiles).toEqual(beforeVisibilityProfiles);
    expect(useCadDocumentStore.getState().activeVisibilityProfileId).toBe(beforeActiveVisibilityProfileId);
    expect(useCadUiStore.getState().canvasViewport).toEqual(beforeViewport);
  });

  it("does not use an ineligible Module instance for a target-scoped Bake sandbox", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point Broken = coordinate(x: 0, y: 0, enabled: false)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const instance = useCadDocumentStore.getState().elements.find((element) => element.name === "A")!;
    selectElement(instance.id, "replace", true);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasCommand",
          commandId: "bakeCurrentShape",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
    });

    expect(drawingCanvasProps.bakeSandboxTargetIds).toBeNull();
  });

  it("synchronizes a successful Duplicate as Snapshot through current host authority", async () => {
    const source = "nui 1\nline AB = segment(start: (2, 4), end: (12, 4))";
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 41 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const line = state.elements.find((element) => element.name === "AB")!;
    useCadUiStore.getState().setCanvasSelectionEligibility(state.elements, new Set(state.elements.map(({ id }) => id)));
    selectElement(line.id, "replace", true);
    drawingCanvasProps.evaluation = {
      computedGeometry: new Map([[line.id, {
        kind: "line",
        elementId: line.id,
        name: line.name,
        startPointId: null,
        endPointId: null,
        start: { kind: "point", elementId: `${line.id}:start`, name: "AB.start", x: 2, y: 4 },
        end: { kind: "point", elementId: `${line.id}:end`, name: "AB.end", x: 12, y: 4 },
        length: 10,
        startAngleDeg: 0,
        endAngleDeg: 180,
        startTangentAngleDeg: 0,
        endTangentAngleDeg: 180
      }]]),
      errors: [],
      warnings: [],
      evaluatedElementIds: new Set(state.elements.map(({ id }) => id)),
      effectiveEnabledElementIds: new Set(state.elements.map(({ id }) => id)),
      effectiveVisibleElementIds: new Set(state.elements.map(({ id }) => id))
    } as EvaluationResult;
    await act(async () => { view.rerender(<VSCodeAppForTest api={api} />); });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "duplicateAsSnapshot" }
      }));
    });

    const commits = api.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === "canvasCommit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      type: "canvasCommit",
      expectedDocumentVersion: 41,
      mutationKind: "model-patch",
      sourceText: useCadDocumentStore.getState().sourceText
    });
    expect(useCadDocumentStore.getState().sourceText).toContain(
      "group {\n  line = segment(start: (2, 4), end: (12, 4))\n}"
    );
    expect(useCadUiStore.getState().selectedElementIds).toEqual([line.id]);
  });

  it("shows the target-specific rejection for a mixed supported and unsupported selection without mutation", async () => {
    const source = [
      "nui 1",
      "point P = coordinate(x: 1, y: 2)",
      'text T = label(text: "REJECT", anchor: (4, 5), size: 3)'
    ].join("\n");
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 51 }
      }));
    });

    const state = useCadDocumentStore.getState();
    const point = state.elements.find((element) => element.name === "P")!;
    const text = state.elements.find((element) => element.name === "T")!;
    const selectedIds = [point.id, text.id];
    const completeIds = new Set(state.elements.map(({ id }) => id));
    act(() => {
      useCadUiStore.getState().setCanvasSelectionEligibility(state.elements, completeIds);
      useCadUiStore.setState({
        selectedElementId: point.id,
        selectedElementIds: selectedIds,
        selectionAnchorElementId: point.id,
        selectionSubject: { kind: "elements" }
      });
    });
    drawingCanvasProps.evaluation = {
      computedGeometry: new Map<string, ComputedGeometry>([
        [point.id, { kind: "point", elementId: point.id, name: "P", x: 1, y: 2 }],
        [text.id, {
          kind: "text",
          elementId: text.id,
          name: "T",
          text: "REJECT",
          anchor: { kind: "point", elementId: `${text.id}:anchor`, name: "T.anchor", x: 4, y: 5 },
          fontSize: 3
        }]
      ]),
      errors: [],
      warnings: [],
      evaluatedElementIds: completeIds,
      effectiveEnabledElementIds: completeIds,
      effectiveVisibleElementIds: completeIds
    };
    await act(async () => { view.rerender(<VSCodeAppForTest api={api} />); });

    const sourceBefore = useCadDocumentStore.getState().sourceText;
    const pastBefore = useCadDocumentStore.getState().past;
    const futureBefore = useCadDocumentStore.getState().future;
    const selectionPastBefore = useCadDocumentStore.getState().selectionPast;
    const selectionFutureBefore = useCadDocumentStore.getState().selectionFuture;
    const selectionBefore = {
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: useCadUiStore.getState().selectedElementIds,
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId,
      selectionSubject: useCadUiStore.getState().selectionSubject
    };
    api.postMessage.mockClear();

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "duplicateAsSnapshot" }
      }));
    });

    const reason = `選択要素 ${text.id} はスナップショットに対応しないジオメトリです (unsupported-geometry-kind)。`;
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(reason);
    expect(alert.parentElement).toBe(screen.getByRole("main"));
    expect(alert.style.position).toBe("absolute");
    expect(alert.style.pointerEvents).toBe("none");
    expect(useCadUiStore.getState().commandErrorMessage).toBe(reason);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(useCadDocumentStore.getState().past).toEqual(pastBefore);
    expect(useCadDocumentStore.getState().future).toEqual(futureBefore);
    expect(useCadDocumentStore.getState().selectionPast).toEqual(selectionPastBefore);
    expect(useCadDocumentStore.getState().selectionFuture).toEqual(selectionFutureBefore);
    expect({
      selectedElementId: useCadUiStore.getState().selectedElementId,
      selectedElementIds: useCadUiStore.getState().selectedElementIds,
      selectionAnchorElementId: useCadUiStore.getState().selectionAnchorElementId,
      selectionSubject: useCadUiStore.getState().selectionSubject
    }).toEqual(selectionBefore);
    expect(api.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message?.type === "canvasCommit")).toHaveLength(0);
  });

  it("snapshots selected imported Canvas runtime geometry with its graph commit authority", async () => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: fixture.source,
          documentVersion: issue1651DocumentVersion,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
    });
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: fixture.publication }));
    });
    const runtime = drawingCanvasProps.multiDocumentRuntimePresentation!;
    const imported = runtime.elements.find((element) => element.name === "Imported")!;
    const rootPoint = runtime.elements.find((element) => element.name === "A")!;
    expect(imported).toBeDefined();
    expect(rootPoint).toBeDefined();
    expect(imported.parentGroupId).not.toBe(rootPoint.parentGroupId);
    expect(sourceOwnerForRuntimeElementId(fixture.compiled, imported.id)).toMatchObject({
      kind: "moduleBody",
      sourceDocumentId: "file:///workspace/module_test_lib.nui"
    });

    const localState = useCadDocumentStore.getState();
    expect(localState.elements.some((element) => element.id === imported.id)).toBe(false);
    expect(runtime.graphRevision).not.toBe(localState.compiledDocumentRevision);
    const runtimePointIds = runtime.elements.filter((element) => element.type === "freePoint").map((element) => element.id);
    const sourceBefore = useCadDocumentStore.getState().sourceText;
    const historyBefore = useCadDocumentStore.getState().past;
    drawingCanvasProps.evaluation = completeGraphSnapshotEvaluationFor(runtime.elements);
    act(() => {
      useCadUiStore.getState().setCanvasSelectionEligibility(runtime.elements, new Set(runtime.elements.map(({ id }) => id)));
      useCadUiStore.setState({
        selectedElementId: imported.id,
        selectedElementIds: [imported.id, rootPoint.id],
        selectionAnchorElementId: imported.id,
        selectionSubject: { kind: "elements" }
      });
    });
    await act(async () => { view.rerender(<VSCodeAppForTest api={api} />); });
    for (const id of [imported.id, rootPoint.id]) {
      expect(drawingCanvasProps.evaluation.evaluatedElementIds).toContain(id);
      expect(drawingCanvasProps.evaluation.effectiveEnabledElementIds).toContain(id);
      expect(drawingCanvasProps.evaluation.effectiveVisibleElementIds).toContain(id);
    }
    expect(drawingCanvasProps.evaluation.computedGeometry.get(imported.id)).toMatchObject({ x: 50, y: 0 });
    expect(drawingCanvasProps.evaluation.computedGeometry.get(rootPoint.id)).toMatchObject({ x: 0, y: 0 });

    act(() => useCadUiStore.getState().setCommandErrorMessage("stale snapshot rejection"));
    expect(screen.getByRole("alert").textContent).toBe("stale snapshot rejection");
    api.postMessage.mockClear();
    evaluationRevisionCapture.revisions = [];
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "duplicateAsSnapshot" }
      }));
    });

    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const commits = api.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message?.type === "canvasCommit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      type: "canvasCommit",
      expectedDocumentVersion: issue1651DocumentVersion,
      graphAuthority: {
        rootDocumentId: fixture.publication.graph.rootDocumentId,
        graphRevision: fixture.publication.graph.revision
      }
    });
    const committedSource = useCadDocumentStore.getState().sourceText;
    expect(committedSource.endsWith(
      "group {\n  point = coordinate(x: 50, y: 0)\n  point = coordinate(x: 0, y: 0)\n}"
    )).toBe(true);
    expect(useCadDocumentStore.getState().past).toHaveLength(historyBefore.length + 1);
    expect(evaluationRevisionCapture.revisions[0]).toBe(runtime.graphRevision);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([imported.id, rootPoint.id]);
    expect(runtimePointIds).toContain(imported.id);
    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    useCadDocumentStore.getState().redo();
    expect(useCadDocumentStore.getState().sourceText).toBe(committedSource);
  });

  it.each([
    "missing ownership",
    "corrupted ownership",
    "stale graph",
    "changed imported dependency",
    "stale evaluation",
    "stale host document version",
    "stale host Source"
  ] as const)("rejects graph snapshot with %s without mutation", async (failure) => {
    const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
    let publication = structuredClone(fixture.publication);

    const api = { postMessage: vi.fn() };
    const view = render(<VSCodeAppForTest api={api} />);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "replaceTextDocument",
          sourceText: fixture.source,
          documentVersion: issue1651DocumentVersion,
          hostDocumentUri: issue1651RootDocumentUri
        }
      }));
      window.dispatchEvent(new MessageEvent("message", { data: publication }));
    });
    let runtime = drawingCanvasProps.multiDocumentRuntimePresentation!;
    const runtimeElements = runtime.elements;
    const imported = runtimeElements.find((element) => element.name === "Imported")!;
    const rootPoint = runtimeElements.find((element) => element.name === "A")!;
    drawingCanvasProps.evaluation = completeGraphSnapshotEvaluationFor(runtimeElements);
    act(() => {
      useCadUiStore.getState().setCanvasSelectionEligibility(runtimeElements, new Set(runtimeElements.map(({ id }) => id)));
      useCadUiStore.setState({
        selectedElementId: imported.id,
        selectedElementIds: [imported.id, rootPoint.id],
        selectionAnchorElementId: imported.id,
        selectionSubject: { kind: "elements" }
      });
    });
    await act(async () => { view.rerender(<VSCodeAppForTest api={api} />); });

    // Establish that every case starts from the same complete, current graph evaluation
    // and valid two-element Canvas selection as the successful positive control.
    expect(runtime.graphRevision).toBe(fixture.publication.graph.revision);
    expect(useCadUiStore.getState().selectedElementIds).toEqual([imported.id, rootPoint.id]);
    expect(useCadUiStore.getState().selectionSubject).toEqual({ kind: "elements" });
    for (const id of [imported.id, rootPoint.id]) {
      expect(drawingCanvasProps.evaluation.evaluatedElementIds).toContain(id);
      expect(drawingCanvasProps.evaluation.effectiveEnabledElementIds).toContain(id);
      expect(drawingCanvasProps.evaluation.effectiveVisibleElementIds).toContain(id);
      expect(drawingCanvasProps.evaluation.computedGeometry.has(id)).toBe(true);
    }
    expect(drawingCanvasProps.evaluation.computedGeometry.get(imported.id)).toMatchObject({ x: 50, y: 0 });
    expect(drawingCanvasProps.evaluation.computedGeometry.get(rootPoint.id)).toMatchObject({ x: 0, y: 0 });
    expect(evaluationStateControl.isCurrent).toBe(true);

    if (failure === "missing ownership") {
      const owners = publication.canvasRuntime!.modulePresentation.sourceOwnership!.owners;
      publication.canvasRuntime!.modulePresentation.sourceOwnership!.owners = owners
        .filter((owner) => owner.runtimeElementId !== imported.id);
    } else if (failure === "corrupted ownership") {
      const importedOwner = publication.canvasRuntime!.modulePresentation.sourceOwnership!.owners
        .find((owner) => owner.runtimeElementId === imported.id)!;
      importedOwner.statement.range.startLine += 1;
    } else if (failure === "stale graph") {
      publication.graph.revision += 1;
      expect(publication.graph.revision).not.toBe(runtime.graphRevision);
    } else if (failure === "changed imported dependency") {
      const changedPublication = structuredClone(publication);
      changedPublication.graph.revision += 1;
      changedPublication.canvasRuntime!.graphRevision += 1;
      changedPublication.canvasRuntime!.modulePresentation.sourceOwnership!.graphRevision += 1;
      const dependency = changedPublication.graph.dependencyFingerprints[0]!;
      dependency.savedSourceFingerprint += ":changed";
      publication = changedPublication;
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: publication }));
      });
      runtime = drawingCanvasProps.multiDocumentRuntimePresentation!;
      expect(runtime.graphRevision).toBe(publication.graph.revision);
      expect(publication.canvasRuntime!.modulePresentation.sourceOwnership!.graphRevision)
        .toBe(publication.graph.revision);
      expect(publication.canvasRuntime!.modulePresentation.sourceOwnership!.dependencySourceIdentities)
        .not.toEqual(publication.graph.dependencyFingerprints);
    } else if (failure === "stale evaluation") {
      evaluationStateControl.isCurrent = false;
    } else if (failure === "stale host document version") {
      const changedPublication = structuredClone(publication);
      changedPublication.documentVersion += 1;
      changedPublication.graph.revision += 1;
      changedPublication.canvasRuntime!.graphRevision += 1;
      changedPublication.canvasRuntime!.modulePresentation.sourceOwnership!.graphRevision += 1;
      publication = changedPublication;
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data: publication }));
      });
      expect(publication.documentVersion).not.toBe(issue1651DocumentVersion);
      expect(publication.canvasRuntime!.graphRevision).toBe(publication.graph.revision);
    } else if (failure === "stale host Source") {
      act(() => {
        useCadDocumentStore.getState().replaceTextDocument(`${fixture.source}\n`, {
          currentFilePath: null,
          dirtySinceSave: true
        });
      });
      expect(useCadDocumentStore.getState().sourceText).not.toBe(publication.graph.rootSource.normalizedSource);
    }

    const sourceBefore = useCadDocumentStore.getState().sourceText;
    const pastBefore = useCadDocumentStore.getState().past;
    const futureBefore = useCadDocumentStore.getState().future;
    const selectionPastBefore = useCadDocumentStore.getState().selectionPast;
    const selectionFutureBefore = useCadDocumentStore.getState().selectionFuture;
    const selectionBefore = useCadUiStore.getState().selectedElementIds;
    api.postMessage.mockClear();
    evaluationRevisionCapture.revisions = [];

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "canvasCommand", commandId: "duplicateAsSnapshot" }
      }));
    });

    if (failure === "missing ownership" || failure === "corrupted ownership") {
      expect(useCadUiStore.getState().commandErrorMessage)
        .toBe(`要素 ${imported.id} のSource位置を現在の文書で特定できません。`);
      expect(evaluationRevisionCapture.revisions).toContain(runtime.graphRevision);
    } else {
      expect(useCadUiStore.getState().commandErrorMessage)
        .toBe("現在のSource、Canvas選択、評価結果を確認できないため、スナップショットを中止しました。");
      if (failure === "stale graph") {
        expect(publication.graph.revision).not.toBe(runtime.graphRevision);
      } else if (failure === "changed imported dependency") {
        expect(publication.canvasRuntime!.graphRevision).toBe(publication.graph.revision);
        expect(publication.canvasRuntime!.modulePresentation.sourceOwnership!.dependencySourceIdentities)
          .not.toEqual(publication.graph.dependencyFingerprints);
      } else if (failure === "stale evaluation") {
        expect(evaluationStateControl.isCurrent).toBe(false);
        expect(evaluationRevisionCapture.revisions).toContain(runtime.graphRevision);
      } else if (failure === "stale host document version") {
        expect(publication.documentVersion).not.toBe(issue1651DocumentVersion);
      } else {
        expect(useCadDocumentStore.getState().sourceText).not.toBe(publication.graph.rootSource.normalizedSource);
      }
    }
    expect(api.postMessage.mock.calls.map(([message]) => message)
      .filter((message) => message?.type === "canvasCommit")).toHaveLength(0);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceBefore);
    expect(useCadDocumentStore.getState().past).toEqual(pastBefore);
    expect(useCadDocumentStore.getState().future).toEqual(futureBefore);
    expect(useCadDocumentStore.getState().selectionPast).toEqual(selectionPastBefore);
    expect(useCadDocumentStore.getState().selectionFuture).toEqual(selectionFutureBefore);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(selectionBefore);
  });

  it("uses the resolved Source Bake target for a target-scoped sandbox", async () => {
    const source = [
      "nui 1",
      "point Dependency = coordinate(x: 0, y: 0, enabled: false)",
      "line Broken = segment(start: @Dependency, end: (10, 0), enabled: false)"
    ].join("\n");
    const immediateEvaluate = vi.spyOn(VscodeRustTransport.prototype, "evaluate");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const broken = useCadDocumentStore.getState().elements.find((element) => element.name === "Broken")!;

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 20,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("Broken"),
          mode: "current",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
    });

    expect(drawingCanvasProps.bakeSandboxTargetIds).toEqual([broken.id]);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 20,
      status: "nothing"
    });
    expect(evaluationTransportCapture.bake).toBeTypeOf("function");
    const bakeTransport = evaluationTransportCapture.bake as (input: { elements: [] }) => Promise<unknown>;
    const pendingEvaluation = bakeTransport({ elements: [] });
    void pendingEvaluation.catch(() => undefined);
    expect(immediateEvaluate).toHaveBeenCalledTimes(1);
  });

  it.each(["current", "base"] as const)(
    "retains an exact Source Bake %s request while its evaluation is not current",
    async (mode) => {
      const source = [
        "nui 1",
        "point A = coordinate(x: 0, y: 0)"
      ].join("\n");
      const api = { postMessage: vi.fn() };
      const dispatchBake = vi.spyOn(commandRegistry, "dispatchCommand").mockReturnValue(false);
      evaluationStateControl.isCurrent = false;
      const view = render(<VSCodeAppForTest api={api} />);

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
        }));
        window.dispatchEvent(new MessageEvent("message", {
          data: {
            type: "bakeSourceRequest",
            requestId: mode === "current" ? 31 : 32,
            documentVersion: 1,
            normalizedSourceOffset: source.indexOf("A"),
            mode,
            emitSkippedComments: true,
            includeHiddenGeometry: false,
            includeDisabledGeometry: false
          }
        }));
      });

      const requestId = mode === "current" ? 31 : 32;
      expect(api.postMessage).not.toHaveBeenCalledWith({
        type: "bakeSourceResult",
        requestId,
        status: "stale"
      });

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
        }));
      });
      expect(api.postMessage).not.toHaveBeenCalledWith({
        type: "bakeSourceResult",
        requestId,
        status: "stale"
      });

      evaluationStateControl.isCurrent = true;
      await act(async () => {
        view.rerender(<VSCodeAppForTest api={api} />);
        await Promise.resolve();
      });

      expect(api.postMessage.mock.calls.filter(([message]) =>
        message?.type === "bakeSourceResult" && message.requestId === requestId
      )).toHaveLength(1);
      expect(dispatchBake).toHaveBeenCalledTimes(1);
      expect(dispatchBake).toHaveBeenCalledWith(
        mode === "current" ? "bakeCurrentShape" : "bakeBaseShape",
        expect.objectContaining({ sourceStatementIndex: expect.any(Number) })
      );
      view.unmount();
    }
  );

  it("fails closed when a deferred Source Bake loses document authority before evaluation is current", async () => {
    const source = "nui 1\npoint A = coordinate(x: 0, y: 0)";
    const newerSource = "nui 1\npoint Later = coordinate(x: 100, y: 0)";
    const api = { postMessage: vi.fn() };
    evaluationStateControl.isCurrent = false;
    const view = render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 33,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("A"),
          mode: "current",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: false
        }
      }));
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newerSource, documentVersion: 2, reason: "edit" }
      }));
    });

    evaluationStateControl.isCurrent = true;
    await act(async () => {
      view.rerender(<VSCodeAppForTest api={api} />);
      await Promise.resolve();
    });

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 33,
      status: "stale"
    });
    expect(api.postMessage.mock.calls.filter(([message]) =>
      message?.type === "bakeOperationResult" && message.surface === "source" && message.requestId === 33
    )).toHaveLength(0);
    view.unmount();
  });

  it("rejects a stale Source Bake sandbox without mutating the newer document", async () => {
    const source = [
      "nui 1",
      "point Dependency = coordinate(x: 0, y: 0, enabled: false)",
      "line Broken = segment(start: @Dependency, end: (10, 0), enabled: false)"
    ].join("\n");
    let resolveSandbox!: (value: unknown) => void;
    drawingCanvasProps.bakeSandboxPromise = new Promise((resolve) => {
      resolveSandbox = resolve;
    });
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 1 }
      }));
    });
    const newerSource = `${source}\n// newer authoritative text`;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "bakeSourceRequest",
          requestId: 21,
          documentVersion: 1,
          normalizedSourceOffset: source.indexOf("Broken"),
          mode: "current",
          emitSkippedComments: true,
          includeHiddenGeometry: false,
          includeDisabledGeometry: true
        }
      }));
      await Promise.resolve();
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: newerSource, documentVersion: 2, reason: "edit" }
      }));
      resolveSandbox({});
      await Promise.resolve();
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(newerSource);
    expect(useCadDocumentStore.getState().sourceText).not.toContain("Bake skipped:");
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "bakeSourceResult",
      requestId: 21,
      status: "stale"
    });
  });

  it("selects a concrete Module instance when a descendant is presented", async () => {
    const source = [
      "nui 1",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 31 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    const canvas = screen.getByTestId("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({})
    } as DOMRect);
    useCadUiStore.getState().setCanvasViewport({ panX: 0, panY: 0, zoom: 1 });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 311,
          documentVersion: 31,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual([instance.id]);
    expect(useCadUiStore.getState().selectedElementId).toBe(instance.id);
    expect(useCadUiStore.getState().selectedElementIds).not.toContain(child.id);
    expect(useCadUiStore.getState().canvasViewport).toEqual({ panX: -80, panY: 0, zoom: 1 });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 311,
      status: "resolved",
      degradations: []
    });
  });

  it("keeps the existing selection and viewport when a Module instance has no own presentation", async () => {
    const source = [
      "nui 1",
      "point Existing = coordinate(x: 0, y: 0)",
      "module M() {",
      "  point P = coordinate(x: 80, y: 0, visible: false)",
      "}",
      "instance A = M()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 32 }
      }));
    });
    const state = useCadDocumentStore.getState();
    const existing = state.elements.find((element) => element.name === "Existing")!;
    const instance = state.elements.find((element) => element.type === "moduleInstance" && element.name === "A")!;
    const child = state.elements.find((element) => element.parentGroupId === instance.id && element.name === "P")!;
    drawingCanvasProps.evaluation.computedGeometry.set(child.id, {
      kind: "point",
      elementId: child.id,
      name: child.name,
      x: 80,
      y: 0
    });
    useCadUiStore.getState().setCanvasSelectionEligibility(state.elements, new Set([existing.id]));
    selectElement(existing.id, "replace", true);
    useCadUiStore.getState().setCanvasViewport({ panX: 17, panY: -9, zoom: 2 });
    const viewportBefore = { ...useCadUiStore.getState().canvasViewport };

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "canvasNavigationRequest",
          requestId: 321,
          documentVersion: 32,
          normalizedSourceOffset: source.indexOf("A = M")
        }
      }));
    });

    expect(useCadUiStore.getState()).toMatchObject({
      selectedElementId: existing.id,
      selectedElementIds: [existing.id],
      selectionAnchorElementId: existing.id
    });
    expect(useCadUiStore.getState().canvasViewport).toEqual(viewportBefore);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "canvasNavigationResult",
      requestId: 321,
      status: "failed",
      reason: "no-revealable-runtime-target"
    });
  });

  it("reselects current materializations for a generated group inside a reusable Module body", async () => {
    const source = [
      "nui 1",
      "module Leaf() {",
      "  point P = coordinate(x: 80, y: 0)",
      "}",
      "module Outer() {",
      "  instance FirstChild = Leaf()",
      "  instance SecondChild = Leaf()",
      "}",
      "instance First = Outer()",
      "instance Second = Outer()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    render(<VSCodeAppForTest api={api} />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "replaceTextDocument", sourceText: source, documentVersion: 61 }
      }));
    });
    const before = useCadDocumentStore.getState();
    const childIndexes = before.doc.statements.flatMap((statement, index) =>
      statement.kind === "moduleInstance" && (statement.name === "FirstChild" || statement.name === "SecondChild")
        ? [index]
        : []
    );
    const childTargets = childIndexes.map((childIndex) => ({
      childIndex,
      statementId: before.doc.statementMap?.statementIdByStatementIndex?.get(childIndex)
    }));
    expect(childTargets).toHaveLength(2);
    expect(childTargets.every((target) => target.statementId)).toBe(true);
    if (childTargets.some((target) => !target.statementId)) return;
    const oldChildRuntimeIds = new Set(
      before.doc.moduleMaterialization?.executionStatements
        .filter((entry) => childIndexes.includes(entry.sourceStatementIndex))
        .map((entry) => entry.runtimeElementId) ?? []
    );

    const planned = planInlineModule({
      source: {
        normalizedSource: source,
        sourceRevision: before.currentSourceRevision
      },
      compiled: before.doc,
      targets: childTargets.map((target) => ({ documentKey: null, statementId: target.statementId! })),
      policy: {
        includeHiddenInstances: false,
        includeDisabledInstances: false
      }
    });
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    expect(planned.targets.filter((target) => target.status === "inlined")).toHaveLength(2);
    const nextSource = applyLineSplices(source, planned.splices);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: nextSource, documentVersion: 62, reason: "edit" }
      }));
    });
    const after = useCadDocumentStore.getState();
    const generatedGroupIndexes = after.doc.statements.flatMap((statement, index) =>
      statement.kind === "group" && (statement.name === "FirstChild" || statement.name === "SecondChild")
        ? [index]
        : []
    );
    expect(generatedGroupIndexes).toHaveLength(2);
    const generatedGroups = generatedGroupIndexes.map((index) => after.doc.statements[index]);
    expect(generatedGroups.every((statement) => statement?.kind === "group")).toBe(true);
    if (generatedGroups.some((statement) => statement?.kind !== "group")) return;

    const generatedGroupMaterializations = after.doc.moduleMaterialization!.executionStatements
      .filter((entry) => generatedGroupIndexes.includes(entry.sourceStatementIndex))
      .map((entry) => entry.runtimeElementId)
      .filter((id) => after.elements.some((element) => element.id === id));
    expect(generatedGroupMaterializations.length).toBeGreaterThanOrEqual(4);
    const generatedGroupMaterializationsInSourceOrder = generatedGroupIndexes.flatMap((groupIndex) =>
      after.doc.moduleMaterialization!.executionStatements
        .filter((entry) => entry.sourceStatementIndex === groupIndex)
        .map((entry) => entry.runtimeElementId)
        .filter((id) => after.elements.some((element) => element.id === id))
    );
    const generatedGeometryMaterializations = generatedGroupMaterializationsInSourceOrder.flatMap((groupId) =>
      after.elements.filter((element) => element.parentGroupId === groupId && element.name === "P").map((element) => element.id)
    );
    expect(generatedGeometryMaterializations.length).toBeGreaterThanOrEqual(4);
    for (const element of after.elements.filter((element) => element.name === "P")) {
      drawingCanvasProps.evaluation.computedGeometry.set(element.id, {
        kind: "point",
        elementId: element.id,
        name: element.name,
        x: 80,
        y: 0
      });
    }
    await act(async () => {
      publishAllCurrentElementsAsPresented();
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "inlineModuleSelectionRequest",
          requestId: 621,
          documentVersion: 62,
          normalizedSource: nextSource,
          generatedGroups: generatedGroupIndexes.map((generatedGroupIndex, index) => {
            const generatedGroup = generatedGroups[index]!;
            return {
              sourceStatementIndex: generatedGroupIndex,
              sourceRange: {
                from: generatedGroup.documentRange.from,
                to: generatedGroup.documentRange.to
              },
              generatedGroupName: generatedGroup.name
            };
          })
        }
      }));
    });

    expect(useCadUiStore.getState().selectedElementIds).toEqual(generatedGeometryMaterializations);
    expect(useCadUiStore.getState().selectedElementIds.some((id) => oldChildRuntimeIds.has(id))).toBe(false);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "inlineModuleSelectionResult",
      requestId: 621,
      documentVersion: 62,
      status: "selected",
      selectedRuntimeElementIds: generatedGeometryMaterializations
    });
  });

  it("keeps Canvas-origin Inline reselection out of selection history across Undo and Redo", async () => {
    const source = [
      "nui 1",
      "module Stamp() {",
      "  point Anchor = coordinate(x: 10, y: 20)",
      "}",
      "instance One = Stamp()"
    ].join("\n");
    const api = { postMessage: vi.fn() };
    const send = async (data: unknown) => {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", { data }));
      });
    };
    const canvasHistoryRequests = () => api.postMessage.mock.calls.filter(
      ([message]) => message?.type === "canvasHistoryRequest"
    );

    render(<VSCodeAppForTest api={api} />);
    await send({ type: "replaceTextDocument", sourceText: source, documentVersion: 1 });
    publishAllCurrentElementsAsPresented();

    const before = useCadDocumentStore.getState();
    const one = before.elements.find((element) =>
      element.type === "moduleInstance" && element.name === "One"
    );
    expect(one).toBeDefined();
    if (!one) return;
    const oldRuntimeElementIds = new Set(before.elements.map((element) => element.id));
    selectElement(one.id, "replace", true);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);

    const oneStatementIndex = before.doc.statements.findIndex((statement) =>
      statement.kind === "moduleInstance" && statement.name === "One"
    );
    const oneStatementId = before.doc.statementMap?.statementIdByStatementIndex?.get(oneStatementIndex);
    expect(oneStatementId).toBeDefined();
    if (!oneStatementId) return;
    const planned = planInlineModule({
      source: {
        normalizedSource: source,
        sourceRevision: before.currentSourceRevision
      },
      compiled: before.doc,
      targets: [{ documentKey: null, statementId: oneStatementId }],
      policy: {
        includeHiddenInstances: false,
        includeDisabledInstances: false
      }
    });
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const nextSource = applyLineSplices(source, planned.splices);
    expect(nextSource).toContain("group One {");

    // Model the successful Canvas-origin Source mutation through the same
    // pending commit/authoritative publication boundary used in production.
    useCadDocumentStore.getState().commitText(nextSource, "command");
    drawingCanvasProps.postCanvasCommit!(323);
    await send({
      type: "canvasCommitResult",
      operationId: 323,
      status: "accepted",
      documentVersion: 2
    });
    await send({
      type: "commitText",
      sourceText: nextSource,
      documentVersion: 2,
      reason: "edit"
    });

    const after = useCadDocumentStore.getState();
    const generatedGroupIndex = after.doc.statements.findIndex((statement) =>
      statement.kind === "group" && statement.name === "One"
    );
    expect(generatedGroupIndex).toBeGreaterThanOrEqual(0);
    if (generatedGroupIndex < 0) return;
    const generatedGroup = after.doc.statements[generatedGroupIndex];
    expect(generatedGroup?.kind).toBe("group");
    if (!generatedGroup || generatedGroup.kind !== "group") return;
    const generatedGroupRuntimeIds = after.doc.moduleMaterialization!.executionStatements
      .filter((entry) => entry.sourceStatementIndex === generatedGroupIndex)
      .map((entry) => entry.runtimeElementId)
      .filter((id) => after.elements.some((element) => element.id === id));
    const generatedGeometryIds = generatedGroupRuntimeIds.flatMap((groupId) =>
      after.elements
        .filter((element) => element.parentGroupId === groupId && element.name === "Anchor")
        .map((element) => element.id)
    );
    expect(generatedGeometryIds).not.toHaveLength(0);
    if (generatedGeometryIds.length === 0) return;
    for (const element of after.elements.filter((element) => element.name === "Anchor")) {
      drawingCanvasProps.evaluation.computedGeometry.set(element.id, {
        kind: "point",
        elementId: element.id,
        name: element.name,
        x: 10,
        y: 20
      });
    }
    publishAllCurrentElementsAsPresented();

    await send({
      type: "inlineModuleSelectionRequest",
      requestId: 632,
      documentVersion: 2,
      normalizedSource: nextSource,
      generatedGroups: [{
        sourceStatementIndex: generatedGroupIndex,
        sourceRange: {
          from: generatedGroup.documentRange.from,
          to: generatedGroup.documentRange.to
        },
        generatedGroupName: generatedGroup.name
      }]
    });

    expect(useCadDocumentStore.getState().sourceText).toBe(nextSource);
    expect(useCadUiStore.getState().selectedElementIds).toEqual(generatedGeometryIds);
    expect(useCadUiStore.getState().selectedElementIds.some((id) => oldRuntimeElementIds.has(id))).toBe(false);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(useCadDocumentStore.getState().past.at(-1)?.selection).toMatchObject({
      selectedElementId: one.id,
      selectedElementIds: [one.id],
      selectionAnchorElementId: one.id
    });
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "inlineModuleSelectionResult",
      requestId: 632,
      documentVersion: 2,
      status: "selected",
      selectedRuntimeElementIds: generatedGeometryIds
    });

    await send({ type: "canvasCommand", commandId: "undo" });
    expect(canvasHistoryRequests()).toHaveLength(1);
    expect(canvasHistoryRequests()[0]?.[0]).toEqual({
      type: "canvasHistoryRequest",
      direction: "undo",
      expectedDocumentVersion: 2
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual(generatedGeometryIds);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: source, documentVersion: 3, reason: "undo" }
      }));
    });
    const undoOne = useCadDocumentStore.getState().elements.find((element) =>
      element.type === "moduleInstance" && element.name === "One"
    );
    expect(undoOne).toBeDefined();
    if (!undoOne) return;
    expect(undoOne.id).not.toBe(one.id);
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
    await act(async () => {
      publishAllCurrentElementsAsPresented();
      await Promise.resolve();
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await send({ type: "canvasHistoryResult", direction: "undo", status: "completed", documentVersion: 3 });
    await send({ type: "canvasCommand", commandId: "undo" });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await send({ type: "canvasCommand", commandId: "redo" });
    expect(useCadUiStore.getState().selectedElementIds).toEqual([]);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(1);
    expect(canvasHistoryRequests()).toHaveLength(1);

    await send({ type: "canvasCommand", commandId: "redo" });
    expect(canvasHistoryRequests()).toHaveLength(2);
    expect(canvasHistoryRequests()[1]?.[0]).toEqual({
      type: "canvasHistoryRequest",
      direction: "redo",
      expectedDocumentVersion: 3
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "commitText", sourceText: nextSource, documentVersion: 4, reason: "redo" }
      }));
      publishAllCurrentElementsAsPresented();
      await Promise.resolve();
    });
    const redoState = useCadDocumentStore.getState();
    const redoGroupRuntimeIds = redoState.doc.moduleMaterialization!.executionStatements
      .filter((entry) => entry.sourceStatementIndex === generatedGroupIndex)
      .map((entry) => entry.runtimeElementId)
      .filter((id) => redoState.elements.some((element) => element.id === id));
    const redoGeneratedGeometryIds = redoGroupRuntimeIds.flatMap((groupId) =>
      redoState.elements
        .filter((element) => element.parentGroupId === groupId && element.name === "Anchor")
        .map((element) => element.id)
    );
    expect(redoGeneratedGeometryIds).not.toHaveLength(0);
    await send({ type: "canvasHistoryResult", direction: "redo", status: "completed", documentVersion: 4 });
    for (const element of redoState.elements.filter((element) => element.name === "Anchor")) {
      drawingCanvasProps.evaluation.computedGeometry.set(element.id, {
        kind: "point",
        elementId: element.id,
        name: element.name,
        x: 10,
        y: 20
      });
    }
    await act(async () => {
      publishAllCurrentElementsAsPresented();
      await Promise.resolve();
    });
    const redoGroupStatement = redoState.doc.statements[generatedGroupIndex];
    expect(redoGroupStatement?.kind).toBe("group");
    if (!redoGroupStatement || redoGroupStatement.kind !== "group") return;
    await send({
      type: "inlineModuleSelectionRequest",
      requestId: 633,
      documentVersion: 4,
      normalizedSource: nextSource,
      generatedGroups: [{
        sourceStatementIndex: generatedGroupIndex,
        sourceRange: {
          from: redoGroupStatement.documentRange.from,
          to: redoGroupStatement.documentRange.to
        },
        generatedGroupName: redoGroupStatement.name
      }]
    });
    expect(useCadUiStore.getState().selectedElementIds).toEqual(redoGeneratedGeometryIds);
    expect(useCadUiStore.getState().selectedElementIds.some((id) => oldRuntimeElementIds.has(id))).toBe(false);
    expect(useCadDocumentStore.getState().selectionPast).toHaveLength(0);
    expect(api.postMessage).toHaveBeenCalledWith({
      type: "inlineModuleSelectionResult",
      requestId: 633,
      documentVersion: 4,
      status: "selected",
      selectedRuntimeElementIds: redoGeneratedGeometryIds
    });
    expect(useCadDocumentStore.getState().sourceText).toBe(nextSource);
  });

});

it("supplies the open Host root across a graph gap and rejects a superseded publication", async () => {
  const fixture = await buildIssue1651ImportedModuleCanvasEditFixture(true);
  const root = issue1651RootDocumentUri;
  const version = issue1651DocumentVersion;
  const send = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
  const view = render(<VSCodeAppForTest api={{ postMessage: vi.fn() }} />);
  expect(drawingCanvasProps.hostRootDocumentId).toBeNull();

  send({ type: "replaceTextDocument", documentVersion: version, sourceText: fixture.source, hostDocumentUri: root });
  const epoch = drawingCanvasProps.hostDocumentEpoch;
  expect(drawingCanvasProps.hostRootDocumentId).toBe(root);
  send(fixture.publication);
  expect(drawingCanvasProps.multiDocumentRuntimePresentation?.rootDocumentId).toBe(root);
  expect(drawingCanvasProps.awaitingHostGraph).toBe(false);

  send({
    type: "multiDocumentGraphPublication",
    documentVersion: version,
    status: "invalidated",
    hostDocumentUri: root,
    graph: null
  });
  send(fixture.publication);
  expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
  expect(drawingCanvasProps.awaitingHostGraph).toBe(true);
  expect(drawingCanvasProps.hostRootDocumentId).toBe(root);

  send({
    type: "commitText",
    documentVersion: version + 1,
    sourceText: fixture.source.replace("x: 0", "x: 15"),
    hostDocumentUri: root,
    reason: "edit"
  });
  send(fixture.publication);
  expect(drawingCanvasProps.multiDocumentRuntimePresentation).toBeNull();
  expect(drawingCanvasProps.hostRootDocumentId).toBe(root);
  expect(drawingCanvasProps.hostDocumentEpoch).toBe(epoch);

  send({
    type: "replaceTextDocument",
    documentVersion: version + 2,
    sourceText: fixture.source,
    hostDocumentUri: "file:///workspace/another.nui"
  });
  expect(drawingCanvasProps.hostRootDocumentId).toBe("file:///workspace/another.nui");
  expect(drawingCanvasProps.hostDocumentEpoch).toBe(epoch + 1);
  send({
    type: "multiDocumentGraphPublication",
    documentVersion: null,
    status: "unavailable",
    hostDocumentUri: "file:///workspace/another.nui",
    graph: null
  });
  expect(drawingCanvasProps.hostRootDocumentId).toBeNull();
  view.unmount();
});
